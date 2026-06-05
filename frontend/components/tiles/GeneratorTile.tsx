import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconZap, IconSettings, IconCheck, IconAlertTriangle, IconX } from '../icons';
import { fluidTextSm, fluidTextXs, fluidTextLg, fluidGap } from './tileScale';
import { apiFetchGenerator } from '../../services/api';

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
const GeneratorGraphic = ({ running, fault }: { running: boolean; fault: boolean }) => {
    const glowColor = fault ? '#ef4444' : running ? '#fbbf24' : 'transparent';
    return (
        <div className="relative flex items-center justify-center" style={{ width: 'clamp(4rem, 46cqmin, 8rem)', aspectRatio: '200 / 140' }}>
            {(running || fault) && (
                <div
                    className="absolute rounded-full blur-2xl pointer-events-none"
                    style={{ width: '85%', height: '80%', background: glowColor, opacity: fault ? 0.4 : 0.35 }}
                />
            )}
            <svg viewBox="0 0 200 140" className="relative w-full h-full" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.4))' }}>
                <defs>
                    <linearGradient id="genBody" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f1f5f9" />
                        <stop offset="50%" stopColor="#cbd5e1" />
                        <stop offset="100%" stopColor="#94a3b8" />
                    </linearGradient>
                    <linearGradient id="genLid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e2e8f0" />
                        <stop offset="100%" stopColor="#cbd5e1" />
                    </linearGradient>
                    <linearGradient id="genVent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#475569" />
                        <stop offset="100%" stopColor="#1e293b" />
                    </linearGradient>
                </defs>
                {/* Lid */}
                <path d="M15 22 L185 22 L178 9 L22 9 Z" fill="url(#genLid)" stroke="#94a3b8" strokeWidth="1.5" />
                {/* Body */}
                <rect x="10" y="20" width="180" height="100" rx="10" fill="url(#genBody)" stroke="#64748b" strokeWidth="2" />
                {/* Top gloss highlight */}
                <rect x="22" y="26" width="100" height="6" rx="3" fill="#ffffff" opacity="0.55" />
                {/* Recessed louvre panel */}
                <rect x="30" y="38" width="140" height="56" rx="6" fill="url(#genVent)" stroke="#334155" strokeWidth="1.5" />
                <line x1="42" y1="52" x2="158" y2="52" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                <line x1="42" y1="66" x2="158" y2="66" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                <line x1="42" y1="80" x2="158" y2="80" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                {/* Base / pad */}
                <rect x="8" y="116" width="184" height="16" rx="3" fill="#1e293b" />
                {/* Running / fault indicator light */}
                <circle cx="170" cy="106" r="5"
                    fill={fault ? '#ef4444' : running ? '#22c55e' : '#475569'}
                    style={glowColor !== 'transparent' ? { filter: `drop-shadow(0 0 4px ${fault ? '#ef4444' : '#22c55e'})` } : undefined}>
                    {(running && !fault) && <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />}
                </circle>
            </svg>
        </div>
    );
};

const GeneratorDetailModal = ({ name, state, onClose }: { name: string, state: Record<string, any>, onClose: () => void }) => {
    const reasons = deriveReasons(state);
    const hasErrors = reasons.some(r => r.severity === 'error');

    // Helper to format values nicely, handling 0 correctly but treating null/undefined as 'N/A'
    const fmt = (val: any, suffix = '') => {
        if (val === undefined || val === null) return 'N/A';
        return `${val}${suffix}`;
    };

    const detailItems = [
        { label: 'Status', value: state.status },
        { label: 'Active', value: state.active ? 'Yes' : 'No' },
        { label: 'Site Status', value: state.siteStatus, isHeader: true },
        { label: 'Site Health', value: state.siteHealth },
        { label: 'Grid Status', value: state.gridStatus },
        { label: 'Grid Health', value: state.gridHealth },
        { label: 'Utility Monitor', value: state.utilityMonitor },
        { label: 'Generator Status', value: state.generatorStatus, isHeader: true },
        { label: 'Generator Health', value: state.generatorHealth },
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
        { label: 'Smart Mode', value: state.smartModeEnabled === true ? `Enabled (${state.smartModeDetection || 'Auto'})` : state.smartModeEnabled === false ? 'Disabled' : 'N/A', isHeader: true },
        { label: 'Heartbeat (cleanState)', value: state.cleanStateLastUpdated ? new Date(state.cleanStateLastUpdated).toLocaleString() : 'N/A' },
        { label: 'Equipment Telemetry', value: state.equipmentDataTimestamp ? `${new Date(state.equipmentDataTimestamp).toLocaleString()} ${state.equipmentDataStale ? '(stale)' : '(fresh)'}` : 'N/A' },
        { label: 'Last Updated', value: state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : 'N/A' },
        { label: 'Polled At', value: state.polledAt ? new Date(state.polledAt).toLocaleString() : 'N/A' },
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

    // Live telemetry fetched from the configured endpoint (server-side proxy).
    const [details, setDetails] = useState<Record<string, any> | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (!endpointUrl || isEditor) return;
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
    }, [endpointUrl, refresh, isEditor]);

    const state = (details || {}) as Record<string, any>;
    const isActive = state.active || false;

    // Derive warning reasons once per render — feeds both the inline caption
    // and the change-notification tracker below.
    const reasons = useMemo(() => deriveReasons(state), [details]);
    const topReason = reasons[0] || null;

    // State tracking for notifications: fire on reason-set transitions (so the
    // user sees exactly what changed), and on generator status / running state.
    const prevReasonSig = useRef('');
    const prevGenStatus = useRef<any>(undefined);
    const prevRunning = useRef<any>(undefined);

    useEffect(() => {
        if (!details) return;
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
    const siteStatus = state.status || (endpointUrl ? (details ? 'Unknown' : 'Loading') : 'Setup');
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
        if (!isEditor && !isLocked && details) {
            setShowDetails(true);
        }
    };

    const animationConfig = pulseAnimation ? {
        enabled: true,
        effect: 'pulse',
        color: badgeType === 'error' ? '#ef4444' : '#3b82f6'
    } : tile.animation;

    // Explicit null/undefined checks to display correct placeholder or 0
    const engineHours = (state.engineHours !== undefined && state.engineHours !== null) ? Number(state.engineHours).toFixed(1) : '--';
    const battVolts = (state.batteryVoltage !== undefined && state.batteryVoltage !== null) ? Number(state.batteryVoltage).toFixed(1) : '--';
    const gridVolts = (state.gridVoltage !== undefined && state.gridVoltage !== null) ? Number(state.gridVoltage).toFixed(0) : '--';

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
            {showDetails && details && <GeneratorDetailModal name={device.name || 'Generator'} state={state} onClose={() => setShowDetails(false)} />}
        </>
    );
};

export default GeneratorTile;
