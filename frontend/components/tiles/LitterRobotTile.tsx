import React from 'react';
import { Device, TileConfig } from '../../types';
import TileWrapper from './TileWrapper';
import { IconCat, IconActivity } from '../icons';
import { fluidIcon, fluidTextXs, fluidGap } from './tileScale';

// Composite "robot" card (Litter-Robot / Whisker, and any vacuum-based device).
// useDashboard groups the device's vacuum + all its sensors/switches into one
// Device whose state is { status, stats[], isLitter }. This tile beautifies HA's
// standard (data-dense) litter-robot card into the B-Panels look: a focal icon +
// activity status, then a tidy grid of the remaining readouts (waste, litter,
// sleep mode, …). Stays live because the composite recomputes from member state.

interface RobotStat { id: string; label: string; value: string }
interface RobotState { status?: string; stats?: RobotStat[]; isLitter?: boolean }

const STATUS_LABEL: Record<string, { text: string; dot: string; active: boolean }> = {
  docked:    { text: 'Ready',     dot: '#22c55e', active: false },
  idle:      { text: 'Ready',     dot: '#22c55e', active: false },
  cleaning:  { text: 'Cleaning',  dot: '#38bdf8', active: true },
  returning: { text: 'Returning', dot: '#38bdf8', active: true },
  paused:    { text: 'Paused',    dot: '#fb923c', active: false },
  error:     { text: 'Error',     dot: '#ef4444', active: false },
};
const titleCase = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;

const LitterRobotTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
  const st = (device.state || {}) as RobotState;
  const raw = String(st.status ?? '').toLowerCase();
  const status = STATUS_LABEL[raw] || { text: titleCase(String(st.status ?? 'Unknown')), dot: '#9ca3af', active: false };
  const Icon = st.isLitter ? IconCat : IconActivity;
  const allStats = st.stats ?? [];
  const stats = allStats.slice(0, 6);
  const more = allStats.length - stats.length;
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
      <div className="flex flex-col w-full h-full" style={fluidGap(0.55)}>
        {/* Status header */}
        <div className="flex items-center" style={{ gap: 'clamp(0.4rem, 3cqmin, 0.75rem)' }}>
          <div
            className="flex items-center justify-center rounded-full shrink-0"
            style={{
              width: 'clamp(2rem, 22cqmin, 3.25rem)',
              aspectRatio: '1 / 1',
              background: status.active
                ? `radial-gradient(circle at 38% 30%, color-mix(in srgb, ${status.dot} 45%, transparent), transparent 70%)`
                : 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.02) 70%, transparent)',
              border: '1px solid rgb(255 255 255 / 0.12)',
            }}
          >
            <Icon className="text-gray-100" style={fluidIcon(1.4)} />
          </div>
          <div className="flex items-center min-w-0" style={{ gap: '0.4rem' }}>
            <span className="rounded-full shrink-0" style={{ width: '0.5rem', height: '0.5rem', background: status.dot, boxShadow: `0 0 6px ${status.dot}` }} />
            <p className="font-bold text-gray-100 truncate" style={{ fontSize: 'clamp(0.9rem, 7cqmin, 1.4rem)' }}>{status.text}</p>
          </div>
        </div>

        {/* Beautified stat grid */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 flex-1 min-h-0 content-start overflow-hidden" style={{ gap: 'clamp(0.3rem, 3cqmin, 0.6rem)' }}>
            {stats.map(s => (
              <div key={s.id} className="flex flex-col rounded-control bg-white/5 border border-white/10 px-2 py-1 min-w-0">
                <span className="text-gray-400 uppercase tracking-wide truncate" style={{ fontSize: 'clamp(0.45rem, 3cqmin, 0.65rem)' }} title={s.label}>{s.label}</span>
                <span className="text-gray-100 font-semibold truncate" style={{ fontSize: 'clamp(0.7rem, 4.5cqmin, 1rem)' }} title={s.value}>{s.value}</span>
              </div>
            ))}
            {more > 0 && (
              <div className="flex items-center text-gray-400" style={fluidTextXs}>+{more} more</div>
            )}
          </div>
        )}
      </div>
    </TileWrapper>
  );
};

export default LitterRobotTile;
