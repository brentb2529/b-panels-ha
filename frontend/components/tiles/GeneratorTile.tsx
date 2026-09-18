import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconZap, IconSettings, IconCheck, IconAlertTriangle, IconX } from '../icons';
import { fluidTextSm, fluidTextXs, fluidTextLg, fluidGap } from './tileScale';
import { apiFetchGenerator } from '../../services/api';
import { useEnergyTrakGenerator } from '../../hooks/useEnergyTrakGenerator';

// The Generator tile is a config-stored virtual device. Its `device.state`
// holds the tile CONFIG — { endpoint, siteId, refresh } — not live telemetry.
// The endpoint is fetched server-side (CORS-safe, LAN-allowed) via the
// b_panels integration; the parsed JSON document is the live "state" the rest
// of this component renders, exactly matching the original EnergyTrak shape.
interface GeneratorConfig {
    // Either a full URL to the site-details document, or a base URL that we
    // join with `/energytrak/site-details/<siteId>`.
    endpoint?: string;
    siteId?: string;
    refresh?: number; // seconds; default 60
}

// Build the absolute document URL from the stored config. Supports both a
// ready-made full URL and a base URL + siteId pair.
function resolveEndpointUrl(cfg: GeneratorConfig): string | null {
    const endpoint = (cfg.endpoint || '').trim();
    const siteId = (cfg.siteId || '').trim();
    if (!endpoint) return null;
    // Already a site-details URL (or any path) → use verbatim.
    if (/\/site-details\//.test(endpoint) || /\/genmon/i.test(endpoint)) return endpoint;
    // Base URL + siteId → join.
    if (siteId) {
        const base = endpoint.replace(/\/+$/, '');
        return `${base}/energytrak/site-details/${encodeURIComponent(siteId)}`;
    }
    return endpoint;
}

// Shown wherever the generator does not report a field at all. Distinct from a
// real 0: some units never report output voltage, RPM or load, so those rows
// are genuinely absent rather than zero.
const EM_DASH = '\u2014';

// Derive human-readable reasons for why a generator tile is in warning / error
// state. Returns the most important reasons first (so the tile can truncate to
// the top one or two). The same list drives the modal's prominent banner, so
// a technician sees everything without relying on tooltips (they don't work
// on the wall-mounted touch panels).
function deriveReasons(state: Record<string, any>): { severity: 'error' | 'warning' | 'info'; text: string }[] {
    const reasons: { severity: 'error' | 'warning' | 'info'; text: string }[] = [];

    const lc = (v: any) => String(v || '').toLowerCase();
    const siteHealth = lc(state.siteHealth);
    const generatorHealth = lc(state.generatorHealth);
    const gridHealth = lc(state.gridHealth);
    const status = lc(state.status);
    const gridStatus = lc(state.gridStatus);
    const utilityMon = String(state.utilityMonitor || '');

    // 1. Fault condition (hard) — highest severity
    if (state.fault === true || state.faultCondition === true) {
        reasons.push({ severity: 'error', text: 'Fault condition active' });
    }

    // 2. Active alarms
    if (Array.isArray(state.activeAlarms) && state.activeAlarms.length > 0) {
        const names = state.activeAlarms.slice(0, 3).join(', ');
        const extra = state.activeAlarms.length > 3 ? ` +${state.activeAlarms.length - 3} more` : '';
        reasons.push({ severity: 'error', text: `Alarm${state.activeAlarms.length > 1 ? 's' : ''}: ${names}${extra}` });
    }

    // 2b. THE BRIDGE ITSELF.
    //
    // Without these the worst failure is invisible. When the bridge stops
    // answering, or the generator stops answering the bridge, the readings do
    // not blank — they FREEZE at their last values, and the tile would keep
    // showing a healthy generator indefinitely from data that stopped being
    // true hours ago. That is the one failure a status tile must never render
    // as "fine".
    //
    // Only raised when the field exists, so a cloud-only install is untouched.
    if (state.bridgeReachable === false) {
        reasons.push({ severity: 'error', text: 'Local bridge unreachable — readings may be stale' });
    } else if (state.busHealthy === false) {
        reasons.push({ severity: 'error', text: 'Generator not answering the bridge — readings frozen' });
    } else if (state.telemetrySource === 'cloud' && state.bridgeHost) {
        // A bridge is configured but is not the source. Not an emergency, but
        // the resolution and latency are gone, and silence about it is how a
        // degraded install stays degraded.
        reasons.push({ severity: 'warning', text: 'Falling back to cloud data — bridge not in use' });
    }

    // 3. Site / generator / grid health — escalating by worst level
    for (const [label, h] of [['Site', siteHealth], ['Generator', generatorHealth], ['Grid', gridHealth]] as const) {
        if (h === 'critical' || h === 'error') {
            reasons.push({ severity: 'error', text: `${label} health: ${h}` });
        } else if (h === 'warning' || h === 'notice') {
            reasons.push({ severity: 'warning', text: `${label} health: ${h}` });
        }
    }

    // 4. Utility / grid monitor string from controller. The genmon emits
    //    threshold-status strings like "STOPPED OVER 150V" / "RUNNING OVER
    //    150V" / "STOPPED UNDER 100V" as part of NORMAL operation — they
    //    describe which voltage-window guard is currently armed, not a fault.
    //    Only surface strings that don't look like an OK/READY/MONITORING or
    //    one of those threshold-armed states.
    const utilityNormal = /^(ok|ready|monitoring)$/i.test(utilityMon)
        || /^(stopped|running)\s+(over|under)\s+\d+\s*v?$/i.test(utilityMon);
    if (utilityMon && !utilityNormal) {
        reasons.push({ severity: 'warning', text: `Utility: ${utilityMon}` });
    }

    // 5. Non-present grid
    if (gridStatus && !['present', 'good', 'monitoring'].includes(gridStatus)) {
        reasons.push({ severity: 'warning', text: `Grid status: ${state.gridStatus}` });
    }

    // 6. Status string surfacing if it's explicitly "warning" / "critical" and
    //    we haven't already captured the reason via a health field.
    if (['warning', 'critical', 'error'].includes(status)) {
        const already = reasons.some(r => r.text.toLowerCase().includes(status));
        if (!already) {
            reasons.push({ severity: status === 'warning' ? 'warning' : 'error', text: `Status: ${state.status}` });
        }
    }

    // 7. Vendor freshness is intentionally NOT surfaced as a warning. The
    //    `equipmentDataStale` / `equipmentDataAgeSeconds` fields reflect a vendor
    //    telemetry timestamp that frequently never updates (observed 200+ days
    //    "stale" on a perfectly healthy unit), so it produced a bogus standing
    //    warning on the main widget. Real problems are caught by fault state,
    //    active alarms, and component health above.

    return reasons;
}

const StatusBadge = ({ label, status }: { label: string, status: 'ok' | 'warning' | 'error' | 'active' }) => {
    const colors = {
        ok: 'bg-green-500/20 text-green-400 border-green-500/30',
        warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        error: 'bg-red-500/20 text-red-400 border-red-500/30',
        active: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };
    const style = colors[status] || colors.ok;

    return (
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${style}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            {(status === 'ok' || status === 'active') && (
                <div className="bg-green-500 rounded-full p-0.5">
                    <IconCheck className="w-2.5 h-2.5 text-black" strokeWidth={4} />
                </div>
            )}
            {(status === 'warning' || status === 'error') && (
                <div className="bg-red-500 rounded-full p-0.5">
                    <IconAlertTriangle className="w-2.5 h-2.5 text-black" strokeWidth={4} />
                </div>
            )}
        </div>
    );
};

const DetailRow = ({ icon: Icon, label, status, health }: any) => {
    const getStatusColor = (h: string, s: string) => {
        const lh = (h || '').toLowerCase();
        const ls = (s || '').toLowerCase();
        if ((lh === 'good' || lh === 'healthy' || lh === 'ok') && ls !== 'offline' && ls !== 'error') return 'text-green-400';
        if (lh === 'warning' || ls === 'offline') return 'text-yellow-400';
        if (lh === 'critical' || lh === 'error' || ls === 'error') return 'text-red-400';
        return 'text-gray-400';
    };

    return (
        <div className="flex items-center justify-between py-1 border-b border-white/10 last:border-0 w-full">
            <div className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5 text-gray-300" />
                <span className="font-semibold text-gray-300 uppercase tracking-wide" style={{ fontSize: 'clamp(0.5rem, 4.5cqmin, 0.65rem)' }}>{label}</span>
            </div>
            <div className="flex items-center gap-2">
                <span className={`font-bold ${getStatusColor(health, status)}`} style={{ fontSize: 'clamp(0.5rem, 4.5cqmin, 0.65rem)' }}>
                    {status || 'Unknown'}
                </span>
            </div>
        </div>
    );
};

const MetricItem = ({ label, value, unit }: { label: string, value: string | number, unit?: string }) => (
    <div
        className="flex flex-col items-center justify-center rounded-control p-1.5 flex-1 border border-white/10"
        style={{ background: 'rgb(0 0 0 / 0.22)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06), inset 0 -2px 5px rgb(0 0 0 / 0.35)' }}
    >
        <span className="uppercase font-bold tracking-wider text-gray-300" style={{ fontSize: 'clamp(0.45rem, 4.5cqmin, 0.6rem)' }}>{label}</span>
        <span className="font-bold text-white leading-tight tabular-nums" style={fluidTextSm}>
            {value}<span className="text-gray-400 ml-0.5 font-normal" style={{ fontSize: 'clamp(0.45rem, 4cqmin, 0.65rem)' }}>{unit}</span>
        </span>
    </div>
);

// A dimensional generator illustration sitting on a soft accent-tinted halo.
// Running units glow amber; idle/faulted read as a quiet metal box. This turns
// the previously flat gray rectangle into the tile's clear focal point.
/**
 * The generator, drawn as a standby set rather than a box with three lines.
 *
 * The previous version was a white rounded rectangle with three stripes, which
 * read as a kitchen appliance. A whole-home standby unit has a very specific
 * silhouette and it is worth getting right, because this tile is glanced at far
 * more often than it is read: a wide low enclosure, an overhanging peaked lid,
 * and tall louvre banks that occupy most of the side. Those three things are
 * what make it recognisable at 40 pixels.
 *
 * Drawn in a shallow three-quarter view so it has depth without needing to be
 * large, and standing on its pad -- these things are never on grass.
 *
 * Motion is reserved for states that matter. Running adds exhaust haze and a
 * steady green lamp; a fault turns the lamp red and stops the haze, because a
 * faulted set is not moving air. Both are suppressed under
 * prefers-reduced-motion, where the colour alone still carries it.
 */
const GeneratorGraphic = ({ running, fault }: { running: boolean; fault: boolean }) => {
    const glowColor = fault ? '#ef4444' : running ? '#fbbf24' : 'transparent';
    // Louvre slats, generated rather than hand-placed so the spacing stays even.
    const slats = Array.from({ length: 9 }, (_, i) => 50 + i * 7);
    return (
        <div className="relative flex items-center justify-center" style={{ width: 'clamp(4rem, 46cqmin, 8rem)', aspectRatio: '200 / 140' }}>
            {(running || fault) && (
                <div
                    className="absolute rounded-full blur-2xl pointer-events-none"
                    style={{ width: '85%', height: '80%', background: glowColor, opacity: fault ? 0.4 : 0.3 }}
                />
            )}
            <svg viewBox="0 0 200 140" className="relative w-full h-full" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.45))' }}>
                <style>{`@media (prefers-reduced-motion: reduce){
                    .gen-anim{animation:none !important; display:none}
                    .gen-anim-keep{animation:none !important}}`}</style>
                <defs>
                    <linearGradient id="genFace" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e7ebf0" />
                        <stop offset="55%" stopColor="#c3cad3" />
                        <stop offset="100%" stopColor="#98a1ad" />
                    </linearGradient>
                    <linearGradient id="genSide" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#8b94a1" />
                        <stop offset="100%" stopColor="#6b7480" />
                    </linearGradient>
                    <linearGradient id="genRoof" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f4f7fa" />
                        <stop offset="100%" stopColor="#cbd3dc" />
                    </linearGradient>
                    <linearGradient id="genRecess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2b3442" />
                        <stop offset="100%" stopColor="#141a23" />
                    </linearGradient>
                    <linearGradient id="genPad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4b5563" />
                        <stop offset="100%" stopColor="#262c36" />
                    </linearGradient>
                </defs>

                {/* Pad, in the same shallow perspective as the body. */}
                <path d="M14 118 L178 118 L192 128 L26 128 Z" fill="url(#genPad)" />
                <path d="M14 118 L178 118 L178 121 L14 121 Z" fill="#6b7280" opacity="0.5" />

                {/* Receding right-hand side. Drawn before the face so the face
                    overlaps it cleanly at the corner. */}
                <path d="M162 40 L178 32 L178 112 L162 118 Z" fill="url(#genSide)" stroke="#5b6472" strokeWidth="1.2" />

                {/* Body face */}
                <path d="M22 40 L162 40 L162 118 L22 118 Z" fill="url(#genFace)" stroke="#5b6472" strokeWidth="1.6" />

                {/* Overhanging peaked lid -- the most recognisable feature. */}
                <path d="M16 40 L168 40 L184 31 L30 31 Z" fill="url(#genRoof)" stroke="#8b94a1" strokeWidth="1.2" />
                <path d="M16 40 L168 40 L168 44 L16 44 Z" fill="#aab3be" opacity="0.75" />
                <path d="M30 31 L184 31 L182 28 L32 28 Z" fill="#dfe5ec" />
                {/* Lid seam */}
                <line x1="95" y1="31" x2="95" y2="40" stroke="#9aa3ae" strokeWidth="0.8" opacity="0.8" />

                {/* Louvre bank: a recess with slats, which is what actually
                    makes the silhouette read as a generator rather than a box. */}
                <rect x="36" y="44" width="110" height="64" rx="3" fill="url(#genRecess)" stroke="#39414f" strokeWidth="1.2" />
                {slats.map((y) => (
                    <g key={y}>
                        <line x1="41" y1={y} x2="141" y2={y} stroke="#8e97a4" strokeWidth="2.1" strokeLinecap="round" opacity="0.85" />
                        <line x1="41" y1={y + 1.5} x2="141" y2={y + 1.5} stroke="#0f141b" strokeWidth="1.1" strokeLinecap="round" opacity="0.9" />
                    </g>
                ))}

                {/* Control panel door, right of the louvres. */}
                <rect x="149" y="52" width="9" height="30" rx="1.5" fill="#aeb6c1" stroke="#69727f" strokeWidth="1" />
                <circle cx="153.5" cy="86" r="1.6" fill="#69727f" />

                {/* Status lamp. Green steady while running, red on fault, dark
                    when stopped -- never green-and-blinking for both. */}
                <circle cx="153.5" cy="96" r="4.2"
                    fill={fault ? '#ef4444' : running ? '#22c55e' : '#39414f'}
                    stroke="#2b3442" strokeWidth="0.8"
                    style={glowColor !== 'transparent'
                        ? { filter: `drop-shadow(0 0 5px ${fault ? '#ef4444' : '#22c55e'})` } : undefined}>
                    {(running && !fault) && (
                        <animate className="gen-anim-keep" attributeName="opacity"
                            values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
                    )}
                </circle>

                {/* Exhaust, low on the receding side, with haze only while the
                    engine is actually turning and not faulted. */}
                <rect x="166" y="98" width="12" height="7" rx="2" fill="#39414f" stroke="#2b3442" strokeWidth="0.8" />
                {running && !fault && (
                    <g className="gen-anim">
                        <circle cx="182" cy="99" r="3.4" fill="#cbd5e1" opacity="0.32">
                            <animate attributeName="cy" values="99;86;80" dur="2.4s" repeatCount="indefinite" />
                            <animate attributeName="r" values="2.4;5.5;7.5" dur="2.4s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.34;0.16;0" dur="2.4s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="180" cy="99" r="2.6" fill="#cbd5e1" opacity="0.26">
                            <animate attributeName="cy" values="99;88;82" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
                            <animate attributeName="r" values="1.8;4.4;6.2" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.28;0.13;0" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
                        </circle>
                    </g>
                )}
            </svg>
        </div>
    );
};

/**
 * Live panel at the top of the modal WHILE THE ENGINE IS TURNING.
 *
 * A running generator is the one moment this tile has something that a list of
 * static rows says badly. Speed, output, frequency, load and coolant all move,
 * and they move together — watching them settle is how you tell a healthy start
 * from a sick one.
 *
 * The rotor's spin period is driven by ACTUAL reported RPM rather than being a
 * fixed decorative animation. That is the point: during the low-speed warm-up
 * this unit does (~2800 RPM against 3600 at full song) the rotor visibly turns
 * slower, so "it has not stepped up yet" becomes something you see rather than
 * a number whose significance you have to already know.
 *
 * prefers-reduced-motion holds the rotor still; the numbers carry the whole
 * message on their own, which they can.
 */
const RunningHero = ({ state }: { state: Record<string, any> }) => {
    const num = (v: any) => (v === undefined || v === null || v === '' ? undefined : Number(v));
    const rpm = num(state.engineSpeed);
    const volts = num(state.outputVoltage);
    const hz = num(state.generatorFrequency);
    const kw = num(state.loadPower);
    const pct = num(state.percentageLoad);
    const cool = num(state.coolantTemperature);
    const batt = num(state.batteryVoltage);

    // 3600 RPM -> one turn per second, scaled from there and clamped so a stale
    // or absurd reading cannot strobe or freeze the rotor.
    const period = rpm && rpm > 50 ? Math.min(4, Math.max(0.25, 3600 / rpm)) : 0;
    // Below ~3400 the machine is warming up rather than ready to carry load.
    // Naming that beats showing a bare number.
    const atSpeed = rpm !== undefined && rpm >= 3400;

    const Reading = ({ label, value, unit }: { label: string; value?: number; unit?: string }) => (
        <div className="flex flex-col items-center justify-center px-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
            <span className="font-bold text-white tabular-nums leading-tight" style={{ fontSize: 'clamp(0.95rem, 4.2vw, 1.4rem)' }}>
                {value === undefined || Number.isNaN(value) ? EM_DASH : value.toFixed(unit === 'V' || unit === 'RPM' ? 0 : 1)}
                {value !== undefined && !Number.isNaN(value) && unit
                    ? <span className="text-[11px] font-medium text-gray-400 ml-0.5">{unit}</span> : null}
            </span>
        </div>
    );

    return (
        <div className="p-4 border-b border-amber-500/30 bg-gradient-to-b from-amber-900/25 to-transparent">
            <style>{`@keyframes binfohubSpin{to{transform:rotate(360deg)}}
                @media (prefers-reduced-motion: reduce){.binfohub-rotor{animation:none !important}}`}</style>
            <div className="flex items-center gap-3 mb-3">
                <svg viewBox="0 0 48 48" className="w-11 h-11 shrink-0" aria-hidden="true">
                    <circle cx="24" cy="24" r="21" fill="none" stroke="#f59e0b" strokeOpacity="0.35" strokeWidth="2" />
                    <g className="binfohub-rotor"
                       style={period ? { animation: `binfohubSpin ${period}s linear infinite`, transformOrigin: '24px 24px' } : undefined}>
                        <path d="M24 5 L27.4 20 L24 24 L20.6 20 Z" fill="#fbbf24" />
                        <path d="M40.5 33.5 L26.6 27.2 L24 24 L29 22.7 Z" fill="#fbbf24" fillOpacity="0.85" />
                        <path d="M7.5 33.5 L19 22.7 L24 24 L21.4 27.2 Z" fill="#fbbf24" fillOpacity="0.7" />
                    </g>
                    <circle cx="24" cy="24" r="3.2" fill="#78350f" stroke="#fbbf24" strokeWidth="1.4" />
                </svg>
                <div className="min-w-0">
                    <div className="text-amber-300 font-bold text-sm uppercase tracking-wider">
                        {state.exercising || state.scheduledExerciseInProgress ? 'Exercise running' : 'Generator running'}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                        {rpm === undefined ? 'Speed not reported'
                            : atSpeed ? 'At rated speed' : 'Low-speed warm-up — not yet at rated speed'}
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-4 gap-1">
                <Reading label="Speed" value={rpm} unit="RPM" />
                <Reading label="Output" value={volts} unit="V" />
                <Reading label="Freq" value={hz} unit="Hz" />
                <Reading label="Load" value={kw !== undefined ? kw : pct} unit={kw !== undefined ? 'kW' : '%'} />
            </div>
            <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-white/10">
                <Reading label="Coolant" value={cool} unit="\u00B0" />
                <Reading label="Battery" value={batt} unit="V" />
            </div>
        </div>
    );
};

const GeneratorDetailModal = ({ name, state, onClose }: { name: string, state: Record<string, any>, onClose: () => void }) => {
    const reasons = deriveReasons(state);
    const hasErrors = reasons.some(r => r.severity === 'error');

    // Format a value, keeping a real 0 but rendering absent data as an em dash.
    const fmt = (val: any, suffix = '') => {
        if (val === undefined || val === null || val === '') return EM_DASH;
        return `${val}${suffix}`;
    };
    // For plain string rows that would otherwise render blank when undefined.
    const txt = (val: any) => (val === undefined || val === null || val === '' ? EM_DASH : String(val));

    const detailItems = [
        { label: 'Status', value: txt(state.status) },
        { label: 'Active', value: state.active ? 'Yes' : 'No' },
        { label: 'Site Status', value: txt(state.siteStatus), isHeader: true },
        { label: 'Site Health', value: txt(state.siteHealth) },
        { label: 'Grid Status', value: txt(state.gridStatus) },
        { label: 'Grid Health', value: txt(state.gridHealth) },
        { label: 'Utility Monitor', value: txt(state.utilityMonitor) },
        { label: 'Generator Status', value: txt(state.generatorStatus), isHeader: true },
        { label: 'Generator Health', value: txt(state.generatorHealth) },
        { label: 'Battery Voltage', value: fmt(state.batteryVoltage, ' V') },
        { label: 'Engine Hours', value: fmt(state.engineHours, ' hrs') },
        { label: 'Grid Voltage', value: fmt(state.gridVoltage, ' V') },
        { label: 'Grid Frequency', value: fmt(state.gridFrequency, ' Hz') },
        { label: 'Gen Frequency', value: fmt(state.generatorFrequency, ' Hz') },
        { label: 'Output Voltage', value: fmt(state.outputVoltage, ' V') },
        { label: 'Engine Speed', value: fmt(state.engineSpeed, ' RPM') },
        { label: 'Starts', value: state.startsCount },
        { label: 'Trips', value: state.tripsCount },
        { label: 'Load Power', value: fmt(state.loadPower) },
        { label: 'Smart Mode', value: state.smartModeEnabled === true ? `Enabled (${state.smartModeDetection || 'Auto'})` : state.smartModeEnabled === false ? 'Disabled' : EM_DASH, isHeader: true },
        { label: 'Heartbeat (cleanState)', value: state.cleanStateLastUpdated ? new Date(state.cleanStateLastUpdated).toLocaleString() : EM_DASH },
        { label: 'Equipment Telemetry', value: state.equipmentDataTimestamp ? `${new Date(state.equipmentDataTimestamp).toLocaleString()} ${state.equipmentDataStale ? '(stale)' : '(fresh)'}` : EM_DASH },
        { label: 'Last Updated', value: state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : EM_DASH },
        { label: 'Polled At', value: state.polledAt ? new Date(state.polledAt).toLocaleString() : EM_DASH },

        // ---- Local B-Infohub bridge --------------------------------------
        // Off the generator's own Modbus bus rather than the EnergyTrak cloud,
        // and present only while a bridge is attached. The shared rows above
        // are NOT repeated here: they are already local-backed when the bridge
        // is live, and showing a reading twice implies two sources that could
        // disagree. Each degrades to an em dash on a cloud-only install, which
        // is the honest rendering of "this generator has no bridge".
        { label: 'Telemetry Source', value: state.telemetrySource
            ? (state.telemetrySource === 'local' ? 'Local bridge' : 'EnergyTrak cloud')
            : EM_DASH, isHeader: true },
        { label: 'Bridge Address', value: txt(state.bridgeHost) },
        { label: 'Bridge Reachable', value: state.bridgeReachable === undefined
            ? EM_DASH : (state.bridgeReachable ? 'Yes' : 'NO') },
        // Separate from the row above on purpose: both look like "values
        // stopped moving", but one is the bridge not answering and the other is
        // the generator having gone quiet on the bridge.
        { label: 'Generator Answering Bus', value: state.busHealthy === undefined
            ? EM_DASH : (state.busHealthy ? 'Yes' : 'NO') },
        { label: 'Bus Data Age', value: state.localBusAgeSeconds === undefined
            ? EM_DASH : `${Number(state.localBusAgeSeconds).toFixed(0)} s` },
        { label: 'Coolant Temp', value: fmt(state.coolantTemperature, '\u00B0') },
        { label: 'Load', value: state.percentageLoad === undefined
            ? EM_DASH : `${Number(state.percentageLoad).toFixed(0)} %` },
        { label: 'Gen L1-L2', value: fmt(state.generatorL1L2Voltage, ' V') },
        { label: 'Utility L1 / L2', value:
            (state.utilityL1Voltage === undefined && state.utilityL2Voltage === undefined)
                ? EM_DASH
                : `${state.utilityL1Voltage ?? EM_DASH} / ${state.utilityL2Voltage ?? EM_DASH} V` },
        { label: 'Lifetime Energy', value: fmt(state.cumulativeEnergyKwh, ' kWh') },
        { label: 'Exercising', value: (state.exercising || state.scheduledExerciseInProgress)
            ? 'Yes' : (state.exercising === undefined ? EM_DASH : 'No') },
    ];

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden border border-gray-700 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-700 shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-white">{name}</h3>
                        <p className="text-xs text-gray-400">Detailed Status</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-700 transition-colors">
                        <IconX className="w-6 h-6" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-0">
                    {/* Live panel first while the engine is turning: during a
                        run the moving numbers ARE the story, and they belong
                        above the static rows rather than buried under them. */}
                    {(state.active === true || state.engineRunning === true) && <RunningHero state={state} />}

                    {/* Prominent reason banner — always visible when the tile is
                        showing anything other than "ok", so the user never has
                        to hunt for why a warning exists. Touch-friendly (no hover). */}
                    {reasons.length > 0 && (
                        <div className={`p-4 border-b ${hasErrors ? 'bg-red-900/30 border-red-500/40' : 'bg-yellow-900/30 border-yellow-500/40'}`}>
                            <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider mb-2 ${hasErrors ? 'text-red-300' : 'text-yellow-300'}`}>
                                <IconAlertTriangle className="w-4 h-4" />
                                {hasErrors ? `${reasons.filter(r => r.severity === 'error').length} Issue(s)` : `Status: ${reasons.length} warning${reasons.length > 1 ? 's' : ''}`}
                            </div>
                            <ul className="space-y-1 text-sm">
                                {reasons.map((r, i) => (
                                    <li key={i} className="flex items-baseline gap-2">
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                            r.severity === 'error' ? 'bg-red-400' :
                                            r.severity === 'warning' ? 'bg-yellow-400' : 'bg-sky-400'
                                        }`} />
                                        <span className={r.severity === 'error' ? 'text-red-100' : r.severity === 'warning' ? 'text-yellow-100' : 'text-sky-100'}>
                                            {r.text}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-gray-700/50">
                            {detailItems.map(({ label, value, isHeader }) => (
                                <tr key={label} className={`${isHeader ? 'bg-gray-900/50' : 'hover:bg-gray-700/30'} transition-colors`}>
                                    <td className={`p-3 font-medium ${isHeader ? 'text-white' : 'text-gray-400'} w-1/2 border-r border-gray-700/30`}>{label}</td>
                                    <td className="p-3 text-gray-200 font-mono break-all">
                                        {value}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>,
        document.body
    );
};

const GeneratorTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { addNotification } = useDashboardActions();
    const [showDetails, setShowDetails] = useState(false);
    const isLocked = !!tile.isLocked;

    // device.state carries the tile CONFIG (endpoint/siteId/refresh), not live
    // telemetry. Resolve the document URL once per config change.
    const cfg = (device.state && typeof device.state === 'object' ? device.state : {}) as GeneratorConfig;
    const endpointUrl = useMemo(() => resolveEndpointUrl(cfg), [cfg.endpoint, cfg.siteId]);
    const refresh = Math.max(15, Number(cfg.refresh) || 60); // seconds

    // Live telemetry. Preferred source is the `energytrak` HACS integration,
    // which polls EnergyTrak from inside Home Assistant and publishes entities —
    // no external poller, and it reads every device the site links to rather
    // than only the first. The configured HTTP endpoint (a standalone poller on
    // the LAN) remains as a fallback, so a panel keeps working until the
    // integration is installed.
    const { data: haGenerator } = useEnergyTrakGenerator(cfg.siteId);
    const useHaEntities = haGenerator !== null;

    const [details, setDetails] = useState<Record<string, any> | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (useHaEntities || !endpointUrl || isEditor) return;
        let cancelled = false;
        const load = async () => {
            try {
                const data = await apiFetchGenerator(endpointUrl);
                if (!cancelled) {
                    setDetails(data || null);
                    setFetchError(null);
                }
            } catch (e: any) {
                if (!cancelled) setFetchError(e?.message ?? String(e));
            }
        };
        load();
        const id = setInterval(load, refresh * 1000);
        return () => { cancelled = true; clearInterval(id); };
    }, [useHaEntities, endpointUrl, refresh, isEditor]);

    const state = (useHaEntities ? haGenerator!.state : details || {}) as Record<string, any>;
    // Telemetry is present, from EITHER source. Every "do we have data yet?"
    // check must use this — `details` alone is null whenever the data comes
    // from entities, which silently disabled the detail modal and its tap
    // target when the tile was first switched over to Home Assistant.
    const hasTelemetry = useHaEntities || details !== null;
    const isActive = state.active || false;

    // Derive warning reasons once per render — feeds both the inline caption
    // and the change-notification tracker below.
    const reasons = useMemo(() => deriveReasons(state), [details, haGenerator]);
    const topReason = reasons[0] || null;

    // State tracking for notifications: fire on reason-set transitions (so the
    // user sees exactly what changed), and on generator status / running state.
    const prevReasonSig = useRef('');
    const prevGenStatus = useRef<any>(undefined);
    const prevRunning = useRef<any>(undefined);

    useEffect(() => {
        if (!hasTelemetry) return;
        const sig = reasons.map(r => `${r.severity}:${r.text}`).join('|');
        if (prevReasonSig.current && prevReasonSig.current !== sig) {
            const newErrs = reasons.filter(r => r.severity === 'error');
            const newWarns = reasons.filter(r => r.severity === 'warning');
            if (newErrs.length > 0) {
                addNotification(`Generator alert: ${newErrs[0].text}`, 'error');
            } else if (newWarns.length > 0) {
                addNotification(`Generator warning: ${newWarns[0].text}`, 'warning');
            } else if (reasons.length === 0 && prevReasonSig.current !== '') {
                addNotification('Generator cleared: all issues resolved', 'success');
            }
        }
        prevReasonSig.current = sig;

        if (prevGenStatus.current !== undefined && prevGenStatus.current !== state.generatorStatus) {
            addNotification(`Generator status: ${state.generatorStatus || 'Unknown'}`, 'info');
        }
        prevGenStatus.current = state.generatorStatus;

        if (prevRunning.current !== undefined && prevRunning.current !== state.active) {
            addNotification(state.active ? 'Generator is RUNNING' : 'Generator stopped', state.active ? 'warning' : 'info');
        }
        prevRunning.current = state.active;
    }, [reasons, state.generatorStatus, state.active, details, addNotification]);

    // Status determination — drive badge color/animation from the SAME derived
    // reasons that feed the inline caption and modal banner. Active running
    // overrides to "active" blue with a pulse, unless something is error-level.
    const siteStatus = state.status || (hasTelemetry ? 'Unknown' : (endpointUrl ? 'Loading' : 'Setup'));
    const hasError = reasons.some(r => r.severity === 'error');
    const hasWarning = reasons.some(r => r.severity === 'warning');

    let badgeType: 'ok' | 'warning' | 'error' | 'active' = 'ok';
    let pulseAnimation = false;

    if (hasError) {
        badgeType = 'error';
        pulseAnimation = true;
    } else if (isActive) {
        badgeType = 'active';
        pulseAnimation = true;
    } else if (hasWarning) {
        badgeType = 'warning';
    }

    const handleClick = () => {
        if (!isEditor && !isLocked && hasTelemetry) {
            setShowDetails(true);
        }
    };

    const animationConfig = pulseAnimation ? {
        enabled: true,
        effect: 'pulse',
        color: badgeType === 'error' ? '#ef4444' : '#3b82f6'
    } : tile.animation;

    // Explicit null/undefined checks to display correct placeholder or 0
    const engineHours = (state.engineHours !== undefined && state.engineHours !== null) ? Number(state.engineHours).toFixed(1) : EM_DASH;
    // Local-only, so an em dash here means "no bridge", not "no reading".
    const coolant = (state.coolantTemperature !== undefined && state.coolantTemperature !== null)
        ? `${Number(state.coolantTemperature).toFixed(0)}\u00B0` : EM_DASH;
    const loadPct = (state.percentageLoad !== undefined && state.percentageLoad !== null)
        ? `${Number(state.percentageLoad).toFixed(0)}%` : EM_DASH;
    const onLocal = state.telemetrySource === 'local';
    const battVolts = (state.batteryVoltage !== undefined && state.batteryVoltage !== null) ? Number(state.batteryVoltage).toFixed(1) : EM_DASH;
    const gridVolts = (state.gridVoltage !== undefined && state.gridVoltage !== null) ? Number(state.gridVoltage).toFixed(0) : EM_DASH;

    // Show a setup caption when no endpoint is configured, or a fetch error.
    const setupReason: { severity: 'error' | 'warning' | 'info'; text: string } | null =
        !endpointUrl ? { severity: 'info', text: 'Set the endpoint URL in tile settings' }
        : fetchError ? { severity: 'error', text: `Fetch failed: ${fetchError}` }
        : null;
    const captionReason = topReason || setupReason;

    return (
        <>
            <TileWrapper
                label=""
                isLocked={isLocked}
                isEditor={isEditor}
                className={`!p-3 !block ${cornerClassName || ''}`}
                isActive={pulseAnimation}
                accent="warn"
                animation={animationConfig as any}
                onClick={handleClick}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                        <h2 className="font-bold text-white leading-none mt-1" style={fluidTextLg}>{device.name || 'Generator'}</h2>
                        <StatusBadge label={siteStatus} status={badgeType} />
                    </div>

                    {/* Primary reason caption — visible at a glance so the user
                        doesn't have to tap into the modal to learn WHY the tile
                        is in warning/error state. */}
                    {captionReason && (
                        <div className={`mt-1.5 flex items-center gap-1.5 leading-tight ${
                            captionReason.severity === 'error' ? 'text-red-300' : captionReason.severity === 'warning' ? 'text-yellow-300' : 'text-sky-300'
                        }`} style={fluidTextXs}>
                            <IconAlertTriangle className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{captionReason.text}</span>
                            {reasons.length > 1 && (
                                <span className="text-gray-400 flex-shrink-0">+{reasons.length - 1}</span>
                            )}
                        </div>
                    )}

                    {/* Graphic — focal element */}
                    <div className="flex-1 flex items-center justify-center min-h-0 py-1">
                        <GeneratorGraphic running={isActive} fault={hasError} />
                    </div>

                    {/* Metrics Row */}
                    <div className="flex mb-2 w-full" style={fluidGap(0.375)}>
                        <MetricItem label="Batt" value={battVolts} unit="V" />
                        <MetricItem label="Grid" value={gridVolts} unit="V" />
                        <MetricItem label="Hrs" value={engineHours} />
                        {/* Local-only fourth slot: it appears exactly when a
                            bridge is feeding the tile, and is simply absent
                            otherwise. Coolant while the engine is turning (the
                            reading that actually moves during a run), load the
                            rest of the time. */}
                        {onLocal && (isActive
                            ? <MetricItem label="Cool" value={coolant} />
                            : <MetricItem label="Load" value={loadPct} />)}
                    </div>

                    {/* Status List */}
                    <div className="mt-auto rounded-control p-1.5 border border-white/10" style={{ background: 'rgb(0 0 0 / 0.22)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.05), inset 0 -2px 5px rgb(0 0 0 / 0.3)' }}>
                        <DetailRow
                            icon={IconSettings}
                            label="Gen Status"
                            status={state.generatorStatus}
                            health={state.generatorHealth}
                        />
                        <DetailRow
                            icon={IconZap}
                            label="Grid Status"
                            status={state.gridStatus}
                            health={state.gridHealth}
                        />
                    </div>
                </div>
            </TileWrapper>
            {showDetails && hasTelemetry && <GeneratorDetailModal name={device.name || 'Generator'} state={state} onClose={() => setShowDetails(false)} />}
        </>
    );
};

export default GeneratorTile;
