import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconArrowUp, IconArrowDown, IconBlinds } from '../../components/icons';
import { fluidIcon, fluidText2xl, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassShadeTile — liquid-glass cover/shade tile with a live position readout
// and an animated shade visualizer. Position binding is the cover's
// `current_position` (0..100), mapped into `device.state` (a plain number) by
// `mapHaEntityToInternalDevice`. Open/close/nudge commit via `updateDeviceState`,
// which routes to `cover.set_cover_position` through the existing HA service
// layer — the same realtime plumbing the legacy ShadeTile uses.
// ---------------------------------------------------------------------------

const numeric = (val: Device['state']): number => {
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val));
  return Number.isFinite(n) ? n : 0;
};

const GlassShadeTile = ({
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
  const level = Math.max(0, Math.min(100, Math.round(numeric(device.state))));
  const isLocked = !!tile.isLocked;
  const isUnavailable = device.isOnline === false;

  const move = (next: number) => {
    if (isEditor || isLocked) return;
    const clamped = Math.max(0, Math.min(100, next));
    const action = () => updateDeviceState(device.id, clamped);
    if (tile.requirePin) requestPin(action);
    else action();
  };

  const statusText = isUnavailable ? '—' : level >= 98 ? 'Open' : level <= 2 ? 'Closed' : `${level}%`;

  return (
    <GlassCard
      label={tile.label || ''}
      accent="lights"
      isActive={level > 2}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isProtected={tile.requirePin}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex items-stretch" style={{ gap: 'clamp(0.35rem, 4cqmin, 0.7rem)' }}>
        {/* Visualizer: a window with a descending shade. */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{
            width: '38%',
            borderRadius: 'clamp(6px, 4cqmin, 12px)',
            border: '1px solid rgba(var(--bp-accent-lights-rgb),0.25)',
            background: 'linear-gradient(180deg, rgba(120,170,210,0.18), rgba(120,170,210,0.04))',
            cursor: isEditor || isLocked ? 'default' : 'pointer',
          }}
          onClick={() => move(level > 50 ? 0 : 100)}
          title="Tap to toggle open/close"
        >
          <div
            className="absolute left-0 right-0 top-0"
            style={{
              height: `${100 - level}%`,
              background: 'linear-gradient(180deg, rgba(40,48,60,0.92), rgba(28,34,44,0.85))',
              borderBottom: '2px solid rgba(var(--bp-accent-lights-rgb),0.45)',
              transition: 'height 480ms cubic-bezier(0.22,0.61,0.36,1)',
            }}
          >
            <div
              className="w-full h-full"
              style={{ opacity: 0.12, background: 'repeating-linear-gradient(0deg, transparent, transparent 8px, #000 9px)' }}
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <IconBlinds style={{ ...fluidIcon(1.3), color: 'rgba(255,255,255,0.65)' }} />
          </div>
        </div>

        {/* Readout + controls. */}
        <div className="flex-1 flex flex-col justify-between min-w-0" style={{ gap: 'clamp(0.2rem, 2cqmin, 0.4rem)' }}>
          <p className="bp-readout" style={{ ...fluidText2xl, color: level > 2 ? 'var(--bp-text-primary)' : 'var(--bp-text-secondary)' }}>
            {statusText}
          </p>
          <div className="grid grid-cols-2" style={{ gap: 'clamp(0.2rem, 2cqmin, 0.4rem)' }}>
            <button
              type="button"
              className="bp-scene-pill"
              style={{ ...fluidTextXs, padding: 'clamp(0.2rem,2.5cqmin,0.45rem)', opacity: isEditor || isLocked ? 0.6 : 1 }}
              disabled={isEditor || isLocked}
              onClick={(e) => { e.stopPropagation(); move(100); }}
            >
              <IconArrowUp style={fluidIcon(0.85)} />
            </button>
            <button
              type="button"
              className="bp-scene-pill"
              style={{ ...fluidTextXs, padding: 'clamp(0.2rem,2.5cqmin,0.45rem)', opacity: isEditor || isLocked ? 0.6 : 1 }}
              disabled={isEditor || isLocked}
              onClick={(e) => { e.stopPropagation(); move(0); }}
            >
              <IconArrowDown style={fluidIcon(0.85)} />
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassShadeTile;
