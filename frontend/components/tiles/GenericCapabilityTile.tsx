import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconActivity, IconPower } from '../icons';
import { fluidIcon, fluidText2xl, fluidTextXs, fluidGap } from './tileScale';

// Fallback tile for Home Assistant entities whose domain isn't mapped to a
// bespoke tile (DeviceType.Generic). Presentation is derived from the inferred
// capability metadata so a new integration's entities show up immediately
// instead of falling through to UnknownTile.
//
// Controllable on/off entities (capabilityData.primary === 'toggle') are
// interactive and route through the generic turn_on/turn_off command path;
// everything else renders a read-only value. Follows the tile design language
// in CLAUDE.md: TileWrapper glass card, an icon-in-a-halo focal disc, fluid
// sizing, semantic accent, and a hue glow on the active state.

const ON_STATES = new Set(['on', 'open', 'home', 'playing', 'locked', 'active', 'true']);

const isOnState = (state: Device['state']): boolean =>
  state === true || (typeof state === 'string' && ON_STATES.has(state.toLowerCase()));

const titleCase = (s: string): string =>
  s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Turn the raw HA state into a human-readable value, appending the unit for
// numeric readings (e.g. "23.5 °C", "412 W") and tidying enum/blank states.
const formatValue = (device: Device): string => {
  const data = device.capabilityData || {};
  const unit = typeof data.unit === 'string' ? data.unit : undefined;
  const raw = device.state;

  if (typeof raw === 'boolean') return raw ? 'On' : 'Off';
  if (raw === '' || raw === null || raw === undefined) return '—';

  const str = String(raw);
  if (str === 'unavailable' || str === 'unknown') return titleCase(str);

  const num = Number(str);
  if (str.trim() !== '' && !Number.isNaN(num)) {
    return unit ? `${num} ${unit}` : `${num}`;
  }
  return titleCase(str.replace(/_/g, ' '));
};

// Dimensional focal disc behind the icon — a soft glass puck when idle, an
// accent-tinted glowing halo when active. Mirrors SensorTile's halo so generic
// tiles read as real focal cards, not flat icon+label boxes (per CLAUDE.md).
const Halo = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  const color = 'rgb(var(--accent))';
  return (
    <div
      className="relative flex items-center justify-center rounded-full"
      style={{
        width: 'clamp(2.75rem, 38cqmin, 5.5rem)',
        aspectRatio: '1 / 1',
        background: active
          ? `radial-gradient(circle at 38% 30%, color-mix(in srgb, ${color} 55%, transparent), color-mix(in srgb, ${color} 16%, transparent) 68%, transparent)`
          : 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.10), rgb(255 255 255 / 0.02) 70%, transparent)',
        border: `1px solid ${active ? `color-mix(in srgb, ${color} 55%, transparent)` : 'rgb(255 255 255 / 0.10)'}`,
        boxShadow: active
          ? `inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 24px -4px ${color}`
          : 'inset 0 1px 0 rgb(255 255 255 / 0.10), inset 0 -2px 6px rgb(0 0 0 / 0.22)',
        transition: 'background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
      }}
    >
      {children}
    </div>
  );
};

const GenericCapabilityTile = ({
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

  const data = device.capabilityData || {};
  const isToggle = data.controllable === true && data.primary === 'toggle';
  const isOn = isOnState(device.state);
  const active = isToggle && isOn;
  const value = isToggle ? (isOn ? 'On' : 'Off') : formatValue(device);
  const sublabel = String(data.deviceClass || data.domain || '').replace(/_/g, ' ');
  const isUnavailable = device.isOnline === false || device.state === 'unavailable';

  const Icon = isToggle ? IconPower : IconActivity;

  const handleClick = isToggle
    ? () => {
        if (isEditor || tile.isLocked) return;
        const action = () => updateDeviceState(device.id, !isOn);
        if (tile.requirePin) requestPin(action);
        else action();
      }
    : undefined;

  return (
    <TileWrapper
      label={tile.label || device.name}
      isActive={active}
      accent="brand"
      isUnavailable={isUnavailable}
      isLocked={tile.isLocked}
      isEditor={isEditor}
      animation={tile.animation}
      className={cornerClassName}
      batteryLevel={device.battery}
      onClick={handleClick}
    >
      <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
        <Halo active={active && !isUnavailable}>
          <Icon
            className={active ? 'text-white' : 'text-gray-300'}
            style={{
              ...fluidIcon(1.7),
              filter: active && !isUnavailable ? 'drop-shadow(0 0 6px rgb(var(--accent)))' : undefined,
            }}
          />
        </Halo>
        <p
          className={`font-bold tabular-nums text-center break-words leading-tight ${active ? 'text-white' : 'text-gray-100'}`}
          style={fluidText2xl}
        >
          {value}
        </p>
        {sublabel && (
          <p className="text-gray-400 capitalize" style={fluidTextXs}>
            {sublabel}
          </p>
        )}
      </div>
    </TileWrapper>
  );
};

export default GenericCapabilityTile;
