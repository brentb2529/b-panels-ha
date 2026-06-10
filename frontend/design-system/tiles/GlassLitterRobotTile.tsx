import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Device, TileConfig, LitterRobotState } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import * as haClient from '../../services/haClient';
import {
  IconCat,
  IconRefreshCw,
  IconMoon,
  IconSun,
  IconLock,
  IconLockOpen,
  IconClock,
  IconActivity,
} from '../../components/icons';
import { fluidTextXs, fluidTextSm, fluidTextLg } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';
import {
  projectLitterRobot,
  controlGate,
  controlServiceCall,
  lastCycleLabel,
  type LitterRobotControl,
} from './litterRobotLogic';

// ---------------------------------------------------------------------------
// GlassLitterRobotTile — the liquid-glass Whisker / Litter-Robot surface.
//
// LIVE BINDING: renders the composite `LitterRobotState` that `useDashboard`
// assembles from a robot's live HA entities (the Whisker standalone integration
// or HA core `litterrobot`): waste_drawer_level %, litter_level %,
// litter_level_state enum, scoops_saved_count, hopper_status, status_code,
// night_light / panel_lock switches, the start_cycle button. All math + status
// mapping live in `litterRobotLogic.ts` (pure + unit-tested).
//
// CONTROLS are LOW-HAZARD appliance actions (Start Cycle / Night-light / Panel
// Lock) — guarded by an in-tile PRESS-AND-HOLD confirm, NOT the hard
// pool/HVAC/AKVO/security equipment-gate. Nothing fires on a tap; the user must
// hold to commit. Sleep schedule / wait-time stay read-only here (use the
// integration's selects). Honest offline state (em-dash, no actuation).
// ---------------------------------------------------------------------------

const HOLD_MS = 800;

// A single press-and-hold control pill. Fills a progress ring over HOLD_MS;
// on completion it commits; releasing early aborts (nothing fires). This is the
// low-hazard confirm gate — deliberate, in-tile, no modal.
const HoldControl = ({
  icon,
  label,
  active,
  disabled,
  onCommit,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onCommit: () => void;
}) => {
  const [progress, setProgress] = useState(0);
  const [committing, setCommitting] = useState(false);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const committed = useRef(false);

  const cancel = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!committed.current) setProgress(0);
  }, []);

  const tick = useCallback(() => {
    const p = Math.min(1, (performance.now() - start.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      committed.current = true;
      setCommitting(true);
      onCommit();
      // brief settle, then reset the ring
      window.setTimeout(() => {
        committed.current = false;
        setCommitting(false);
        setProgress(0);
      }, 600);
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }, [onCommit]);

  const begin = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (disabled || committing) return;
    committed.current = false;
    start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [disabled, committing, tick]);

  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);

  const ringDeg = Math.round(progress * 360);
  const accentColor = active ? 'var(--bp-accent-lights)' : 'var(--bp-text-secondary)';

  return (
    <button
      type="button"
      className="bp-lr-hold"
      disabled={disabled}
      aria-label={`${label} (press and hold)`}
      title={`Hold to ${label.toLowerCase()}`}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.2rem',
        border: 'none',
        background: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        padding: 0,
        touchAction: 'none',
      }}
    >
      <span
        style={{
          position: 'relative',
          width: 'clamp(1.9rem, 13cqmin, 2.9rem)',
          height: 'clamp(1.9rem, 13cqmin, 2.9rem)',
          borderRadius: '9999px',
          display: 'grid',
          placeItems: 'center',
          background: `conic-gradient(var(--bp-accent-lights) ${ringDeg}deg, rgba(255,255,255,0.10) ${ringDeg}deg)`,
          transition: progress === 0 ? 'background 200ms ease' : undefined,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: '3px',
            borderRadius: '9999px',
            background: 'rgba(20,24,33,0.85)',
            display: 'grid',
            placeItems: 'center',
            color: accentColor,
          }}
        >
          {icon}
        </span>
      </span>
      <span style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)', lineHeight: 1 }}>{label}</span>
    </button>
  );
};

// Litter-Robot silhouette with a live status dot (the device "feels alive").
const DeviceGlyph = ({ color, cycling }: { color: string; cycling: boolean }) => (
  <div className="relative shrink-0" style={{ width: 'clamp(2.5rem, 24cqmin, 5.5rem)', aspectRatio: '1 / 1.05' }}>
    <svg viewBox="0 0 80 84" className="w-full h-full" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))' }}>
      <defs>
        <linearGradient id="glrBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#eef2f7" />
          <stop offset="100%" stopColor="#cfd8e3" />
        </linearGradient>
        <radialGradient id="glrWindow" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#2b3543" />
          <stop offset="45%" stopColor="#161d27" />
          <stop offset="100%" stopColor="#080b10" />
        </radialGradient>
        <linearGradient id="glrBase" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eef2f7" />
          <stop offset="100%" stopColor="#c2cbd8" />
        </linearGradient>
      </defs>
      <rect x="9" y="63" width="62" height="17" rx="5" fill="url(#glrBase)" stroke="#b6c0cf" strokeWidth="1" />
      <rect x="27" y="70" width="26" height="7" rx="2.5" fill="#aab4c2" />
      <rect x="5" y="9" width="70" height="60" rx="20" fill="url(#glrBody)" stroke="#c3cdd9" strokeWidth="1" />
      <ellipse cx="32" cy="16" rx="20" ry="5" fill="#ffffff" opacity="0.6" />
      <rect x="31" y="2" width="18" height="10" rx="4" fill="#2a3340" />
      <circle cx="40" cy="37" r="23" fill="url(#glrWindow)" stroke="#3a4654" strokeWidth="1.5">
        {cycling && (
          <animateTransform attributeName="transform" type="rotate" from="0 40 37" to="360 40 37" dur="3.2s" repeatCount="indefinite" />
        )}
      </circle>
      <ellipse cx="32" cy="28" rx="8" ry="4.5" fill="#4b5666" opacity="0.55" />
      <circle cx="62" cy="57" r="3.6" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
        {cycling && <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />}
      </circle>
    </svg>
  </div>
);

// Waste drawer — a container that fills bottom-up (the literal drawer filling).
const WasteFill = ({ pct, color }: { pct: number; color: string }) => (
  <div
    className="relative rounded-control overflow-hidden"
    style={{
      width: 'clamp(1.4rem, 9cqmin, 2.1rem)',
      height: 'clamp(2rem, 13cqmin, 3.1rem)',
      background: 'rgba(0,0,0,0.28)',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.5)',
    }}
  >
    <div
      className="absolute bottom-0 left-0 right-0"
      style={{
        height: `${pct}%`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%), ${color}`,
        transition: 'height 0.6s cubic-bezier(0.4,0,0.2,1)',
      }}
    />
  </div>
);

// Litter level — a globe (circle) that fills bottom-up with a subtle ripple.
const LitterBowl = ({ pct, color }: { pct: number; color: string }) => (
  <div
    className="relative rounded-full overflow-hidden"
    style={{
      width: 'clamp(2rem, 13cqmin, 3.1rem)',
      aspectRatio: '1 / 1',
      background: 'rgba(0,0,0,0.28)',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.5)',
    }}
  >
    <div
      className="absolute bottom-0 left-0 right-0"
      style={{
        height: `${pct}%`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0) 50%), ${color}`,
        transition: 'height 0.6s cubic-bezier(0.4,0,0.2,1)',
      }}
    />
  </div>
);

const Gauge = ({ label, value, valueColor, children }: {
  label: string; value: string; valueColor?: string; children: React.ReactNode;
}) => (
  <div className="flex flex-col items-center" style={{ gap: '0.25rem' }}>
    <span className="uppercase font-semibold" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>{label}</span>
    {children}
    <span className="font-bold tabular-nums" style={{ ...fluidTextXs, color: valueColor || 'var(--bp-text-secondary)' }}>{value}</span>
  </div>
);

const Chip = ({ icon, label, value, color }: { icon?: React.ReactNode; label: string; value: string; color?: string }) => (
  <div
    className="flex items-center"
    style={{
      gap: '0.3rem',
      padding: '0.15rem 0.45rem',
      borderRadius: '9999px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.08)',
    }}
  >
    {icon && <span style={{ color: color || 'var(--bp-text-secondary)', display: 'grid', placeItems: 'center' }}>{icon}</span>}
    <span style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>{label}</span>
    <span className="font-semibold tabular-nums" style={{ ...fluidTextXs, color: color || 'var(--bp-text-primary)' }}>{value}</span>
  </div>
);

const GlassLitterRobotTile = ({
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
  const { addNotification } = useDashboardActions();
  const state = device.state as LitterRobotState;
  const proj = projectLitterRobot(state);
  const isLocked = !!tile.isLocked;

  if (!proj) {
    return (
      <GlassCard label={tile.label || device.name} accent="climate" isEditor={isEditor} isLocked={isLocked} className={cornerClassName}>
        <div className="flex flex-col items-center justify-center" style={{ gap: '0.4rem', color: 'var(--bp-text-dim)' }}>
          <IconCat style={{ width: '1.75rem', height: '1.75rem', opacity: 0.5 }} />
          <span style={fluidTextSm}>—</span>
        </div>
      </GlassCard>
    );
  }

  const isUnavailable = !proj.isOnline;

  // Fire a confirmed (post-hold) control. The gate is re-checked here as
  // defense-in-depth even though the hold UI already enforces it.
  const runControl = (control: LitterRobotControl) => {
    const entityId =
      control === 'cycle' ? (state.haEntities?.startCycle || state.haEntities?.vacuum)
      : control === 'nightlight' ? state.haEntities?.nightLight
      : state.haEntities?.panelLock;
    const gate = controlGate({ isEditor, isLocked, isOnline: proj.isOnline, entityId });
    if (!gate.allowed) {
      addNotification(`${device.name}: control unavailable`, 'warning');
      return;
    }
    const call = controlServiceCall(control, state);
    if (!call) {
      addNotification(`${device.name}: control not available for this robot`, 'warning');
      return;
    }
    haClient.callService(call.domain, call.service, call.data)
      .then(() => addNotification(`${device.name}: ${labelFor(control)} sent`, 'success'))
      .catch((err: any) => addNotification(`${device.name}: ${err?.message || 'command failed'}`, 'error'));
  };

  const labelFor = (c: LitterRobotControl) =>
    c === 'cycle' ? 'cycle' : c === 'nightlight' ? (proj.nightLightOn ? 'light off' : 'light on') : (proj.panelLocked ? 'unlock' : 'lock');

  const canCycle = !!(state.haEntities?.startCycle || state.haEntities?.vacuum);
  const canLight = !!state.haEntities?.nightLight;
  const canLock = !!state.haEntities?.panelLock;
  const controlsDisabled = isEditor || isLocked || isUnavailable;

  const lastCycle = lastCycleLabel(state.lastCycleTime);

  return (
    <GlassCard
      label=""
      accent={proj.info.accent}
      isActive={proj.info.active}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col" style={{ gap: 'clamp(0.3rem, 2.5cqmin, 0.7rem)' }}>
        {/* Header: glyph + name + status pill */}
        <div className="flex items-center w-full" style={{ gap: 'clamp(0.4rem, 4cqmin, 0.9rem)' }}>
          <div className="relative flex items-center justify-center shrink-0">
            <div className="absolute rounded-full blur-xl pointer-events-none" style={{ width: '85%', height: '70%', background: proj.info.color, opacity: isUnavailable ? 0.15 : 0.35 }} />
            <DeviceGlyph color={proj.info.color} cycling={proj.status === 'CYCLING' && !isUnavailable} />
          </div>
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.2rem' }}>
            <h2 className="font-bold truncate leading-tight text-left" style={{ ...fluidTextLg, color: 'var(--bp-text-primary)' }}>{tile.label || device.name}</h2>
            <div className="flex items-center" style={{ gap: '0.4rem' }}>
              <span className="rounded-full shrink-0" style={{ width: '0.55rem', height: '0.55rem', background: proj.info.color, boxShadow: `0 0 8px ${proj.info.color}` }} />
              <span className="truncate" style={{ ...fluidTextSm, color: 'var(--bp-text-secondary)' }}>{isUnavailable ? 'Offline' : proj.info.label}</span>
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: '0.3rem', marginTop: '0.1rem' }}>
              {proj.scoopsSaved !== undefined && (
                <Chip icon={<IconActivity style={{ width: '0.8rem', height: '0.8rem' }} />} label="Scoops" value={isUnavailable ? '—' : String(proj.scoopsSaved)} />
              )}
              <Chip icon={<IconClock style={{ width: '0.8rem', height: '0.8rem' }} />} label="Cycle" value={isUnavailable ? '—' : lastCycle} />
            </div>
          </div>
        </div>

        {/* Gauges: waste drawer + litter level */}
        <div className="flex items-end justify-start" style={{ gap: 'clamp(0.8rem, 6cqmin, 1.6rem)' }}>
          <Gauge label="Waste" value={isUnavailable ? '—' : `${proj.wastePct}%`} valueColor={proj.wasteCritical ? '#f87171' : undefined}>
            <WasteFill pct={isUnavailable ? 0 : proj.wastePct} color={proj.wasteColor} />
          </Gauge>
          {proj.hasLitter && (
            <Gauge label="Litter" value={isUnavailable ? '—' : proj.litterWord} valueColor={proj.litterLow ? '#f87171' : undefined}>
              <LitterBowl pct={isUnavailable ? 0 : proj.litterPct} color={proj.litterColor} />
            </Gauge>
          )}
          {proj.hopperWord !== '—' && (
            <div className="flex flex-col items-center justify-end self-stretch" style={{ gap: '0.25rem' }}>
              <span className="uppercase font-semibold" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>Hopper</span>
              <span className="font-semibold" style={{ ...fluidTextSm, color: proj.hopperRemoved ? '#fbbf24' : 'var(--bp-text-secondary)' }}>{isUnavailable ? '—' : proj.hopperWord}</span>
            </div>
          )}
        </div>

        {/* Controls — press-and-hold (low-hazard appliance confirm) */}
        <div className="flex items-center justify-around mt-auto pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {canCycle && (
            <HoldControl
              icon={<IconRefreshCw style={{ width: '1rem', height: '1rem' }} />}
              label="Cycle"
              disabled={controlsDisabled}
              onCommit={() => runControl('cycle')}
            />
          )}
          {canLight && (
            <HoldControl
              icon={proj.nightLightOn ? <IconSun style={{ width: '1rem', height: '1rem' }} /> : <IconMoon style={{ width: '1rem', height: '1rem' }} />}
              label="Light"
              active={proj.nightLightOn}
              disabled={controlsDisabled}
              onCommit={() => runControl('nightlight')}
            />
          )}
          {canLock && (
            <HoldControl
              icon={proj.panelLocked ? <IconLock style={{ width: '1rem', height: '1rem' }} /> : <IconLockOpen style={{ width: '1rem', height: '1rem' }} />}
              label={proj.panelLocked ? 'Locked' : 'Lock'}
              active={proj.panelLocked}
              disabled={controlsDisabled}
              onCommit={() => runControl('panellock')}
            />
          )}
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassLitterRobotTile;
