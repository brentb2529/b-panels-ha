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
import {
    GlassPanel, GlassCard, GlassButton,
    glassMaterial, glassMaterialActive,
    BuildBar,
    radius, spring, duration, accentVar as dsAccentVar,
} from '../../design-system';

// =============================================================================
// Kohler / Rehlko standby-generator surface — DISPLAY-ONLY.  (liquid-glass rollout)
//
// GLASS ROLLOUT:
//   • Outer tile: GlassPanel (level-1, glass-mount)
//   • Vital stat cells: GlassCard (level-3 = control-bead material)
//   • Load percentage: BuildBar widget (springs to value on mount + change)
//   • Status indicator: living glow dot with running/standby/exercise/fault tone
//     using glassMaterialActive (green=running, sky=exercise, muted=standby, red=fault)
//   • Generator graphic: mode-tinted glow using design tokens, not hardcoded hex
//   • Modal: GlassPanel (level-2) + GlassButton close
//   • Preview badge: unchanged (amber pattern ribbon, no glass treatment needed)
//   • All data bindings, composites, display-only contract UNCHANGED.
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
type Headline = { word: string; tone: 'running' | 'exercise' | 'standby' | 'fault' | 'offline' };

function headlineFor(s: GeneratorRehlkoState): Headline {
    if (s.isConnected === false) return { word: 'Offline', tone: 'offline' };
    if (s.isExercising) return { word: 'Exercising', tone: 'exercise' };
    if (s.isRunning) return { word: 'Running', tone: 'running' };
    const es = (s.engineState || s.status || '').toLowerCase();
    if (/standby|ready/.test(es)) return { word: 'Standby', tone: 'standby' };
    if (/off|switchstateoff|shutdown/.test(es)) return { word: 'Off', tone: 'offline' };
    if (s.engineState) return { word: s.engineState, tone: 'standby' };
    return { word: 'Standby', tone: 'standby' };
}

// Map tone to design-system accent CSS vars (no hardcoded hex in component code)
const TONE_ACCENT_VAR: Record<Headline['tone'], string> = {
    running:  'var(--accent-plug)',    // green — actively running / generating
    exercise: 'var(--accent-water)',   // sky — scheduled exercise run
    standby:  'var(--accent)',         // brand blue — healthy standby
    fault:    'var(--accent-alert)',   // red — fault / error
    offline:  'var(--accent-warn)',    // amber — disconnected
};

// Fallback hex for contexts that need a concrete color (glow div, svg fills)
const TONE_HEX: Record<Headline['tone'], string> = {
    running:  '#22c55e',
    exercise: '#38bdf8',
    standby:  '#94a3b8',
    fault:    '#ef4444',
    offline:  '#9ca3af',
};

// --- Attention derivation ----------------------------------------------------
function attentionFor(s: GeneratorRehlkoState): { severity: 'error' | 'warning'; text: string }[] {
    const out: { severity: 'error' | 'warning'; text: string }[] = [];
    if (s.oilPressureProblem === true) out.push({ severity: 'error', text: 'Low oil pressure' });
    if (s.isConnected === false) out.push({ severity: 'warning', text: 'Controller offline' });
    return out;
}

// --- Power-source pill -------------------------------------------------------
const PowerSourcePill = ({ source }: { source: GeneratorRehlkoState['powerSource'] }) => {
    const onGen = source === 'generator';
    const onUtil = source === 'utility';
    const label = onGen ? 'On Generator' : onUtil ? 'On Utility' : 'Source n/a';
    const accentCssVar = onGen ? 'var(--accent-plug)' : onUtil ? 'var(--accent-water)' : undefined;
    const Icon = onGen ? IconZap : IconHome;

    return (
        <GlassButton
            active={!!accentCssVar}
            accentVar={accentCssVar}
            style={{
                gap: 6, padding: '4px 10px 4px 8px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--type-2xs)',
                fontWeight: 'var(--weight-bold)',
                letterSpacing: 'var(--tracking-caps)',
                textTransform: 'uppercase',
                cursor: 'default',
                color: accentCssVar ? accentCssVar : 'rgb(var(--text) / 0.45)',
            }}
        >
            <Icon style={{ width: '1rem', height: '1rem', flexShrink: 0 }} />
            {label}
        </GlassButton>
    );
};

// --- Living status dot -------------------------------------------------------
// A glass-bead indicator that pulses when the generator is active.
// Adapts its glow color to tone via design-system accent vars.
const LivingStatusDot = ({ tone }: { tone: Headline['tone'] }) => {
    const isActive = tone === 'running' || tone === 'exercise';
    const isFault  = tone === 'fault';
    const accentCssVar = TONE_ACCENT_VAR[tone];
    const hex = TONE_HEX[tone];

    return (
        <span
            style={{
                display: 'inline-block',
                width: '0.7rem', height: '0.7rem',
                borderRadius: '50%', flexShrink: 0,
                background: hex,
                boxShadow: `0 0 ${isActive ? 14 : isFault ? 10 : 6}px ${hex}`,
                animation: isActive
                    ? 'widget-idle-breathe 1.8s ease-in-out infinite'
                    : isFault
                    ? 'glass-pulse-ring 1.2s ease-in-out infinite'
                    : 'none',
                transition: `background var(--dur-medium) var(--spring-gentle), box-shadow var(--dur-medium) var(--spring-gentle)`,
            }}
        />
    );
};

// --- Generator graphic — mode-tinted glow now via design tokens --------------
const GeneratorGraphic = ({ running, fault, exercising }: { running: boolean; fault: boolean; exercising: boolean }) => {
    const tone: Headline['tone'] = fault ? 'fault' : exercising ? 'exercise' : running ? 'running' : 'standby';
    const glowHex = fault ? '#ef4444' : exercising ? '#38bdf8' : running ? '#22c55e' : 'transparent';
    const showGlow = glowHex !== 'transparent';

    return (
        <div className="relative flex items-center justify-center" style={{ width: 'clamp(3.5rem, 30cqmin, 6.5rem)', aspectRatio: '200 / 140' }}>
            {showGlow && (
                <div
                    className="absolute rounded-full blur-2xl pointer-events-none"
                    style={{
                        width: '88%', height: '82%',
                        background: `color-mix(in srgb, ${TONE_ACCENT_VAR[tone]} 60%, transparent)`,
                        opacity: fault ? 0.45 : 0.38,
                        animation: (running || exercising) ? 'widget-idle-breathe 2s ease-in-out infinite' : 'none',
                    }}
                />
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
                {/* Status LED — uses design token hex fallbacks */}
                <circle
                    cx="170" cy="106" r="5"
                    fill={glowHex !== 'transparent' ? glowHex : '#475569'}
                    style={showGlow ? { filter: `drop-shadow(0 0 4px ${glowHex})` } : undefined}
                >
                    {(running || exercising) && !fault && (
                        <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />
                    )}
                </circle>
            </svg>
        </div>
    );
};

// --- Vital stat cell — glass-bead (level-3) ----------------------------------
const Vital = ({ icon: Icon, label, value, unit }: { icon: any; label: string; value: string; unit?: string }) => (
    <div
        className="flex flex-col items-center justify-center flex-1 min-w-0"
        style={{
            borderRadius: 'var(--radius-control)',
            padding: '6px 4px',
            ...glassMaterial(3),
        }}
    >
        <div className="flex items-center gap-1 mb-0.5">
            <Icon style={{ width: '0.7rem', height: '0.7rem' }} className="text-gray-400 shrink-0" />
            <span
                className="uppercase font-bold tracking-wider"
                style={{ fontSize: 'clamp(0.42rem, 4cqmin, 0.58rem)', color: 'rgb(var(--text) / 0.45)' }}
            >
                {label}
            </span>
        </div>
        <span
            className="font-bold leading-none tabular-nums"
            style={{ ...fluidTextSm, color: 'rgb(var(--text))' }}
        >
            {value}
            {unit && (
                <span
                    className="font-normal ml-0.5"
                    style={{ fontSize: 'clamp(0.42rem, 3.5cqmin, 0.6rem)', color: 'rgb(var(--text) / 0.45)' }}
                >
                    {unit}
                </span>
            )}
        </span>
    </div>
);

// --- Load bar row — BuildBar with % and watt label ---------------------------
const LoadBar = ({ loadPercent, loadWatts, isActive }: { loadPercent: number | null; loadWatts: number | null; isActive: boolean }) => {
    const pct = loadPercent !== null && Number.isFinite(loadPercent) ? Math.max(0, Math.min(100, loadPercent)) : 0;
    const kw  = loadWatts !== null && Number.isFinite(loadWatts) ? loadWatts : 0;
    const kwLabel = kw >= 1000 ? `${(kw / 1000).toFixed(1)} kW` : `${Math.round(kw)} W`;

    return (
        <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgb(var(--text) / 0.45)' }}>
                    Load
                </span>
                <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'var(--type-xs)', fontWeight: 'var(--weight-bold)', color: isActive ? 'var(--accent-plug)' : 'rgb(var(--text) / 0.7)' }}>
                    {loadPercent !== null && Number.isFinite(loadPercent) ? `${Math.round(loadPercent)}%` : 'n/a'}
                    {kw > 0 && (
                        <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 400, color: 'rgb(var(--text) / 0.45)', marginLeft: 4 }}>
                            {kwLabel}
                        </span>
                    )}
                </span>
            </div>
            <BuildBar
                value={pct}
                min={0} max={100}
                colorVar={isActive ? 'var(--accent-plug)' : 'var(--accent)'}
                height={6}
                active={isActive}
                label={`Load ${Math.round(pct)}%`}
            />
        </div>
    );
};

// --- Preview ribbon ----------------------------------------------------------
// Unmistakable, theme-stable banner — preserved from original (pattern ribbon works in all themes)
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

// --- Detail modal — now GlassPanel + GlassButton ---------------------------
const KohlerGeneratorModal = ({ s, onClose }: { s: GeneratorRehlkoState; onClose: () => void }) => {
    const attention = attentionFor(s);
    const hl = headlineFor(s);
    const toneHex = TONE_HEX[hl.tone];

    const rows: { label: string; value: string; header?: boolean }[] = [
        { label: 'Engine state',      value: s.engineState ?? 'n/a' },
        { label: 'Controller status', value: s.status ?? 'n/a' },
        { label: 'Power source',      value: s.powerSource ? (s.powerSource === 'generator' ? 'Generator' : 'Utility') : 'n/a' },
        { label: 'Auto mode',         value: s.autoRun === null ? 'n/a' : s.autoRun ? 'Armed' : 'Off' },
        { label: 'Connectivity',      value: s.isConnected === null ? 'n/a' : s.isConnected ? 'Online' : 'Offline' },
        { label: 'Electrical', value: '', header: true },
        { label: 'Generator output (avg)', value: `${fmtNum(s.generatorVoltage)} V` },
        { label: 'Utility voltage (avg)',   value: `${fmtNum(s.utilityVoltage)} V` },
        { label: 'Frequency',         value: `${fmtNum(s.engineFrequency, 1)} Hz` },
        { label: 'Load',              value: `${fmtNum(s.loadWatts)} W (${fmtNum(s.loadPercent)} %)` },
        { label: 'Engine', value: '', header: true },
        { label: 'Engine speed',      value: `${fmtNum(s.engineSpeed)} rpm` },
        { label: 'Battery',           value: `${fmtNum(s.batteryVoltage, 1)} V` },
        { label: 'Oil pressure',      value: `${fmtNum(s.oilPressure)} psi` },
        { label: 'Coolant temp',      value: `${fmtNum(s.coolantTemp)} °F` },
        { label: 'Oil temp',          value: `${fmtNum(s.oilTemp)} °F` },
        { label: 'Controller temp',   value: `${fmtNum(s.controllerTemp)} °F` },
        { label: 'Total runtime',     value: `${fmtNum(s.totalRuntimeHours, 1)} h` },
        { label: 'Fuel level',        value: 'n/a (NG/LP — no tank sender)' },
        { label: 'Schedule', value: '', header: true },
        { label: 'Next exercise',     value: fmtTimestamp(s.nextExercise) },
        { label: 'Last run',          value: fmtTimestamp(s.lastRun) },
        { label: 'Last maintenance',  value: fmtTimestamp(s.lastMaintenance) },
        { label: 'Next maintenance',  value: fmtTimestamp(s.nextMaintenance) },
    ];

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center z-[100] p-4"
            style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.6)' }}
            onClick={onClose}
        >
            <GlassPanel
                level={2}
                animate
                borderRadius="var(--radius-surface)"
                className="w-full max-w-lg overflow-hidden max-h-[88vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Modal header */}
                <div
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: 'var(--space-4)', borderBottom: '1px solid var(--glass-l2-border)',
                        flexShrink: 0,
                        background: 'var(--glass-l1-tint)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <LivingStatusDot tone={hl.tone} />
                        <div>
                            <h3 style={{ fontSize: 'var(--type-lg)', fontWeight: 'var(--weight-bold)', color: 'rgb(var(--text))' }}>
                                {s.generatorName}
                            </h3>
                            <p style={{ fontSize: 'var(--type-xs)', color: 'rgb(var(--text) / 0.45)' }}>
                                {hl.word}{s.powerSource ? ` · ${s.powerSource === 'generator' ? 'On Generator' : 'On Utility'}` : ''}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {s.isPreview && <PreviewBadge />}
                        <GlassButton
                            onClick={onClose}
                            style={{ padding: 8, borderRadius: 'var(--radius-control)' }}
                            aria-label="Close"
                        >
                            <IconX className="w-5 h-5" style={{ color: 'rgb(var(--text) / 0.6)' }} />
                        </GlassButton>
                    </div>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {s.isPreview && (
                        <div style={{
                            padding: 'var(--space-3)',
                            background: 'color-mix(in srgb, var(--accent-warn) 8%, var(--glass-l2-bg))',
                            borderBottom: '1px solid color-mix(in srgb, var(--accent-warn) 30%, transparent)',
                            color: 'var(--accent-warn)',
                            fontSize: 'var(--type-xs)',
                            lineHeight: 1.5,
                        }}>
                            Representative fixture — NOT live telemetry. Values are simulated and go live when the Rehlko (Kohler Energy Management) account is connected to the core <span style={{ fontFamily: 'var(--font-numeric)' }}>rehlko</span> integration.
                        </div>
                    )}
                    {attention.length > 0 && (
                        <div style={{
                            padding: 'var(--space-4)',
                            borderBottom: `1px solid ${attention.some(a => a.severity === 'error')
                                ? 'color-mix(in srgb, var(--accent-alert) 30%, transparent)'
                                : 'color-mix(in srgb, var(--accent-warn) 30%, transparent)'}`,
                            background: `color-mix(in srgb, ${attention.some(a => a.severity === 'error') ? 'var(--accent-alert)' : 'var(--accent-warn)'} 8%, var(--glass-l2-bg))`,
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                fontSize: 'var(--type-xs)', fontWeight: 'var(--weight-bold)',
                                textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)',
                                marginBottom: 8,
                                color: attention.some(a => a.severity === 'error') ? 'var(--accent-alert)' : 'var(--accent-warn)',
                            }}>
                                <IconAlertTriangle style={{ width: 14, height: 14 }} /> Attention
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {attention.map((a, i) => (
                                    <li key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                        <span style={{
                                            display: 'inline-block', width: 6, height: 6,
                                            borderRadius: '50%', flexShrink: 0, marginTop: 4,
                                            background: a.severity === 'error' ? 'var(--accent-alert)' : 'var(--accent-warn)',
                                        }} />
                                        <span style={{ fontSize: 'var(--type-sm)', color: 'rgb(var(--text) / 0.85)' }}>{a.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--type-sm)' }}>
                        <tbody>
                            {rows.map(({ label, value, header }) => (
                                <tr
                                    key={label}
                                    style={{
                                        background: header ? 'var(--glass-l1-tint)' : undefined,
                                        borderBottom: '1px solid var(--glass-l2-border)',
                                    }}
                                >
                                    <td style={{
                                        padding: 'var(--space-3)',
                                        fontWeight: header ? 'var(--weight-semibold)' : 'var(--weight-medium)',
                                        color: header ? 'rgb(var(--text))' : 'rgb(var(--text) / 0.55)',
                                        width: '50%',
                                        borderRight: '1px solid var(--glass-l2-border)',
                                    }}>
                                        {label}
                                    </td>
                                    <td style={{
                                        padding: 'var(--space-3)',
                                        color: 'rgb(var(--text) / 0.85)',
                                        fontFamily: value !== '' ? 'var(--font-numeric)' : undefined,
                                        wordBreak: 'break-all',
                                    }}>
                                        {value}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{
                        padding: 'var(--space-3)',
                        fontSize: 'var(--type-2xs)', color: 'rgb(var(--text) / 0.35)',
                        lineHeight: 1.5,
                        borderTop: '1px solid var(--glass-l2-border)',
                    }}>
                        Display-only. The <span style={{ fontFamily: 'var(--font-numeric)' }}>rehlko</span> integration exposes no control entities; start / stop / exercise are not available from this surface.
                    </div>
                </div>
            </GlassPanel>
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

    // Graceful degradation
    if (!s || !('engineState' in s)) {
        return (
            <TileWrapper label={tile.label || device.name} isLocked={isLocked} isEditor={isEditor} className={cornerClassName} accent="warn">
                <div className="flex flex-col items-center justify-center h-full" style={{ color: 'rgb(var(--text) / 0.45)' }}>
                    <IconPower className="w-7 h-7 mb-2 opacity-50" />
                    <span style={{ fontSize: 'var(--type-xs)' }}>Generator — loading…</span>
                </div>
            </TileWrapper>
        );
    }

    const state = s as GeneratorRehlkoState;
    const hl = headlineFor(state);
    const attention = attentionFor(state);
    const hasError = attention.some(a => a.severity === 'error');
    const isActive = state.isRunning || state.isExercising || hasError;

    const accent: 'alert' | 'brand' | 'warn' = hasError ? 'alert' : isActive ? 'brand' : 'warn';
    const animation = (hasError || state.isRunning || state.isExercising)
        ? { enabled: true, effect: 'pulse' as const, color: TONE_HEX[hl.tone] }
        : tile.animation;

    const nextEx = relativeTo(state.nextExercise);

    // Load metrics for BuildBar
    const loadPct = state.loadPercent !== null && Number.isFinite(state.loadPercent) ? state.loadPercent : 0;

    return (
        <>
            <TileWrapper
                label=""
                isLocked={isLocked}
                isEditor={isEditor}
                className={`!p-0 !block ${cornerClassName || ''}`}
                isActive={isActive}
                accent={accent}
                animation={animation as any}
                onClick={() => { if (!isEditor && !isLocked) setShowDetails(true); }}
            >
                {/* GlassPanel wraps the tile body — level-1, glass-mount */}
                <GlassPanel
                    level={1}
                    animate
                    borderRadius="0"
                    style={{ padding: 'var(--space-3)', height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                    {/* ── Header: name + preview + connectivity ── */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <h2
                            className="font-bold leading-tight min-w-0 truncate"
                            style={{ ...fluidTextLg, color: 'rgb(var(--text))' }}
                        >
                            {device.name || state.generatorName}
                        </h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {state.isPreview && <PreviewBadge compact />}
                            {state.isConnected === false && (
                                <IconWifiOff style={{ width: 14, height: 14, color: 'rgb(var(--text) / 0.4)' }} />
                            )}
                        </div>
                    </div>

                    {/* ── Hero: living status dot + headline + source pill ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <LivingStatusDot tone={hl.tone} />
                        <span
                            className="font-extrabold leading-none truncate"
                            style={{ ...fluidText2xl, color: 'rgb(var(--text))' }}
                        >
                            {hl.word}
                        </span>
                    </div>
                    <div style={{ marginTop: 6 }}>
                        <PowerSourcePill source={state.powerSource} />
                    </div>

                    {/* ── Attention caption ── */}
                    {attention.length > 0 && (
                        <div
                            className="flex items-center gap-1.5 leading-tight"
                            style={{
                                marginTop: 6,
                                ...fluidTextXs,
                                color: hasError ? 'var(--accent-alert)' : 'var(--accent-warn)',
                            }}
                        >
                            <IconAlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                            <span className="truncate font-semibold">{attention[0].text}</span>
                            {attention.length > 1 && (
                                <span style={{ color: 'rgb(var(--text) / 0.45)' }}>+{attention.length - 1}</span>
                            )}
                        </div>
                    )}

                    {/* ── Generator graphic — mode-tinted glow ── */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: '4px 0' }}>
                        <GeneratorGraphic running={state.isRunning} exercising={state.isExercising} fault={hasError} />
                    </div>

                    {/* ── Load BuildBar ── */}
                    <div style={{ marginBottom: 8 }}>
                        <LoadBar loadPercent={state.loadPercent} loadWatts={state.loadWatts} isActive={isActive} />
                    </div>

                    {/* ── Vitals row 1 — GlassCard bead cells ── */}
                    <div style={{ display: 'flex', width: '100%', marginBottom: 6, gap: 6 }}>
                        <Vital icon={IconBattery}   label="Batt" value={fmtNum(state.batteryVoltage, 1)} unit="V" />
                        <Vital icon={IconZap}       label="Out"  value={fmtNum(state.generatorVoltage)} unit="V" />
                        <Vital icon={IconActivity}  label="Hz"   value={fmtNum(state.engineFrequency, 1)} />
                    </div>
                    {/* ── Vitals row 2 ── */}
                    <div style={{ display: 'flex', width: '100%', gap: 6 }}>
                        <Vital icon={IconCpu}   label="RPM" value={fmtNum(state.engineSpeed)} />
                        <Vital icon={IconClock} label="Hrs" value={fmtNum(state.totalRuntimeHours, 0)} />
                        <Vital icon={IconThermometer} label="Cool" value={fmtNum(state.coolantTemp)} unit="°F" />
                    </div>

                    {/* ── Footer: next exercise + auto mode ── */}
                    <div
                        style={{
                            marginTop: 6,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                            color: 'rgb(var(--text) / 0.45)',
                            ...fluidTextXs,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
                            <IconClock style={{ width: 12, height: 12, flexShrink: 0, color: 'rgb(var(--text) / 0.35)' }} />
                            <span className="truncate">
                                {nextEx
                                    ? <>Exercise <span style={{ color: 'rgb(var(--text))', fontWeight: 600 }}>{nextEx}</span></>
                                    : 'No exercise scheduled'}
                            </span>
                        </span>
                        {state.autoRun !== null && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                {state.autoRun
                                    ? <><IconCheckCircle style={{ width: 12, height: 12, color: 'var(--accent-plug)' }} /> Auto</>
                                    : <><IconPowerOff style={{ width: 12, height: 12, color: 'rgb(var(--text) / 0.35)' }} /> Manual</>}
                            </span>
                        )}
                    </div>
                </GlassPanel>
            </TileWrapper>

            {showDetails && <KohlerGeneratorModal s={state} onClose={() => setShowDetails(false)} />}
        </>
    );
};

export default KohlerGeneratorTile;
