import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconCheck, IconAlertTriangle, IconX, IconPowerOff, IconWifiOff } from '../icons';
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
/**
 * THE TILE IS THE GENERATOR — and specifically THIS generator.
 *
 * Drawn from the actual unit on the pad, a Briggs & Stratton PowerProtect. The
 * details that make it recognisable are not the ones a generic "generator"
 * drawing reaches for:
 *
 *   - a single deep rounded dome for a roof, not a flat peaked lid
 *   - a NARROW perforated intake bay on the left, not louvres spread across the
 *     whole front (that one detail is why the previous drawing read as a window
 *     air-conditioner)
 *   - smooth panels with an embossed emblem on the access door
 *   - a black control enclosure high on the right
 *   - a black base plinth it stands on
 *
 * Drawn rather than photographed on purpose: this repo is public and the product
 * shot is the manufacturer's, a drawing recolours for fault and running states,
 * and vector scales to any tile size without a second asset.
 *
 * IT STILL HAS TO BEHAVE LIKE A TILE. Absolutely positioned to its container and
 * scaled with `meet` — never `slice`, which would crop the roof or the plinth off
 * a machine whose whole job is to be recognisable by silhouette, and never
 * `none`, which would stretch it. Anchored xMidYMax so it stands on the floor of
 * the tile and any spare room becomes headroom above.
 */
const GeneratorUnit = ({ running, fault, rpm, anchorTop }: { running: boolean; fault: boolean; rpm?: number; anchorTop?: boolean }) => {
    // THE MACHINE ITSELF MOVES, AND IT MOVES AT THE REAL SPEED.
    //
    // A drawing with a puff of smoke bolted on is a cartoon: the smoke is the
    // same whether the set is idling at 2800 during warm-up or at 3600 under
    // full house load, so it carries no information at all.
    //
    // The cooling fan behind the intake mesh is driven from reported engine
    // speed, and the cabinet shakes in time with it. That makes the slow
    // warm-up VISIBLE -- the fan is plainly lazy for the first minutes of a
    // weekly exercise and then steps up -- without anyone having to know that
    // 2800 means warming and 3600 means ready.
    //
    // Clamped at both ends: a stale or absurd reading must not strobe the fan
    // or freeze it in a way that reads as "stopped" on a running machine.
    const fanPeriod = running && !fault && rpm && rpm > 50
        ? Math.min(2.4, Math.max(0.18, 3600 / rpm * 0.42))
        : 0;
    const shake = running && !fault;
    // Perforated intake mesh. Generated rather than hand-placed so the grid
    // stays even at any size, and kept as small dots because that is what it is
    // -- punched perforations, not slats.
    const mesh: { x: number; y: number }[] = [];
    for (let r = 0; r < 18; r++) {
        for (let c = 0; c < 5; c++) {
            mesh.push({ x: 25 + c * 2.8 + (r % 2 ? 1.4 : 0), y: 41 + r * 3.05 });
        }
    }
    return (
        <svg
            viewBox="0 0 200 128"
            // Bottom-anchored while idle, so the set stands on the floor of the
            // tile. Top-anchored the moment the numbers appear, because they
            // claim the lower half and the half worth keeping is the one with
            // the crown, the turning fan and the status lamp in it.
            preserveAspectRatio={anchorTop ? 'xMidYMin meet' : 'xMidYMax meet'}
            className="absolute inset-0 w-full h-full"
            aria-hidden="true"
        >
            <style>{`@keyframes binfohubFan{to{transform:rotate(360deg)}}
                @keyframes binfohubShake{
                    0%,100%{transform:translate(0,0)}
                    25%{transform:translate(0.22px,-0.2px)}
                    50%{transform:translate(-0.18px,0.24px)}
                    75%{transform:translate(0.2px,0.16px)}}
                @media (prefers-reduced-motion: reduce){
                .gen-anim{animation:none !important; display:none}
                .gen-fan,.gen-shake{animation:none !important}
                .gen-anim-keep{animation:none !important}}`}</style>
            <defs>
                {/* Brushed aluminium: bright across the upper third, falling away
                    below, which is what gives the panels their sheen. */}
                <linearGradient id="ppSkin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f2f4f7" />
                    <stop offset="22%" stopColor="#dfe3e9" />
                    <stop offset="60%" stopColor="#c3c9d1" />
                    <stop offset="100%" stopColor="#a4abb5" />
                </linearGradient>
                <linearGradient id="ppLid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbfcfd" />
                    <stop offset="45%" stopColor="#e3e7ec" />
                    <stop offset="100%" stopColor="#b9c0c9" />
                </linearGradient>
                <linearGradient id="ppBase" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3a3f47" />
                    <stop offset="100%" stopColor="#15181c" />
                </linearGradient>
                <clipPath id="ppIntake"><rect x="22" y="38" width="17" height="60" rx="2" /></clipPath>
                <radialGradient id="ppHalo" cx="50%" cy="58%" r="62%">
                    <stop offset="0%" stopColor={fault ? '#ef4444' : '#fbbf24'} stopOpacity={fault ? 0.3 : 0.2} />
                    <stop offset="100%" stopColor={fault ? '#ef4444' : '#fbbf24'} stopOpacity="0" />
                </radialGradient>
            </defs>

            {(running || fault) && <rect x="0" y="0" width="200" height="128" fill="url(#ppHalo)" />}

            {/* Everything from here down is the machine, and the machine shakes
                when it is running. Amplitude is a fifth of a viewBox unit --
                at tile size that is well under a pixel, which is the point: it
                should read as a running engine, never as a wobbling graphic. */}
            <g className="gen-shake" style={shake ? { animation: 'binfohubShake 0.14s steps(2,end) infinite' } : undefined}>

            {/* Cabinet.
                A BOX WITH A GENTLY ROUNDED TOP, not a dome. The first attempt
                curved the roof up over a third of the height and came out
                looking like a bread bin; on the real unit the sides run straight
                for most of the cabinet and only the top corners are radiused,
                with a shallow crown between them. Silhouette is the whole job
                here, so this is the proportion that matters most. */}
            <path d="M14 104 L14 40 Q14 27 30 26 L170 26 Q186 27 186 40 L186 104 Z"
                  fill="url(#ppSkin)" stroke="#8d949e" strokeWidth="1.2" />
            {/* Shallow crown along the top, catching the light. */}
            <path d="M16 38 Q16 29 31 28 L169 28 Q184 29 184 38 Q100 33 16 38 Z"
                  fill="url(#ppLid)" opacity="0.95" />
            {/* Soft shoulder shadow just under the crown. */}
            <path d="M14 41 Q100 37 186 41 L186 44 Q100 40 14 44 Z" fill="#9aa1ab" opacity="0.3" />

            {/* Panel seams. The real cabinet is three panels: a narrow intake
                bay, the main access door, then the control end. */}
            <line x1="44" y1="34" x2="44" y2="104" stroke="#9aa1ab" strokeWidth="0.9" opacity="0.9" />
            <line x1="150" y1="32" x2="150" y2="104" stroke="#9aa1ab" strokeWidth="0.9" opacity="0.9" />

            {/* Intake bay: perforated mesh, recessed, LEFT OF THE DOOR — not
                louvres spread across the whole front. Getting this wrong is what
                made the previous drawing read as a window air-conditioner. */}
            <rect x="22" y="38" width="17" height="60" rx="2" fill="#20262e" stroke="#7f8690" strokeWidth="0.9" />
            {/* The cooling fan, seen THROUGH the perforations -- drawn before
                the mesh so the dots sit in front of it, which is both correct
                and what stops it reading as a sticker on the outside. */}
            {fanPeriod > 0 && (
                <g className="gen-anim" clipPath="url(#ppIntake)">
                    <g className="gen-fan" style={{ animation: `binfohubFan ${fanPeriod}s linear infinite`, transformOrigin: '30.5px 68px' }}>
                        {[0, 60, 120, 180, 240, 300].map(a => (
                            <path key={a} d="M30.5 68 L33.6 53 Q30.5 50 27.4 53 Z" fill="#aeb6c0" opacity="0.5"
                                  transform={`rotate(${a} 30.5 68)`} />
                        ))}
                        <circle cx="30.5" cy="68" r="3" fill="#8f97a2" opacity="0.65" />
                    </g>
                </g>
            )}
            {mesh.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r="0.85" fill="#767e89" opacity="0.7" />
            ))}

            {/* Access door with its embossed emblem. Deliberately an emblem
                rather than the manufacturer's wordmark: this repo is public, and
                a soft embossed badge reads correctly at tile size anyway. */}
            <ellipse cx="97" cy="60" rx="21" ry="10.5" fill="none" stroke="#aeb5bf" strokeWidth="1.4" opacity="0.7" />
            <ellipse cx="97" cy="59" rx="21" ry="10.5" fill="none" stroke="#ffffff" strokeWidth="0.6" opacity="0.45" />
            <rect x="83" y="58" width="28" height="4" rx="2" fill="#b6bdc6" opacity="0.55" />
            {/* Door latch, top centre, as on the real cabinet. */}
            <circle cx="97" cy="40" r="2.4" fill="#8a919b" stroke="#6d747e" strokeWidth="0.7" />

            {/* Control end: the black enclosure high on the right, and the
                status lamp below it. */}
            <rect x="157" y="38" width="21" height="23" rx="3" fill="#23272d" stroke="#14171b" strokeWidth="0.9" />
            <rect x="160" y="41" width="15" height="9" rx="1.5" fill="#30353c" />
            <circle cx="167.5" cy="70" r="4.6"
                fill={fault ? '#ef4444' : running ? '#22c55e' : '#39414f'}
                stroke="#23272d" strokeWidth="0.9"
                style={(running || fault) ? { filter: `drop-shadow(0 0 6px ${fault ? '#ef4444' : '#22c55e'})` } : undefined}>
                {(running && !fault) && (
                    <animate className="gen-anim-keep" attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
                )}
            </circle>

            {/* Black base plinth, with the two pad bolts. */}
            <rect x="10" y="100" width="180" height="16" rx="2.5" fill="url(#ppBase)" />
            <rect x="10" y="100" width="180" height="2.5" fill="#575d66" opacity="0.6" />
            <circle cx="52" cy="108" r="2" fill="#4a5058" />
            <circle cx="148" cy="108" r="2" fill="#4a5058" />
            <path d="M6 116 L194 116 L194 120 L6 120 Z" fill="#000" opacity="0.45" />

            {/* Exhaust haze, low on the right, only while the engine is actually
                turning and not faulted — a faulted set is not moving air. */}
            {running && !fault && (
                <g className="gen-anim">
                    <circle cx="190" cy="98" r="3.4" fill="#cbd5e1" opacity="0.3">
                        <animate attributeName="cy" values="98;82;72" dur="2.4s" repeatCount="indefinite" />
                        <animate attributeName="r" values="2.4;5.6;7.8" dur="2.4s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.32;0.15;0" dur="2.4s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="188" cy="98" r="2.6" fill="#cbd5e1" opacity="0.24">
                        <animate attributeName="cy" values="98;84;75" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
                        <animate attributeName="r" values="1.8;4.4;6.2" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.26;0.12;0" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
                    </circle>
                </g>
            )}
            </g>
        </svg>
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


/** Shared readout cell for the modal heroes. */
const HeroReading = ({ label, value, unit }: { label: string; value?: number; unit?: string }) => (
    <div className="flex flex-col items-center justify-center px-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
        <span className="font-bold text-white tabular-nums leading-tight" style={{ fontSize: 'clamp(0.95rem, 4.2vw, 1.4rem)' }}>
            {value === undefined || Number.isNaN(value) ? EM_DASH : value.toFixed(unit === 'V' || unit === 'RPM' ? 0 : 1)}
            {value !== undefined && !Number.isNaN(value) && unit
                ? <span className="text-[11px] font-medium text-gray-400 ml-0.5">{unit}</span> : null}
        </span>
    </div>
);

const heroNum = (v: any) => (v === undefined || v === null || v === '' ? undefined : Number(v));

/**
 * FAULTED. The generator has tripped and will not answer an outage until it is
 * cleared at the panel, which is the single sentence that matters and the one a
 * row of grey key/value pairs buries.
 *
 * It names the actual alarms rather than saying "fault condition": the
 * controller exposes 32 discrete bits and which one fired decides whether this
 * is a dead battery or a seized engine.
 */
const FaultHero = ({ state, alarms }: { state: Record<string, any>; alarms: string[] }) => (
    <div className="p-4 border-b border-red-500/40 bg-gradient-to-b from-red-900/45 to-transparent">
        <style>{`@keyframes binfohubThrob{0%,100%{opacity:1}50%{opacity:.55}}
            @media (prefers-reduced-motion: reduce){.binfohub-throb{animation:none !important}}`}</style>
        <div className="flex items-center gap-3 mb-3">
            <div className="binfohub-throb shrink-0 w-11 h-11 rounded-full bg-red-500/25 border-2 border-red-400 flex items-center justify-center"
                 style={{ animation: 'binfohubThrob 1.4s ease-in-out infinite' }}>
                <IconAlertTriangle className="w-6 h-6 text-red-300" />
            </div>
            <div className="min-w-0">
                <div className="text-red-300 font-bold text-sm uppercase tracking-wider">Generator faulted</div>
                <div className="text-[11px] text-gray-300">No standby power until this is cleared at the panel</div>
            </div>
        </div>
        {alarms.length > 0 && (
            <ul className="mb-3 space-y-1">
                {alarms.slice(0, 6).map((a) => (
                    <li key={a} className="text-sm text-red-200 flex items-start gap-1.5">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        <span className="leading-snug">{a}</span>
                    </li>
                ))}
                {alarms.length > 6 && <li className="text-xs text-gray-400">+{alarms.length - 6} more</li>}
            </ul>
        )}
        {/* Battery first: it is the most common cause of a set that will not run,
            and the number you want before walking outside. */}
        <div className="grid grid-cols-3 gap-1 pt-2 border-t border-white/10">
            <HeroReading label="Battery" value={heroNum(state.batteryVoltage)} unit="V" />
            <HeroReading label="Hours" value={heroNum(state.engineHours)} />
            <HeroReading label="Trips" value={heroNum(state.tripsCount)} />
        </div>
    </div>
);

/**
 * UTILITY OUTAGE. The grid is down, which is the one time this machine is the
 * only thing between the house and darkness -- so the question is not "is there
 * a fault" but "is it actually carrying the load".
 */
const OutageHero = ({ state }: { state: Record<string, any> }) => {
    const carrying = state.active === true || state.engineRunning === true;
    return (
        <div className={`p-4 border-b ${carrying ? 'border-amber-500/40 bg-gradient-to-b from-amber-900/35' : 'border-red-500/40 bg-gradient-to-b from-red-900/45'} to-transparent`}>
            <div className="flex items-center gap-3 mb-3">
                <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center border-2 ${
                    carrying ? 'bg-amber-500/20 border-amber-400' : 'bg-red-500/25 border-red-400'}`}>
                    <IconPowerOff className={`w-6 h-6 ${carrying ? 'text-amber-300' : 'text-red-300'}`} />
                </div>
                <div className="min-w-0">
                    <div className={`font-bold text-sm uppercase tracking-wider ${carrying ? 'text-amber-300' : 'text-red-300'}`}>
                        Utility power lost
                    </div>
                    <div className="text-[11px] text-gray-300">
                        {carrying ? 'Generator is running and carrying the house' : 'Generator is NOT running — it should be starting'}
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
                <HeroReading label="Output" value={heroNum(state.outputVoltage)} unit="V" />
                <HeroReading label="Load" value={heroNum(state.loadPower) ?? heroNum(state.percentageLoad)}
                             unit={heroNum(state.loadPower) !== undefined ? 'kW' : '%'} />
                <HeroReading label="Battery" value={heroNum(state.batteryVoltage)} unit="V" />
            </div>
        </div>
    );
};

/**
 * SOURCE DEGRADED. The bridge, or the generator's own bus, has gone quiet and
 * the integration has fallen back to the cloud.
 *
 * Worth its own panel because nothing else on screen looks wrong: every reading
 * still has a plausible value, it is simply minutes old instead of seconds, and
 * the local-only rows have quietly emptied. Saying which half failed is the
 * difference between checking the board and checking the RS-485 pair.
 */
const DegradedHero = ({ state }: { state: Record<string, any> }) => {
    const unreachable = state.bridgeReachable === false;
    return (
        <div className="p-4 border-b border-yellow-500/35 bg-gradient-to-b from-yellow-900/25 to-transparent">
            <div className="flex items-center gap-3 mb-2">
                <div className="shrink-0 w-11 h-11 rounded-full bg-yellow-500/15 border-2 border-yellow-500/60 flex items-center justify-center">
                    <IconWifiOff className="w-6 h-6 text-yellow-300" />
                </div>
                <div className="min-w-0">
                    <div className="text-yellow-300 font-bold text-sm uppercase tracking-wider">Running on cloud data</div>
                    <div className="text-[11px] text-gray-300">
                        {unreachable
                            ? 'The bridge is not answering — check its power and Wi-Fi'
                            : 'The generator has gone quiet on the bridge — check the RS-485 pair'}
                    </div>
                </div>
            </div>
            <div className="text-[11px] text-gray-400 leading-snug">
                Readings below are still correct but minutes old rather than seconds,
                and the local-only rows are unavailable until this clears.
                {state.bridgeHost ? <> Bridge: <span className="text-gray-300">{state.bridgeHost}</span></> : null}
            </div>
        </div>
    );
};

/**
 * Picks the panel that matches what is actually happening, most urgent first.
 *
 * A faulted set outranks an outage: if it has tripped, the outage is academic.
 * An outage outranks a normal run, because "running" during a grid failure is a
 * different event from an exercise. Degradation comes last -- it is about how
 * much to trust the numbers, not about the machine.
 */
const ModalHero = ({ state, alarms, hasError }: { state: Record<string, any>; alarms: string[]; hasError: boolean }) => {
    if (hasError) return <FaultHero state={state} alarms={alarms} />;
    if (state.utilityPowerFailure === true || state.gridPresent === false) return <OutageHero state={state} />;
    if (state.active === true || state.engineRunning === true) return <RunningHero state={state} />;
    if (state.bridgeReachable === false || state.busHealthy === false) return <DegradedHero state={state} />;
    return null;
};


/** "1h 04m" / "12m 30s" — elapsed, in the units a person would say it in. */
const elapsedSince = (iso?: string, now: number = Date.now()): string | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const s = Math.max(0, Math.floor((now - t) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
};

/**
 * WHAT THE TILE SHOWS WHILE SOMETHING IS HAPPENING.
 *
 * The drawing of the machine is the right thing to show when the generator is
 * sitting there doing nothing: it is recognisable, it says which device this
 * tile is, and there is no news to report.
 *
 * The moment the engine is turning, it is the wrong thing. Exhaust haze and a
 * green lamp are decoration -- they say "running", which the badge already
 * said, and nothing else. Standing in a dark house at 2am the questions are:
 * how long has it been running, is it actually carrying the load, and is the
 * output sane. None of those are answerable from a picture.
 *
 * So while the engine runs, or while there is a fault, the illustration gives
 * way to the numbers. It comes back when there is nothing to say.
 */
const LiveStatePanel = ({ state, kind }: { state: Record<string, any>; kind: 'outage' | 'exercise' | 'running' | 'fault' }) => {
    // Elapsed has to advance on its own; the underlying entity only changes
    // when the engine starts or stops.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const num = (v: any) => (v === undefined || v === null || v === '' ? undefined : Number(v));
    const fmt = (v?: number, dp = 0) => (v === undefined || Number.isNaN(v) ? EM_DASH : v.toFixed(dp));

    const kw = num(state.loadPower);
    const pct = num(state.percentageLoad);
    const volts = num(state.outputVoltage);
    const hz = num(state.generatorFrequency);
    const rpm = num(state.engineSpeed);
    const batt = num(state.batteryVoltage);

    const runFor = elapsedSince(state.runningSince, now);
    const outFor = elapsedSince(state.gridLostSince, now);

    const alarms: string[] = Array.isArray(state.activeAlarms) ? state.activeAlarms : [];

    const tone = kind === 'fault' ? 'text-red-300'
        : kind === 'outage' ? 'text-amber-300'
        : kind === 'exercise' ? 'text-sky-300' : 'text-emerald-300';

    // SHORT ENOUGH TO SURVIVE THE TILE. "CARRYING THE HOUSE" was the honest
    // phrase and it truncated to "CARRYING THE HOU..." at tile width, next to
    // an elapsed time it was competing with for the same line. The word that
    // cannot be lost is OUTAGE; the reassurance goes on the line below, where
    // there is room for it.
    const headline = kind === 'fault' ? 'FAULT'
        : kind === 'outage' ? 'OUTAGE'
        : kind === 'exercise' ? 'EXERCISE' : 'RUNNING';

    // At rated speed or still warming up. On this unit a weekly exercise sits
    // near 2800 RPM for several minutes before it steps up, and that is normal
    // -- so it is worth saying rather than leaving someone to wonder.
    const atSpeed = rpm !== undefined && rpm >= 3400;

    const Cell = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
        <div className="flex flex-col items-center justify-center min-w-0">
            <span className="uppercase font-bold tracking-wider text-gray-400 truncate"
                  style={{ fontSize: 'clamp(0.42rem, 4cqmin, 0.58rem)' }}>{label}</span>
            <span className="font-bold text-white tabular-nums leading-none truncate"
                  style={{ fontSize: 'clamp(0.78rem, 8cqmin, 1.25rem)' }}>
                {value}{unit && <span className="text-gray-400 font-normal ml-0.5"
                    style={{ fontSize: 'clamp(0.4rem, 3.6cqmin, 0.6rem)' }}>{unit}</span>}
            </span>
        </div>
    );

    return (
        <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end px-2 pb-1 gap-0.5">
            <div className="flex items-baseline justify-between gap-1.5 min-w-0">
                <span className={`font-bold uppercase tracking-wider truncate ${tone}`}
                      style={{ fontSize: 'clamp(0.5rem, 5cqmin, 0.72rem)' }}>{headline}</span>
                {/* The number that is asked first and answered nowhere else. */}
                {runFor && (
                    <span className="font-bold text-white tabular-nums shrink-0"
                          style={{ fontSize: 'clamp(0.68rem, 6.6cqmin, 1rem)' }}>{runFor}</span>
                )}
            </div>

            {kind === 'fault' ? (
                <div className="text-red-200 leading-snug overflow-hidden"
                     style={{ fontSize: 'clamp(0.5rem, 5cqmin, 0.75rem)' }}>
                    {alarms.length > 0
                        ? alarms.slice(0, 3).join(' · ') + (alarms.length > 3 ? ` +${alarms.length - 3}` : '')
                        : 'Controller reports a fault — check the panel'}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-0.5">
                        <Cell label="Load" value={kw !== undefined ? fmt(kw, 1) : fmt(pct)} unit={kw !== undefined ? 'kW' : '%'} />
                        <Cell label="Output" value={fmt(volts)} unit="V" />
                        <Cell label="Freq" value={fmt(hz, 1)} unit="Hz" />
                    </div>
                    {/* One line, and only when it has something to add. Battery
                        and coolant already have permanent cells in the strip
                        below; repeating them here would spend the tile's last
                        row saying what is already on screen. */}
                    <div className="flex items-center justify-between gap-1.5 text-gray-300 min-w-0"
                         style={{ fontSize: 'clamp(0.4rem, 3.8cqmin, 0.56rem)' }}>
                        <span className="truncate">
                            {kind === 'outage' ? 'carrying the house' : (
                                <>
                                    {rpm !== undefined ? `${fmt(rpm)} RPM` : EM_DASH}
                                    {rpm !== undefined && !atSpeed && ' · warming up'}
                                </>
                            )}
                        </span>
                        {kind === 'outage' && outFor && (
                            <span className="shrink-0 tabular-nums text-amber-300">grid out {outFor}</span>
                        )}
                    </div>
                </>
            )}
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
                    {/* A panel matched to what is happening, above the static
                        rows: during a run the moving numbers ARE the story, and
                        during a fault or an outage the single actionable
                        sentence is. Both are buried by a list of key/value
                        pairs. Nothing is shown when the set is simply on
                        standby, which is the state that needs no headline. */}
                    <ModalHero state={state} alarms={Array.isArray(state.activeAlarms) ? state.activeAlarms : []} hasError={hasErrors} />

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
    // `active` is the cloud's run flag; engineRunning is the bridge's. Either
    // one being true means the engine is turning.
    const isActive = state.active === true || state.engineRunning === true;

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

    // Status determination.
    //
    // THE LABEL AND THE COLOUR MUST COME FROM THE SAME PLACE.
    //
    // They did not. The colour was derived from `reasons`, and the text was
    // `state.status` -- the health grade, a different field entirely. Nothing
    // kept them in step, so during a weekly exercise the tile rendered the word
    // "HEALTHY" in red: the grade still said healthy while the fault flag had
    // gone true. A badge that contradicts itself is worse than either half
    // alone, because there is no way to tell which one to believe.
    //
    // The label is now derived from the same state as the colour, in the same
    // order, so the two cannot disagree by construction.
    const hasError = reasons.some(r => r.severity === 'error');
    const hasWarning = reasons.some(r => r.severity === 'warning');

    // A scheduled exercise is the machine working, not an incident, and it
    // deserves to be said on the tile face -- otherwise a running generator on
    // a Tuesday morning is indistinguishable from one responding to an outage.
    const isExercising = state.exercising === true || state.scheduledExerciseInProgress === true;
    const rawStatus = state.status || (hasTelemetry ? 'Unknown' : (endpointUrl ? 'Loading' : 'Setup'));

    let badgeType: 'ok' | 'warning' | 'error' | 'active' = 'ok';
    let pulseAnimation = false;
    let siteStatus = rawStatus;

    if (hasError) {
        badgeType = 'error';
        pulseAnimation = true;
        siteStatus = 'FAULT';
    } else if (isActive && state.utilityPowerFailure === true) {
        // OUTAGE OUTRANKS EXERCISE, and used to not.
        // The exercise branch came first, so a grid failure that happened to
        // land inside the weekly exercise window -- or an exercise the
        // controller had not yet cleared -- would badge the tile EXERCISE
        // while the house was actually running on the generator. That is the
        // one moment this tile exists for, mislabelled as routine.
        badgeType = 'active';
        pulseAnimation = true;
        // "ON GENERATOR" wrapped to two lines inside the pill at tile width
        // and squeezed the device name to "Gener...". The headline below
        // already says OUTAGE and the line under it says carrying the house,
        // so the badge only has to be unmistakable, not complete.
        siteStatus = 'ON GEN';
    } else if (isExercising) {
        badgeType = 'active';
        pulseAnimation = true;
        siteStatus = 'EXERCISE';
    } else if (isActive) {
        badgeType = 'active';
        pulseAnimation = true;
        siteStatus = 'RUNNING';
    } else if (hasWarning) {
        badgeType = 'warning';
        siteStatus = 'CHECK';
    }

    // Which live panel, if any. Standby shows the machine and nothing else --
    // that is the state with no news, and the one the drawing suits.
    const liveKind: 'outage' | 'exercise' | 'running' | 'fault' | null =
        hasError ? 'fault'
        : (isActive && state.utilityPowerFailure === true) ? 'outage'
        : (isActive && isExercising) ? 'exercise'
        : isActive ? 'running'
        : null;

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
    // `useHaEntities` GATES THIS, and originally did not.
    // The endpoint is the FALLBACK path: once the energytrak integration is
    // installed, telemetry arrives as entities and no endpoint is needed or
    // wanted. Keyed on `endpointUrl` alone, a fully working tile pulling live
    // local data still nagged "set the endpoint URL" across its face forever,
    // with no endpoint to set. Only ask for setup when nothing is feeding it.
    const setupReason: { severity: 'error' | 'warning' | 'info'; text: string } | null =
        (!endpointUrl && !useHaEntities) ? { severity: 'info', text: 'Set the endpoint URL in tile settings' }
        : fetchError ? { severity: 'error', text: `Fetch failed: ${fetchError}` }
        : null;
    const captionReason = topReason || setupReason;

    return (
        <>
            <TileWrapper
                label=""
                isLocked={isLocked}
                isEditor={isEditor}
                className={`!p-0 !block overflow-hidden ${cornerClassName || ''}`}
                isActive={pulseAnimation}
                accent="warn"
                animation={animationConfig as any}
                onClick={handleClick}
            >
                {/* The machine IS the tile: it is the backdrop, and the
                    identity and state sit on it.

                    The data plate is a real flex ROW rather than an overlay.
                    Overlaying it looked right on a large tile and fell apart on
                    a small or tall one, where the readings landed on top of the
                    louvres and became unreadable. Giving it its own row means
                    the machine is drawn into whatever is left, at any tile size,
                    and the two can never collide. It still reads as part of the
                    unit — a plinth under the set, which is where a real plate
                    lives. */}
                <div className="gen-on-dark flex flex-col w-full overflow-hidden rounded-[inherit]">
                    {/* DAY MODE WAS UNREADABLE, AND THIS IS WHY.
                        App.tsx remaps text globally for light mode --
                        `.light-mode .text-white { color: #111827 }`, and the
                        same for the grays. That is right for a tile that
                        follows the theme and wrong for this one: the machine,
                        the header scrim and the data plate are deliberately
                        dark in BOTH themes, because a silver enclosure drawn on
                        a white tile has no contrast and stops reading as a
                        generator at all.
                        So in day mode every label turned near-black on top of a
                        near-black bar. Rather than fight the remap at each call
                        site, the dark region is named and the remap is undone
                        inside it. */}
                    <style>{`
                        .light-mode .gen-on-dark .text-white { color: #ffffff; }
                        .light-mode .gen-on-dark .text-gray-200 { color: #e5e7eb; }
                        .light-mode .gen-on-dark .text-gray-300 { color: #d1d5db; }
                        .light-mode .gen-on-dark .text-gray-400 { color: #9ca3af; }
                    `}</style>
                    {/* THE MACHINE AREA NEEDS INTRINSIC HEIGHT, NOT JUST flex-1.
                        TileWrapper's content slot is sized BY its content rather
                        than stretched to the tile: measured on the wall panel it
                        was 59px inside a 226px tile. With `flex-1 min-h-0` and a
                        `basis: 0%`, an area whose only child is absolutely
                        positioned has no natural height at all, so it collapsed
                        to zero, the data plate took the whole 59px as a strip
                        across the top, and the generator rendered at height 0.
                        The old layout never hit this because its graphic carried
                        its own aspect-ratio and pushed the slot taller.

                        `flex: 1 1 auto` with an aspect-ratio gives both: the
                        aspect supplies the natural height when the slot is
                        content-sized, and the grow still fills the space when a
                        parent does stretch. maxHeight keeps a very wide tile
                        from turning the machine into a mural.

                        The machine is anchored to the bottom of this area, so on
                        a tall tile the spare room lands above it, with a soft
                        wash so that headroom reads as space the set is standing
                        in rather than a gap the layout failed to fill. */}
                    <div className="relative w-full"
                         style={{ flex: '1 1 auto', minHeight: 0, aspectRatio: '200 / 112', maxHeight: '11rem',
                                  background: 'linear-gradient(to bottom, #0b1220 0%, #16202e 55%, #1c2733 100%)' }}>
                        <GeneratorUnit running={isActive} fault={hasError} anchorTop={!!liveKind}
                                       rpm={Number(state.engineSpeed) || undefined} />
                        {/* A GRADIENT, NOT A BLACK SHEET.
                            The first version laid a flat 70% black over the
                            whole tile to make the numbers legible, which worked
                            and cost the machine entirely -- it went grey and
                            dead behind a wash, and the animation it had just
                            been given was invisible. The scrim now only exists
                            where the text is, fading out by mid-height, so the
                            top of the cabinet, the fan turning behind the
                            intake and the status lamp all stay in the clear. */}
                        {liveKind && (
                            <div className={`absolute inset-x-0 bottom-0 pointer-events-none ${liveKind === 'fault' ? 'h-full' : 'h-[62%]'}`}
                                 style={{ background: liveKind === 'fault'
                                     // A FAULTED SET IS NOT A SPECTACLE. The drawing
                                     // is there to say "this is the generator", which
                                     // a tile screaming FAULT has already established,
                                     // and the alarm names need every pixel of the
                                     // room it was occupying.
                                     ? 'linear-gradient(to top, rgba(3,7,18,0.95) 0%, rgba(3,7,18,0.9) 70%, rgba(3,7,18,0.72) 100%)'
                                     : 'linear-gradient(to top, rgba(3,7,18,0.94) 0%, rgba(3,7,18,0.88) 34%, rgba(3,7,18,0.5) 66%, rgba(3,7,18,0) 100%)' }} />
                        )}
                        {liveKind && <LiveStatePanel state={state} kind={liveKind} />}

                        {/* Identity and state, over the lid. A scrim rather than
                            a solid bar, so the machine reads through it. */}
                        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2
                                        bg-gradient-to-b from-black/80 via-black/40 to-transparent">
                            <h2 className="font-bold text-white leading-none truncate drop-shadow" style={fluidTextLg}>
                                {device.name || 'Generator'}
                            </h2>
                            <StatusBadge label={siteStatus} status={badgeType} />
                        </div>

                        {/* Why it is not OK, on the tile face, so nobody has to
                            open the modal to learn that something is wrong —
                            only what to do about it. */}
                        {/* Its own dark chip rather than bare text on the tile.
                            On the light-themed wall panel this was red text on a
                            red-tinted error background and was effectively
                            unreadable — the one line that most needed to be
                            legible. A chip makes it theme-independent. */}
                        {captionReason && (
                            <div className="absolute inset-x-0 top-8 px-2">
                                <div className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 leading-tight bg-black/70 ${
                                    captionReason.severity === 'error' ? 'text-red-300'
                                    : captionReason.severity === 'warning' ? 'text-yellow-300' : 'text-sky-300'
                                }`} style={fluidTextXs}>
                                    <IconAlertTriangle className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">{captionReason.text}</span>
                                    {reasons.length > 1 && (
                                        <span className="text-gray-300 flex-shrink-0">+{reasons.length - 1}</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Data plate. The fourth cell is local-only and appears
                        exactly when a bridge is feeding the tile: coolant while
                        the engine is turning (the reading that actually moves
                        during a run), load the rest of the time. */}
                    <div className="shrink-0 flex items-stretch px-2 py-1.5 border-t border-white/10"
                         style={{ ...fluidGap(0.375), background: '#111a24' }}>
                        <MetricItem label="Batt" value={battVolts} unit="V" />
                        <MetricItem label="Grid" value={gridVolts} unit="V" />
                        <MetricItem label="Hrs" value={engineHours} />
                        {onLocal && (isActive
                            ? <MetricItem label="Cool" value={coolant} />
                            : <MetricItem label="Load" value={loadPct} />)}
                    </div>
                </div>
            </TileWrapper>
            {showDetails && hasTelemetry && <GeneratorDetailModal name={device.name || 'Generator'} state={state} onClose={() => setShowDetails(false)} />}
        </>
    );
};

export default GeneratorTile;
