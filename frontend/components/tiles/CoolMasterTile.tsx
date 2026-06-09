/**
 * CoolMasterTile — "Thermal Intelligence" instrument cluster
 *
 * Aesthetic: Aviation cockpit meets building automation SCADA. Precision
 * instrumentation, purposeful animation, mechanical depth. Every animation
 * reflects real hardware state — no decorative motion.
 *
 * Visual architecture:
 *  - Radial thermal ring: arc spans current→target; gap = delta demand
 *  - Animated turbine fan indicator: blade rotation speed maps to fan_mode
 *  - Swing vane: oscillating bar shows vane direction / sweep
 *  - Airflow particles: stream downward (cool) or upward (heat) when running
 *  - Mode-colored ambient glow breathes with compressor cycle
 *  - Filter/fault badges pulse as real warning lights
 *  - Stale: cyan ring scan animation signals pending reconcile
 *
 * Data/control contract: ALL via haClient (subscribeEntities / callService).
 * Optimistic + reconcile; stale indicator after STALE_MS without reconcile.
 *
 * Responsive: fluid scale via cqmin — same component for wall 2×2 and 1×1 mobile.
 * Light/dark: CSS variable palette from index.html.
 */

import React, {
    useCallback, useEffect, useRef, useState, useMemo,
} from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { CoolMasterUnitState } from '../../hooks/useCoolMasterSurface';
import * as haClient from '../../services/haClient';
import TileWrapper, { TileAccent } from './TileWrapper';
import {
    IconThermometer, IconSnowflake, IconFlame, IconPower,
    IconAlertTriangle, IconRotateCcw, IconActivity,
    IconPlus, IconMinus,
} from '../icons';
import {
    fluidTextXs, fluidTextSm, fluidTextLg,
    fluidText3xl, fluidIcon, fluidGap,
} from './tileScale';

// ─── Constants ─────────────────────────────────────────────────────────────────

const STALE_MS = 5_000;

// Fan mode → rotation period (ms). Lower = faster visual spin.
const FAN_RPM: Record<string, number> = {
    vlow: 4200, low: 2800, med: 1700, high: 1000, top: 600, auto: 1400,
};

const HVAC_LABEL: Record<string, string> = {
    off: 'Off', cool: 'Cool', heat: 'Heat', auto: 'Auto',
    fan_only: 'Fan', dry: 'Dry', heat_cool: 'Auto',
};

const FAN_LABEL: Record<string, string> = {
    vlow: 'VLow', low: 'Low', med: 'Med', high: 'High', top: 'Top', auto: 'Auto',
};

// Palette per mode
const MODE_PALETTE: Record<string, { primary: string; secondary: string; glow: string; bg: string }> = {
    cool:     { primary: '#22d3ee', secondary: '#0ea5e9', glow: 'rgba(34,211,238,0.35)', bg: 'rgba(8,47,73,0.92)' },
    heat:     { primary: '#fb923c', secondary: '#f97316', glow: 'rgba(251,146,60,0.35)', bg: 'rgba(69,26,3,0.92)' },
    auto:     { primary: '#34d399', secondary: '#10b981', glow: 'rgba(52,211,153,0.3)',  bg: 'rgba(6,36,24,0.92)' },
    fan_only: { primary: '#818cf8', secondary: '#6366f1', glow: 'rgba(129,140,248,0.3)', bg: 'rgba(19,18,40,0.92)' },
    dry:      { primary: '#f0abfc', secondary: '#e879f9', glow: 'rgba(240,171,252,0.28)', bg: 'rgba(40,10,40,0.92)' },
    off:      { primary: '#475569', secondary: '#334155', glow: 'rgba(71,85,105,0.15)',  bg: 'rgba(15,20,30,0.92)' },
};
const getPalette = (mode: string) => MODE_PALETTE[mode] ?? MODE_PALETTE.off;

// ─── SVG Animations — self-contained, CSS-variables-driven ────────────────────

/** Radial arc: outer ring showing current temp vs target. */
const ThermalRing = ({
    current, target, unit: tempUnit, size, mode, isOn, isUnavailable,
}: {
    current: number | null;
    target: number | null;
    size: number; // px (CSS size — cqmin-driven from parent)
    mode: string;
    unit: 'C' | 'F';
    isOn: boolean;
    isUnavailable: boolean;
}) => {
    const pal = getPalette(mode);
    const r = 44;
    const cx = 50;
    const cy = 50;
    const circumference = 2 * Math.PI * r;
    // Arc spans 270° (from 135° to 405°). We map the temperature range onto this.
    const arcFraction = 0.75; // 270°/360°

    // Compute arc lengths
    const tempMin = tempUnit === 'F' ? 60 : 16;
    const tempMax = tempUnit === 'F' ? 90 : 32;
    const clamp = (v: number) => Math.min(tempMax, Math.max(tempMin, v));
    const frac = (v: number) => (clamp(v) - tempMin) / (tempMax - tempMin);

    const targetFrac  = target  !== null ? frac(target)  : 0.5;
    const currentFrac = current !== null ? frac(current) : targetFrac;

    const targetDash  = targetFrac  * arcFraction * circumference;
    const currentDash = currentFrac * arcFraction * circumference;

    // Gap between current and target (demand pressure)
    const delta = current !== null && target !== null ? current - target : 0;
    const isDemanding = Math.abs(delta) > 0.3 && isOn && !isUnavailable;

    // SVG arc: starts at 135° (bottom-left), sweeps 270° clockwise
    const startAngle = 135;
    const totalSweep = 270;

    const polarToXY = (angle: number, radius: number) => {
        const rad = ((angle - 90) * Math.PI) / 180;
        return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
    };

    const describeArc = (startDeg: number, sweepDeg: number, rad: number) => {
        const start = polarToXY(startDeg, rad);
        const end   = polarToXY(startDeg + sweepDeg, rad);
        const largeArc = sweepDeg > 180 ? 1 : 0;
        return `M ${start.x} ${start.y} A ${rad} ${rad} 0 ${largeArc} 1 ${end.x} ${end.y}`;
    };

    const trackPath  = describeArc(startAngle, totalSweep, r);
    const targetPath = describeArc(startAngle, targetFrac * totalSweep, r);
    const currentPath = describeArc(startAngle, currentFrac * totalSweep, r);

    return (
        <svg
            viewBox="0 0 100 100"
            style={{ width: size, height: size, display: 'block', overflow: 'visible' }}
            aria-hidden
        >
            <defs>
                <filter id="cm-glow-ring">
                    <feGaussianBlur stdDeviation="2.5" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <filter id="cm-glow-current">
                    <feGaussianBlur stdDeviation="1.8" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>

            {/* Track */}
            <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" strokeLinecap="round" />

            {/* Target arc */}
            <path
                d={targetPath}
                fill="none"
                stroke={isOn && !isUnavailable ? pal.secondary : 'rgba(255,255,255,0.12)'}
                strokeWidth="4"
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.34,1.56,0.64,1), stroke 0.4s ease' }}
                filter={isOn && !isUnavailable ? 'url(#cm-glow-ring)' : undefined}
            >
                {isDemanding && (
                    <animate
                        attributeName="stroke-opacity"
                        values="1;0.5;1"
                        dur="1.8s"
                        repeatCount="indefinite"
                    />
                )}
            </path>

            {/* Current temp arc (brighter, narrower, offset outward) */}
            <path
                d={currentPath}
                fill="none"
                stroke={isOn && !isUnavailable ? pal.primary : 'rgba(255,255,255,0.22)'}
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.4s ease' }}
                filter={isOn && !isUnavailable ? 'url(#cm-glow-current)' : undefined}
            />

            {/* Demand gap tick — a small bright dot at the current temp endpoint */}
            {current !== null && isOn && !isUnavailable && (() => {
                const dot = polarToXY(startAngle + currentFrac * totalSweep, r);
                return (
                    <circle cx={dot.x} cy={dot.y} r="2.5" fill={pal.primary} filter="url(#cm-glow-current)">
                        {isDemanding && (
                            <animate attributeName="r" values="2.5;3.5;2.5" dur="1.4s" repeatCount="indefinite" />
                        )}
                    </circle>
                );
            })()}
        </svg>
    );
};

/** Animated turbine blades — rotation speed reflects fan_mode */
const FanTurbine = ({
    fanMode, isOn, isUnavailable, size,
}: {
    fanMode: string | null;
    isOn: boolean;
    isUnavailable: boolean;
    size: number;
}) => {
    const period = isOn && !isUnavailable && fanMode
        ? (FAN_RPM[fanMode.toLowerCase()] ?? 1400)
        : 0;
    const spinning = period > 0;

    // 4-blade turbine
    const blades = [0, 90, 180, 270];
    return (
        <svg
            viewBox="0 0 32 32"
            style={{ width: size, height: size, display: 'block' }}
            aria-hidden
        >
            <defs>
                <radialGradient id="cm-hub" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
                </radialGradient>
            </defs>
            <g style={spinning ? {
                transformOrigin: '16px 16px',
                animation: `spin ${period}ms linear infinite`,
            } : {}}>
                {blades.map(angle => (
                    <path
                        key={angle}
                        d="M 16 16 Q 16 7 12 5 Q 15 10 16 16"
                        fill="rgba(255,255,255,0.35)"
                        style={{
                            transformOrigin: '16px 16px',
                            transform: `rotate(${angle}deg)`,
                        }}
                    />
                ))}
            </g>
            {/* Hub */}
            <circle cx="16" cy="16" r="3" fill="url(#cm-hub)" />
            {spinning && (
                <circle cx="16" cy="16" r="3.5" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5">
                    <animate attributeName="r" values="3.5;5;3.5" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="0.15;0;0.15" dur="1.5s" repeatCount="indefinite" />
                </circle>
            )}
        </svg>
    );
};

/** Swing vane — a sweeping arc indicator */
const SwingVane = ({
    swingMode, isOn, isUnavailable, size,
}: {
    swingMode: string | null;
    isOn: boolean;
    isUnavailable: boolean;
    size: number;
}) => {
    const [phase, setPhase] = useState(0);
    const rafRef = useRef<number | null>(null);
    const startRef = useRef<number | null>(null);

    const isAuto = swingMode?.toLowerCase() === 'auto';
    const sweeping = isAuto && isOn && !isUnavailable;

    useEffect(() => {
        if (!sweeping) {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            setPhase(0);
            return;
        }
        const period = 3000; // ms per full sweep
        const animate = (ts: number) => {
            if (!startRef.current) startRef.current = ts;
            const elapsed = (ts - startRef.current) % period;
            setPhase((elapsed / period) * Math.PI * 2);
            rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [sweeping]);

    // Static angle from swing mode string ("30" → 30°, "60" → 60°, etc.)
    const staticAngle = (() => {
        if (!swingMode || swingMode.toLowerCase() === 'stop') return 10;
        if (swingMode.toLowerCase() === 'horizontal') return 0;
        if (swingMode.toLowerCase() === 'vertical') return 75;
        const n = parseInt(swingMode, 10);
        return isNaN(n) ? 30 : n;
    })();

    // Visual angle: sweep ±35° around base angle if auto, else static
    const baseAngle = sweeping
        ? 35 + Math.sin(phase) * 35 // 0°..70°
        : staticAngle;

    // Draw a short bar at the angle
    const rad = (baseAngle * Math.PI) / 180;
    const len = size * 0.38;
    const cx = size / 2;
    const cy = size * 0.55;
    const x2 = cx + Math.cos(rad - Math.PI / 2) * len;
    const y2 = cy + Math.sin(rad - Math.PI / 2) * len;
    const x1 = cx - Math.cos(rad - Math.PI / 2) * len * 0.4;
    const y1 = cy - Math.sin(rad - Math.PI / 2) * len * 0.4;

    const color = isOn && !isUnavailable ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.18)';

    return (
        <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, display: 'block' }} aria-hidden>
            {/* Arc track */}
            <path
                d={`M ${size * 0.15} ${cy} A ${len * 0.9} ${len * 0.9} 0 0 1 ${size * 0.85} ${cy}`}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
            />
            {/* Vane bar */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ transition: sweeping ? 'none' : 'all 0.4s cubic-bezier(0.34,1.56,0.64,1)' }}
            />
            {/* Pivot dot */}
            <circle cx={cx} cy={cy} r="2" fill={color} />
        </svg>
    );
};

/** Airflow particles: upward (heat) or downward (cool/fan) streams */
const AirflowParticles = ({
    mode, isOn, isUnavailable,
}: {
    mode: string;
    isOn: boolean;
    isUnavailable: boolean;
}) => {
    if (!isOn || isUnavailable) return null;
    const isHeat = mode === 'heat';
    const isCool = mode === 'cool' || mode === 'fan_only';
    if (!isHeat && !isCool) return null;

    const pal = getPalette(mode);
    // 5 particles at staggered x positions and durations
    const particles = [
        { x: 15, delay: 0,   dur: 3.2 },
        { x: 35, delay: 0.8, dur: 2.8 },
        { x: 55, delay: 0.3, dur: 3.5 },
        { x: 72, delay: 1.2, dur: 2.6 },
        { x: 88, delay: 0.6, dur: 3.0 },
    ];

    return (
        <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden
            preserveAspectRatio="none"
        >
            {particles.map((p, i) => {
                const fromY = isHeat ? 90 : 10;
                const toY   = isHeat ? 10 : 90;
                return (
                    <g key={i}>
                        <circle cx={p.x} cy={fromY} r="1.2" fill={pal.primary} opacity="0">
                            <animateMotion
                                dur={`${p.dur}s`}
                                begin={`${p.delay}s`}
                                repeatCount="indefinite"
                                path={`M 0 0 L 0 ${isHeat ? -(fromY - toY) : (toY - fromY)}`}
                            />
                            <animate
                                attributeName="opacity"
                                values="0;0.45;0.45;0"
                                keyTimes="0;0.1;0.8;1"
                                dur={`${p.dur}s`}
                                begin={`${p.delay}s`}
                                repeatCount="indefinite"
                            />
                            <animate
                                attributeName="r"
                                values="0.8;1.4;0.8"
                                dur={`${p.dur}s`}
                                begin={`${p.delay}s`}
                                repeatCount="indefinite"
                            />
                        </circle>
                    </g>
                );
            })}
        </svg>
    );
};

/** Fault/filter animated badge — strobes on active fault */
const StatusBadge = ({
    label, variant,
}: {
    label: string;
    variant: 'fault' | 'filter' | 'ok' | 'stale';
}) => {
    const cfg: Record<string, { bg: string; text: string; border: string; pulse: boolean }> = {
        fault:  { bg: 'rgba(239,68,68,0.2)',  text: '#fca5a5', border: 'rgba(239,68,68,0.5)',  pulse: true },
        filter: { bg: 'rgba(234,179,8,0.18)', text: '#fde68a', border: 'rgba(234,179,8,0.45)', pulse: true },
        ok:     { bg: 'rgba(52,211,153,0.15)', text: '#6ee7b7', border: 'rgba(52,211,153,0.3)', pulse: false },
        stale:  { bg: 'rgba(34,211,238,0.12)', text: '#67e8f9', border: 'rgba(34,211,238,0.35)', pulse: true },
    };
    const c = cfg[variant];
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wider"
            style={{
                background: c.bg,
                color: c.text,
                border: `1px solid ${c.border}`,
                padding: 'clamp(0.1rem, 1.2cqmin, 0.25rem) clamp(0.3rem, 2.5cqmin, 0.5rem)',
                fontSize: 'clamp(0.42rem, 7cqmin, 0.62rem)',
                animation: c.pulse ? 'cm-badge-pulse 1.6s ease-in-out infinite' : undefined,
                boxShadow: c.pulse ? `0 0 8px ${c.border}` : undefined,
            }}
        >
            {variant === 'fault' && (
                <IconAlertTriangle style={{ width: 'clamp(0.5rem, 7cqmin, 0.7rem)', height: 'clamp(0.5rem, 7cqmin, 0.7rem)', flexShrink: 0 }} />
            )}
            {variant === 'filter' && (
                <span style={{ fontSize: '0.9em' }}>●</span>
            )}
            {label}
        </span>
    );
};

/** Compact mode pill selector */
const ModePills = ({
    options, value, onSelect, disabled, renderLabel, renderIcon, accentColor,
}: {
    options: string[];
    value: string | null;
    onSelect: (v: string) => void;
    disabled?: boolean;
    renderLabel: (v: string) => string;
    renderIcon?: (v: string) => React.ReactNode;
    accentColor: string;
}) => (
    <div className="flex flex-wrap gap-0.5 justify-center w-full">
        {options.map(opt => {
            const isActive = value?.toLowerCase() === opt.toLowerCase();
            return (
                <button
                    key={opt}
                    disabled={disabled}
                    onClick={() => !disabled && onSelect(opt)}
                    className="flex items-center gap-0.5 rounded-control transition-all duration-200"
                    style={{
                        background: isActive ? `${accentColor}22` : 'rgba(0,0,0,0.28)',
                        border: `1px solid ${isActive ? accentColor + '88' : 'rgba(255,255,255,0.1)'}`,
                        color: isActive ? accentColor : 'rgba(255,255,255,0.45)',
                        padding: 'clamp(0.1rem, 1.5cqmin, 0.28rem) clamp(0.25rem, 2.5cqmin, 0.55rem)',
                        fontSize: 'clamp(0.45rem, 8.5cqmin, 0.68rem)',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.38 : 1,
                        boxShadow: isActive ? `inset 0 0 8px ${accentColor}18, 0 0 6px ${accentColor}22` : undefined,
                        transform: 'scale(1)',
                        transition: 'all 0.15s ease',
                    }}
                    onMouseDown={e => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
                    onMouseUp={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                >
                    {renderIcon && renderIcon(opt)}
                    {renderLabel(opt)}
                </button>
            );
        })}
    </div>
);

// ─── HVAC mode icon component ─────────────────────────────────────────────────

const HvacModeIcon = ({ mode, style, className }: { mode: string; style?: React.CSSProperties; className?: string }) => {
    switch (mode) {
        case 'cool': return <IconSnowflake className={className} style={style} />;
        case 'heat': return <IconFlame className={className} style={style} />;
        case 'off':  return <IconPower className={className} style={style} />;
        case 'fan_only': return <IconActivity className={className} style={style} />;
        default:     return <IconThermometer className={className} style={style} />;
    }
};

const hvacModeAccent = (mode: string): TileAccent =>
    mode === 'heat' ? 'warn' : mode === 'cool' ? 'water' : 'brand';

// ─── CSS keyframes (injected once) ───────────────────────────────────────────

const KEYFRAMES = `
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes cm-badge-pulse { 0%,100% { opacity:1; } 50% { opacity:0.48; } }
@keyframes cm-stale-scan {
    0%   { box-shadow: 0 0 0 2px rgba(34,211,238,0) inset; }
    25%  { box-shadow: 0 0 0 2px rgba(34,211,238,0.6) inset; }
    75%  { box-shadow: 0 0 0 2px rgba(34,211,238,0.6) inset; }
    100% { box-shadow: 0 0 0 2px rgba(34,211,238,0) inset; }
}
@keyframes cm-breath {
    0%,100% { opacity: 0.7; }
    50% { opacity: 1; }
}
@keyframes cm-particle-up { from { transform: translateY(0); opacity: 0.4; } to { transform: translateY(-40px); opacity: 0; } }
@keyframes cm-particle-dn { from { transform: translateY(0); opacity: 0.4; } to { transform: translateY(40px); opacity: 0; } }
`;

let _keyframesInjected = false;
const injectKeyframes = () => {
    if (_keyframesInjected) return;
    _keyframesInjected = true;
    const style = document.createElement('style');
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
};

// ─── Optimistic state type ─────────────────────────────────────────────────────

interface OptimisticState {
    hvacMode?: string;
    targetTemp?: number;
    fanMode?: string;
    swingMode?: string;
}

// ─── Main tile ─────────────────────────────────────────────────────────────────

const CoolMasterTile = ({
    device,
    tile,
    isEditor,
    cornerClassName,
}: {
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string;
}) => {
    useEffect(() => { injectKeyframes(); }, []);

    const { requestPin, addNotification } = useDashboardActions();
    const unit = device.state as CoolMasterUnitState;
    const isLocked = !!tile.isLocked;

    // ── Optimistic state + stale detection ─────────────────────────────────
    const [optimistic, setOptimistic] = useState<OptimisticState>({});
    const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isStale, setIsStale] = useState(false);

    useEffect(() => {
        setOptimistic(prev => {
            const next = { ...prev };
            if (prev.hvacMode !== undefined && prev.hvacMode === unit.hvacMode) delete next.hvacMode;
            if (prev.targetTemp !== undefined && prev.targetTemp === unit.targetTemp) delete next.targetTemp;
            if (prev.fanMode !== undefined && prev.fanMode?.toLowerCase() === unit.fanMode?.toLowerCase()) delete next.fanMode;
            if (prev.swingMode !== undefined && prev.swingMode?.toLowerCase() === unit.swingMode?.toLowerCase()) delete next.swingMode;
            if (Object.keys(next).length === 0) {
                setIsStale(false);
                if (staleTimer.current) { clearTimeout(staleTimer.current); staleTimer.current = null; }
            }
            return next;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unit.hvacMode, unit.targetTemp, unit.fanMode, unit.swingMode]);

    useEffect(() => () => { if (staleTimer.current) clearTimeout(staleTimer.current); }, []);

    const armStale = () => {
        if (staleTimer.current) clearTimeout(staleTimer.current);
        staleTimer.current = setTimeout(() => setIsStale(true), STALE_MS);
    };

    // ── Derived display values ──────────────────────────────────────────────
    const hvacMode   = optimistic.hvacMode  ?? unit.hvacMode;
    const targetTemp = optimistic.targetTemp ?? unit.targetTemp;
    const fanMode    = optimistic.fanMode    ?? unit.fanMode;
    const swingMode  = optimistic.swingMode  ?? unit.swingMode;
    const isOn       = hvacMode !== 'off' && hvacMode !== 'unavailable';
    const isUnavailable = !unit.isOnline;

    const pal = getPalette(hvacMode);
    const accent = hvacModeAccent(hvacMode);

    // ── Layout tiers ────────────────────────────────────────────────────────
    const tileW = tile.width || 1;
    const tileH = tile.height || 1;
    const isLarge = tileW >= 2 && tileH >= 2;
    const isTall = tileH >= 2;

    // ── Action guard ────────────────────────────────────────────────────────
    const guard = useCallback((action: () => void) => {
        if (isEditor || isLocked) return;
        if (tile.requirePin) { requestPin(() => action()); } else { action(); }
    }, [isEditor, isLocked, tile.requirePin, requestPin]);

    const setHvacMode = useCallback((mode: string) => {
        guard(() => {
            setOptimistic(p => ({ ...p, hvacMode: mode }));
            setIsStale(false); armStale();
            haClient.callService('climate', 'set_hvac_mode', {
                entity_id: unit.climateEntityId, hvac_mode: mode,
            }).catch(err => {
                addNotification(`Mode change failed: ${err?.message || err}`, 'error');
                setOptimistic(p => { const n = { ...p }; delete n.hvacMode; return n; });
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guard, unit.climateEntityId, addNotification]);

    const setTemp = useCallback((delta: number) => {
        guard(() => {
            const current = optimistic.targetTemp ?? unit.targetTemp;
            if (current === null) return;
            const next = Math.round((current + delta) * 2) / 2;
            setOptimistic(p => ({ ...p, targetTemp: next }));
            setIsStale(false); armStale();
            haClient.callService('climate', 'set_temperature', {
                entity_id: unit.climateEntityId, temperature: next,
            }).catch(err => {
                addNotification(`Temperature change failed: ${err?.message || err}`, 'error');
                setOptimistic(p => { const n = { ...p }; delete n.targetTemp; return n; });
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guard, unit.climateEntityId, unit.targetTemp, optimistic.targetTemp, addNotification]);

    const setFanMode = useCallback((mode: string) => {
        guard(() => {
            setOptimistic(p => ({ ...p, fanMode: mode }));
            setIsStale(false); armStale();
            haClient.callService('climate', 'set_fan_mode', {
                entity_id: unit.climateEntityId, fan_mode: mode,
            }).catch(err => {
                addNotification(`Fan mode change failed: ${err?.message || err}`, 'error');
                setOptimistic(p => { const n = { ...p }; delete n.fanMode; return n; });
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guard, unit.climateEntityId, addNotification]);

    const setSwingMode = useCallback((mode: string) => {
        guard(() => {
            setOptimistic(p => ({ ...p, swingMode: mode }));
            setIsStale(false); armStale();
            haClient.callService('climate', 'set_swing_mode', {
                entity_id: unit.climateEntityId, swing_mode: mode,
            }).catch(err => {
                addNotification(`Swing mode change failed: ${err?.message || err}`, 'error');
                setOptimistic(p => { const n = { ...p }; delete n.swingMode; return n; });
            });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guard, unit.climateEntityId, addNotification]);

    const resetFilter = useCallback(() => {
        if (!unit.resetFilterEntityId) return;
        guard(() => {
            haClient.callService('button', 'press', {
                entity_id: unit.resetFilterEntityId!,
            }).catch(err => {
                addNotification(`Filter reset failed: ${err?.message || err}`, 'error');
            });
        });
    }, [guard, unit.resetFilterEntityId, addNotification]);

    // ── Graceful degradation ─────────────────────────────────────────────────
    if (!unit || !unit.climateEntityId) {
        return (
            <TileWrapper
                label={tile.label || device.name}
                isLocked={isLocked}
                isEditor={isEditor}
                className={`border border-gray-600/30 ${cornerClassName || ''}`}
            >
                <div className="flex flex-col items-center justify-center h-full gap-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    <IconThermometer style={fluidIcon(2)} />
                    <span style={{ ...fluidTextXs, opacity: 0.5 }}>No entity</span>
                </div>
            </TileWrapper>
        );
    }

    // ── Temp delta helper ────────────────────────────────────────────────────
    const delta = unit.currentTemp !== null && targetTemp !== null
        ? unit.currentTemp - targetTemp
        : null;
    const deltaText = delta !== null
        ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}°`
        : null;
    const isDemanding = delta !== null && Math.abs(delta) > 0.3 && isOn;

    // ── Ring size (fluid based on tile size) ─────────────────────────────────
    // We use a % of the container; the outer div is a size-container so cqmin works.
    // We pass a fixed "virtual" size to ThermalRing, which itself uses viewBox scaling.
    const ringVirtualSize = isLarge ? 96 : 72;
    const turbineSize = isLarge ? 28 : 20;
    const vaneSize = isLarge ? 24 : 18;

    // ── Stale container style ────────────────────────────────────────────────
    const staleContainerStyle: React.CSSProperties = isStale ? {
        animation: 'cm-stale-scan 2s ease-in-out infinite',
        borderRadius: 'inherit',
    } : {};

    return (
        <TileWrapper
            label=""
            isLocked={isLocked}
            isEditor={isEditor}
            isActive={isOn && !isUnavailable}
            isUnavailable={isUnavailable}
            isProtected={tile.requirePin}
            accent={accent}
            animation={tile.animation}
            className={[
                '!p-0 !block overflow-hidden',
                isUnavailable
                    ? 'border border-gray-600/25'
                    : unit.errorCode
                        ? 'border border-red-500/50'
                        : 'border border-cyan-500/25',
                cornerClassName || '',
            ].join(' ')}
        >
            {/* Stale scan overlay */}
            <div className="absolute inset-0 rounded-inherit pointer-events-none z-50" style={staleContainerStyle} aria-hidden />

            {/* Airflow particles layer */}
            <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
                <AirflowParticles mode={hvacMode} isOn={isOn} isUnavailable={isUnavailable} />
            </div>

            {/* Background gradient */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: isUnavailable
                        ? 'rgba(15,20,30,0.95)'
                        : `radial-gradient(ellipse 80% 60% at 25% 25%, ${pal.glow}, transparent 70%), linear-gradient(160deg, ${pal.bg} 0%, rgba(10,13,20,0.97) 100%)`,
                    transition: 'background 0.6s ease',
                }}
                aria-hidden
            />

            {/* Ambient glow when active */}
            {isOn && !isUnavailable && (
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: `radial-gradient(ellipse 60% 50% at 75% 80%, ${pal.glow}, transparent 65%)`,
                        animation: 'cm-breath 4s ease-in-out infinite',
                    }}
                    aria-hidden
                />
            )}

            {/* ── Content ── */}
            <div
                className="relative z-10 flex flex-col h-full"
                style={{
                    padding: isLarge ? 'clamp(0.5rem, 4cqmin, 0.875rem)' : 'clamp(0.3rem, 3cqmin, 0.625rem)',
                    gap: isLarge ? 'clamp(0.25rem, 2cqmin, 0.5rem)' : 'clamp(0.15rem, 1.5cqmin, 0.375rem)',
                }}
            >
                {/* ── Row 1: Header ── */}
                <div className="flex items-center justify-between shrink-0">
                    <div className="flex items-center min-w-0" style={{ gap: 'clamp(0.2rem, 2cqmin, 0.4rem)' }}>
                        <HvacModeIcon
                            mode={hvacMode}
                            style={{
                                ...fluidIcon(isLarge ? 1.125 : 1),
                                color: isOn && !isUnavailable ? pal.primary : 'rgba(255,255,255,0.3)',
                                filter: isOn && !isUnavailable ? `drop-shadow(0 0 4px ${pal.primary})` : undefined,
                                flexShrink: 0,
                                transition: 'color 0.4s ease, filter 0.4s ease',
                            }}
                        />
                        <span
                            className="font-bold text-white truncate leading-tight"
                            style={{
                                ...fluidTextSm,
                                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                                maxWidth: '11ch',
                            }}
                        >
                            {tile.label || unit.name}
                        </span>
                    </div>

                    {/* Status badges: fault > filter > stale > (nothing) */}
                    <div className="flex items-center shrink-0 ml-1" style={{ gap: 'clamp(0.15rem, 1.5cqmin, 0.3rem)' }}>
                        {unit.errorCode ? (
                            <StatusBadge label={unit.errorCode} variant="fault" />
                        ) : unit.filterDirty ? (
                            <StatusBadge label="Filter" variant="filter" />
                        ) : isStale ? (
                            <StatusBadge label="Sync…" variant="stale" />
                        ) : null}
                    </div>
                </div>

                {/* ── Row 2: Thermal instrument (ring + temps + turbine) ── */}
                <div className="flex items-center justify-center shrink-0" style={{ gap: 'clamp(0.25rem, 2.5cqmin, 0.5rem)' }}>
                    {/* Radial ring + temps overlaid */}
                    <div className="relative flex items-center justify-center"
                        style={{ width: ringVirtualSize, height: ringVirtualSize, flexShrink: 0 }}>
                        <ThermalRing
                            current={unit.currentTemp}
                            target={targetTemp}
                            unit={unit.tempUnit}
                            size={ringVirtualSize}
                            mode={hvacMode}
                            isOn={isOn}
                            isUnavailable={isUnavailable}
                        />
                        {/* Temperature readout inside ring */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
                            style={{ gap: 'clamp(0.05rem, 0.8cqmin, 0.15rem)' }}>
                            {/* Current temp */}
                            <span
                                className="tabular-nums leading-none font-medium"
                                style={{
                                    fontSize: 'clamp(0.42rem, 7cqmin, 0.7rem)',
                                    color: 'rgba(255,255,255,0.45)',
                                    letterSpacing: '0.02em',
                                }}
                            >
                                {unit.currentTemp !== null ? `${unit.currentTemp.toFixed(1)}°` : '–°'}
                            </span>
                            {/* Target temp */}
                            <span
                                className="tabular-nums leading-none font-bold"
                                style={{
                                    fontSize: 'clamp(0.75rem, 13cqmin, 1.5rem)',
                                    color: isOn && !isUnavailable ? pal.primary : 'rgba(255,255,255,0.55)',
                                    textShadow: isOn && !isUnavailable ? `0 0 14px ${pal.glow}` : undefined,
                                    transition: 'color 0.3s ease, text-shadow 0.3s ease',
                                }}
                            >
                                {targetTemp !== null ? targetTemp.toFixed(1) : '–'}
                                <span style={{ fontSize: '0.45em', color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>
                                    °{unit.tempUnit}
                                </span>
                            </span>
                            {/* Delta demand */}
                            {deltaText && (
                                <span
                                    className="tabular-nums leading-none font-bold uppercase tracking-wider"
                                    style={{
                                        fontSize: 'clamp(0.38rem, 6cqmin, 0.58rem)',
                                        color: isDemanding
                                            ? (hvacMode === 'cool'
                                                ? (delta! > 0 ? '#fca5a5' : '#67e8f9')
                                                : (delta! < 0 ? '#fca5a5' : '#fb923c'))
                                            : 'rgba(255,255,255,0.22)',
                                        animation: isDemanding ? 'cm-breath 2s ease-in-out infinite' : undefined,
                                    }}
                                >
                                    {deltaText}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Instrument column: turbine + vane */}
                    <div className="flex flex-col items-center" style={{ gap: 'clamp(0.15rem, 2cqmin, 0.4rem)' }}>
                        {/* Fan turbine */}
                        <div className="flex flex-col items-center" style={{ gap: 'clamp(0.05rem, 1cqmin, 0.15rem)' }}>
                            <FanTurbine
                                fanMode={fanMode}
                                isOn={isOn}
                                isUnavailable={isUnavailable}
                                size={turbineSize}
                            />
                            {fanMode && (
                                <span style={{
                                    fontSize: 'clamp(0.38rem, 5.5cqmin, 0.55rem)',
                                    color: isOn && !isUnavailable ? pal.primary : 'rgba(255,255,255,0.2)',
                                    fontWeight: 700,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                    lineHeight: 1,
                                    transition: 'color 0.3s ease',
                                }}>
                                    {FAN_LABEL[fanMode.toLowerCase()] ?? fanMode}
                                </span>
                            )}
                        </div>

                        {/* Swing vane (only if supported) */}
                        {unit.supportsSwing && (
                            <div className="flex flex-col items-center" style={{ gap: 'clamp(0.05rem, 1cqmin, 0.12rem)' }}>
                                <SwingVane
                                    swingMode={swingMode}
                                    isOn={isOn}
                                    isUnavailable={isUnavailable}
                                    size={vaneSize}
                                />
                                {swingMode && (
                                    <span style={{
                                        fontSize: 'clamp(0.35rem, 5cqmin, 0.5rem)',
                                        color: 'rgba(255,255,255,0.3)',
                                        fontWeight: 700,
                                        letterSpacing: '0.04em',
                                        textTransform: 'uppercase',
                                        lineHeight: 1,
                                    }}>
                                        {swingMode.charAt(0).toUpperCase() + swingMode.slice(1)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Row 3: Temp step buttons (only when on) ── */}
                {isOn && targetTemp !== null && (
                    <div className="flex items-center justify-center shrink-0" style={{ gap: 'clamp(0.3rem, 3cqmin, 0.625rem)' }}>
                        <button
                            disabled={isEditor || isLocked || isUnavailable}
                            onClick={() => setTemp(-0.5)}
                            className="flex items-center justify-center rounded-full border transition-all duration-150 active:scale-90"
                            style={{
                                width: 'clamp(1.1rem, 13cqmin, 1.6rem)',
                                height: 'clamp(1.1rem, 13cqmin, 1.6rem)',
                                background: 'rgba(0,0,0,0.35)',
                                border: `1px solid rgba(255,255,255,0.12)`,
                                color: 'rgba(255,255,255,0.55)',
                                cursor: (isEditor || isLocked || isUnavailable) ? 'not-allowed' : 'pointer',
                                opacity: (isEditor || isLocked || isUnavailable) ? 0.35 : 1,
                            }}
                        >
                            <IconMinus style={{ width: 'clamp(0.45rem, 6cqmin, 0.75rem)', height: 'clamp(0.45rem, 6cqmin, 0.75rem)' }} />
                        </button>

                        <span style={{
                            fontSize: 'clamp(0.45rem, 7cqmin, 0.65rem)',
                            color: 'rgba(255,255,255,0.3)',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                        }}>
                            Setpoint
                        </span>

                        <button
                            disabled={isEditor || isLocked || isUnavailable}
                            onClick={() => setTemp(0.5)}
                            className="flex items-center justify-center rounded-full border transition-all duration-150 active:scale-90"
                            style={{
                                width: 'clamp(1.1rem, 13cqmin, 1.6rem)',
                                height: 'clamp(1.1rem, 13cqmin, 1.6rem)',
                                background: 'rgba(0,0,0,0.35)',
                                border: `1px solid rgba(255,255,255,0.12)`,
                                color: 'rgba(255,255,255,0.55)',
                                cursor: (isEditor || isLocked || isUnavailable) ? 'not-allowed' : 'pointer',
                                opacity: (isEditor || isLocked || isUnavailable) ? 0.35 : 1,
                            }}
                        >
                            <IconPlus style={{ width: 'clamp(0.45rem, 6cqmin, 0.75rem)', height: 'clamp(0.45rem, 6cqmin, 0.75rem)' }} />
                        </button>
                    </div>
                )}

                {/* ── Row 4: HVAC mode selector ── */}
                <div className="shrink-0">
                    <ModePills
                        options={unit.hvacModes}
                        value={hvacMode}
                        onSelect={setHvacMode}
                        disabled={isEditor || isLocked || isUnavailable}
                        renderLabel={v => HVAC_LABEL[v] ?? v}
                        renderIcon={v => (
                            <HvacModeIcon
                                mode={v}
                                style={{ width: 'clamp(0.4rem, 7cqmin, 0.65rem)', height: 'clamp(0.4rem, 7cqmin, 0.65rem)', marginRight: '0.15em' }}
                            />
                        )}
                        accentColor={pal.primary}
                    />
                </div>

                {/* ── Row 5: Fan mode selector ── */}
                {unit.fanModes.length > 0 && (
                    <div className="shrink-0">
                        <div style={{
                            fontSize: 'clamp(0.38rem, 5.5cqmin, 0.55rem)',
                            color: 'rgba(255,255,255,0.22)',
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            textAlign: 'center',
                            marginBottom: 'clamp(0.1rem, 1cqmin, 0.2rem)',
                        }}>
                            Fan Speed
                        </div>
                        <ModePills
                            options={unit.fanModes}
                            value={fanMode}
                            onSelect={setFanMode}
                            disabled={isEditor || isLocked || !isOn || isUnavailable}
                            renderLabel={v => FAN_LABEL[v.toLowerCase()] ?? v}
                            accentColor={pal.primary}
                        />
                    </div>
                )}

                {/* ── Row 6: Swing mode (large only) ── */}
                {unit.supportsSwing && unit.swingModes.length > 0 && isTall && (
                    <div className="shrink-0">
                        <div style={{
                            fontSize: 'clamp(0.38rem, 5.5cqmin, 0.55rem)',
                            color: 'rgba(255,255,255,0.22)',
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            textAlign: 'center',
                            marginBottom: 'clamp(0.1rem, 1cqmin, 0.2rem)',
                        }}>
                            Swing
                        </div>
                        <ModePills
                            options={unit.swingModes}
                            value={swingMode}
                            onSelect={setSwingMode}
                            disabled={isEditor || isLocked || !isOn || isUnavailable}
                            renderLabel={v => v.charAt(0).toUpperCase() + v.slice(1)}
                            accentColor={pal.primary}
                        />
                    </div>
                )}

                {/* ── Row 7: Footer — unit id + filter reset ── */}
                <div
                    className="flex items-center justify-between shrink-0"
                    style={{ marginTop: 'auto', paddingTop: 'clamp(0.1rem, 1cqmin, 0.2rem)' }}
                >
                    <span style={{
                        fontSize: 'clamp(0.38rem, 5.5cqmin, 0.55rem)',
                        color: 'rgba(255,255,255,0.18)',
                        fontFamily: 'ui-monospace, monospace',
                        letterSpacing: '0.04em',
                    }}>
                        {unit.rawUnitId}
                    </span>

                    {unit.filterDirty && unit.resetFilterEntityId && (
                        <button
                            disabled={isEditor || isLocked || isUnavailable}
                            onClick={resetFilter}
                            title="Reset filter timer"
                            className="flex items-center rounded-control transition-all duration-150 active:scale-95"
                            style={{
                                gap: 'clamp(0.15rem, 1.5cqmin, 0.3rem)',
                                padding: 'clamp(0.08rem, 1cqmin, 0.2rem) clamp(0.2rem, 2cqmin, 0.4rem)',
                                background: 'rgba(234,179,8,0.12)',
                                border: '1px solid rgba(234,179,8,0.4)',
                                color: '#fde68a',
                                fontSize: 'clamp(0.38rem, 5.5cqmin, 0.55rem)',
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                cursor: (isEditor || isLocked || isUnavailable) ? 'not-allowed' : 'pointer',
                                opacity: (isEditor || isLocked || isUnavailable) ? 0.38 : 1,
                                animation: 'cm-badge-pulse 2s ease-in-out infinite',
                            }}
                        >
                            <IconRotateCcw style={{
                                width: 'clamp(0.45rem, 6cqmin, 0.6rem)',
                                height: 'clamp(0.45rem, 6cqmin, 0.6rem)',
                            }} />
                            Reset
                        </button>
                    )}
                </div>
            </div>
        </TileWrapper>
    );
};

export default CoolMasterTile;
