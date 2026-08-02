// One independent climate zone, rendered as a wall-legible control card.
//
// Shows: room name, current temperature, current humidity (if known), the
// target setpoint (large, primary), hvac_mode, fan_mode (if supported), and the
// live hvac_action/running state. All controls are optimistic — the parent
// surface fires the HA service and reconciles against real state — and are
// disabled when the zone is unavailable so we never command an offline zone.
//
// Each tile drives EXACTLY its own entity. There is no shared/master mode: a
// multi-master system has one of these per zone, each independent.

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

type Accent = 'heat' | 'cool' | 'auto' | 'dry' | 'fan' | 'off';

// Map an hvac_mode to a semantic accent + the CSS-variable color so the card
// lights up in the right hue across all three themes (warn=orange for heat,
// water=blue for cool, etc.) instead of a hardcoded color.
function accentFor(mode: string): { accent: Accent; colorVar: string } {
    switch (mode) {
        case 'heat':
            return { accent: 'heat', colorVar: 'var(--accent-warn)' };
        case 'cool':
            return { accent: 'cool', colorVar: 'var(--accent-water)' };
        case 'heat_cool':
        case 'auto':
            return { accent: 'auto', colorVar: 'var(--accent-plug)' };
        case 'dry':
            return { accent: 'dry', colorVar: 'var(--accent-light)' };
        case 'fan_only':
            return { accent: 'fan', colorVar: 'var(--accent)' };
        default:
            return { accent: 'off', colorVar: 'var(--surface-control)' };
    }
}

function modeLabel(mode: string): string {
    switch (mode) {
        case 'heat_cool':
            return 'Heat/Cool';
        case 'fan_only':
            return 'Fan';
        default:
            return mode.charAt(0).toUpperCase() + mode.slice(1);
    }
}

function ModeIcon({ mode, className, style }: { mode: string; className?: string; style?: React.CSSProperties }) {
    switch (mode) {
        case 'heat':
            return <IconFlame className={className} style={style} />;
        case 'cool':
            return <IconSnowflake className={className} style={style} />;
        case 'dry':
            return <IconDroplets className={className} style={style} />;
        case 'fan_only':
            return <IconFan className={className} style={style} />;
        case 'heat_cool':
        case 'auto':
            return <IconActivity className={className} style={style} />;
        default:
            return <IconPower className={className} style={style} />;
    }
}

// hvac_action → short status label + a color for the running badge.
function actionMeta(action: string | null): { label: string; rgb: string } | null {
    switch (action) {
        case 'heating':
            return { label: 'Heating', rgb: 'var(--accent-warn)' };
        case 'cooling':
            return { label: 'Cooling', rgb: 'var(--accent-water)' };
        case 'drying':
            return { label: 'Drying', rgb: 'var(--accent-light)' };
        case 'fan':
            return { label: 'Fan', rgb: 'var(--accent)' };
        case 'idle':
            return { label: 'Idle', rgb: 'var(--surface-control)' };
        case 'off':
            return { label: 'Off', rgb: 'var(--surface-control)' };
        case 'preheating':
            return { label: 'Preheating', rgb: 'var(--accent-warn)' };
        case 'defrosting':
            return { label: 'Defrosting', rgb: 'var(--accent-water)' };
        default:
            return null;
    }
}

// Round to the entity's step, clamped to its bounds.
function clampStep(value: number, step: number, min: number, max: number): number {
    const snapped = Math.round(value / step) * step;
    const fixed = parseFloat(snapped.toFixed(2));
    return Math.min(max, Math.max(min, fixed));
}

interface Props {
    zone: ClimateZone;
    onSetTemperature: (entityId: string, temperature: number) => void;
    // Cycles this zone's hvac_mode to `next`; the parent handles slave→master
    // routing, so the tile only asks for the next mode.
    onCycleHvacMode: (next: string) => void;
    onSetFanMode: (entityId: string, fanMode: string) => void;
    // Topology role + mode-control state (resolved by the parent surface).
    role?: ZoneRole;
    // Display name of the owning master (for "mode follows <name>").
    masterName?: string;
    // True when this slave's mode change is routed to the master (control stays
    // enabled). When false AND role==='slave', the mode control is disabled and
    // we show "mode follows master".
    modeRouted?: boolean;
    // Compact variant for slaves nested under a master card.
    nested?: boolean;
}

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
    const { accent, colorVar } = accentFor(zone.hvacMode);
    const isOff = zone.hvacMode === 'off';
    const disabled = !zone.available;
    const action = actionMeta(zone.hvacAction);
    const isRunning = zone.hvacAction === 'heating' || zone.hvacAction === 'cooling' || zone.hvacAction === 'drying' || zone.hvacAction === 'fan';

    // A slave can change its mode ONLY when the parent can route the call to the
    // master entity (calling set_hvac_mode on a slave hard-fails today). When it
    // can't be routed, the control is disabled and we show "mode follows master".
    const isSlave = role === 'slave';
    const modeControlDisabled = disabled || zone.hvacModes.length === 0 || (isSlave && !modeRouted);

    // The displayed setpoint: single target, else the range midpoint.
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
        const idx = zone.hvacModes.indexOf(zone.hvacMode);
        const next = zone.hvacModes[(idx + 1) % zone.hvacModes.length];
        onCycleHvacMode(next);
    };

    const cycleFan = () => {
        if (disabled || !zone.supportsFanMode || zone.fanModes.length === 0) return;
        const idx = zone.fanMode ? zone.fanModes.indexOf(zone.fanMode) : -1;
        const next = zone.fanModes[(idx + 1) % zone.fanModes.length];
        onSetFanMode(zone.entityId, next);
    };

    const unit = zone.temperatureUnit || '°C';

    return (
        <div
            className="relative flex flex-col rounded-tile overflow-hidden bg-gray-700 transition-all duration-200"
            style={{
                border: `1px solid ${!isOff && !disabled ? colorVar : 'var(--tile-border)'}`,
                boxShadow:
                    !isOff && !disabled
                        ? `inset 0 1px 0 rgb(255 255 255 / 0.13), inset 0 -3px 7px rgb(0 0 0 / 0.22), inset 0 0 22px -6px ${colorVar}, var(--elev-1)`
                        : `inset 0 1px 0 rgb(255 255 255 / 0.13), inset 0 -3px 7px rgb(0 0 0 / 0.22), var(--elev-1)`,
                backgroundColor:
                    !isOff && !disabled
                        ? `color-mix(in srgb, ${colorVar} 16%, rgb(var(--surface) / var(--tile-alpha)))`
                        : `rgb(var(--surface) / var(--tile-alpha))`,
                opacity: disabled ? 0.6 : 1,
                filter: disabled ? 'grayscale(1)' : undefined,
                minHeight: nested ? '10.5rem' : '11.5rem',
            }}
        >
            {/* Header: room name + running badge */}
            <div className="flex items-start justify-between gap-2 px-3 pt-3">
                <div className="flex items-center gap-2 min-w-0">
                    <ModeIcon
                        mode={zone.hvacMode}
                        className="shrink-0"
                        style={{
                            width: '1.25rem',
                            height: '1.25rem',
                            color: isOff || disabled ? 'rgb(var(--text) / 0.45)' : colorVar,
                            filter: isRunning ? `drop-shadow(0 0 6px ${colorVar})` : undefined,
                        }}
                    />
                    <h3 className="font-bold text-white truncate text-base leading-tight">{zone.name}</h3>
                    {role === 'master' && (
                        <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                            style={{
                                color: 'var(--accent)',
                                backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                            }}
                            title="Master zone — controls the mode for its slave zones"
                        >
                            Master
                        </span>
                    )}
                    {role === 'slave' && (
                        <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-gray-300"
                            style={{ backgroundColor: 'rgb(var(--surface-control))', border: '1px solid var(--tile-border)' }}
                            title={masterName ? `Slave zone of ${masterName}` : 'Slave zone'}
                        >
                            Slave
                        </span>
                    )}
                </div>
                {disabled ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 shrink-0">
                        <IconWifiOff className="w-3.5 h-3.5" /> Offline
                    </span>
                ) : action ? (
                    <span
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0"
                        style={{
                            color: action.rgb,
                            backgroundColor: `color-mix(in srgb, ${action.rgb} 18%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${action.rgb} 35%, transparent)`,
                        }}
                    >
                        {isRunning && (
                            <span
                                className="rounded-full animate-pulse"
                                style={{ width: 6, height: 6, backgroundColor: action.rgb }}
                            />
                        )}
                        {action.label}
                    </span>
                ) : null}
            </div>

            {/* Current readings */}
            <div className="flex items-center gap-3 px-3 pt-1.5 text-gray-300">
                <span className="flex items-center gap-1 text-sm tabular-nums">
                    <IconThermometer className="w-4 h-4 opacity-70" />
                    {zone.currentTemperature != null ? `${zone.currentTemperature.toFixed(1)}${unit}` : '--'}
                </span>
                {zone.currentHumidity != null && (
                    <span className="flex items-center gap-1 text-sm tabular-nums">
                        <IconDroplets className="w-4 h-4 opacity-70" />
                        {Math.round(zone.currentHumidity)}%
                    </span>
                )}
            </div>

            {/* Setpoint stepper — the primary control */}
            <div className="flex-1 flex items-center justify-center gap-3 px-3 py-2">
                <button
                    aria-label="Lower setpoint"
                    onClick={() => step(-zone.tempStep)}
                    disabled={!canStep}
                    className="flex items-center justify-center rounded-full bg-gray-600 text-white text-2xl font-light leading-none active:scale-90 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ width: '2.75rem', height: '2.75rem', minWidth: '2.75rem' }}
                >
                    −
                </button>
                <div className="flex flex-col items-center leading-none">
                    <div className="font-bold text-white tabular-nums" style={{ fontSize: '2.5rem' }}>
                        {displaySetpoint != null ? (
                            <>
                                {displaySetpoint.toFixed(zone.tempStep < 1 ? 1 : 0)}
                                <span className="text-gray-400" style={{ fontSize: '0.45em' }}>
                                    {unit}
                                </span>
                            </>
                        ) : (
                            <span className="text-gray-500 text-2xl">—</span>
                        )}
                    </div>
                    {zone.supportsTargetRange && zone.targetTempLow != null && zone.targetTempHigh != null && (
                        <span className="text-[11px] text-gray-400 tabular-nums mt-0.5">
                            {zone.targetTempLow.toFixed(0)}–{zone.targetTempHigh.toFixed(0)}{unit}
                        </span>
                    )}
                </div>
                <button
                    aria-label="Raise setpoint"
                    onClick={() => step(zone.tempStep)}
                    disabled={!canStep}
                    className="flex items-center justify-center rounded-full bg-gray-600 text-white text-2xl font-light leading-none active:scale-90 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ width: '2.75rem', height: '2.75rem', minWidth: '2.75rem' }}
                >
                    +
                </button>
            </div>

            {/* Mode + fan selectors (tap to cycle) */}
            <div className="flex items-stretch gap-2 px-3 pb-3">
                {isSlave && !modeRouted ? (
                    // Slave whose mode can't be routed to a master entity: the
                    // integration hard-fails set_hvac_mode on a slave, so we show
                    // a read-only "mode follows master" chip instead of a control.
                    <div
                        className="flex-1 flex flex-col items-center justify-center rounded-control py-1.5 px-2"
                        style={{ backgroundColor: 'rgb(var(--surface-control))', border: '1px solid var(--tile-border)' }}
                        title={masterName ? `Mode is set by master zone ${masterName}` : 'Mode is set by the master zone'}
                    >
                        <span className="flex items-center gap-1.5 text-white font-semibold text-sm">
                            <ModeIcon mode={zone.hvacMode} style={{ width: '1rem', height: '1rem' }} />
                            {modeLabel(zone.hvacMode)}
                        </span>
                        <span className="text-[9px] text-gray-400 uppercase tracking-wider mt-0.5 truncate max-w-full">
                            Mode follows {masterName || 'master'}
                        </span>
                    </div>
                ) : (
                    <button
                        onClick={cycleMode}
                        disabled={modeControlDisabled}
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 rounded-control bg-gray-600 text-white font-semibold py-2.5 active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                            color: isOff || disabled ? undefined : colorVar,
                            border: `1px solid ${isOff || disabled ? 'transparent' : `color-mix(in srgb, ${colorVar} 40%, transparent)`}`,
                        }}
                        title={isSlave && modeRouted && masterName ? `Sets the mode on master zone ${masterName}` : undefined}
                    >
                        <span className="flex items-center gap-1.5">
                            <ModeIcon mode={zone.hvacMode} style={{ width: '1.1rem', height: '1.1rem' }} />
                            <span className="text-sm">{modeLabel(zone.hvacMode)}</span>
                        </span>
                        {isSlave && modeRouted && (
                            <span className="text-[9px] text-gray-300 uppercase tracking-wider truncate max-w-full">
                                via {masterName || 'master'}
                            </span>
                        )}
                    </button>
                )}
                {zone.supportsFanMode && zone.fanModes.length > 0 && (
                    <button
                        onClick={cycleFan}
                        disabled={disabled}
                        className="flex items-center justify-center gap-1.5 rounded-control bg-gray-600 text-gray-100 font-semibold py-2.5 px-3 active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Fan mode"
                    >
                        <IconFan
                            className={isRunning && zone.hvacAction === 'fan' ? 'animate-spin' : ''}
                            style={{ width: '1.1rem', height: '1.1rem' }}
                        />
                        <span className="text-sm capitalize">{zone.fanMode ?? 'Fan'}</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default RoomClimateTile;
