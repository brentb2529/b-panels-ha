/**
 * Ae200Tile — Mitsubishi City Multi AE-200E Direct
 *
 * Design direction: industrial-precision instrument panel.
 * Each group card reads like a climate module on a rack controller — cool
 * graphite surface with a precision temperature readout, animated mode-colored
 * state ring, vane direction indicator, fan-speed gauge, and pulsing fault
 * badges. Clearly distinct from CoolMaster's gateway-abstracted look.
 *
 * Entity contract (ae200 custom component):
 *   climate.ae200_*            — hvac_mode / fan_mode / swing_mode / temps
 *   sensor.*_inlet_temperature — return-air inlet temp
 *   sensor.*_outdoor_temp      — outdoor unit temp (per controller)
 *   binary_sensor.*_filter     — filter problem class
 *   binary_sensor.*_error      — error problem class
 *
 * Commands via updateDeviceState(entityId, payload):
 *   { mode }        → climate.set_hvac_mode
 *   { setpoint }    → climate.set_temperature
 *   { fanMode }     → climate.set_fan_mode
 *   { swingMode }   → climate.set_swing_mode
 */

import React, { useState, useCallback } from 'react';
import { Device, TileConfig, Ae200State, Ae200Group, Ae200HvacMode, Ae200FanMode } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import {
    IconThermometer,
    IconSnowflake,
    IconFlame,
    IconPower,
    IconDroplets,
    IconAlertTriangle,
    IconActivity,
} from '../icons';
import { fluidTextSm } from './tileScale';

// ─── Lucide icons not yet exported from icons.tsx ────────────────────────────
// We re-import directly here rather than adding them globally.
import { Wind, Minus, Plus } from 'lucide-react';
const IconWind2 = (p: React.ComponentProps<typeof Wind>) => <Wind {...p} />;
const IconMinus = (p: React.ComponentProps<typeof Minus>) => <Minus {...p} />;
const IconPlus2 = (p: React.ComponentProps<typeof Plus>) => <Plus {...p} />;

// ─── Design constants ─────────────────────────────────────────────────────────

const MODE_CONFIG: Record<Ae200HvacMode, {
    label: string;
    accent: string;          // hex for glow / SVG fill
    accentRgb: string;       // rgb triplet for CSS mix
    bg: string;              // tailwind / inline bg for card body
    Icon: React.FC<React.SVGProps<SVGSVGElement>>;
}> = {
    cool: {
        label: 'COOL',
        accent: '#38bdf8',
        accentRgb: '56 189 248',
        bg: 'rgba(8,42,68,0.72)',
        Icon: (p) => <IconSnowflake {...(p as any)} />,
    },
    heat: {
        label: 'HEAT',
        accent: '#fb923c',
        accentRgb: '251 146 60',
        bg: 'rgba(68,26,8,0.72)',
        Icon: (p) => <IconFlame {...(p as any)} />,
    },
    dry: {
        label: 'DRY',
        accent: '#a78bfa',
        accentRgb: '167 139 250',
        bg: 'rgba(46,20,72,0.72)',
        Icon: (p) => <IconDroplets {...(p as any)} />,
    },
    fan_only: {
        label: 'FAN',
        accent: '#6ee7b7',
        accentRgb: '110 231 183',
        bg: 'rgba(12,50,40,0.72)',
        Icon: (p) => <IconWind2 {...(p as any)} />,
    },
    auto: {
        label: 'AUTO',
        accent: '#22d3ee',
        accentRgb: '34 211 238',
        bg: 'rgba(8,50,60,0.72)',
        Icon: (p) => <IconActivity {...(p as any)} />,
    },
    off: {
        label: 'OFF',
        accent: '#6b7280',
        accentRgb: '107 114 128',
        bg: 'rgba(20,20,28,0.72)',
        Icon: (p) => <IconPower {...(p as any)} />,
    },
};

const FAN_LEVELS: Ae200FanMode[] = ['AUTO', 'LOW', 'MID2', 'MID1', 'HIGH'];
const FAN_BAR_COUNT = 5;
const fanIndex = (f: Ae200FanMode) => {
    if (f === 'AUTO') return 2;       // middle dot for auto
    const idx = { LOW: 0, MID2: 1, MID1: 2, HIGH: 3 }[f as string];
    return idx !== undefined ? idx + 1 : 0;
};
// How many bars to fill (0–5) for visual meter
const fanBarsFilled = (f: Ae200FanMode): number => {
    const m: Record<Ae200FanMode, number> = { AUTO: 3, LOW: 1, MID2: 2, MID1: 3, HIGH: 5 };
    return m[f] ?? 3;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated mode ring around the main icon */
const ModeRing: React.FC<{ mode: Ae200HvacMode; isActive: boolean; size: number }> = ({ mode, isActive, size }) => {
    const cfg = MODE_CONFIG[mode] || MODE_CONFIG.off;
    const r = (size / 2) - 3;
    const circ = 2 * Math.PI * r;
    // When active, fill ~75% of the circle (partial arc); when idle 20%
    const fill = isActive ? circ * 0.75 : circ * 0.2;
    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
            {/* Track */}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={2.5}
            />
            {/* Active arc */}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={cfg.accent}
                strokeWidth={isActive ? 3 : 2}
                strokeDasharray={`${fill} ${circ - fill}`}
                strokeDashoffset={circ * 0.25}
                strokeLinecap="round"
                style={{
                    filter: isActive ? `drop-shadow(0 0 4px ${cfg.accent})` : 'none',
                    transition: 'stroke-dasharray 1.2s ease, stroke 0.4s ease',
                }}
            >
                {isActive && (
                    <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from={`0 ${size / 2} ${size / 2}`}
                        to={`360 ${size / 2} ${size / 2}`}
                        dur="8s"
                        repeatCount="indefinite"
                    />
                )}
            </circle>
        </svg>
    );
};

/** Fan speed bar meter */
const FanMeter: React.FC<{ fanMode: Ae200FanMode; accent: string; isActive: boolean }> = ({ fanMode, accent, isActive }) => {
    const filled = fanBarsFilled(fanMode);
    return (
        <div className="flex items-end gap-[2px]">
            {Array.from({ length: FAN_BAR_COUNT }, (_, i) => (
                <div
                    key={i}
                    style={{
                        width: '3px',
                        height: `${6 + i * 3}px`,
                        borderRadius: '1.5px',
                        background: i < filled
                            ? (isActive ? accent : `${accent}99`)
                            : 'rgba(255,255,255,0.12)',
                        boxShadow: i < filled && isActive ? `0 0 4px ${accent}` : 'none',
                        transition: 'background 0.4s ease',
                    }}
                />
            ))}
        </div>
    );
};

/** Vane/swing direction visualizer */
const VaneIndicator: React.FC<{ swingMode: string | null; accent: string; isActive: boolean }> = ({ swingMode, accent, isActive }) => {
    // Map swing modes to a visual vane angle (degrees from horizontal)
    const angleMap: Record<string, number> = {
        auto: 45, horizontal: 0, vertical: 90,
        '1': 15, '2': 30, '3': 45, '4': 60, '5': 75,
    };
    const angle = swingMode ? (angleMap[swingMode.toLowerCase()] ?? 45) : 45;
    const isAuto = swingMode === 'auto';

    return (
        <div className="flex flex-col items-center gap-[1.5px]" title={`Vane: ${swingMode ?? 'auto'}`}>
            {[0, 1, 2].map(i => (
                <div
                    key={i}
                    style={{
                        width: '18px',
                        height: '3px',
                        borderRadius: '1.5px',
                        background: isActive ? accent : `${accent}66`,
                        transform: `rotate(${angle - (i * 5)}deg)`,
                        boxShadow: isActive ? `0 0 3px ${accent}` : 'none',
                        transition: 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1), background 0.4s',
                        opacity: isActive ? 1 - i * 0.2 : 0.5 - i * 0.1,
                    }}
                >
                    {isAuto && isActive && (
                        /* subtle animation cue for auto sweep */
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: '1.5px',
                                animation: `ae200-vane-pulse 3s ${i * 0.4}s ease-in-out infinite`,
                            }}
                        />
                    )}
                </div>
            ))}
        </div>
    );
};

/** Temp delta arc: shows how far current is from setpoint */
const TempDeltaArc: React.FC<{
    current: number | null;
    setpoint: number | null;
    mode: Ae200HvacMode;
    accent: string;
    size: number;
}> = ({ current, setpoint, mode, accent, size }) => {
    if (current === null || setpoint === null) return null;
    const delta = current - setpoint;
    const maxDelta = 5;
    const clampedRatio = Math.min(Math.abs(delta) / maxDelta, 1);
    const r = size / 2 - 2;
    const circ = 2 * Math.PI * r;
    const arcLen = circ * 0.5 * clampedRatio;
    // Direction: heat wants current below setpoint (fill from bottom going up on left)
    // Cool wants current above setpoint (fill on right side)
    const offset = circ * 0.25;
    const isWarm = delta > 0;
    const color = isWarm ? '#fb923c' : '#38bdf8';
    if (clampedRatio < 0.05) return null;
    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{ position: 'absolute', top: 0, left: 0 }}
        >
            <circle
                cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray={`${arcLen} ${circ - arcLen}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                opacity={0.7}
                style={{ transition: 'stroke-dasharray 1s ease' }}
            />
        </svg>
    );
};

/** Fault badge with pulse animation */
const FaultBadge: React.FC<{ label: string; type: 'filter' | 'error' }> = ({ label, type }) => {
    const isError = type === 'error';
    return (
        <div
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 border"
            style={{
                background: isError ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                borderColor: isError ? 'rgba(239,68,68,0.5)' : 'rgba(234,179,8,0.5)',
                animation: 'ae200-fault-pulse 2s ease-in-out infinite',
            }}
        >
            <IconAlertTriangle
                style={{ width: '9px', height: '9px', color: isError ? '#ef4444' : '#eab308' }}
            />
            <span
                style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}
                className={isError ? 'text-red-400' : 'text-yellow-400'}
            >
                {label}
            </span>
        </div>
    );
};

/** Single group card — the primary building block */
const GroupCard: React.FC<{
    group: Ae200Group;
    isCompact: boolean;
    onModeToggle: (g: Ae200Group) => void;
    onSetpointDelta: (g: Ae200Group, delta: number) => void;
    onFanCycle: (g: Ae200Group) => void;
    isEditor: boolean;
}> = ({ group, isCompact, onModeToggle, onSetpointDelta, onFanCycle, isEditor }) => {
    const cfg = MODE_CONFIG[group.mode] || MODE_CONFIG.off;
    const ringSize = isCompact ? 48 : 64;
    const iconSize = isCompact ? 14 : 20;

    const hasFault = group.filterDirty || group.hasError;
    const tempDelta = group.currentTemp !== null && group.setpoint !== null
        ? group.currentTemp - group.setpoint
        : null;

    return (
        <div
            className="relative flex flex-col rounded-control overflow-hidden select-none"
            style={{
                background: group.isOnline ? cfg.bg : 'rgba(20,20,28,0.72)',
                border: `1px solid ${group.isOnline ? `${cfg.accent}30` : 'rgba(255,255,255,0.06)'}`,
                boxShadow: group.isActive
                    ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px -6px ${cfg.accent}50`
                    : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                flex: 1,
                minWidth: 0,
                padding: isCompact ? '8px 8px 6px' : '10px 10px 8px',
                opacity: group.isOnline ? 1 : 0.55,
                transition: 'box-shadow 0.6s ease, background 0.6s ease',
            }}
        >
            {/* Animated top glow strip when active */}
            {group.isActive && group.isOnline && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '2px',
                        background: `linear-gradient(90deg, transparent, ${cfg.accent}, transparent)`,
                        animation: 'ae200-shimmer 2.4s ease-in-out infinite',
                    }}
                />
            )}

            {/* Header row: mode ring + name + fan meter */}
            <div className="flex items-center justify-between" style={{ gap: isCompact ? '6px' : '8px' }}>
                {/* Mode ring + icon */}
                <div className="relative shrink-0" style={{ width: ringSize, height: ringSize }}>
                    <ModeRing mode={group.mode} isActive={group.isActive && group.isOnline} size={ringSize} />
                    <TempDeltaArc
                        current={group.currentTemp}
                        setpoint={group.setpoint}
                        mode={group.mode}
                        accent={cfg.accent}
                        size={ringSize}
                    />
                    <button
                        onClick={() => !isEditor && onModeToggle(group)}
                        className="absolute inset-0 flex items-center justify-center rounded-full transition-opacity hover:opacity-80 active:scale-95"
                        disabled={isEditor}
                        title={`Mode: ${cfg.label}`}
                    >
                        <cfg.Icon
                            style={{
                                width: iconSize,
                                height: iconSize,
                                color: group.isOnline ? cfg.accent : '#6b7280',
                                filter: group.isActive && group.isOnline ? `drop-shadow(0 0 5px ${cfg.accent})` : 'none',
                                transition: 'filter 0.4s ease',
                            }}
                        />
                    </button>
                </div>

                {/* Name + mode label */}
                <div className="flex-1 flex flex-col min-w-0">
                    <span
                        className="text-white font-semibold truncate leading-tight"
                        style={{ fontSize: isCompact ? '10px' : '11px' }}
                    >
                        {group.name}
                    </span>
                    <span
                        className="font-bold tracking-widest"
                        style={{
                            fontSize: '8px',
                            color: group.isOnline ? cfg.accent : '#6b7280',
                            textShadow: group.isActive && group.isOnline ? `0 0 6px ${cfg.accent}` : 'none',
                        }}
                    >
                        {cfg.label}
                    </span>
                    {/* Fan meter */}
                    <div className="flex items-center gap-1 mt-0.5">
                        <FanMeter fanMode={group.fanMode} accent={cfg.accent} isActive={group.isActive && group.isOnline} />
                        <button
                            onClick={() => !isEditor && onFanCycle(group)}
                            disabled={isEditor || !group.isOnline}
                            className="hover:opacity-70 transition-opacity active:scale-95"
                            title={`Fan: ${group.fanMode}`}
                        >
                            <IconWind2
                                style={{ width: 9, height: 9, color: group.isOnline ? `${cfg.accent}cc` : '#4b5563' }}
                            />
                        </button>
                    </div>
                </div>

                {/* Right column: temp display */}
                <div className="flex flex-col items-end shrink-0">
                    {/* Current temp */}
                    <div className="flex items-baseline gap-0.5">
                        <span
                            className="font-bold tabular-nums text-white"
                            style={{
                                fontSize: isCompact ? '18px' : '22px',
                                textShadow: group.isActive && group.isOnline ? `0 0 12px ${cfg.accent}80` : 'none',
                                transition: 'text-shadow 0.4s ease',
                                fontVariantNumeric: 'tabular-nums',
                                letterSpacing: '-0.02em',
                            }}
                        >
                            {group.currentTemp !== null ? group.currentTemp.toFixed(1) : '--'}
                        </span>
                        <span className="text-gray-400 font-normal" style={{ fontSize: '9px' }}>
                            {group.tempUnit}
                        </span>
                    </div>

                    {/* Setpoint with ± controls */}
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={() => !isEditor && onSetpointDelta(group, -0.5)}
                            disabled={isEditor || !group.isOnline}
                            className="rounded hover:bg-white/10 active:scale-90 transition-all disabled:opacity-30"
                            style={{ padding: '1px', lineHeight: 1 }}
                        >
                            <IconMinus style={{ width: 8, height: 8, color: '#9ca3af' }} />
                        </button>
                        <span
                            className="tabular-nums"
                            style={{
                                fontSize: isCompact ? '10px' : '11px',
                                color: group.isOnline ? cfg.accent : '#6b7280',
                                fontWeight: 600,
                                minWidth: '28px',
                                textAlign: 'center',
                            }}
                        >
                            {group.setpoint !== null ? `${group.setpoint.toFixed(1)}°` : '--°'}
                        </span>
                        <button
                            onClick={() => !isEditor && onSetpointDelta(group, 0.5)}
                            disabled={isEditor || !group.isOnline}
                            className="rounded hover:bg-white/10 active:scale-90 transition-all disabled:opacity-30"
                            style={{ padding: '1px', lineHeight: 1 }}
                        >
                            <IconPlus2 style={{ width: 8, height: 8, color: '#9ca3af' }} />
                        </button>
                    </div>

                    {/* Delta indicator */}
                    {tempDelta !== null && group.isOnline && (
                        <span
                            style={{
                                fontSize: '8px',
                                color: tempDelta > 0.4 ? '#fb923c' : tempDelta < -0.4 ? '#38bdf8' : '#6b7280',
                                fontWeight: 700,
                                letterSpacing: '-0.01em',
                            }}
                        >
                            {tempDelta > 0 ? '+' : ''}{tempDelta.toFixed(1)}
                        </span>
                    )}
                </div>
            </div>

            {/* Footer row: inlet temp + vane + faults */}
            {!isCompact && (
                <div className="flex items-center justify-between mt-1.5" style={{ gap: '6px' }}>
                    {/* Inlet temp */}
                    <div className="flex items-center gap-1">
                        <IconThermometer style={{ width: 9, height: 9, color: '#6b7280' }} />
                        <span style={{ fontSize: '8px', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                            {group.inletTemp !== null ? `${group.inletTemp.toFixed(1)}${group.tempUnit} in` : '-- in'}
                        </span>
                    </div>

                    {/* Vane direction */}
                    {group.swingMode && (
                        <VaneIndicator
                            swingMode={group.swingMode}
                            accent={cfg.accent}
                            isActive={group.isActive && group.isOnline}
                        />
                    )}

                    {/* Fault badges */}
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                        {group.filterDirty && <FaultBadge label="Filter" type="filter" />}
                        {group.hasError && <FaultBadge label="Error" type="error" />}
                    </div>
                </div>
            )}
            {/* Compact fault dots */}
            {isCompact && hasFault && (
                <div className="flex gap-0.5 mt-0.5 justify-end">
                    {group.filterDirty && (
                        <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" style={{ animation: 'ae200-fault-pulse 2s ease-in-out infinite' }} />
                    )}
                    {group.hasError && (
                        <div className="w-1.5 h-1.5 rounded-full bg-red-400" style={{ animation: 'ae200-fault-pulse 2s 0.3s ease-in-out infinite' }} />
                    )}
                </div>
            )}
        </div>
    );
};

// ─── Keyframe styles (injected once) ─────────────────────────────────────────
const AE200_STYLES = `
@keyframes ae200-shimmer {
    0%, 100% { opacity: 0.4; transform: scaleX(0.3); }
    50%       { opacity: 1;   transform: scaleX(1); }
}
@keyframes ae200-fault-pulse {
    0%, 100% { opacity: 0.7; }
    50%       { opacity: 1; }
}
@keyframes ae200-spin-slow {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
}
`;
let stylesInjected = false;
const injectStyles = () => {
    if (stylesInjected) return;
    const el = document.createElement('style');
    el.textContent = AE200_STYLES;
    document.head.appendChild(el);
    stylesInjected = true;
};

// ─── Main tile ────────────────────────────────────────────────────────────────

const HVAC_MODE_CYCLE: Ae200HvacMode[] = ['off', 'cool', 'heat', 'dry', 'fan_only', 'auto'];
const FAN_CYCLE: Ae200FanMode[] = ['AUTO', 'LOW', 'MID2', 'MID1', 'HIGH'];

const Ae200Tile: React.FC<{
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string;
}> = ({ device, tile, isEditor = false, cornerClassName }) => {
    injectStyles();
    const { updateDeviceState } = useDashboardActions();
    const state = device.state as Ae200State | null;
    const isLocked = !!tile.isLocked;

    // Track optimistic state updates — entity_id → pending value
    const [optimistic, setOptimistic] = useState<Record<string, Partial<Ae200Group>>>({});
    const [staleIds, setStaleIds] = useState<Set<string>>(new Set());

    const mergeOptimistic = useCallback((entityId: string, patch: Partial<Ae200Group>) => {
        setOptimistic(prev => ({ ...prev, [entityId]: { ...prev[entityId], ...patch } }));
        // Mark stale after 8s if HA hasn't reconciled
        const timer = setTimeout(() => {
            setStaleIds(prev => new Set([...prev, entityId]));
        }, 8000);
        // Clear stale after 15s
        setTimeout(() => {
            setStaleIds(prev => { const n = new Set(prev); n.delete(entityId); return n; });
            setOptimistic(prev => { const n = { ...prev }; delete n[entityId]; return n; });
        }, 15000);
        return () => clearTimeout(timer);
    }, []);

    // Apply optimistic overlay to a group
    const resolveGroup = useCallback((g: Ae200Group): Ae200Group => {
        const opt = optimistic[g.entityId];
        if (!opt) return g;
        return { ...g, ...opt };
    }, [optimistic]);

    const handleModeToggle = useCallback((group: Ae200Group) => {
        if (isEditor || isLocked || !group.isOnline) return;
        const idx = HVAC_MODE_CYCLE.indexOf(group.mode);
        const next = HVAC_MODE_CYCLE[(idx + 1) % HVAC_MODE_CYCLE.length];
        mergeOptimistic(group.entityId, { mode: next, isOn: next !== 'off' });
        updateDeviceState(group.entityId, { mode: next });
    }, [isEditor, isLocked, mergeOptimistic, updateDeviceState]);

    const handleSetpointDelta = useCallback((group: Ae200Group, delta: number) => {
        if (isEditor || isLocked || !group.isOnline) return;
        const base = group.setpoint ?? 22;
        const min = group.minTemp ?? 16;
        const max = group.maxTemp ?? 30;
        const next = Math.max(min, Math.min(max, parseFloat((base + delta).toFixed(1))));
        mergeOptimistic(group.entityId, { setpoint: next });
        updateDeviceState(group.entityId, { setpoint: next });
    }, [isEditor, isLocked, mergeOptimistic, updateDeviceState]);

    const handleFanCycle = useCallback((group: Ae200Group) => {
        if (isEditor || isLocked || !group.isOnline) return;
        const idx = FAN_CYCLE.indexOf(group.fanMode);
        const next = FAN_CYCLE[(idx + 1) % FAN_CYCLE.length];
        mergeOptimistic(group.entityId, { fanMode: next });
        updateDeviceState(group.entityId, { fanMode: next });
    }, [isEditor, isLocked, mergeOptimistic, updateDeviceState]);

    // Loading/empty state
    if (!state || !state.controllers || state.controllers.length === 0) {
        return (
            <TileWrapper
                label={tile.label || device.name}
                isLocked={isLocked}
                isEditor={isEditor}
                className={`border border-cyan-500/10 ${cornerClassName || ''}`}
            >
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
                    <IconThermometer style={{ width: 28, height: 28, opacity: 0.3 }} />
                    <span style={{ fontSize: '10px', opacity: 0.5 }}>No AE-200E controllers</span>
                </div>
            </TileWrapper>
        );
    }

    const tileW = tile.width || 1;
    const tileH = tile.height || 1;
    const isLarge = tileW >= 2;
    const isTall  = tileH >= 2;

    // Aggregate controller metrics for the header
    const allGroups = state.controllers.flatMap(c => c.groups).map(resolveGroup);
    const anyActive  = allGroups.some(g => g.isActive && g.isOnline);
    const anyOnline  = allGroups.some(g => g.isOnline);
    const anyFault   = allGroups.some(g => g.filterDirty || g.hasError);
    const primaryMode: Ae200HvacMode = allGroups.find(g => g.isOn)?.mode ?? 'off';
    const primaryCfg = MODE_CONFIG[primaryMode] || MODE_CONFIG.off;
    const outdoorTemp = state.controllers[0]?.outdoorTemp;
    const isStale = staleIds.size > 0;

    // TileWrapper accent
    const wrapperAccent = primaryMode === 'heat' ? 'warn' as const
        : primaryMode === 'cool' || primaryMode === 'fan_only' || primaryMode === 'dry' ? 'water' as const
        : 'brand' as const;

    return (
        <TileWrapper
            label=""
            isActive={anyActive}
            accent={wrapperAccent}
            isUnavailable={!anyOnline}
            isLocked={isLocked}
            isEditor={isEditor}
            className={`!p-0 !block overflow-hidden ${cornerClassName || ''}`}
        >
            {/* Injected keyframes */}
            <style>{AE200_STYLES}</style>

            {/* Main layout */}
            <div
                className="flex flex-col h-full relative"
                style={{
                    background: `linear-gradient(160deg, ${primaryCfg.bg}, rgba(12,14,20,0.95))`,
                    transition: 'background 0.8s ease',
                }}
            >
                {/* Ambient glow layer */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: anyActive
                            ? `radial-gradient(ellipse 70% 50% at 50% 0%, ${primaryCfg.accent}12, transparent 70%)`
                            : 'none',
                        transition: 'background 1s ease',
                    }}
                />

                {/* Header bar */}
                <div
                    className="relative z-10 flex items-center justify-between px-3 py-2 shrink-0"
                    style={{
                        borderBottom: `1px solid ${anyActive ? `${primaryCfg.accent}20` : 'rgba(255,255,255,0.05)'}`,
                    }}
                >
                    <div className="flex items-center gap-2">
                        {/* Controller ident chip */}
                        <div
                            className="flex items-center gap-1 rounded px-2 py-0.5"
                            style={{
                                background: `${primaryCfg.accent}18`,
                                border: `1px solid ${primaryCfg.accent}30`,
                            }}
                        >
                            {/* AE-200E badge — clean monospace label */}
                            <span
                                style={{
                                    fontSize: '9px',
                                    fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
                                    fontWeight: 700,
                                    color: primaryCfg.accent,
                                    letterSpacing: '0.08em',
                                    textShadow: anyActive ? `0 0 8px ${primaryCfg.accent}` : 'none',
                                }}
                            >
                                AE-200E
                            </span>
                        </div>

                        <h2
                            className="font-semibold text-white truncate"
                            style={fluidTextSm}
                        >
                            {tile.label || device.name}
                        </h2>
                    </div>

                    {/* Right: outdoor temp chip + fault/stale badges */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {isStale && (
                            <div
                                className="rounded-full px-1.5 py-0.5 border"
                                style={{
                                    fontSize: '7px',
                                    fontWeight: 700,
                                    letterSpacing: '0.05em',
                                    color: '#f59e0b',
                                    borderColor: 'rgba(245,158,11,0.4)',
                                    background: 'rgba(245,158,11,0.1)',
                                    textTransform: 'uppercase',
                                }}
                            >
                                PENDING
                            </div>
                        )}
                        {anyFault && (
                            <div
                                className="rounded-full px-1.5 py-0.5 border"
                                style={{
                                    fontSize: '7px',
                                    fontWeight: 700,
                                    letterSpacing: '0.05em',
                                    color: '#ef4444',
                                    borderColor: 'rgba(239,68,68,0.4)',
                                    background: 'rgba(239,68,68,0.08)',
                                    textTransform: 'uppercase',
                                    animation: 'ae200-fault-pulse 2s ease-in-out infinite',
                                }}
                            >
                                FAULT
                            </div>
                        )}
                        {outdoorTemp !== null && (
                            <div
                                className="flex items-center gap-0.5 rounded-full px-2 py-0.5"
                                style={{
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                }}
                            >
                                <IconThermometer style={{ width: 9, height: 9, color: '#94a3b8' }} />
                                <span style={{ fontSize: '9px', color: '#cbd5e1', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                    {outdoorTemp.toFixed(1)}°
                                </span>
                                <span style={{ fontSize: '7px', color: '#64748b' }}>OUT</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Groups grid */}
                <div
                    className="relative z-10 flex-1 overflow-auto"
                    style={{
                        padding: isLarge ? '10px' : '6px',
                        display: 'flex',
                        flexDirection: isLarge && isTall ? 'row' : 'column',
                        flexWrap: isLarge ? 'wrap' : 'nowrap',
                        gap: isLarge ? '8px' : '5px',
                        alignContent: 'flex-start',
                        alignItems: 'stretch',
                    }}
                >
                    {state.controllers.flatMap(controller =>
                        controller.groups.map(rawGroup => {
                            const group = resolveGroup(rawGroup);
                            return (
                                <GroupCard
                                    key={group.entityId}
                                    group={group}
                                    isCompact={!isLarge || !isTall}
                                    onModeToggle={handleModeToggle}
                                    onSetpointDelta={handleSetpointDelta}
                                    onFanCycle={handleFanCycle}
                                    isEditor={isEditor || isLocked}
                                />
                            );
                        })
                    )}
                </div>

                {/* Footer: active count summary */}
                <div
                    className="relative z-10 flex items-center justify-between px-3 py-1.5 shrink-0"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                >
                    <span style={{ fontSize: '8px', color: '#64748b', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {allGroups.filter(g => g.isOn).length}/{allGroups.length} active
                    </span>
                    {/* Mode color legend dot */}
                    <div className="flex items-center gap-1">
                        {anyActive && (
                            <div
                                className="w-1.5 h-1.5 rounded-full"
                                style={{
                                    background: primaryCfg.accent,
                                    boxShadow: `0 0 4px ${primaryCfg.accent}`,
                                    animation: 'ae200-fault-pulse 2s ease-in-out infinite',
                                }}
                            />
                        )}
                        <span style={{ fontSize: '8px', color: primaryCfg.accent, fontWeight: 700, letterSpacing: '0.08em' }}>
                            {primaryCfg.label}
                        </span>
                    </div>
                </div>
            </div>
        </TileWrapper>
    );
};

export default Ae200Tile;
