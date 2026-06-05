import React, { useEffect, useState } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import TileSlider from './TileSlider';
import { IconActivity, IconPower, IconZap, IconChevronRight } from '../icons';
import { fluidIcon, fluidText2xl, fluidTextXs, fluidGap } from './tileScale';

// Fallback tile for Home Assistant entities whose domain isn't mapped to a
// bespoke tile (DeviceType.Generic). Presentation AND control are derived
// entirely from the inferred capability metadata (capabilityData.primary), so a
// new integration's entities show up — and work — immediately, with no
// per-integration code. The supported generic primaries:
//   toggle       -> on/off power button         (switch, fan, humidifier, …)
//   number       -> slider (min/max/step)       (number, input_number)
//   mode-select  -> tap-to-cycle option         (select, input_select)
//   press        -> momentary action button     (button, input_button)
//   <else>       -> formatted read-only value   (sensor, and anything niche)
//
// Follows the tile design language in CLAUDE.md: TileWrapper glass card, an
// icon-in-a-halo focal disc, fluid sizing, semantic accent, and a hue glow on
// the active state.

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
  const primary = data.primary as string | undefined;
  const controllable = data.controllable === true;
  // `unavailable` means the device/integration is offline — suppress controls
  // and grey the tile. `unknown` (e.g. a never-pressed button) is NOT offline.
  const isUnavailable = device.isOnline === false || device.state === 'unavailable';
  const interactive = controllable && !isUnavailable && !isEditor && !tile.isLocked;
  const sublabel = String(data.deviceClass || data.domain || '').replace(/_/g, ' ');

  // Wrap a control action with the optional per-tile PIN gate.
  const guard = (fn: () => void) => () => {
    if (!interactive) return;
    if (tile.requirePin) requestPin(fn);
    else fn();
  };

  // --- number: bounded slider (local state for smooth dragging) ------------
  const numericValue = typeof device.state === 'number' ? device.state : parseFloat(String(device.state));
  const [sliderLevel, setSliderLevel] = useState(Number.isNaN(numericValue) ? 0 : numericValue);
  useEffect(() => {
    const n = typeof device.state === 'number' ? device.state : parseFloat(String(device.state));
    if (!Number.isNaN(n)) setSliderLevel(n);
  }, [device.state]);

  if (primary === 'number') {
    const unit = typeof data.unit === 'string' ? data.unit : '';
    const min = typeof data.min === 'number' ? data.min : 0;
    const max = typeof data.max === 'number' ? data.max : 100;
    const step = typeof data.step === 'number' ? data.step : 1;
    return (
      <TileWrapper
        label={tile.label || device.name}
        isActive={false}
        accent="brand"
        isUnavailable={isUnavailable}
        isLocked={tile.isLocked}
        isEditor={isEditor}
        animation={tile.animation}
        className={cornerClassName}
        batteryLevel={device.battery}
      >
        <div className="w-full h-full flex flex-col">
          <div className="flex-1 flex flex-col justify-center items-center gap-1 w-full">
            <p className="font-bold tabular-nums text-gray-100" style={fluidText2xl}>
              {Number.isNaN(numericValue) ? '—' : `${sliderLevel}${unit ? ` ${unit}` : ''}`}
            </p>
            {sublabel && <p className="text-gray-400 capitalize" style={fluidTextXs}>{sublabel}</p>}
          </div>
          <div className="w-full px-2 pb-1">
            <TileSlider
              value={sliderLevel}
              min={min}
              max={max}
              step={step}
              accentColor="rgb(var(--accent))"
              onChange={(e) => setSliderLevel(parseFloat(e.target.value))}
              onCommit={guard(() => updateDeviceState(device.id, sliderLevel))}
              disabled={!interactive}
            />
          </div>
        </div>
      </TileWrapper>
    );
  }

  // --- mode-select: tap cycles to the next option --------------------------
  if (primary === 'mode-select') {
    const options: string[] = Array.isArray(data.options) ? data.options : [];
    const current = String(device.state ?? '');
    const cycle = () => {
      if (!options.length) return;
      const idx = options.indexOf(current);
      const next = options[(idx + 1) % options.length];
      updateDeviceState(device.id, next);
    };
    return (
      <TileWrapper
        label={tile.label || device.name}
        isActive={false}
        accent="brand"
        isUnavailable={isUnavailable}
        isLocked={tile.isLocked}
        isEditor={isEditor}
        animation={tile.animation}
        className={cornerClassName}
        batteryLevel={device.battery}
        onClick={interactive && options.length > 1 ? guard(cycle) : undefined}
      >
        <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
          <Halo active={false}>
            <IconChevronRight className="text-gray-300" style={fluidIcon(1.7)} />
          </Halo>
          <p className="font-bold text-center break-words leading-tight text-gray-100" style={fluidText2xl}>
            {current ? titleCase(current.replace(/_/g, ' ')) : '—'}
          </p>
          {options.length > 1 && <p className="text-gray-400" style={fluidTextXs}>tap to change</p>}
        </div>
      </TileWrapper>
    );
  }

  // --- press: momentary action button --------------------------------------
  if (primary === 'press') {
    return (
      <TileWrapper
        label={tile.label || device.name}
        isActive={false}
        accent="brand"
        isUnavailable={isUnavailable}
        isLocked={tile.isLocked}
        isEditor={isEditor}
        animation={tile.animation}
        className={cornerClassName}
        batteryLevel={device.battery}
        onClick={interactive ? guard(() => updateDeviceState(device.id, 'press')) : undefined}
      >
        <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
          <Halo active={false}>
            <IconZap className="text-gray-300" style={fluidIcon(1.7)} />
          </Halo>
          <p className="font-bold text-gray-100" style={fluidText2xl}>Press</p>
          {sublabel && <p className="text-gray-400 capitalize" style={fluidTextXs}>{sublabel}</p>}
        </div>
      </TileWrapper>
    );
  }

  // --- toggle: on/off power button -----------------------------------------
  const isToggle = controllable && primary === 'toggle';
  const isOn = isOnState(device.state);
  const active = isToggle && isOn;
  const value = isToggle ? (isOn ? 'On' : 'Off') : formatValue(device);
  const Icon = isToggle ? IconPower : IconActivity;

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
      onClick={isToggle && interactive ? guard(() => updateDeviceState(device.id, !isOn)) : undefined}
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
