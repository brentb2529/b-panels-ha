import React from 'react';
import { Device, TileConfig } from '../../types';
import TileWrapper from './TileWrapper';
import { IconCat, IconActivity } from '../icons';
import { fluidIcon, fluidText2xl, fluidTextXs, fluidGap } from './tileScale';

// Robot-vacuum tile (Litter-Robot / Whisker and generic robot vacuums). Mirrors
// the original B-Panels litter-robot card: a focal robot icon in a status-tinted
// halo, a friendly activity label (Ready / Cleaning / …) and a status dot, plus
// the battery readout via TileWrapper. Litter-Robot waste/litter levels are
// their own HA sensor entities and render as their own value tiles.

// HA vacuum activity → friendly label + accent color.
const STATUS: Record<string, { text: string; color: string; dot: string; active: boolean }> = {
  docked:    { text: 'Ready',     color: '#86efac', dot: '#22c55e', active: false },
  idle:      { text: 'Ready',     color: '#86efac', dot: '#22c55e', active: false },
  cleaning:  { text: 'Cleaning',  color: '#7dd3fc', dot: '#38bdf8', active: true },
  returning: { text: 'Returning', color: '#7dd3fc', dot: '#38bdf8', active: true },
  paused:    { text: 'Paused',    color: '#fdba74', dot: '#fb923c', active: false },
  error:     { text: 'Error',     color: '#fca5a5', dot: '#ef4444', active: false },
};

const titleCase = (s: string) => s.length ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;

const Halo = ({ color, active, children }: { color: string; active: boolean; children: React.ReactNode }) => (
  <div
    className="relative flex items-center justify-center rounded-full"
    style={{
      width: 'clamp(2.75rem, 38cqmin, 5.5rem)',
      aspectRatio: '1 / 1',
      background: active
        ? `radial-gradient(circle at 38% 30%, color-mix(in srgb, ${color} 50%, transparent), color-mix(in srgb, ${color} 14%, transparent) 68%, transparent)`
        : 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.10), rgb(255 255 255 / 0.02) 70%, transparent)',
      border: `1px solid ${active ? `color-mix(in srgb, ${color} 55%, transparent)` : 'rgb(255 255 255 / 0.12)'}`,
      boxShadow: active
        ? `inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 22px -4px ${color}`
        : 'inset 0 1px 0 rgb(255 255 255 / 0.10), inset 0 -2px 6px rgb(0 0 0 / 0.22)',
    }}
  >
    {children}
  </div>
);

const VacuumTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
  const raw = String(device.state ?? '').toLowerCase();
  const status = STATUS[raw] || { text: titleCase(String(device.state ?? 'Unknown')), color: '#9ca3af', dot: '#9ca3af', active: false };
  const isLitter = /litter|whisker/i.test(device.name) || /litter|whisker/i.test(device.id);
  const Icon = isLitter ? IconCat : IconActivity;
  const isUnavailable = device.isOnline === false || raw === 'unavailable';

  return (
    <TileWrapper
      label={tile.label || device.name}
      isActive={status.active}
      accent="brand"
      isUnavailable={isUnavailable}
      isLocked={tile.isLocked}
      isEditor={isEditor}
      animation={tile.animation}
      className={cornerClassName}
      batteryLevel={device.battery}
    >
      <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
        <Halo color={status.color} active={status.active && !isUnavailable}>
          <Icon
            className={status.active ? 'text-white' : 'text-gray-200'}
            style={{ ...fluidIcon(1.9), filter: status.active && !isUnavailable ? `drop-shadow(0 0 6px ${status.color})` : undefined }}
          />
        </Halo>
        <div className="flex items-center" style={fluidGap(0.4)}>
          <span className="rounded-full" style={{ width: '0.5rem', height: '0.5rem', background: status.dot, boxShadow: `0 0 6px ${status.dot}` }} />
          <p className="font-bold text-gray-100" style={fluidText2xl}>{status.text}</p>
        </div>
        {device.battery !== undefined && (
          <p className="text-gray-400" style={fluidTextXs}>Battery {device.battery}%</p>
        )}
      </div>
    </TileWrapper>
  );
};

export default VacuumTile;
