import React, { useEffect, useState } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconLightbulb } from '../../components/icons';
import { fluidIcon, fluidText2xl, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassLightGroupTile — liquid-glass "group of lights" tile: a master on/off +
// dim plus an honest "N of M on" rollup when member counts are known.
//
// Live binding: binds to a single HA `light` GROUP entity (e.g. a HA `light`
// group helper or an integration-provided group). `device.state` arrives in the
// same shape as a dimmer (number, or { level, isOn }). The "N of M" rollup is
// shown only when the entity reports member counts in
// `capabilityData.groupOn`/`capabilityData.groupTotal` — we NEVER fabricate a
// count; absent that data the tile shows the master on/brightness alone.
// Master dim/toggle commit via `updateDeviceState` -> `light.turn_on/off`.
// ---------------------------------------------------------------------------

interface Parsed { level: number; isOn: boolean; }

const parse = (state: Device['state']): Parsed => {
  if (typeof state === 'number') return { level: state, isOn: state > 0 };
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const o = state as Record<string, any>;
    const level = typeof o.level === 'number' ? o.level : 0;
    return { level, isOn: o.isOn ?? level > 0 };
  }
  return { level: 0, isOn: !!state };
};

const GlassLightGroupTile = ({
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
  const parsed = parse(device.state);
  const isRich = typeof device.state === 'object' && device.state !== null && !Array.isArray(device.state);
  const isLocked = !!tile.isLocked;
  const isUnavailable = device.isOnline === false;

  const [level, setLevel] = useState(parsed.level);
  useEffect(() => { setLevel(parsed.level); }, [parsed.level]);

  const isOn = parsed.isOn;

  // Honest member rollup: only render counts the entity actually reports.
  const cap = (device.capabilityData || {}) as Record<string, any>;
  const groupOn = typeof cap.groupOn === 'number' ? cap.groupOn : undefined;
  const groupTotal = typeof cap.groupTotal === 'number' ? cap.groupTotal : undefined;
  const hasRollup = groupOn !== undefined && groupTotal !== undefined;

  const commit = (newLevel: number, on = newLevel > 0) => {
    const payload: Device['state'] = isRich ? ({ level: newLevel, isOn: on } as any) : newLevel;
    const action = () => updateDeviceState(device.id, payload);
    if (tile.requirePin) requestPin(action); else action();
  };

  const onSlide = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isEditor || isLocked) return;
    setLevel(parseInt(e.target.value, 10));
  };
  const onCommit = () => { if (!isEditor && !isLocked) commit(level, level > 0); };
  const toggle = (e: React.MouseEvent) => {
    if (isEditor || isLocked) return;
    e.stopPropagation();
    const next = isOn ? 0 : level > 0 ? level : 100;
    setLevel(next);
    commit(next, !isOn);
  };

  return (
    <GlassCard
      label={tile.label || ''}
      accent="lights"
      isActive={isOn}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isProtected={tile.requirePin}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col justify-between" style={{ gap: 'clamp(0.2rem, 2.5cqmin, 0.5rem)' }}>
        <div
          className="flex-1 flex flex-col justify-center items-center w-full min-h-0"
          style={{ gap: 'clamp(0.1rem, 1.5cqmin, 0.35rem)', cursor: isEditor || isLocked ? 'default' : 'pointer' }}
          onClick={toggle}
        >
          <IconLightbulb
            style={{
              ...fluidIcon(1.7),
              color: isOn ? 'var(--bp-accent-lights)' : 'var(--bp-text-dim)',
              filter: isOn && !isUnavailable ? 'drop-shadow(0 0 8px rgba(var(--bp-accent-lights-rgb),0.7))' : undefined,
              transition: 'color 200ms ease, filter 200ms ease',
            }}
          />
          <p className="bp-readout" style={{ ...fluidText2xl, color: isOn ? 'var(--bp-text-primary)' : 'var(--bp-text-secondary)' }}>
            {isUnavailable ? '—' : isOn ? `${level}%` : 'Off'}
          </p>
          <p className="bp-meta tabular-nums" style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)' }}>
            {isUnavailable ? '—' : hasRollup ? `${groupOn} of ${groupTotal} on` : isOn ? 'Group on' : 'Group off'}
          </p>
        </div>

        <div className="w-full px-1 pb-1">
          <div className="bp-track" style={{ height: 'clamp(6px, 5cqmin, 9px)' }}>
            <div className="bp-track-fill" style={{ width: `${level}%`, background: 'linear-gradient(90deg, rgba(var(--bp-accent-lights-rgb),0.65), rgba(var(--bp-accent-lights-rgb),1))' }} />
            <input
              type="range"
              className="bp-range"
              min={0}
              max={100}
              value={level}
              onChange={onSlide}
              onMouseUp={onCommit}
              onTouchEnd={onCommit}
              onClick={(e) => e.stopPropagation()}
              disabled={isEditor || isLocked}
              aria-label={`${tile.label || device.name} group brightness`}
            />
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassLightGroupTile;
