import React, { useEffect, useRef, useState } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconSun } from '../../components/icons';
import { fluidIcon, fluidTextSm, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassSceneTile — liquid-glass scene activator (scene.turn_on).
//
// HONEST STATE: a scene has no "active" state in HA — it is a fire-and-forget
// action. So this tile shows NO persistent active/lit state. Instead it records
// the LAST time the user activated it FROM THIS TILE (the only thing we can know
// truthfully) and surfaces it as a "Activated <relative time>" subline, plus a
// brief radial glow pulse on tap (motion grammar "scene activation"). It never
// claims a scene is "on".
//
// Live binding: triggers via `triggerScene` from `useDashboardActions`, which
// routes to `scene.turn_on` through the same haClient.callService path the
// legacy SceneTile uses.
// ---------------------------------------------------------------------------

const relTime = (ts: number, now: number): string => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const GlassSceneTile = ({
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
  const { triggerScene, requestPin } = useDashboardActions();
  const isLocked = !!tile.isLocked;
  const isUnavailable = device.isOnline === false;

  // Last-activated tracking — client-side, the only truthful signal for a
  // stateless scene. Persists for the session; re-ticks the relative label.
  const [lastActivated, setLastActivated] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const [justFired, setJustFired] = useState(false);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    if (lastActivated === null) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, [lastActivated]);

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const fire = () => {
    triggerScene(device.id);
    setLastActivated(Date.now());
    setJustFired(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setJustFired(false), 700);
  };

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditor || isLocked) return;
    if (tile.requirePin) requestPin(fire);
    else fire();
  };

  return (
    <GlassCard
      label={tile.label || ''}
      accent="lights"
      // NOT bound to a fake "on" — only a brief post-tap flash drives the glow.
      isActive={justFired}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isProtected={tile.requirePin}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ gap: 'clamp(0.2rem, 3cqmin, 0.55rem)' }}>
        <IconSun
          style={{
            ...fluidIcon(2),
            color: justFired ? 'var(--bp-accent-lights)' : 'var(--bp-text-secondary)',
            filter: justFired ? 'drop-shadow(0 0 10px rgba(var(--bp-accent-lights-rgb),0.8))' : undefined,
            transition: 'color 300ms ease, filter 300ms ease',
          }}
        />

        <button
          type="button"
          onClick={handleTrigger}
          disabled={isEditor || isLocked}
          className="bp-scene-pill"
          style={{
            width: '100%',
            ...fluidTextSm,
            fontWeight: 600,
            color: 'var(--bp-text-primary)',
            padding: 'clamp(0.3rem, 4cqmin, 0.6rem) 0.5rem',
            opacity: isEditor || isLocked ? 0.6 : 1,
          }}
        >
          {justFired ? 'Activated' : 'Activate'}
        </button>

        <p className="bp-meta" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>
          {lastActivated === null ? 'Not activated yet' : `Activated ${relTime(lastActivated, Date.now())}`}
        </p>
      </div>
    </GlassCard>
  );
};

export default GlassSceneTile;
