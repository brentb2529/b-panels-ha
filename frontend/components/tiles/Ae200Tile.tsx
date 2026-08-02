/**
 * Ae200Tile — Mitsubishi City Multi AE-200E Liquid Glass surface
 *
 * Design: Same liquid glass material language as AirControlSurface / CoolMasterTile,
 * but visually distinct from CoolMaster: per-group glass instrument cards with a
 * precision city-multi panel character.
 *
 * Each group card shows:
 *   • AnimatedFan (fan_only) or LivingModeIcon (heat/cool/dry/auto) as the rail glyph
 *   • BuildBars: inlet temp progress + setpoint progress
 *   • Glass-bead +/− setpoint steppers
 *   • Mode cycle button + fan cycle button (glass-l3)
 *   • filter/error pulsing badges
 *
 * Outdoor-temp chip + controller ident live in the glass-l1 header.
 * Capped grid (minmax 15rem, 22rem) + container stacking, same as Air reference.
 *
 * Entity contract (ae200 custom component): unchanged.
 *   climate.ae200_*            — hvac_mode / fan_mode / swing_mode / temps
 *   sensor.*_inlet_temperature — return-air inlet temp
 *   sensor.*_outdoor_temp      — outdoor unit temp (per controller)
 *   binary_sensor.*_filter     — filter problem class
 *   binary_sensor.*_error      — error problem class
 *
 * Commands via updateDeviceState(entityId, payload): unchanged.
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
import {
    AnimatedFan,
    BuildBar,
    LivingModeIcon,
    GlassButton,
    glassMaterial,
    glassMaterialActive,
} from '../../design-system';

// ─── Lucide icons not yet exported from icons.tsx ────────────────────────────
import { Wind, Minus, Plus } from 'lucide-react';
const IconWind2 = (p: React.ComponentProps<typeof Wind>) => <Wind {...p} />;
const IconMinus = (p: React.ComponentProps<typeof Minus>) => <Minus {...p} />;
const IconPlus2 = (p: React.ComponentProps<typeof Plus>) => <Plus {...p} />;

// ─── Mode config (CSS token accent vars — not hex) ────────────────────────────

const MODE_ACCENT: Record<Ae200HvacMode, { colorVar: string; label: string }> = {
    cool:     { colorVar: 'var(--accent-water)', label: 'COOL' },
    heat:     { colorVar: 'var(--accent-warn)',  label: 'HEAT' },
    dry:      { colorVar: 'var(--accent-light)', label: 'DRY'  },
    fan_only: { colorVar: 'var(--accent)',       label: 'FAN'  },
    auto:     { colorVar: 'var(--accent-plug)',  label: 'AUTO' },
    off:      { colorVar: 'var(--glass-l3-bg)',  label: 'OFF'  },
};

const ModeIcon: React.FC<{ mode: Ae200HvacMode; style?: React.CSSProperties }> = ({ mode, style }) => {
    switch (mode) {
        case 'cool':     return <IconSnowflake style={style} />;
        case 'heat':     return <IconFlame     style={style} />;
        case 'dry':      return <IconDroplets  style={style} />;
        case 'fan_only': return <IconWind2     style={style as any} />;
        case 'auto':     return <IconActivity  style={style} />;
        default:         return <IconPower     style={style} />;
    }
};

// Fan level 0..1 for AnimatedFan spin speed
const FAN_RPM: Record<Ae200FanMode, number> = {
    AUTO: 0.55, LOW: 0.20, MID2: 0.40, MID1: 0.65, HIGH: 0.90,
};
const fanBarsFilled = (f: Ae200FanMode): number =>
    ({ AUTO: 3, LOW: 1, MID2: 2, MID1: 3, HIGH: 5 } as Record<Ae200FanMode, number>)[f] ?? 3;

const HVAC_CYCLE: Ae200HvacMode[] = ['off', 'cool', 'heat', 'dry', 'fan_only', 'auto'];
const FAN_CYCLE: Ae200FanMode[]   = ['AUTO', 'LOW', 'MID2', 'MID1', 'HIGH'];

// ─── Fault badge (glass material, pulsing dot) ─────────────────────────────

const FaultBadge: React.FC<{ label: string; type: 'filter' | 'error' }> = ({ label, type }) => {
    const colorVar = type === 'error' ? 'var(--accent-alert)' : 'var(--accent-warn)';
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'clamp(0.42rem, 7cqmin, 0.58rem)',
                fontWeight: 700,
                letterSpacing: 'var(--tracking-caps)',
                textTransform: 'uppercase',
                color: colorVar,
                backgroundColor: `color-mix(in srgb, ${colorVar} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${colorVar} 36%, transparent)`,
                boxShadow: `0 0 8px -2px color-mix(in srgb, ${colorVar} 42%, transparent)`,
                animation: 'ae200-glass-pulse 1.8s ease-in-out infinite',
            }}
        >
            <span
                style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: colorVar,
                    boxShadow: `0 0 4px 1px color-mix(in srgb, ${colorVar} 60%, transparent)`,
                    display: 'inline-block',
                    flexShrink: 0,
                }}
            />
            {label}
        </span>
    );
};

// ─── Fan bar meter ─────────────────────────────────────────────────────────

const FanMeter: React.FC<{ fanMode: Ae200FanMode; colorVar: string; isActive: boolean }> = ({ fanMode, colorVar, isActive }) => {
    const filled = fanBarsFilled(fanMode);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {Array.from({ length: 5 }, (_, i) => (
                <div
                    key={i}
                    style={{
                        width: 3,
                        height: 6 + i * 3,
                        borderRadius: 'var(--radius-pill)',
                        background: i < filled
                            ? (isActive ? colorVar : `color-mix(in srgb, ${colorVar} 60%, transparent)`)
                            : 'rgba(var(--text) / 0.10)',
                        boxShadow: i < filled && isActive
                            ? `0 0 4px color-mix(in srgb, ${colorVar} 60%, transparent)`
                            : 'none',
                        transition: 'background 0.4s ease',
                    }}
                />
            ))}
        </div>
    );
};

// ─── Per-group glass instrument card ────────────────────────────────────────

const GroupCard: React.FC<{
    group: Ae200Group;
    onModeToggle: (g: Ae200Group) => void;
    onSetpointDelta: (g: Ae200Group, delta: number) => void;
    onFanCycle: (g: Ae200Group) => void;
    isEditor: boolean;
}> = ({ group, onModeToggle, onSetpointDelta, onFanCycle, isEditor }) => {
    const cfg = MODE_ACCENT[group.mode] || MODE_ACCENT.off;
    const colorVar  = cfg.colorVar;
    const isActive  = group.isActive && group.isOnline;
    const isOn      = group.mode !== 'off';
    const rpmLevel  = FAN_RPM[group.fanMode] ?? 0.55;

    // Card glass material
    const cardMat = isActive
        ? glassMaterialActive(2, colorVar, { glowStrength: 0.16 })
        : glassMaterial(2);

    // Temp bars
    const tempMin = group.minTemp ?? 16;
    const tempMax = group.maxTemp ?? 30;
    const inletProgress = group.inletTemp !== null
        ? { value: group.inletTemp, min: tempMin, max: tempMax }
        : null;
    const setpointProgress = group.setpoint !== null
        ? { value: group.setpoint, min: tempMin, max: tempMax }
        : null;

    return (
        <div
            style={{
                ...cardMat,
                borderRadius: 'var(--radius-card)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                opacity: group.isOnline ? 1 : 0.55,
                filter: group.isOnline ? undefined : 'grayscale(0.6)',
                containerType: 'inline-size',
                flex: 1,
                minWidth: 0,
                transition: [
                    `background-color var(--dur-medium) var(--spring-gentle)`,
                    `border-color var(--dur-medium) var(--spring-gentle)`,
                    `box-shadow var(--dur-medium) ease`,
                ].join(', '),
            }}
        >
            {/* Running accent strip */}
            {isActive && (
                <div
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 'var(--space-3)',
                        right: 'var(--space-3)',
                        height: 2,
                        borderRadius: 'var(--radius-pill)',
                        background: `linear-gradient(90deg, transparent, ${colorVar}, transparent)`,
                        animation: 'ae200-glass-shimmer 2.6s ease-in-out infinite',
                        pointerEvents: 'none',
                    }}
                />
            )}

            {/* ── Card header: glyph bead + name + fault badges ─────────────── */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                {/* Mode/fan glyph rail */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    flexShrink: 0,
                }}>
                    {/* Mode icon bead — tappable to cycle mode */}
                    <button
                        onClick={() => !isEditor && onModeToggle(group)}
                        disabled={isEditor || !group.isOnline}
                        title={`Mode: ${cfg.label}`}
                        style={{
                            ...(isActive
                                ? glassMaterialActive(3, colorVar, { glowStrength: 0.24 })
                                : glassMaterial(3)),
                            width: 40,
                            height: 40,
                            borderRadius: 'var(--radius-control)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: isEditor || !group.isOnline ? 'not-allowed' : 'pointer',
                            transition: [
                                `background-color var(--dur-medium) var(--spring-gentle)`,
                                `border-color var(--dur-medium) var(--spring-gentle)`,
                                `box-shadow var(--dur-medium) ease`,
                                `transform var(--dur-fast) var(--spring-snappy)`,
                            ].join(', '),
                        }}
                        onPointerDown={e => { if (!isEditor && group.isOnline) (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
                        onPointerUp={e =>   { (e.currentTarget as HTMLElement).style.transform = ''; }}
                        onPointerLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                    >
                        <LivingModeIcon mode={group.mode} active={isActive} colorVar={colorVar}>
                            {group.mode === 'fan_only' ? (
                                <AnimatedFan
                                    active={isActive}
                                    rpmLevel={rpmLevel}
                                    size={22}
                                    colorVar={isActive ? colorVar : 'rgba(var(--text) / 0.30)'}
                                    showAirflow={false}
                                />
                            ) : (
                                <ModeIcon
                                    mode={group.mode}
                                    style={{
                                        width: 18,
                                        height: 18,
                                        color: isActive ? colorVar : 'rgba(var(--text) / 0.38)',
                                        filter: isActive ? `drop-shadow(0 0 5px ${colorVar})` : undefined,
                                        transition: `color var(--dur-medium) var(--spring-gentle)`,
                                    }}
                                />
                            )}
                        </LivingModeIcon>
                    </button>

                    {/* Mode label chip */}
                    <span style={{
                        fontSize: 'clamp(0.44rem, 2cqi, 0.56rem)',
                        fontWeight: 700,
                        letterSpacing: 'var(--tracking-caps)',
                        textTransform: 'uppercase',
                        color: isActive ? colorVar : 'rgba(var(--text) / 0.30)',
                        textShadow: isActive ? `0 0 6px ${colorVar}` : undefined,
                        transition: `color var(--dur-medium) var(--spring-gentle)`,
                    }}>
                        {cfg.label}
                    </span>
                </div>

                {/* Name + fault badges */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <h4 style={{
                        margin: 0,
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(0.72rem, 3.6cqi, 0.88rem)',
                        fontWeight: 600,
                        letterSpacing: 'var(--tracking-tight)',
                        color: 'rgb(var(--text))',
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {group.name}
                    </h4>

                    {/* Fault badges */}
                    {(group.filterDirty || group.hasError) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                            {group.filterDirty && <FaultBadge label="Filter" type="filter" />}
                            {group.hasError    && <FaultBadge label="Error"  type="error"  />}
                        </div>
                    )}
                </div>

                {/* Temp display */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                        <span style={{
                            fontFamily: 'var(--font-numeric)',
                            fontSize: 'clamp(1.3rem, 9cqi, 1.85rem)',
                            fontWeight: 700,
                            letterSpacing: '-0.02em',
                            color: 'rgb(var(--text))',
                            textShadow: isActive ? `0 0 14px color-mix(in srgb, ${colorVar} 50%, transparent)` : undefined,
                            transition: 'text-shadow 0.4s ease',
                            fontVariantNumeric: 'tabular-nums',
                        }}>
                            {group.currentTemp !== null ? group.currentTemp.toFixed(1) : '--'}
                        </span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(0.5rem, 2.5cqi, 0.68rem)', color: 'rgba(var(--text) / 0.45)', fontWeight: 500 }}>
                            {group.tempUnit}
                        </span>
                    </div>

                    {/* Setpoint with ± steppers */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <button
                            onClick={() => !isEditor && onSetpointDelta(group, -0.5)}
                            disabled={isEditor || !group.isOnline}
                            style={{
                                ...glassMaterial(3),
                                width: 18,
                                height: 18,
                                borderRadius: 'var(--radius-chip)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: isEditor || !group.isOnline ? 'not-allowed' : 'pointer',
                                opacity: !group.isOnline ? 0.3 : 1,
                                padding: 0,
                                transition: `transform var(--dur-fast) var(--spring-snappy)`,
                            }}
                            onPointerDown={e => { if (group.isOnline) (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
                            onPointerUp={e =>   { (e.currentTarget as HTMLElement).style.transform = ''; }}
                            onPointerLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                        >
                            <IconMinus style={{ width: 8, height: 8, color: 'rgba(var(--text) / 0.65)' }} />
                        </button>
                        <span style={{
                            fontFamily: 'var(--font-numeric)',
                            fontSize: 'clamp(0.56rem, 2.8cqi, 0.72rem)',
                            fontWeight: 600,
                            color: isActive ? colorVar : 'rgba(var(--text) / 0.58)',
                            minWidth: '2.4rem',
                            textAlign: 'center',
                            transition: `color var(--dur-medium) var(--spring-gentle)`,
                        }}>
                            {group.setpoint !== null ? `${group.setpoint.toFixed(1)}°` : '--°'}
                        </span>
                        <button
                            onClick={() => !isEditor && onSetpointDelta(group, 0.5)}
                            disabled={isEditor || !group.isOnline}
                            style={{
                                ...glassMaterial(3),
                                width: 18,
                                height: 18,
                                borderRadius: 'var(--radius-chip)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: isEditor || !group.isOnline ? 'not-allowed' : 'pointer',
                                opacity: !group.isOnline ? 0.3 : 1,
                                padding: 0,
                                transition: `transform var(--dur-fast) var(--spring-snappy)`,
                            }}
                            onPointerDown={e => { if (group.isOnline) (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
                            onPointerUp={e =>   { (e.currentTarget as HTMLElement).style.transform = ''; }}
                            onPointerLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                        >
                            <IconPlus2 style={{ width: 8, height: 8, color: 'rgba(var(--text) / 0.65)' }} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Telemetry: inlet temp + setpoint BuildBars ───────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {inletProgress && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'clamp(0.46rem, 2.2cqi, 0.58rem)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.38)' }}>
                                <IconThermometer style={{ width: 9, height: 9, opacity: 0.7, flexShrink: 0 }} /> Inlet
                            </span>
                            <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'clamp(0.54rem, 2.6cqi, 0.68rem)', fontWeight: 600, color: 'rgba(var(--text) / 0.65)', whiteSpace: 'nowrap' }}>
                                {group.inletTemp?.toFixed(1)}{group.tempUnit}
                            </span>
                        </div>
                        <BuildBar
                            value={inletProgress.value}
                            min={inletProgress.min}
                            max={inletProgress.max}
                            colorVar={isActive ? colorVar : 'rgba(var(--text) / 0.42)'}
                            active={isActive}
                            height={5}
                            label={`Inlet temp ${group.inletTemp?.toFixed(1)}${group.tempUnit}`}
                        />
                    </div>
                )}

                {setpointProgress && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <span style={{ fontSize: 'clamp(0.46rem, 2.2cqi, 0.58rem)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.38)' }}>
                                Target
                            </span>
                            <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'clamp(0.54rem, 2.6cqi, 0.68rem)', fontWeight: 600, color: isActive ? colorVar : 'rgba(var(--text) / 0.65)', whiteSpace: 'nowrap', transition: `color var(--dur-medium) var(--spring-gentle)` }}>
                                {group.setpoint?.toFixed(1)}°
                            </span>
                        </div>
                        <BuildBar
                            value={setpointProgress.value}
                            min={setpointProgress.min}
                            max={setpointProgress.max}
                            colorVar={isActive ? colorVar : 'rgba(var(--text) / 0.32)'}
                            active={false}
                            height={4}
                            label={`Setpoint ${group.setpoint?.toFixed(1)}${group.tempUnit}`}
                        />
                    </div>
                )}
            </div>

            {/* ── Fan row: meter + cycle button ────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <FanMeter fanMode={group.fanMode} colorVar={colorVar} isActive={isActive} />
                    <AnimatedFan
                        active={isActive}
                        rpmLevel={rpmLevel}
                        size={14}
                        colorVar={isActive ? colorVar : 'rgba(var(--text) / 0.30)'}
                        showAirflow={false}
                    />
                </div>

                <GlassButton
                    disabled={isEditor || !group.isOnline || !isOn}
                    onClick={() => !isEditor && onFanCycle(group)}
                    title={`Fan: ${group.fanMode}`}
                    style={{
                        gap: 4,
                        padding: 'var(--space-1) var(--space-2)',
                        fontSize: 'clamp(0.46rem, 2.2cqi, 0.6rem)',
                        fontWeight: 600,
                        letterSpacing: 'var(--tracking-caps)',
                        textTransform: 'uppercase',
                        color: 'rgba(var(--text) / 0.65)',
                        borderRadius: 'var(--radius-control)',
                    }}
                >
                    <IconWind2 style={{ width: 10, height: 10, opacity: 0.7, flexShrink: 0 }} />
                    {group.fanMode}
                </GlassButton>
            </div>
        </div>
    );
};

// ─── Keyframes (injected once) ───────────────────────────────────────────────

const AE200_STYLES = `
@keyframes ae200-glass-shimmer {
    0%, 100% { opacity: 0.35; transform: scaleX(0.25); }
    50%       { opacity: 1;   transform: scaleX(1); }
}
@keyframes ae200-glass-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.48; }
}
`;
let ae200StylesInjected = false;
const injectAe200Styles = () => {
    if (ae200StylesInjected || typeof document === 'undefined') return;
    ae200StylesInjected = true;
    const el = document.createElement('style');
    el.textContent = AE200_STYLES;
    document.head.appendChild(el);
};

// ─── Main tile ────────────────────────────────────────────────────────────────

const Ae200Tile: React.FC<{
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string;
}> = ({ device, tile, isEditor = false, cornerClassName }) => {
    injectAe200Styles();
    const { updateDeviceState } = useDashboardActions();
    const state = device.state as Ae200State | null;
    const isLocked = !!tile.isLocked;

    const [optimistic, setOptimistic] = useState<Record<string, Partial<Ae200Group>>>({});
    const [staleIds, setStaleIds]     = useState<Set<string>>(new Set());

    const mergeOptimistic = useCallback((entityId: string, patch: Partial<Ae200Group>) => {
        setOptimistic(prev => ({ ...prev, [entityId]: { ...prev[entityId], ...patch } }));
        const timer = setTimeout(() => setStaleIds(prev => new Set([...prev, entityId])), 8000);
        setTimeout(() => {
            setStaleIds(prev => { const n = new Set(prev); n.delete(entityId); return n; });
            setOptimistic(prev => { const n = { ...prev }; delete n[entityId]; return n; });
        }, 15000);
        return () => clearTimeout(timer);
    }, []);

    const resolveGroup = useCallback((g: Ae200Group): Ae200Group => {
        const opt = optimistic[g.entityId];
        return opt ? { ...g, ...opt } : g;
    }, [optimistic]);

    const handleModeToggle = useCallback((group: Ae200Group) => {
        if (isEditor || isLocked || !group.isOnline) return;
        const idx  = HVAC_CYCLE.indexOf(group.mode);
        const next = HVAC_CYCLE[(idx + 1) % HVAC_CYCLE.length];
        mergeOptimistic(group.entityId, { mode: next, isOn: next !== 'off' });
        updateDeviceState(group.entityId, { mode: next });
    }, [isEditor, isLocked, mergeOptimistic, updateDeviceState]);

    const handleSetpointDelta = useCallback((group: Ae200Group, delta: number) => {
        if (isEditor || isLocked || !group.isOnline) return;
        const base = group.setpoint ?? 22;
        const min  = group.minTemp ?? 16;
        const max  = group.maxTemp ?? 30;
        const next = Math.max(min, Math.min(max, parseFloat((base + delta).toFixed(1))));
        mergeOptimistic(group.entityId, { setpoint: next });
        updateDeviceState(group.entityId, { setpoint: next });
    }, [isEditor, isLocked, mergeOptimistic, updateDeviceState]);

    const handleFanCycle = useCallback((group: Ae200Group) => {
        if (isEditor || isLocked || !group.isOnline) return;
        const idx  = FAN_CYCLE.indexOf(group.fanMode);
        const next = FAN_CYCLE[(idx + 1) % FAN_CYCLE.length];
        mergeOptimistic(group.entityId, { fanMode: next });
        updateDeviceState(group.entityId, { fanMode: next });
    }, [isEditor, isLocked, mergeOptimistic, updateDeviceState]);

    // ── Empty state ─────────────────────────────────────────────────────────
    if (!state || !state.controllers || state.controllers.length === 0) {
        return (
            <TileWrapper
                label={tile.label || device.name}
                isLocked={isLocked}
                isEditor={isEditor}
                className={cornerClassName}
            >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 'var(--space-3)', color: 'rgba(var(--text) / 0.28)' }}>
                    <IconThermometer style={{ width: 28, height: 28, opacity: 0.3 }} />
                    <span style={{ fontSize: 'var(--type-xs)', opacity: 0.5 }}>No AE-200E controllers</span>
                </div>
            </TileWrapper>
        );
    }

    const tileW = tile.width || 1;
    const tileH = tile.height || 1;
    const isLarge = tileW >= 2;

    const allGroups      = state.controllers.flatMap(c => c.groups).map(resolveGroup);
    const anyActive      = allGroups.some(g => g.isActive && g.isOnline);
    const anyOnline      = allGroups.some(g => g.isOnline);
    const anyFault       = allGroups.some(g => g.filterDirty || g.hasError);
    const primaryMode    = (allGroups.find(g => g.isOn)?.mode ?? 'off') as Ae200HvacMode;
    const primaryColorVar = MODE_ACCENT[primaryMode]?.colorVar ?? 'var(--glass-l3-bg)';
    const outdoorTemp    = state.controllers[0]?.outdoorTemp;
    const isStale        = staleIds.size > 0;

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
            className={['!p-0 !block overflow-hidden', cornerClassName || ''].join(' ')}
        >
            {/* Level-1 surface glass, spring mount */}
            <div
                style={{
                    backdropFilter:       'var(--glass-l1-backdrop)',
                    WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
                    backgroundColor: anyActive
                        ? `color-mix(in srgb, ${primaryColorVar} 12%, var(--glass-l1-bg))`
                        : 'var(--glass-l1-bg)',
                    backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l1-tint)',
                    border: `1px solid ${anyActive
                        ? `color-mix(in srgb, ${primaryColorVar} 35%, var(--glass-l1-border))`
                        : 'var(--glass-l1-border)'}`,
                    boxShadow: 'var(--rim), var(--elev-3)',
                    borderRadius: 'var(--radius-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    animation: 'glass-mount var(--dur-enter) var(--spring-gentle) both',
                    transition: [
                        `background-color var(--dur-medium) var(--spring-gentle)`,
                        `border-color var(--dur-medium) var(--spring-gentle)`,
                    ].join(', '),
                }}
            >
                {/* ── Header ───────────────────────────────────────────────────── */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-3) var(--space-4)',
                        borderBottom: `1px solid ${anyActive ? `color-mix(in srgb, ${primaryColorVar} 22%, var(--glass-l1-border))` : 'var(--glass-l1-border)'}`,
                        flexShrink: 0,
                        gap: 'var(--space-3)',
                        transition: 'border-color var(--dur-medium) var(--spring-gentle)',
                    }}
                >
                    {/* Left: controller chip + tile name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                        {/* AE-200E ident chip */}
                        <span
                            style={{
                                ...(anyActive
                                    ? glassMaterialActive(3, primaryColorVar, { glowStrength: 0.22 })
                                    : glassMaterial(3)),
                                display: 'inline-flex',
                                padding: '2px 7px',
                                borderRadius: 'var(--radius-chip)',
                                fontFamily: 'var(--font-numeric)',
                                fontSize: 'clamp(0.46rem, 2.2cqi, 0.58rem)',
                                fontWeight: 700,
                                letterSpacing: '0.07em',
                                color: anyActive ? primaryColorVar : 'rgba(var(--text) / 0.50)',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                transition: `color var(--dur-medium) var(--spring-gentle)`,
                            }}
                        >
                            AE-200E
                        </span>

                        <h2
                            style={{
                                margin: 0,
                                fontFamily: 'var(--font-display)',
                                fontSize: 'clamp(0.78rem, 3.8cqi, 0.95rem)',
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
                            {tile.label || device.name}
                        </h2>
                    </div>

                    {/* Right: outdoor temp + stale/fault badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                        {isStale && (
                            <span
                                style={{
                                    padding: '2px 7px',
                                    borderRadius: 'var(--radius-pill)',
                                    fontSize: 'clamp(0.44rem, 2cqi, 0.56rem)',
                                    fontWeight: 700,
                                    letterSpacing: 'var(--tracking-caps)',
                                    textTransform: 'uppercase',
                                    color: 'var(--accent-warn)',
                                    backgroundColor: 'color-mix(in srgb, var(--accent-warn) 12%, transparent)',
                                    border: '1px solid color-mix(in srgb, var(--accent-warn) 30%, transparent)',
                                    animation: 'ae200-glass-pulse 2s ease-in-out infinite',
                                }}
                            >
                                Pending
                            </span>
                        )}
                        {anyFault && (
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '2px 7px',
                                    borderRadius: 'var(--radius-pill)',
                                    fontSize: 'clamp(0.44rem, 2cqi, 0.56rem)',
                                    fontWeight: 700,
                                    letterSpacing: 'var(--tracking-caps)',
                                    textTransform: 'uppercase',
                                    color: 'var(--accent-alert)',
                                    backgroundColor: 'color-mix(in srgb, var(--accent-alert) 12%, transparent)',
                                    border: '1px solid color-mix(in srgb, var(--accent-alert) 30%, transparent)',
                                    boxShadow: '0 0 8px -2px color-mix(in srgb, var(--accent-alert) 40%, transparent)',
                                    animation: 'ae200-glass-pulse 1.8s ease-in-out infinite',
                                }}
                            >
                                <IconAlertTriangle style={{ width: '0.65em', height: '0.65em' }} />
                                Fault
                            </span>
                        )}
                        {outdoorTemp != null && (
                            <div
                                style={{
                                    ...glassMaterial(3),
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '3px 8px',
                                    borderRadius: 'var(--radius-pill)',
                                }}
                            >
                                <IconThermometer style={{ width: 10, height: 10, color: 'rgba(var(--text) / 0.55)', flexShrink: 0 }} />
                                <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'clamp(0.52rem, 2.5cqi, 0.68rem)', fontWeight: 600, color: 'rgba(var(--text) / 0.75)', whiteSpace: 'nowrap' }}>
                                    {outdoorTemp.toFixed(1)}°
                                </span>
                                <span style={{ fontSize: 'clamp(0.42rem, 2cqi, 0.54rem)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.38)' }}>
                                    OUT
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Groups grid ──────────────────────────────────────────────── */}
                <div
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: isLarge ? 'var(--space-3)' : 'var(--space-2)',
                        display: 'grid',
                        gridTemplateColumns: isLarge
                            ? 'repeat(auto-fill, minmax(15rem, 22rem))'
                            : '1fr',
                        justifyContent: 'center',
                        gap: isLarge ? 'var(--space-3)' : 'var(--space-2)',
                        alignContent: 'start',
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
                                    onModeToggle={handleModeToggle}
                                    onSetpointDelta={handleSetpointDelta}
                                    onFanCycle={handleFanCycle}
                                    isEditor={isEditor || isLocked}
                                />
                            );
                        })
                    )}
                </div>

                {/* ── Footer: active summary ───────────────────────────────────── */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-2) var(--space-4)',
                        borderTop: '1px solid var(--glass-l1-border)',
                        flexShrink: 0,
                    }}
                >
                    <span style={{ fontSize: 'clamp(0.44rem, 2cqi, 0.58rem)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.32)' }}>
                        {allGroups.filter(g => g.isOn).length}/{allGroups.length} active
                    </span>

                    {/* Mode + live dot summary */}
                    {anyActive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                            <span
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: primaryColorVar,
                                    boxShadow: `0 0 5px 1px color-mix(in srgb, ${primaryColorVar} 60%, transparent)`,
                                    animation: 'pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
                                    display: 'inline-block',
                                }}
                            />
                            <span style={{ fontSize: 'clamp(0.44rem, 2cqi, 0.58rem)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: primaryColorVar }}>
                                {MODE_ACCENT[primaryMode]?.label ?? primaryMode.toUpperCase()}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </TileWrapper>
    );
};

export default Ae200Tile;
