import React, { useEffect, useState } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconLightbulb } from '../../components/icons';
import { fluidIcon, fluidText2xl } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassDimmerTile — liquid-glass brightness + on/off control for a dimmable
// light. Live-bound through the same `Device`/`useDashboardActions` plumbing as
// the legacy DimmerTile.
//
// `device.state` arrives in one of two shapes from
// `mapHaEntityToInternalDevice`:
//   - a plain number (0..100)            -> simple dimmer
//   - { level, isOn, hsColor?, colorTemp? } -> color/CT-capable light
// We read both. The brightness fill + the icon glow render in the LIVE light
// color when an hs_color is present (the locked "live color/brightness" cue),
// otherwise in the platinum Lights accent. Drag commits via updateDeviceState.
// ---------------------------------------------------------------------------

const hsToHex = (hs: [number, number]) => {
  const [h, s] = hs;
  const l = 0.55;
  const a = (s / 100) * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

interface Parsed {
  level: number;
  isOn: boolean;
  hsColor?: [number, number];
}

const parse = (state: Device['state']): Parsed => {
  if (typeof state === 'number') return { level: state, isOn: state > 0 };
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const o = state as Record<string, any>;
    const level = typeof o.level === 'number' ? o.level : 0;
    return {
      level,
      isOn: o.isOn ?? level > 0,
      hsColor: Array.isArray(o.hsColor) ? (o.hsColor as [number, number]) : undefined,
    };
  }
  return { level: 0, isOn: !!state };
};

const GlassDimmerTile = ({
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

  const [level, setLevel] = useState(parsed.level);
  const isUnavailable = device.isOnline === false;
  const isLocked = !!tile.isLocked;

  useEffect(() => {
    setLevel(parsed.level);
  }, [parsed.level]);

  const isOn = parsed.isOn ?? level > 0;
  // Live color cue: glow/fill in the actual bulb color when known.
  const liveColor = parsed.hsColor ? hsToHex(parsed.hsColor) : undefined;

  const commit = (newLevel: number, on = newLevel > 0) => {
    const payload: Device['state'] = isRich ? ({ level: newLevel, isOn: on } as any) : newLevel;
    const action = () => updateDeviceState(device.id, payload);
    if (tile.requirePin) requestPin(action);
    else action();
  };

  const onSlide = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isEditor || isLocked) return;
    setLevel(parseInt(e.target.value, 10));
  };
  const onCommit = () => {
    if (isEditor || isLocked) return;
    commit(level, level > 0);
  };
  const toggle = (e: React.MouseEvent) => {
    if (isEditor || isLocked) return;
    e.stopPropagation();
    const next = isOn ? 0 : level > 0 ? level : 100;
    setLevel(next);
    commit(next, !isOn);
  };

  const fillColor = liveColor
    ? `linear-gradient(90deg, ${liveColor}99, ${liveColor})`
    : 'linear-gradient(90deg, rgba(var(--bp-accent-lights-rgb),0.65), rgba(var(--bp-accent-lights-rgb),1))';

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
      <div className="w-full h-full flex flex-col justify-between" style={{ gap: 'clamp(0.25rem, 3cqmin, 0.6rem)' }}>
        <div
          className="flex-1 flex flex-col justify-center items-center w-full min-h-0"
          style={{ gap: 'clamp(0.125rem, 2cqmin, 0.5rem)', cursor: isEditor || isLocked ? 'default' : 'pointer' }}
          onClick={toggle}
        >
          <IconLightbulb
            style={{
              ...fluidIcon(1.9),
              color: isOn ? liveColor || 'var(--bp-accent-lights)' : 'var(--bp-text-dim)',
              filter:
                isOn && !isUnavailable
                  ? `drop-shadow(0 0 8px ${liveColor || 'rgba(var(--bp-accent-lights-rgb),0.7)'})`
                  : undefined,
              transition: 'color 200ms ease, filter 200ms ease',
            }}
          />
          <p
            className="bp-readout"
            style={{ ...fluidText2xl, color: isOn ? 'var(--bp-text-primary)' : 'var(--bp-text-secondary)' }}
          >
            {isUnavailable ? '—' : isOn ? `${level}%` : 'Off'}
          </p>
        </div>

        <div className="w-full px-1 pb-1">
          <div className="bp-track" style={{ height: 'clamp(6px, 5cqmin, 9px)' }}>
            <div className="bp-track-fill" style={{ width: `${level}%`, background: fillColor }} />
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
              aria-label={`${tile.label || device.name} brightness`}
            />
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassDimmerTile;
