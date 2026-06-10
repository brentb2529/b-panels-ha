import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconPower, IconPowerOff } from '../../components/icons';
import { fluidIcon, fluidTextXl } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassSwitchTile — liquid-glass on/off control for switch / input_boolean.
//
// LIVE BINDING: reads the normalized `device.state` (boolean, mapped from the
// HA `on`/`off` state by `mapHaEntityToInternalDevice`) and writes via
// `updateDeviceState` from `useDashboardActions` — the exact same realtime
// plumbing the legacy `SwitchTile` uses (optimistic write + WS reconcile +
// PIN/lock gating). Only the presentation changes to the locked design language.
// ---------------------------------------------------------------------------

const GlassSwitchTile = ({
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

  const isOn = !!device.state;
  const isUnavailable = device.isOnline === false;

  const handleClick = () => {
    if (isEditor || tile.isLocked) return;
    const action = () => updateDeviceState(device.id, !isOn);
    if (tile.requirePin) requestPin(action);
    else action();
  };

  const Icon = isOn ? IconPower : IconPowerOff;

  return (
    <GlassCard
      label={tile.label || ''}
      accent="lights"
      isActive={isOn}
      isUnavailable={isUnavailable}
      isLocked={tile.isLocked}
      isProtected={tile.requirePin}
      isEditor={isEditor}
      onClick={handleClick}
      className={cornerClassName}
    >
      <div className="flex flex-col items-center justify-center" style={{ gap: 'clamp(0.25rem, 3cqmin, 0.6rem)' }}>
        <Icon
          style={{
            ...fluidIcon(2),
            color: isOn ? 'var(--bp-accent-lights)' : 'var(--bp-text-dim)',
            filter: isOn && !isUnavailable ? 'drop-shadow(0 0 8px rgba(var(--bp-accent-lights-rgb),0.7))' : undefined,
            transition: 'color 200ms ease, filter 200ms ease',
          }}
        />
        <p
          className="bp-readout"
          style={{
            ...fluidTextXl,
            fontWeight: 500,
            color: isOn ? 'var(--bp-text-primary)' : 'var(--bp-text-secondary)',
          }}
        >
          {isUnavailable ? '—' : isOn ? 'On' : 'Off'}
        </p>
      </div>
    </GlassCard>
  );
};

export default GlassSwitchTile;
