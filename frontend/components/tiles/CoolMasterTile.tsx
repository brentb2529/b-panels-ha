/**
 * CoolMasterTile — Liquid Glass VRF instrument card
 *
 * Design: Liquid Glass material language (matching AirControlSurface / RoomClimateTile).
 * Per-unit glass instrument cards; AnimatedFan (spin reflects fan_mode incl. TOP) +
 * LivingModeIcon (heat/cool/dry/auto) + BuildBar (temp-toward-setpoint) + glass-bead
 * stepper controls + mode-tinted glow + pulsing fault badge.
 *
 * Theme-aware: all colors are CSS tokens (--glass-l*, --accent-*, --text) so the tile
 * adapts to dark / light / ambient-night automatically — no hardcoded hex palette.
 *
 * Data/control contract: unchanged — haClient (subscribeEntities / callService).
 * Optimistic + stale detection; STALE_MS without reconcile → "Sync…" badge.
 */

import React, {
    useCallback, useEffect, useRef, useState,
} from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { CoolMasterUnitState } from '../../hooks/useCoolMasterSurface';
import * as haClient from '../../services/haClient';
import TileWrapper, { TileAccent } from './TileWrapper';
import {
    IconThermometer, IconSnowflake, IconFlame, IconPower,
    IconAlertTriangle, IconRotateCcw, IconActivity,
    IconPlus, IconMinus, IconDroplets,
} from '../icons';
import {
    AnimatedFan,
    BuildBar,
    LivingModeIcon,
    GlassPanel,
    GlassButton,
    glassMaterial,
    glassMaterialActive,
} from '../../design-system';
import {
    fluidTextXs, fluidTextSm,
    fluidIcon,
} from './tileScale';

// ─── Constants ──────────────────────────────────────────────────────────────

const STALE_MS = 5_000;

const HVAC_LABEL: Record<string, string> = {
    off: 'Off', cool: 'Cool', heat: 'Heat', auto: 'Auto',
    fan_only: 'Fan', dry: 'Dry', heat_cool: 'Auto',
};

const FAN_LABEL: Record<string, string> = {
    vlow: 'VLow', low: 'Low', med: 'Med', high: 'High', top: 'Top', auto: 'Auto',
};

// Fan mode → 0..1 rpmLevel for AnimatedFan — TOP maps to full blast
const FAN_LEVEL: Record<string, number> = {
    vlow: 0.18, low: 0.32, med: 0.55, high: 0.80, top: 1.0, auto: 0.60,
};

// ─── Accent resolution (CSS vars, not hex) ─────────────────────────────────

function accentVarFor(mode: string): string {
    switch (mode) {
        case 'heat':     return 'var(--accent-warn)';
        case 'cool':     return 'var(--accent-water)';
        case 'dry':      return 'var(--accent-light)';
        case 'fan_only': return 'var(--accent)';
        case 'auto':
        case 'heat_cool': return 'var(--accent-plug)';
        default:         return 'var(--glass-l3-bg)';
    }
}

const hvacModeAccent = (mode: string): TileAccent =>
    mode === 'heat' ? 'warn' : mode === 'cool' ? 'water' : 'brand';

// ─── Mode icon ──────────────────────────────────────────────────────────────

const ModeIcon = ({ mode, style }: { mode: string; style?: React.CSSProperties }) => {
    switch (mode) {
        case 'cool':     return <IconSnowflake style={style} />;
        case 'heat':     return <IconFlame     style={style} />;
        case 'dry':      return <IconDroplets  style={style} />;
        case 'fan_only': return <IconActivity  style={style} />;
        case 'off':      return <IconPower     style={style} />;
        default:         return <IconThermometer style={style} />;
    }
};

// ─── Fault badge (glass pill + pulsing dot) ─────────────────────────────────

const FaultBadge = ({
    label, variant,
}: {
    label: string;
    variant: 'fault' | 'filter' | 'stale';
}) => {
    const colorVar =
        variant === 'fault'  ? 'var(--accent-alert)' :
        variant === 'filter' ? 'var(--accent-warn)'  :
                               'var(--accent-water)';

    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'clamp(0.42rem, 7cqmin, 0.58rem)',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: colorVar,
                backgroundColor: `color-mix(in srgb, ${colorVar} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${colorVar} 36%, transparent)`,
                boxShadow: `0 0 8px -2px color-mix(in srgb, ${colorVar} 42%, transparent)`,
                animation: 'cm-glass-badge-pulse 1.7s ease-in-out infinite',
                flexShrink: 0,
            }}
        >
            {variant === 'fault' && (
                <IconAlertTriangle style={{ width: '0.65em', height: '0.65em', flexShrink: 0 }} />
            )}
            {variant !== 'fault' && (
                <span
                    style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: colorVar,
                        boxShadow: `0 0 5px 1px color-mix(in srgb, ${colorVar} 60%, transparent)`,
                        display: 'inline-block',
                        flexShrink: 0,
                    }}
                />
            )}
            {label}
        </span>
    );
};

// ─── Mode + fan selector pills (glass-bead level-3) ─────────────────────────

const ModePills = ({
    options, value, onSelect, disabled, renderLabel, accentVar: accentV,
}: {
    options: string[];
    value: string | null;
    onSelect: (v: string) => void;
    disabled?: boolean;
    renderLabel: (v: string) => string;
    accentVar: string;
}) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', justifyContent: 'center', width: '100%' }}>
        {options.map(opt => {
            const isActive = value?.toLowerCase() === opt.toLowerCase();
            const mat = isActive
                ? glassMaterialActive(3, accentV, { glowStrength: 0.20 })
                : glassMaterial(3);
            return (
                <button
                    key={opt}
                    disabled={disabled}
                    onClick={() => !disabled && onSelect(opt)}
                    style={{
                        ...mat,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        borderRadius: 'var(--radius-control)',
                        padding: 'clamp(0.12rem, 1.5cqmin, 0.28rem) clamp(0.28rem, 2.5cqmin, 0.52rem)',
                        fontSize: 'clamp(0.46rem, 8cqmin, 0.66rem)',
                        fontWeight: 700,
                        letterSpacing: 'var(--tracking-caps)',
                        textTransform: 'uppercase',
                        color: isActive ? accentV : 'rgba(var(--text) / 0.65)',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.38 : 1,
                        transition: [
                            `background-color var(--dur-medium) var(--spring-gentle)`,
                            `border-color var(--dur-medium) var(--spring-gentle)`,
                            `box-shadow var(--dur-medium) ease`,
                            `transform var(--dur-fast) var(--spring-snappy)`,
                            `color var(--dur-medium) var(--spring-gentle)`,
                        ].join(', '),
                    }}
                    onPointerDown={e => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
                    onPointerUp={e =>   { (e.currentTarget as HTMLElement).style.transform = ''; }}
                    onPointerLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                >
                    {renderLabel(opt)}
                </button>
            );
        })}
    </div>
);

// ─── Keyframes (injected once) ──────────────────────────────────────────────

const KEYFRAMES = `
@keyframes cm-glass-badge-pulse {
    0%,100% { opacity: 1; }
    50%      { opacity: 0.50; }
}
@keyframes cm-glass-stale-rim {
    0%   { box-shadow: var(--rim), 0 0 0 1.5px rgba(var(--accent-water-rgb, 34 211 238) / 0) inset; }
    30%  { box-shadow: var(--rim), 0 0 0 1.5px rgba(var(--accent-water-rgb, 34 211 238) / 0.55) inset; }
    70%  { box-shadow: var(--rim), 0 0 0 1.5px rgba(var(--accent-water-rgb, 34 211 238) / 0.55) inset; }
    100% { box-shadow: var(--rim), 0 0 0 1.5px rgba(var(--accent-water-rgb, 34 211 238) / 0) inset; }
}
`;
let _kfInjected = false;
const injectKf = () => {
    if (_kfInjected || typeof document === 'undefined') return;
    _kfInjected = true;
    const el = document.createElement('style');
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
};

// ─── Optimistic state ────────────────────────────────────────────────────────

interface OptState {
    hvacMode?: string;
    targetTemp?: number;
    fanMode?: string;
    swingMode?: string;
}

// ─── Main tile ───────────────────────────────────────────────────────────────

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
    useEffect(() => { injectKf(); }, []);

    const { requestPin, addNotification } = useDashboardActions();
    const unit = device.state as CoolMasterUnitState;
    const isLocked = !!tile.isLocked;

    // ── Optimistic state + stale ────────────────────────────────────────────
    const [optimistic, setOptimistic] = useState<OptState>({});
    const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isStale, setIsStale] = useState(false);

    useEffect(() => {
        setOptimistic(prev => {
            const next = { ...prev };
            if (prev.hvacMode  !== undefined && prev.hvacMode === unit.hvacMode) delete next.hvacMode;
            if (prev.targetTemp !== undefined && prev.targetTemp === unit.targetTemp) delete next.targetTemp;
            if (prev.fanMode   !== undefined && prev.fanMode?.toLowerCase() === unit.fanMode?.toLowerCase()) delete next.fanMode;
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

    // ── Derived values ──────────────────────────────────────────────────────
    const hvacMode   = optimistic.hvacMode   ?? unit.hvacMode;
    const targetTemp = optimistic.targetTemp  ?? unit.targetTemp;
    const fanMode    = optimistic.fanMode     ?? unit.fanMode;
    const swingMode  = optimistic.swingMode   ?? unit.swingMode;
    const isOn       = hvacMode !== 'off' && hvacMode !== 'unavailable';
    const isUnavailable = !unit.isOnline;

    const colorVar = accentVarFor(hvacMode);
    const accent   = hvacModeAccent(hvacMode);
    const activeGlass = isOn && !isUnavailable;

    const rpmLevel = fanMode ? (FAN_LEVEL[fanMode.toLowerCase()] ?? 0.6) : 0.0;

    // Temp-toward-setpoint bar
    const tempProgress = unit.currentTemp !== null
        ? { value: unit.currentTemp, min: unit.tempUnit === 'F' ? 60 : 16, max: unit.tempUnit === 'F' ? 90 : 32 }
        : null;

    // ── Layout ──────────────────────────────────────────────────────────────
    const tileH = tile.height || 1;
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

    // ── Graceful degradation ────────────────────────────────────────────────
    if (!unit || !unit.climateEntityId) {
        return (
            <TileWrapper
                label={tile.label || device.name}
                isLocked={isLocked}
                isEditor={isEditor}
                className={cornerClassName}
            >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 'var(--space-2)', color: 'rgba(var(--text) / 0.25)' }}>
                    <IconThermometer style={fluidIcon(2)} />
                    <span style={{ ...fluidTextXs, opacity: 0.5 }}>No entity</span>
                </div>
            </TileWrapper>
        );
    }

    // ── Glass material for the outer card ────────────────────────────────────
    const cardMat = activeGlass
        ? glassMaterialActive(2, colorVar, { glowStrength: 0.18 })
        : glassMaterial(2);

    // Stale outer ring style override
    const staleStyle: React.CSSProperties = isStale
        ? { animation: 'cm-glass-stale-rim 2s ease-in-out infinite' }
        : {};

    return (
        <TileWrapper
            label=""
            isLocked={isLocked}
            isEditor={isEditor}
            isActive={activeGlass}
            isUnavailable={isUnavailable}
            isProtected={tile.requirePin}
            accent={accent}
            animation={tile.animation}
            className={['!p-0 !block overflow-hidden', cornerClassName || ''].join(' ')}
        >
            {/* Glass instrument card — level-2 material, full height */}
            <div
                style={{
                    ...cardMat,
                    ...staleStyle,
                    borderRadius: 'var(--radius-card)',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    padding: 'var(--space-3)',
                    gap: 'var(--space-3)',
                    containerType: 'inline-size',
                    // Spring transition on mode change
                    transition: [
                        `background-color var(--dur-medium) var(--spring-gentle)`,
                        `border-color var(--dur-medium) var(--spring-gentle)`,
                        `box-shadow var(--dur-medium) ease`,
                    ].join(', '),
                    opacity: isUnavailable ? 0.55 : 1,
                    filter: isUnavailable ? 'grayscale(0.6)' : undefined,
                    animation: `glass-mount var(--dur-enter) var(--spring-gentle) both${isStale ? ', cm-glass-stale-rim 2s ease-in-out infinite' : ''}`,
                }}
            >
                {/* ── Header: name + status badge ──────────────────────────────────── */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)', flexShrink: 0 }}>
                    {/* Name + mode glyph bead */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, flex: 1 }}>
                        {/* Icon bead: glass-l3 + accent tint when on */}
                        <div
                            style={{
                                ...(activeGlass
                                    ? glassMaterialActive(3, colorVar, { glowStrength: 0.22 })
                                    : glassMaterial(3)),
                                width: 28,
                                height: 28,
                                minWidth: 28,
                                borderRadius: 'var(--radius-control)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                transition: `background-color var(--dur-medium) var(--spring-gentle), border-color var(--dur-medium) var(--spring-gentle)`,
                            }}
                        >
                            <ModeIcon
                                mode={hvacMode}
                                style={{
                                    width: 14,
                                    height: 14,
                                    color: activeGlass ? colorVar : 'rgba(var(--text) / 0.45)',
                                    transition: `color var(--dur-medium) var(--spring-gentle)`,
                                }}
                            />
                        </div>
                        <h3
                            style={{
                                margin: 0,
                                fontFamily: 'var(--font-display)',
                                fontSize: 'clamp(0.78rem, 4cqi, 0.95rem)',
                                fontWeight: 600,
                                letterSpacing: 'var(--tracking-tight)',
                                color: 'rgb(var(--text))',
                                lineHeight: 1.2,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flex: '0 1 auto',
                            }}
                        >
                            {tile.label || unit.name}
                        </h3>
                    </div>

                    {/* Status badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
                        {unit.errorCode ? (
                            <FaultBadge label={unit.errorCode} variant="fault" />
                        ) : unit.filterDirty ? (
                            <FaultBadge label="Filter" variant="filter" />
                        ) : isStale ? (
                            <FaultBadge label="Sync…" variant="stale" />
                        ) : null}
                    </div>
                </div>

                {/* ── Instrument body: rail | console ──────────────────────────────── */}
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--space-3)',
                        alignItems: 'stretch',
                    }}
                >
                    {/* Telemetry rail — fan/mode glyph + temp BuildBar */}
                    <div
                        style={{
                            flex: '1 1 7rem',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 'var(--space-3)',
                            borderRadius: 'var(--radius-control)',
                            padding: 'var(--space-3) var(--space-2)',
                            backgroundColor: 'color-mix(in srgb, rgb(var(--text)) 4%, transparent)',
                            boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.10)',
                        }}
                    >
                        {/* Animated mode/fan glyph */}
                        <LivingModeIcon mode={hvacMode} active={isOn && !isUnavailable} colorVar={colorVar}>
                            {hvacMode === 'fan_only' ? (
                                <AnimatedFan
                                    active={isOn && !isUnavailable}
                                    rpmLevel={rpmLevel}
                                    size={48}
                                    colorVar={activeGlass ? colorVar : 'rgba(var(--text) / 0.30)'}
                                    title={`Fan — ${FAN_LABEL[fanMode?.toLowerCase() ?? ''] ?? fanMode ?? ''}`}
                                />
                            ) : (
                                <ModeIcon
                                    mode={hvacMode}
                                    style={{
                                        width: 44,
                                        height: 44,
                                        color: activeGlass ? colorVar : 'rgba(var(--text) / 0.30)',
                                        filter: (isOn && !isUnavailable) ? `drop-shadow(0 0 8px ${colorVar})` : undefined,
                                        transition: `color var(--dur-medium) var(--spring-gentle)`,
                                    }}
                                />
                            )}
                        </LivingModeIcon>

                        {/* Telemetry meters */}
                        {tempProgress && (
                            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'clamp(0.5rem, 2.4cqi, 0.6rem)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.4)' }}>
                                            <IconThermometer style={{ width: 9, height: 9, opacity: 0.7, flexShrink: 0 }} /> Temp
                                        </span>
                                        <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'clamp(0.58rem, 2.8cqi, 0.74rem)', fontWeight: 600, color: 'rgba(var(--text) / 0.70)', whiteSpace: 'nowrap' }}>
                                            {unit.currentTemp?.toFixed(1)}°{unit.tempUnit}
                                        </span>
                                    </div>
                                    <BuildBar
                                        value={tempProgress.value}
                                        min={tempProgress.min}
                                        max={tempProgress.max}
                                        colorVar={activeGlass ? colorVar : 'rgba(var(--text) / 0.45)'}
                                        active={isOn && !isUnavailable}
                                        height={5}
                                        label={`Temperature ${unit.currentTemp?.toFixed(1)}°${unit.tempUnit}`}
                                    />
                                </div>

                                {/* Setpoint progress bar (how close are we to target) */}
                                {targetTemp !== null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                            <span style={{ fontSize: 'clamp(0.5rem, 2.4cqi, 0.6rem)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.4)' }}>
                                                Target
                                            </span>
                                            <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'clamp(0.58rem, 2.8cqi, 0.74rem)', fontWeight: 600, color: activeGlass ? colorVar : 'rgba(var(--text) / 0.70)', whiteSpace: 'nowrap', transition: `color var(--dur-medium) var(--spring-gentle)` }}>
                                                {targetTemp.toFixed(1)}°
                                            </span>
                                        </div>
                                        <BuildBar
                                            value={targetTemp}
                                            min={tempProgress.min}
                                            max={tempProgress.max}
                                            colorVar={activeGlass ? colorVar : 'rgba(var(--text) / 0.35)'}
                                            active={false}
                                            height={4}
                                            label={`Setpoint ${targetTemp.toFixed(1)}°${unit.tempUnit}`}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Fan speed indicator (when not fan_only mode) */}
                        {fanMode && hvacMode !== 'fan_only' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%', justifyContent: 'center' }}>
                                <AnimatedFan
                                    active={isOn && !isUnavailable}
                                    rpmLevel={rpmLevel}
                                    size={16}
                                    colorVar={activeGlass ? colorVar : 'rgba(var(--text) / 0.35)'}
                                    showAirflow={false}
                                />
                                <span style={{
                                    fontSize: 'clamp(0.44rem, 2cqi, 0.6rem)',
                                    fontWeight: 700,
                                    letterSpacing: 'var(--tracking-caps)',
                                    textTransform: 'uppercase',
                                    color: activeGlass ? colorVar : 'rgba(var(--text) / 0.40)',
                                    transition: `color var(--dur-medium) var(--spring-gentle)`,
                                }}>
                                    {FAN_LABEL[fanMode.toLowerCase()] ?? fanMode}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Control console — setpoint hero + steppers + mode/fan pickers */}
                    <div
                        style={{
                            flex: '1 1 8rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                            justifyContent: 'center',
                        }}
                    >
                        {/* Setpoint hero */}
                        {isOn && targetTemp !== null && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)' }}>
                                {/* − bead */}
                                <GlassButton
                                    pill
                                    disabled={isEditor || isLocked || isUnavailable}
                                    onClick={() => setTemp(-0.5)}
                                    aria-label="Lower setpoint"
                                    style={{
                                        width: '2.5rem',
                                        height: '2.5rem',
                                        minWidth: '2.5rem',
                                        fontSize: '1.35rem',
                                        fontWeight: 300,
                                        lineHeight: 1,
                                        backgroundImage: 'var(--sheen-default), var(--specular-strong), var(--glass-l3-tint)',
                                        boxShadow: 'var(--rim), var(--elev-2)',
                                        color: 'rgb(var(--text))',
                                    }}
                                >
                                    −
                                </GlassButton>

                                {/* Setpoint digit */}
                                <div style={{ flex: '0 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, gap: 2 }}>
                                    <div style={{
                                        fontFamily: 'var(--font-numeric)',
                                        fontSize: 'clamp(1.6rem, 11cqi, 2.65rem)',
                                        fontWeight: 700,
                                        letterSpacing: '-0.04em',
                                        color: activeGlass ? colorVar : 'rgba(var(--text) / 0.90)',
                                        textShadow: activeGlass
                                            ? `0 0 22px color-mix(in srgb, ${colorVar} 50%, transparent)`
                                            : undefined,
                                        transition: `color var(--dur-medium) var(--spring-gentle), text-shadow var(--dur-medium) ease`,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {targetTemp.toFixed(1)}
                                        <span style={{ fontSize: '0.38em', fontWeight: 500, opacity: 0.65, verticalAlign: 'super', letterSpacing: 0 }}>
                                            °{unit.tempUnit}
                                        </span>
                                    </div>
                                </div>

                                {/* + bead */}
                                <GlassButton
                                    pill
                                    disabled={isEditor || isLocked || isUnavailable}
                                    onClick={() => setTemp(0.5)}
                                    aria-label="Raise setpoint"
                                    style={{
                                        width: '2.5rem',
                                        height: '2.5rem',
                                        minWidth: '2.5rem',
                                        fontSize: '1.35rem',
                                        fontWeight: 300,
                                        lineHeight: 1,
                                        backgroundImage: 'var(--sheen-default), var(--specular-strong), var(--glass-l3-tint)',
                                        boxShadow: 'var(--rim), var(--elev-2)',
                                        color: 'rgb(var(--text))',
                                    }}
                                >
                                    +
                                </GlassButton>
                            </div>
                        )}

                        {/* HVAC mode selector */}
                        <ModePills
                            options={unit.hvacModes}
                            value={hvacMode}
                            onSelect={setHvacMode}
                            disabled={isEditor || isLocked || isUnavailable}
                            renderLabel={v => HVAC_LABEL[v] ?? v}
                            accentVar={colorVar}
                        />

                        {/* Fan speed selector */}
                        {unit.fanModes.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                <span style={{ fontSize: 'clamp(0.42rem, 2cqi, 0.56rem)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.30)', textAlign: 'center' }}>
                                    Fan Speed
                                </span>
                                <ModePills
                                    options={unit.fanModes}
                                    value={fanMode}
                                    onSelect={setFanMode}
                                    disabled={isEditor || isLocked || !isOn || isUnavailable}
                                    renderLabel={v => FAN_LABEL[v.toLowerCase()] ?? v}
                                    accentVar={colorVar}
                                />
                            </div>
                        )}

                        {/* Swing selector (tall tiles only) */}
                        {unit.supportsSwing && unit.swingModes.length > 0 && isTall && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                <span style={{ fontSize: 'clamp(0.42rem, 2cqi, 0.56rem)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.30)', textAlign: 'center' }}>
                                    Swing
                                </span>
                                <ModePills
                                    options={unit.swingModes}
                                    value={swingMode}
                                    onSelect={setSwingMode}
                                    disabled={isEditor || isLocked || !isOn || isUnavailable}
                                    renderLabel={v => v.charAt(0).toUpperCase() + v.slice(1)}
                                    accentVar={colorVar}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Footer: unit ID + filter reset ─────────────────────────────────── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <span style={{
                        fontFamily: 'var(--font-numeric)',
                        fontSize: 'clamp(0.4rem, 2cqi, 0.56rem)',
                        color: 'rgba(var(--text) / 0.22)',
                        letterSpacing: '0.04em',
                    }}>
                        {unit.rawUnitId}
                    </span>

                    {unit.filterDirty && unit.resetFilterEntityId && (
                        <GlassButton
                            accentVar="var(--accent-warn)"
                            active
                            disabled={isEditor || isLocked || isUnavailable}
                            onClick={resetFilter}
                            title="Reset filter timer"
                            style={{
                                gap: 'var(--space-1)',
                                padding: 'var(--space-1) var(--space-2)',
                                fontSize: 'clamp(0.4rem, 2cqi, 0.56rem)',
                                fontWeight: 700,
                                letterSpacing: 'var(--tracking-caps)',
                                textTransform: 'uppercase',
                                color: 'var(--accent-warn)',
                                animation: 'cm-glass-badge-pulse 2s ease-in-out infinite',
                                borderRadius: 'var(--radius-control)',
                            }}
                        >
                            <IconRotateCcw style={{ width: '0.7em', height: '0.7em' }} />
                            Reset
                        </GlassButton>
                    )}
                </div>
            </div>
        </TileWrapper>
    );
};

export default CoolMasterTile;
