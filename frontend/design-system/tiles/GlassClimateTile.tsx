import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconFlame, IconSnowflake, IconPower, IconPlus, IconMinus } from '../../components/icons';
import { fluidIcon, fluidText4xl, fluidTextSm, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard, { GlassAccent } from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassClimateTile — liquid-glass thermostat tile: setpoint + mode + ambient.
//
// Live binding: `device.state` for a `climate.*` entity is shaped by
// `mapHaEntityToInternalDevice` as { mode, currentTemp, setpoint, fan }. Setpoint
// nudges and mode-cycle commit via `updateDeviceState`, which routes to
// `climate.set_temperature` / `climate.set_hvac_mode` through the existing HA
// service layer (the same realtime plumbing the legacy ThermostatTile uses).
//
// This is a DISPLAY/CONTROL binding for a homeowner's thermostat. The
// whole-home Airzone master/slave compilation view stays a separate curated
// experience; this placeable tile is the single-entity thermostat.
// ---------------------------------------------------------------------------

interface ClimateState {
  mode: string;
  currentTemp: number;
  setpoint: number;
  fan?: string;
}

const parse = (state: Device['state']): ClimateState => {
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const o = state as Record<string, any>;
    return {
      mode: typeof o.mode === 'string' ? o.mode : 'off',
      currentTemp: Number(o.currentTemp) || 0,
      setpoint: Number(o.setpoint) || 0,
      fan: o.fan,
    };
  }
  return { mode: typeof state === 'string' ? state : 'off', currentTemp: 0, setpoint: 0 };
};

// Cycle through the modes we can drive generically. HA accepts these for most
// climate entities; an unsupported mode surfaces an error from HA (not a fake).
const MODE_CYCLE = ['off', 'cool', 'heat'] as const;

const GlassClimateTile = ({
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
  const { updateDeviceState, requestPin } = useDashboardActions();
  const state = parse(device.state);
  const isLocked = !!tile.isLocked;
  const isUnavailable = device.isOnline === false;
  const isHeat = state.mode === 'heat' || state.mode === 'heat_cool';
  const isCool = state.mode === 'cool';
  const isActive = state.mode !== 'off' && state.mode !== 'unavailable';

  const accent: GlassAccent = isHeat ? 'heat' : isCool ? 'climate' : 'climate';

  const protectedAction = (action: () => void) => {
    if (isEditor || isLocked) return;
    if (tile.requirePin) requestPin(action);
    else action();
  };

  const nudge = (delta: number) =>
    protectedAction(() => updateDeviceState(device.id, { ...state, setpoint: state.setpoint + delta }));

  const cycleMode = () =>
    protectedAction(() => {
      const idx = MODE_CYCLE.indexOf(state.mode as (typeof MODE_CYCLE)[number]);
      const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      updateDeviceState(device.id, { ...state, mode: next });
    });

  const ModeIcon = isHeat ? IconFlame : isCool ? IconSnowflake : IconPower;
  const modeColor = isHeat ? 'var(--bp-accent-heat)' : isCool ? 'var(--bp-accent-climate)' : 'var(--bp-text-dim)';

  return (
    <GlassCard
      label={tile.label || ''}
      accent={accent}
      isActive={isActive}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isProtected={tile.requirePin}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ gap: 'clamp(0.1rem, 1.5cqmin, 0.35rem)' }}>
        <p className="bp-meta tabular-nums" style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)' }}>
          {isUnavailable ? '—' : `${state.currentTemp.toFixed(0)}° now`}
        </p>
        <div className="flex items-baseline" style={{ gap: '0.08em' }}>
          <span className="bp-readout tabular-nums" style={{ ...fluidText4xl, color: 'var(--bp-text-primary)' }}>
            {isUnavailable ? '—' : state.setpoint.toFixed(0)}
          </span>
          {!isUnavailable && <span className="bp-meta" style={{ ...fluidTextSm, color: 'var(--bp-text-secondary)' }}>°</span>}
        </div>
        <div className="flex items-center justify-center" style={{ gap: 'clamp(0.25rem, 3cqmin, 0.6rem)' }}>
          <button
            type="button"
            className="bp-scene-pill"
            style={{ padding: 'clamp(0.2rem,2.5cqmin,0.45rem)', opacity: isEditor || isLocked ? 0.5 : 1 }}
            disabled={isEditor || isLocked}
            onClick={(e) => { e.stopPropagation(); nudge(-1); }}
            aria-label="Lower setpoint"
          >
            <IconMinus style={fluidIcon(0.9)} />
          </button>
          <button
            type="button"
            style={{ padding: 'clamp(0.2rem,2.5cqmin,0.45rem)', opacity: isEditor || isLocked ? 0.5 : 1, background: 'none', border: 'none', cursor: isEditor || isLocked ? 'default' : 'pointer' }}
            disabled={isEditor || isLocked}
            onClick={(e) => { e.stopPropagation(); cycleMode(); }}
            aria-label="Cycle mode"
          >
            <ModeIcon
              style={{
                ...fluidIcon(1.2),
                color: modeColor,
                filter: isActive && !isUnavailable ? `drop-shadow(0 0 6px ${modeColor})` : undefined,
              }}
            />
          </button>
          <button
            type="button"
            className="bp-scene-pill"
            style={{ padding: 'clamp(0.2rem,2.5cqmin,0.45rem)', opacity: isEditor || isLocked ? 0.5 : 1 }}
            disabled={isEditor || isLocked}
            onClick={(e) => { e.stopPropagation(); nudge(1); }}
            aria-label="Raise setpoint"
          >
            <IconPlus style={fluidIcon(0.9)} />
          </button>
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassClimateTile;
