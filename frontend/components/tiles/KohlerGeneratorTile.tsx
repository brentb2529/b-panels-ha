import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { Device, TileConfig, GeneratorRehlkoState } from '../../types';
import TileWrapper from './TileWrapper';
import {
    IconZap, IconPower, IconPowerOff, IconActivity, IconBattery,
    IconClock, IconAlertTriangle, IconCheckCircle, IconThermometer,
    IconWifiOff, IconCpu, IconX, IconHome, IconSettings,
} from '../icons';
import { fluidTextSm, fluidTextXs, fluidTextLg, fluidText2xl, fluidGap } from './tileScale';

// =============================================================================
// Kohler / Rehlko standby-generator surface — DISPLAY-ONLY.
//
// Bound to the HA core `rehlko` integration via the `rehlko:generator`
// composite (built in useDashboard from the generator's prefixed sensor /
// binary_sensor entities). rehlko ships NO control entities, so this surface
// renders telemetry and NEVER commands the unit — there is no start / stop /
// exercise affordance anywhere in this file by design (safety: equipment-gated
// actuation is escalated, not wired).
//
// All data arrives via the live HA entity subscription (subscribeEntities) and
// reconciles in place — no polling here. device.state is the composite
// GeneratorRehlkoState; `isPreview` marks representative fixture data so the
// surface is never mistaken for live telemetry.
// =============================================================================

const fmtNum = (v: number | null | undefined, digits = 0): string =>
    v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toFixed(digits);

const fmtTimestamp = (iso: string | null): string => {
    if (!iso) return 'n/a';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const relativeTo = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const diffMs = d.getTime() - Date.now();
    const future = diffMs >= 0;
    const mins = Math.round(Math.abs(diffMs) / 60000);
    const hrs = Math.round(mins / 60);
    const days = Math.round(hrs / 24);
    let span: string;
    if (mins < 60) span = `${mins}m`;
    else if (hrs < 48) span = `${hrs}h`;
    else span = `${days}d`;
    return future ? `in ${span}` : `${span} ago`;
};

// --- Headline derivation -----------------------------------------------------
// Collapse engineState/status/running into one bold, room-legible headline.
type Headline = { word: string; tone: 'running' | 'exercise' | 'standby' | 'fault' | 'offline' };
function headlineFor(s: GeneratorRehlkoState): Headline {
    if (s.isConnected === false) return { word: 'Offline', tone: 'offline' };
    if (s.isExercising) return { word: 'Exercising', tone: 'exercise' };
    if (s.isRunning) return { word: 'Running', tone: 'running' };
    // Map a few common controller words; otherwise show the reported state.
    const es = (s.engineState || s.status || '').toLowerCase();
    if (/standby|ready/.test(es)) return { word: 'Standby', tone: 'standby' };
    if (/off|switchstateoff|shutdown/.test(es)) return { word: 'Off', tone: 'offline' };
    if (s.engineState) return { word: s.engineState, tone: 'standby' };
    return { word: 'Standby', tone: 'standby' };
}

const TONE_COLOR: Record<Headline['tone'], string> = {
    running: '#22c55e',
    exercise: '#38bdf8',
    standby: '#94a3b8',
    fault: '#ef4444',
    offline: '#9ca3af',
};

// --- Attention derivation ----------------------------------------------------
function attentionFor(s: GeneratorRehlkoState): { severity: 'error' | 'warning'; text: string }[] {
    const out: { severity: 'error' | 'warning'; text: string }[] = [];
    if (s.oilPressureProblem === true) out.push({ severity: 'error', text: 'Low oil pressure' });
    if (s.isConnected === false) out.push({ severity: 'warning', text: 'Controller offline' });
    return out;
}

// --- Power-source pill --------------------------------------------------------
const PowerSourcePill = ({ source }: { source: GeneratorRehlkoState['powerSource'] }) => {
    const onGen = source === 'generator';
    const onUtil = source === 'utility';
    const label = onGen ? 'On Generator' : onUtil ? 'On Utility' : 'Source n/a';
    const color = onGen ? '#22c55e' : onUtil ? '#38bdf8' : '#9ca3af';
    const Icon = onGen ? IconZap : IconHome;
    return (
        <div
            className="flex items-center gap-2 rounded-full border px-3 py-1.5"
            style={{
                borderColor: `${color}55`,
                background: `color-mix(in srgb, ${color} 16%, transparent)`,
            }}
        >
            <Icon className="shrink-0" style={{ width: '1rem', height: '1rem', color }} />
            <span className="font-bold uppercase tracking-wider" style={{ ...fluidTextXs, color }}>{label}</span>
        </div>
    );
};

// --- Generator graphic (echoes the legacy tile's enclosure, source-aware) ----
const GeneratorGraphic = ({ running, fault, exercising }: { running: boolean; fault: boolean; exercising: boolean }) => {
    const glow = fault ? '#ef4444' : exercising ? '#38bdf8' : running ? '#22c55e' : 'transparent';
    return (
        <div className="relative flex items-center justify-center" style={{ width: 'clamp(3.5rem, 30cqmin, 6.5rem)', aspectRatio: '200 / 140' }}>
            {glow !== 'transparent' && (
                <div className="absolute rounded-full blur-2xl pointer-events-none" style={{ width: '88%', height: '82%', background: glow, opacity: fault ? 0.45 : 0.38 }} />
            )}
            <svg viewBox="0 0 200 140" className="relative w-full h-full" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.4))' }}>
                <defs>
                    <linearGradient id="kgenBody" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f1f5f9" />
                        <stop offset="50%" stopColor="#cbd5e1" />
                        <stop offset="100%" stopColor="#94a3b8" />
                    </linearGradient>
                    <linearGradient id="kgenVent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#475569" />
                        <stop offset="100%" stopColor="#1e293b" />
                    </linearGradient>
                </defs>
                <path d="M15 22 L185 22 L178 9 L22 9 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5" />
                <rect x="10" y="20" width="180" height="100" rx="10" fill="url(#kgenBody)" stroke="#64748b" strokeWidth="2" />
                <rect x="22" y="26" width="100" height="6" rx="3" fill="#ffffff" opacity="0.55" />
                <rect x="30" y="38" width="140" height="56" rx="6" fill="url(#kgenVent)" stroke="#334155" strokeWidth="1.5" />
                <line x1="42" y1="52" x2="158" y2="52" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                <line x1="42" y1="66" x2="158" y2="66" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                <line x1="42" y1="80" x2="158" y2="80" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                <rect x="8" y="116" width="184" height="16" rx="3" fill="#1e293b" />
                <circle cx="170" cy="106" r="5"
                    fill={fault ? '#ef4444' : exercising ? '#38bdf8' : running ? '#22c55e' : '#475569'}
                    style={glow !== 'transparent' ? { filter: `drop-shadow(0 0 4px ${glow})` } : undefined}>
                    {(running || exercising) && !fault && <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />}
                </circle>
            </svg>
        </div>
    );
};

// --- Vital stat cell ----------------------------------------------------------
const Vital = ({ icon: Icon, label, value, unit }: { icon: any; label: string; value: string; unit?: string }) => (
    <div
        className="flex flex-col items-center justify-center rounded-control py-1.5 px-1 flex-1 min-w-0 border border-white/10"
        style={{ background: 'rgb(0 0 0 / 0.22)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06), inset 0 -2px 5px rgb(0 0 0 / 0.35)' }}
    >
        <div className="flex items-center gap-1 mb-0.5">
            <Icon style={{ width: '0.7rem', height: '0.7rem' }} className="text-gray-400 shrink-0" />
            <span className="uppercase font-bold tracking-wider text-gray-300" style={{ fontSize: 'clamp(0.42rem, 4cqmin, 0.58rem)' }}>{label}</span>
        </div>
        <span className="font-bold text-white leading-none tabular-nums" style={fluidTextSm}>
            {value}{unit && <span className="text-gray-400 ml-0.5 font-normal" style={{ fontSize: 'clamp(0.42rem, 3.5cqmin, 0.6rem)' }}>{unit}</span>}
        </span>
    </div>
);

// --- Preview ribbon ----------------------------------------------------------
// Unmistakable, theme-stable banner so a representative fixture is NEVER read
// as live telemetry. Shown on both the tile and the modal.
const PreviewBadge = ({ compact }: { compact?: boolean }) => (
    <div
        className="flex items-center gap-1 rounded-full font-bold uppercase tracking-wider"
        style={{
            padding: compact ? '0.1rem 0.45rem' : '0.2rem 0.6rem',
            background: 'repeating-linear-gradient(45deg, #f59e0b22 0 6px, #f59e0b11 6px 12px)',
            border: '1px solid #f59e0b88',
            color: '#fbbf24',
            fontSize: compact ? 'clamp(0.4rem, 3.5cqmin, 0.55rem)' : '0.7rem',
        }}
    >
        <IconAlertTriangle style={{ width: compact ? '0.6rem' : '0.85rem', height: compact ? '0.6rem' : '0.85rem' }} />
        Preview data
    </div>
);

// --- Detail modal -------------------------------------------------------------
const KohlerGeneratorModal = ({ s, onClose }: { s: GeneratorRehlkoState; onClose: () => void }) => {
    const attention = attentionFor(s);
    const hl = headlineFor(s);
    const rows: { label: string; value: string; header?: boolean }[] = [
        { label: 'Engine state', value: s.engineState ?? 'n/a' },
        { label: 'Controller status', value: s.status ?? 'n/a' },
        { label: 'Power source', value: s.powerSource ? (s.powerSource === 'generator' ? 'Generator' : 'Utility') : 'n/a' },
        { label: 'Auto mode', value: s.autoRun === null ? 'n/a' : s.autoRun ? 'Armed' : 'Off' },
        { label: 'Connectivity', value: s.isConnected === null ? 'n/a' : s.isConnected ? 'Online' : 'Offline' },
        { label: 'Electrical', value: '', header: true },
        { label: 'Generator output (avg)', value: `${fmtNum(s.generatorVoltage)} V` },
        { label: 'Utility voltage (avg)', value: `${fmtNum(s.utilityVoltage)} V` },
        { label: 'Frequency', value: `${fmtNum(s.engineFrequency, 1)} Hz` },
        { label: 'Load', value: `${fmtNum(s.loadWatts)} W (${fmtNum(s.loadPercent)} %)` },
        { label: 'Engine', value: '', header: true },
        { label: 'Engine speed', value: `${fmtNum(s.engineSpeed)} rpm` },
        { label: 'Battery', value: `${fmtNum(s.batteryVoltage, 1)} V` },
        { label: 'Oil pressure', value: `${fmtNum(s.oilPressure)} psi` },
        { label: 'Coolant temp', value: `${fmtNum(s.coolantTemp)} °F` },
        { label: 'Oil temp', value: `${fmtNum(s.oilTemp)} °F` },
        { label: 'Controller temp', value: `${fmtNum(s.controllerTemp)} °F` },
        { label: 'Total runtime', value: `${fmtNum(s.totalRuntimeHours, 1)} h` },
        { label: 'Fuel level', value: 'n/a (NG/LP — no tank sender)' },
        { label: 'Schedule', value: '', header: true },
        { label: 'Next exercise', value: fmtTimestamp(s.nextExercise) },
        { label: 'Last run', value: fmtTimestamp(s.lastRun) },
        { label: 'Last maintenance', value: fmtTimestamp(s.lastMaintenance) },
        { label: 'Next maintenance', value: fmtTimestamp(s.nextMaintenance) },
    ];

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden border border-gray-700 max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-700 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="rounded-full" style={{ width: '0.7rem', height: '0.7rem', background: TONE_COLOR[hl.tone], boxShadow: `0 0 8px ${TONE_COLOR[hl.tone]}` }} />
                        <div>
                            <h3 className="text-lg font-bold text-white">{s.generatorName}</h3>
                            <p className="text-xs text-gray-400">{hl.word}{s.powerSource ? ` · ${s.powerSource === 'generator' ? 'On Generator' : 'On Utility'}` : ''}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {s.isPreview && <PreviewBadge />}
                        <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-700 transition-colors">
                            <IconX className="w-6 h-6" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-0">
                    {s.isPreview && (
                        <div className="p-3 bg-amber-900/30 border-b border-amber-500/40 text-amber-200 text-xs leading-snug">
                            Representative fixture — NOT live telemetry. Values are simulated and go live when the Rehlko (Kohler Energy Management) account is connected to the core <span className="font-mono">rehlko</span> integration.
                        </div>
                    )}
                    {attention.length > 0 && (
                        <div className={`p-4 border-b ${attention.some(a => a.severity === 'error') ? 'bg-red-900/30 border-red-500/40' : 'bg-yellow-900/30 border-yellow-500/40'}`}>
                            <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider mb-2 ${attention.some(a => a.severity === 'error') ? 'text-red-300' : 'text-yellow-300'}`}>
                                <IconAlertTriangle className="w-4 h-4" /> Attention
                            </div>
                            <ul className="space-y-1 text-sm">
                                {attention.map((a, i) => (
                                    <li key={i} className="flex items-baseline gap-2">
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.severity === 'error' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                                        <span className={a.severity === 'error' ? 'text-red-100' : 'text-yellow-100'}>{a.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-gray-700/50">
                            {rows.map(({ label, value, header }) => (
                                <tr key={label} className={header ? 'bg-gray-900/50' : 'hover:bg-gray-700/30'}>
                                    <td className={`p-3 font-medium ${header ? 'text-white' : 'text-gray-400'} w-1/2 border-r border-gray-700/30`}>{label}</td>
                                    <td className="p-3 text-gray-200 font-mono break-all">{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="p-3 text-[10px] text-gray-500 leading-snug border-t border-gray-700/50">
                        Display-only. The <span className="font-mono">rehlko</span> integration exposes no control entities; start / stop / exercise are not available from this surface.
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

// --- Tile --------------------------------------------------------------------
const KohlerGeneratorTile = ({ device, tile, isEditor, cornerClassName }: {
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string;
}) => {
    const [showDetails, setShowDetails] = useState(false);
    const isLocked = !!tile.isLocked;
    const s = (device.state && typeof device.state === 'object' ? device.state : {}) as Partial<GeneratorRehlkoState>;

    // Graceful degradation: before the composite is populated.
    if (!s || !('engineState' in s)) {
        return (
            <TileWrapper label={tile.label || device.name} isLocked={isLocked} isEditor={isEditor} className={cornerClassName} accent="warn">
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <IconPower className="w-7 h-7 mb-2 opacity-50" />
                    <span className="text-xs">Generator — loading…</span>
                </div>
            </TileWrapper>
        );
    }

    const state = s as GeneratorRehlkoState;
    const hl = headlineFor(state);
    const attention = attentionFor(state);
    const hasError = attention.some(a => a.severity === 'error');
    const hasWarning = attention.some(a => a.severity === 'warning');
    const isActive = state.isRunning || state.isExercising || hasError;

    const accent: 'alert' | 'brand' | 'warn' = hasError ? 'alert' : isActive ? 'brand' : 'warn';
    const animation = (hasError || state.isRunning || state.isExercising)
        ? { enabled: true, effect: 'pulse' as const, color: hasError ? '#ef4444' : state.isExercising ? '#38bdf8' : '#22c55e' }
        : tile.animation;

    const nextEx = relativeTo(state.nextExercise);

    return (
        <>
            <TileWrapper
                label=""
                isLocked={isLocked}
                isEditor={isEditor}
                className={`!p-3 !block ${cornerClassName || ''}`}
                isActive={isActive}
                accent={accent}
                animation={animation as any}
                onClick={() => { if (!isEditor && !isLocked) setShowDetails(true); }}
            >
                <div className="flex flex-col h-full">
                    {/* Header: name + preview badge + connectivity */}
                    <div className="flex items-start justify-between gap-2">
                        <h2 className="font-bold text-white leading-tight min-w-0 truncate" style={fluidTextLg}>{device.name || state.generatorName}</h2>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {state.isPreview && <PreviewBadge compact />}
                            {state.isConnected === false && <IconWifiOff className="w-4 h-4 text-gray-400" />}
                        </div>
                    </div>

                    {/* HERO: headline state + power source */}
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="rounded-full shrink-0" style={{ width: '0.7rem', height: '0.7rem', background: TONE_COLOR[hl.tone], boxShadow: `0 0 10px ${TONE_COLOR[hl.tone]}` }} />
                            <span className="font-extrabold text-white leading-none truncate" style={fluidText2xl}>{hl.word}</span>
                        </div>
                    </div>
                    <div className="mt-1.5">
                        <PowerSourcePill source={state.powerSource} />
                    </div>

                    {/* Attention caption */}
                    {attention.length > 0 && (
                        <div className={`mt-1.5 flex items-center gap-1.5 leading-tight ${hasError ? 'text-red-300' : 'text-yellow-300'}`} style={fluidTextXs}>
                            <IconAlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate font-semibold">{attention[0].text}</span>
                            {attention.length > 1 && <span className="text-gray-400">+{attention.length - 1}</span>}
                        </div>
                    )}

                    {/* Graphic */}
                    <div className="flex-1 flex items-center justify-center min-h-0 py-1">
                        <GeneratorGraphic running={state.isRunning} exercising={state.isExercising} fault={hasError} />
                    </div>

                    {/* Vitals row 1 */}
                    <div className="flex w-full mb-1.5" style={fluidGap(0.375)}>
                        <Vital icon={IconBattery} label="Batt" value={fmtNum(state.batteryVoltage, 1)} unit="V" />
                        <Vital icon={IconZap} label="Load" value={fmtNum(state.loadWatts >= 1000 ? state.loadWatts / 1000 : state.loadWatts, state.loadWatts >= 1000 ? 1 : 0)} unit={state.loadWatts !== null && state.loadWatts >= 1000 ? 'kW' : 'W'} />
                        <Vital icon={IconActivity} label="Out" value={fmtNum(state.generatorVoltage)} unit="V" />
                    </div>
                    {/* Vitals row 2 */}
                    <div className="flex w-full" style={fluidGap(0.375)}>
                        <Vital icon={IconActivity} label="Hz" value={fmtNum(state.engineFrequency, 1)} />
                        <Vital icon={IconCpu} label="RPM" value={fmtNum(state.engineSpeed)} />
                        <Vital icon={IconClock} label="Hrs" value={fmtNum(state.totalRuntimeHours, 0)} />
                    </div>

                    {/* Footer: next exercise + auto mode */}
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-gray-300" style={fluidTextXs}>
                        <span className="flex items-center gap-1 min-w-0 truncate">
                            <IconClock className="w-3 h-3 shrink-0 text-gray-400" />
                            {nextEx ? <>Exercise <span className="text-white font-semibold">{nextEx}</span></> : 'No exercise scheduled'}
                        </span>
                        {state.autoRun !== null && (
                            <span className="flex items-center gap-1 shrink-0">
                                {state.autoRun
                                    ? <><IconCheckCircle className="w-3 h-3 text-green-400" /> Auto</>
                                    : <><IconPowerOff className="w-3 h-3 text-gray-500" /> Manual</>}
                            </span>
                        )}
                    </div>
                </div>
            </TileWrapper>
            {showDetails && <KohlerGeneratorModal s={state} onClose={() => setShowDetails(false)} />}
        </>
    );
};

export default KohlerGeneratorTile;
