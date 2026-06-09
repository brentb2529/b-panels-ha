// One independent climate zone, rendered as a wall-legible Liquid Glass card.
//
// Shows: room name, current temperature, current humidity (if known), the
// target setpoint (large, primary), hvac_mode, fan_mode (if supported), and the
// live hvac_action/running state. All controls are optimistic — the parent
// surface fires the HA service and reconciles against real state — and are
// disabled when the zone is unavailable so we never command an offline zone.
//
// VISUAL: Liquid Glass / Apple design system. All functionality, data bindings,
// optimistic control logic, and master/slave semantics are unchanged.

import React from 'react';
import type { ClimateZone, ZoneRole } from '../../services/climate';
import {
    IconFlame,
    IconSnowflake,
    IconPower,
    IconFan,
    IconDroplets,
    IconThermometer,
    IconWifiOff,
    IconActivity,
} from '../icons';
import { AnimatedFan, BuildBar, LivingModeIcon } from '../../design-system';

// ── Mode accent mapping ────────────────────────────────────────────────────
type Accent = 'heat' | 'cool' | 'auto' | 'dry' | 'fan' | 'off';

function accentFor(mode: string): { accent: Accent; colorVar: string } {
    switch (mode) {
        case 'heat':       return { accent: 'heat', colorVar: 'var(--accent-warn)' };
        case 'cool':       return { accent: 'cool', colorVar: 'var(--accent-water)' };
        case 'heat_cool':
        case 'auto':       return { accent: 'auto', colorVar: 'var(--accent-plug)' };
        case 'dry':        return { accent: 'dry',  colorVar: 'var(--accent-light)' };
        case 'fan_only':   return { accent: 'fan',  colorVar: 'var(--accent)' };
        default:           return { accent: 'off',  colorVar: 'var(--glass-l3-bg)' };
    }
}

function modeLabel(mode: string): string {
    switch (mode) {
        case 'heat_cool': return 'Heat/Cool';
        case 'fan_only':  return 'Fan';
        default:          return mode.charAt(0).toUpperCase() + mode.slice(1);
    }
}

function ModeIcon({ mode, style }: { mode: string; style?: React.CSSProperties }) {
    switch (mode) {
        case 'heat':     return <IconFlame     style={style} />;
        case 'cool':     return <IconSnowflake style={style} />;
        case 'dry':      return <IconDroplets  style={style} />;
        case 'fan_only': return <IconFan       style={style} />;
        case 'heat_cool':
        case 'auto':     return <IconActivity  style={style} />;
        default:         return <IconPower     style={style} />;
    }
}

function actionMeta(action: string | null): { label: string; colorVar: string } | null {
    switch (action) {
        case 'heating':    return { label: 'Heating',   colorVar: 'var(--accent-warn)' };
        case 'cooling':    return { label: 'Cooling',   colorVar: 'var(--accent-water)' };
        case 'drying':     return { label: 'Drying',    colorVar: 'var(--accent-light)' };
        case 'fan':        return { label: 'Fan',       colorVar: 'var(--accent)' };
        case 'idle':       return { label: 'Idle',      colorVar: 'rgba(var(--text) / 0.3)' };
        case 'off':        return { label: 'Off',       colorVar: 'rgba(var(--text) / 0.3)' };
        case 'preheating': return { label: 'Preheating',colorVar: 'var(--accent-warn)' };
        case 'defrosting': return { label: 'Defrosting',colorVar: 'var(--accent-water)' };
        default:           return null;
    }
}

function clampStep(value: number, step: number, min: number, max: number): number {
    const snapped = Math.round(value / step) * step;
    const fixed   = parseFloat(snapped.toFixed(2));
    return Math.min(max, Math.max(min, fixed));
}

// Normalize a fan_mode string to a 0..1 speed level for AnimatedFan's spin rate.
// Handles named speeds (low/medium/high/auto) and ordinal position in fanModes
// (e.g. ["quiet","1","2","3","4","auto"]) so the blades spin faster on higher
// settings. Falls back to a moderate default when it can't be inferred.
function fanLevel(fanMode: string | null, fanModes: string[]): number {
    if (!fanMode) return 0.6;
    const m = fanMode.toLowerCase();
    if (m.includes('low') || m === 'min' || m === 'quiet' || m === 'silent') return 0.35;
    if (m.includes('mid') || m === 'medium' || m === 'auto') return 0.6;
    if (m.includes('high') || m === 'max' || m === 'turbo' || m === 'strong') return 0.95;
    // Numeric/ordinal: position within the list → 0.3..1.0
    const idx = fanModes.indexOf(fanMode);
    if (idx >= 0 && fanModes.length > 1) {
        return 0.3 + (idx / (fanModes.length - 1)) * 0.7;
    }
    const n = parseFloat(m);
    if (Number.isFinite(n)) return Math.max(0.3, Math.min(1, n / 5));
    return 0.6;
}

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
    zone: ClimateZone;
    onSetTemperature: (entityId: string, temperature: number) => void;
    onCycleHvacMode: (next: string) => void;
    onSetFanMode: (entityId: string, fanMode: string) => void;
    role?: ZoneRole;
    masterName?: string;
    modeRouted?: boolean;
    nested?: boolean;
}

// ── Stepper button — a glass bead control ─────────────────────────────────
const StepBtn = ({
    label,
    symbol,
    disabled,
    onClick,
}: {
    label: string;
    symbol: string;
    disabled: boolean;
    onClick: () => void;
}) => (
    <button
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        style={{
            width: '2.75rem',
            height: '2.75rem',
            minWidth: '2.75rem',
            borderRadius: 'var(--radius-pill)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            fontWeight: 300,
            lineHeight: 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.35 : 1,
            // Level-3 glass bead: strong specular + beveled rim so it catches light
            backdropFilter:       'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)',
            backgroundImage: 'var(--sheen-default), var(--specular-strong), var(--glass-l3-tint)',
            border: '1px solid var(--glass-l3-border)',
            boxShadow: 'var(--rim), var(--elev-2)',
            color: 'rgb(var(--text))',
            transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1)), opacity 80ms ease',
            // Active state via CSS (no JS needed)
        }}
        onPointerDown={(e) => {
            if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)';
        }}
        onPointerUp={(e) => {
            (e.currentTarget as HTMLElement).style.transform = '';
        }}
        onPointerLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = '';
        }}
    >
        {symbol}
    </button>
);

// ── Main tile component ────────────────────────────────────────────────────
const RoomClimateTile = ({
    zone,
    onSetTemperature,
    onCycleHvacMode,
    onSetFanMode,
    role = 'standalone',
    masterName,
    modeRouted = false,
    nested = false,
}: Props) => {
    const { colorVar } = accentFor(zone.hvacMode);
    const isOff      = zone.hvacMode === 'off';
    const disabled   = !zone.available;
    const action     = actionMeta(zone.hvacAction);
    const isRunning  = zone.hvacAction === 'heating'
                    || zone.hvacAction === 'cooling'
                    || zone.hvacAction === 'drying'
                    || zone.hvacAction === 'fan';

    const isSlave            = role === 'slave';
    const modeControlDisabled = disabled || zone.hvacModes.length === 0 || (isSlave && !modeRouted);

    const displaySetpoint =
        zone.targetTemperature ??
        (zone.targetTempLow != null && zone.targetTempHigh != null
            ? (zone.targetTempLow + zone.targetTempHigh) / 2
            : null);

    const canStep = zone.supportsTargetTemp && zone.targetTemperature != null && !disabled && !isOff;

    const step = (delta: number) => {
        if (!canStep || zone.targetTemperature == null) return;
        const next = clampStep(zone.targetTemperature + delta, zone.tempStep, zone.minTemp, zone.maxTemp);
        if (next !== zone.targetTemperature) onSetTemperature(zone.entityId, next);
    };

    const cycleMode = () => {
        if (modeControlDisabled) return;
        const idx  = zone.hvacModes.indexOf(zone.hvacMode);
        const next = zone.hvacModes[(idx + 1) % zone.hvacModes.length];
        onCycleHvacMode(next);
    };

    const cycleFan = () => {
        if (disabled || !zone.supportsFanMode || zone.fanModes.length === 0) return;
        const idx  = zone.fanMode ? zone.fanModes.indexOf(zone.fanMode) : -1;
        const next = zone.fanModes[(idx + 1) % zone.fanModes.length];
        onSetFanMode(zone.entityId, next);
    };

    const unit = zone.temperatureUnit || '°C';

    // Derive glass material state for the card:
    // - Active (not off, not disabled): bleed accent color into the glass
    // - Off / disabled: neutral glass
    const activeGlass = !isOff && !disabled;

    // Running zones glow strongest (the equipment is actively heating/cooling);
    // active-but-idle zones get a softer halo; off/disabled stay neutral.
    const cardBg = activeGlass
        ? `color-mix(in srgb, ${colorVar} 20%, var(--glass-l2-bg))`
        : 'var(--glass-l2-bg)';

    const cardBorder = activeGlass
        ? `color-mix(in srgb, ${colorVar} 58%, var(--glass-l2-border))`
        : 'var(--glass-l2-border)';

    // Readable luminous halo: inner accent wash + crisp accent edge + a soft
    // outer color halo so heat zones glow warm / cool zones glow cool. Running
    // zones push the outer halo wider/brighter for an at-a-glance "this is on".
    const haloSpread = isRunning ? '34px' : '24px';
    const haloPct    = isRunning ? 52 : 38;
    const cardGlow = activeGlass
        ? [
              `inset 0 0 40px -8px color-mix(in srgb, ${colorVar} 38%, transparent)`,
              `0 0 0 1px color-mix(in srgb, ${colorVar} 40%, transparent)`,
              `0 0 ${haloSpread} -4px color-mix(in srgb, ${colorVar} ${haloPct}%, transparent)`,
              `var(--elev-3)`,
          ].join(', ')
        : 'var(--elev-2)';

    // Temp-toward-setpoint progress: position of current temp on the zone's
    // operating range, so the animated bar reads "where the room is" between
    // min and max. Null when we don't have a current reading.
    const tempProgress =
        zone.currentTemperature != null
            ? { value: zone.currentTemperature, min: zone.minTemp, max: zone.maxTemp }
            : null;

    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
                borderRadius: 'var(--radius-card)',
                overflow: 'hidden',
                padding: 'var(--space-3)',
                opacity: disabled ? 0.55 : 1,
                filter: disabled ? 'grayscale(0.7)' : undefined,
                minHeight: nested ? '12.5rem' : '13.5rem',
                height: '100%',
                // Container so the body can switch row→column by card width.
                containerType: 'inline-size',
                // Liquid Glass level-2 material: luminous backdrop + sheen + rim
                backdropFilter:       'var(--glass-l2-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
                backgroundColor: cardBg,
                backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
                border: `1px solid ${cardBorder}`,
                boxShadow: `var(--rim), ${cardGlow}`,
                // Spring transition on mode/state changes
                transition: [
                    `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                    `border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                    `box-shadow var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                    `opacity var(--dur-medium, 260ms) ease`,
                    `filter var(--dur-medium, 260ms) ease`,
                ].join(', '),
            }}
        >
            {/* ── Header: name + role badge + running state ─────────────── */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 'var(--space-2)',
                    flexShrink: 0,
                }}
            >
                {/* Left: name + role badge (the mode glyph lives in the rail) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <h3
                        style={{
                            margin: 0,
                            fontFamily: 'var(--font-display)',
                            fontSize: 'var(--type-md)',
                            fontWeight: 600,
                            letterSpacing: 'var(--tracking-tight)',
                            color: 'rgb(var(--text))',
                            lineHeight: 1.2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {zone.name}
                    </h3>

                    {/* Master badge */}
                    {role === 'master' && (
                        <span
                            style={{
                                flexShrink: 0,
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-chip)',
                                fontSize: 'var(--type-2xs)',
                                fontWeight: 700,
                                letterSpacing: 'var(--tracking-caps)',
                                textTransform: 'uppercase',
                                color: 'var(--accent)',
                                backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
                            }}
                            title="Master zone — controls the mode for its slave zones"
                        >
                            Master
                        </span>
                    )}

                    {/* Slave badge */}
                    {role === 'slave' && (
                        <span
                            style={{
                                flexShrink: 0,
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-chip)',
                                fontSize: 'var(--type-2xs)',
                                fontWeight: 600,
                                letterSpacing: 'var(--tracking-caps)',
                                textTransform: 'uppercase',
                                color: 'rgba(var(--text) / 0.55)',
                                backgroundColor: 'var(--glass-l3-bg)',
                                border: '1px solid var(--glass-l3-border)',
                            }}
                            title={masterName ? `Slave zone of ${masterName}` : 'Slave zone'}
                        >
                            Slave
                        </span>
                    )}
                </div>

                {/* Right: status badge */}
                {disabled ? (
                    <span
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 'var(--type-2xs)',
                            fontWeight: 600,
                            letterSpacing: 'var(--tracking-caps)',
                            textTransform: 'uppercase',
                            color: 'rgba(var(--text) / 0.38)',
                            flexShrink: 0,
                        }}
                    >
                        <IconWifiOff style={{ width: 11, height: 11 }} />
                        Offline
                    </span>
                ) : action ? (
                    <span
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-pill)',
                            fontSize: 'var(--type-2xs)',
                            fontWeight: 700,
                            letterSpacing: 'var(--tracking-caps)',
                            textTransform: 'uppercase',
                            flexShrink: 0,
                            color: action.colorVar,
                            backgroundColor: `color-mix(in srgb, ${action.colorVar} 14%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${action.colorVar} 30%, transparent)`,
                            transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                        }}
                    >
                        {isRunning && (
                            <span
                                style={{
                                    width: 5,
                                    height: 5,
                                    borderRadius: '50%',
                                    backgroundColor: action.colorVar,
                                    animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
                                    display: 'inline-block',
                                    boxShadow: `0 0 5px 1px ${action.colorVar}`,
                                }}
                            />
                        )}
                        {action.label}
                    </span>
                ) : null}
            </div>

            {/* ── Instrument body: telemetry rail | control console ───────
                A wrapping flex: side-by-side when the card is wide enough,
                stacked when narrow (mobile / nested). The rail leads with the
                prominent animated fan/mode glyph + telemetry meters; the console
                holds the setpoint hero and its controls. flex-wrap + min-widths
                give a responsive two-region layout with no media query. */}
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--space-3)',
                    alignItems: 'stretch',
                    minHeight: 0,
                }}
            >
                {/* Telemetry rail */}
                <div
                    style={{
                        flex: '1 1 7.5rem',
                        minWidth: '7rem',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-3)',
                        borderRadius: 'var(--radius-control)',
                        padding: 'var(--space-3) var(--space-2)',
                        // Faint inset well so the rail reads as an instrument cluster.
                        backgroundColor: 'color-mix(in srgb, rgb(var(--text)) 4%, transparent)',
                        boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.10)',
                    }}
                >
                    {/* Prominent animated mode/fan glyph */}
                    <LivingModeIcon
                        mode={zone.hvacMode}
                        active={isRunning}
                        colorVar={colorVar}
                        style={{ flexShrink: 0 }}
                    >
                        {zone.hvacMode === 'fan_only' || (zone.hvacAction === 'fan') ? (
                            <AnimatedFan
                                active={isRunning}
                                rpmLevel={fanLevel(zone.fanMode, zone.fanModes)}
                                size={56}
                                colorVar={isOff || disabled ? 'rgba(var(--text) / 0.30)' : colorVar}
                                title="Fan running"
                            />
                        ) : (
                            <ModeIcon
                                mode={zone.hvacMode}
                                style={{
                                    width: 48,
                                    height: 48,
                                    color: isOff || disabled ? 'rgba(var(--text) / 0.30)' : colorVar,
                                    filter: isRunning ? `drop-shadow(0 0 9px ${colorVar})` : undefined,
                                    transition: `color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                                }}
                            />
                        )}
                    </LivingModeIcon>

                    {/* Telemetry meters: temp-on-range + humidity */}
                    {(tempProgress || zone.currentHumidity != null) && (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {tempProgress && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--type-2xs)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.4)' }}>
                                            <IconThermometer style={{ width: 10, height: 10, opacity: 0.7 }} /> Temp
                                        </span>
                                        <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'var(--type-xs)', fontWeight: 600, color: 'rgba(var(--text) / 0.7)' }}>
                                            {tempProgress.value.toFixed(1)}{unit}
                                        </span>
                                    </div>
                                    <BuildBar
                                        value={tempProgress.value}
                                        min={tempProgress.min}
                                        max={tempProgress.max}
                                        colorVar={activeGlass ? colorVar : 'rgba(var(--text) / 0.5)'}
                                        active={isRunning}
                                        height={6}
                                        label={`Temperature ${tempProgress.value.toFixed(1)}${unit}`}
                                    />
                                </div>
                            )}
                            {zone.currentHumidity != null && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--type-2xs)', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgba(var(--text) / 0.4)' }}>
                                            <IconDroplets style={{ width: 10, height: 10, opacity: 0.7 }} /> Humidity
                                        </span>
                                        <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'var(--type-xs)', fontWeight: 600, color: 'rgba(var(--text) / 0.7)' }}>
                                            {Math.round(zone.currentHumidity)}%
                                        </span>
                                    </div>
                                    <BuildBar
                                        value={zone.currentHumidity}
                                        min={0}
                                        max={100}
                                        colorVar="var(--accent-water)"
                                        active={zone.hvacAction === 'drying'}
                                        height={6}
                                        label={`Humidity ${Math.round(zone.currentHumidity)}%`}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Control console */}
                <div
                    style={{
                        flex: '1 1 9rem',
                        minWidth: '8.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-3)',
                        justifyContent: 'center',
                    }}
                >
                    {/* Setpoint hero with +/- steppers */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 'var(--space-2)',
                        }}
                    >
                        <StepBtn
                            label="Lower setpoint"
                            symbol="−"
                            disabled={!canStep}
                            onClick={() => step(-zone.tempStep)}
                        />

                        {/* Setpoint digit */}
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                lineHeight: 1,
                                gap: 3,
                                minWidth: 0,
                            }}
                        >
                            <div
                                style={{
                                    fontFamily: 'var(--font-numeric)',
                                    fontSize: 'var(--type-hero)',
                                    fontWeight: 700,
                                    letterSpacing: '-0.04em',
                                    color: activeGlass ? colorVar : 'rgba(var(--text) / 0.90)',
                                    textShadow: activeGlass
                                        ? `0 0 24px color-mix(in srgb, ${colorVar} 50%, transparent)`
                                        : undefined,
                                    transition: [
                                        `color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                                        `text-shadow var(--dur-medium, 260ms) ease`,
                                    ].join(', '),
                                }}
                            >
                                {displaySetpoint != null ? (
                                    <>
                                        {displaySetpoint.toFixed(zone.tempStep < 1 ? 1 : 0)}
                                        <span
                                            style={{
                                                fontSize: '0.38em',
                                                fontWeight: 500,
                                                opacity: 0.65,
                                                verticalAlign: 'super',
                                                letterSpacing: 0,
                                            }}
                                        >
                                            {unit}
                                        </span>
                                    </>
                                ) : (
                                    <span style={{ color: 'rgba(var(--text) / 0.28)', fontSize: '0.7em' }}>—</span>
                                )}
                            </div>

                            {zone.supportsTargetRange
                                && zone.targetTempLow  != null
                                && zone.targetTempHigh != null && (
                                <span
                                    style={{
                                        fontFamily: 'var(--font-numeric)',
                                        fontSize: 'var(--type-xs)',
                                        fontWeight: 500,
                                        color: 'rgba(var(--text) / 0.40)',
                                        letterSpacing: '-0.01em',
                                    }}
                                >
                                    {zone.targetTempLow.toFixed(0)}–{zone.targetTempHigh.toFixed(0)}{unit}
                                </span>
                            )}
                        </div>

                        <StepBtn
                            label="Raise setpoint"
                            symbol="+"
                            disabled={!canStep}
                            onClick={() => step(zone.tempStep)}
                        />
                    </div>

                    {/* Mode + fan selectors */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'stretch',
                            gap: 'var(--space-2)',
                        }}
                    >
                {/* Mode control */}
                {isSlave && !modeRouted ? (
                    // Slave whose mode can't be routed: read-only chip
                    <div
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                            borderRadius: 'var(--radius-control)',
                            padding: 'var(--space-2) var(--space-3)',
                            backdropFilter:       'var(--glass-l3-backdrop)',
                            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                            backgroundColor: 'var(--glass-l3-bg)',
                            backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                            border: '1px solid var(--glass-l3-border)',
                            boxShadow: 'var(--rim)',
                        }}
                        title={masterName ? `Mode is set by master zone ${masterName}` : 'Mode is set by the master zone'}
                    >
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                fontFamily: 'var(--font-body)',
                                fontSize: 'var(--type-sm)',
                                fontWeight: 600,
                                color: 'rgb(var(--text))',
                                letterSpacing: 'var(--tracking-tight)',
                            }}
                        >
                            <ModeIcon mode={zone.hvacMode} style={{ width: 14, height: 14 }} />
                            {modeLabel(zone.hvacMode)}
                        </span>
                        <span
                            style={{
                                fontSize: 'var(--type-2xs)',
                                fontWeight: 500,
                                letterSpacing: 'var(--tracking-caps)',
                                textTransform: 'uppercase',
                                color: 'rgba(var(--text) / 0.35)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                            }}
                        >
                            Follows {masterName || 'master'}
                        </span>
                    </div>
                ) : (
                    // Active mode button
                    <button
                        onClick={cycleMode}
                        disabled={modeControlDisabled}
                        title={isSlave && modeRouted && masterName ? `Sets the mode on master zone ${masterName}` : undefined}
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                            borderRadius: 'var(--radius-control)',
                            padding: 'var(--space-2) var(--space-3)',
                            cursor: modeControlDisabled ? 'not-allowed' : 'pointer',
                            opacity: modeControlDisabled ? 0.40 : 1,
                            // Level-3 glass, tinted + haloed by mode color when active
                            backdropFilter:       'var(--glass-l3-backdrop)',
                            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                            backgroundColor: !isOff && !disabled
                                ? `color-mix(in srgb, ${colorVar} 22%, var(--glass-l3-bg))`
                                : 'var(--glass-l3-bg)',
                            backgroundImage: 'var(--sheen-default), var(--specular-strong), var(--glass-l3-tint)',
                            border: `1px solid ${!isOff && !disabled
                                ? `color-mix(in srgb, ${colorVar} 48%, var(--glass-l3-border))`
                                : 'var(--glass-l3-border)'}`,
                            boxShadow: `var(--rim)${!isOff && !disabled
                                ? `, inset 0 0 18px -5px color-mix(in srgb, ${colorVar} 34%, transparent), 0 0 14px -4px color-mix(in srgb, ${colorVar} 42%, transparent)`
                                : ''}`,
                            transition: [
                                `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                                `border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                                `box-shadow var(--dur-medium, 260ms) ease`,
                                `transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))`,
                                `opacity 120ms ease`,
                            ].join(', '),
                        }}
                        onPointerDown={(e) => {
                            if (!modeControlDisabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
                        }}
                        onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                        onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                    >
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                fontFamily: 'var(--font-body)',
                                fontSize: 'var(--type-sm)',
                                fontWeight: 600,
                                letterSpacing: 'var(--tracking-tight)',
                                color: !isOff && !disabled ? colorVar : 'rgb(var(--text))',
                                transition: `color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                            }}
                        >
                            <ModeIcon
                                mode={zone.hvacMode}
                                style={{
                                    width: 14,
                                    height: 14,
                                    filter: isRunning ? `drop-shadow(0 0 4px ${colorVar})` : undefined,
                                }}
                            />
                            {modeLabel(zone.hvacMode)}
                        </span>
                        {isSlave && modeRouted && (
                            <span
                                style={{
                                    fontSize: 'var(--type-2xs)',
                                    fontWeight: 500,
                                    letterSpacing: 'var(--tracking-caps)',
                                    textTransform: 'uppercase',
                                    color: 'rgba(var(--text) / 0.38)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    maxWidth: '100%',
                                }}
                            >
                                via {masterName || 'master'}
                            </span>
                        )}
                    </button>
                )}

                {/* Fan mode button */}
                {zone.supportsFanMode && zone.fanModes.length > 0 && (
                    <button
                        onClick={cycleFan}
                        disabled={disabled}
                        title="Fan mode"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 5,
                            borderRadius: 'var(--radius-control)',
                            padding: 'var(--space-2) var(--space-3)',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.40 : 1,
                            // Level-3 glass
                            backdropFilter:       'var(--glass-l3-backdrop)',
                            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                            backgroundColor: 'var(--glass-l3-bg)',
                            backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l3-tint)',
                            border: '1px solid var(--glass-l3-border)',
                            boxShadow: 'var(--rim)',
                            fontFamily: 'var(--font-body)',
                            fontSize: 'var(--type-sm)',
                            fontWeight: 500,
                            color: 'rgba(var(--text) / 0.75)',
                            letterSpacing: 'var(--tracking-tight)',
                            whiteSpace: 'nowrap',
                            transition: [
                                `transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))`,
                                `opacity 120ms ease`,
                            ].join(', '),
                        }}
                        onPointerDown={(e) => {
                            if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
                        }}
                        onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                        onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                    >
                        <AnimatedFan
                            // The fan blows whenever the equipment is actively moving
                            // air: explicit fan action, OR heating/cooling/drying with
                            // the blower engaged. Spin speed reflects the fan level.
                            active={isRunning}
                            rpmLevel={fanLevel(zone.fanMode, zone.fanModes)}
                            size={15}
                            colorVar={disabled ? 'rgba(var(--text) / 0.4)' : 'currentColor'}
                            title={`Fan ${zone.fanMode ?? ''}`.trim()}
                        />
                        <span style={{ textTransform: 'capitalize' }}>
                            {zone.fanMode ?? 'Fan'}
                        </span>
                    </button>
                )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RoomClimateTile;
