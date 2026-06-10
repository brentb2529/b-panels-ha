import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { subscribeEntities, callService } from '../../services/haClient';
import {
  IconDroplets,
  IconCloudRain,
  IconClock,
  IconPlay,
  IconPower,
  IconSun,
  IconActivity,
  IconAlertTriangle,
  IconCheck,
  IconPlus,
  IconMinus,
} from '../../components/icons';
import { fluidTextXs, fluidTextSm, fluidTextLg } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';
import {
  projectIrrigation,
  actuationGate,
  zoneRunCall,
  zoneStopCall,
  sceneRunCall,
  controllerToggleCall,
  remainingLabel,
  lastWateredLabel,
  moistureColor,
  clampDuration,
  type EntityMap,
  type ZoneView,
  type SceneView,
  type IrrigationProjection,
} from './rachioLogic';

// ---------------------------------------------------------------------------
// GlassIrrigationTile — the liquid-glass Rachio irrigation SURFACE.
//
// LIVE BINDING: this is a self-discovering surface. It owns ONE
// `subscribeEntities` subscription and discovers all `rachio_pro` zones from the
// live HA store (a zone = a `switch.*` carrying a `zone_number` attr — an
// integration shape, NOT a site id), groups them by their homeowner `location`
// attribute, and pairs each to its sibling soil-moisture / last-watered sensors.
// Controller standby / rain-delay switches, the rain-sensor + forecast, and
// sprinkler scenes are discovered the same way. NO site ids are hardcoded and
// there is NO area-registry read. All math/grouping/mapping live in
// `rachioLogic.ts` (pure + unit-tested).
//
// SAFETY (Rachio FINDINGS §7): every zone-run / scene-run / rain-delay / standby
// actuates a real valve = water (LOW-to-MODERATE hazard). EVERY actuating
// control is guarded by an in-tile PRESS-AND-HOLD confirm — nothing fires on a
// bare tap; the user must hold to commit. This is NOT the hard pool/HVAC/AKVO
// equipment-gate; it is a real, deliberate confirm (mirrors the Whisker
// low-hazard pattern). Honest offline state (em-dash, no actuation).
// ---------------------------------------------------------------------------

const HOLD_MS = 800;

// ── Press-and-hold confirm control ──────────────────────────────────────────
// Fills a conic progress ring over HOLD_MS; on completion it commits; releasing
// early aborts (nothing fires). The single confirm primitive for the whole
// surface (zone start/stop, scene run, rain-delay/standby).
const HoldButton = ({
  children,
  label,
  disabled,
  active,
  danger,
  onCommit,
  size = 'md',
}: {
  children: React.ReactNode;
  label?: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  onCommit: () => void;
  size?: 'sm' | 'md';
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
  const fill = danger ? 'var(--bp-critical-rgb)' : active ? 'var(--bp-positive-rgb)' : 'var(--bp-accent-pool-rgb)';
  const dim = size === 'sm' ? 'clamp(1.7rem, 9cqmin, 2.3rem)' : 'clamp(2rem, 11cqmin, 2.7rem)';

  return (
    <button
      type="button"
      className="bp-rachio-hold"
      disabled={disabled}
      aria-label={label ? `${label} (press and hold)` : 'press and hold'}
      title={label ? `Hold to ${label.toLowerCase()}` : 'Hold to confirm'}
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
        gap: '0.18rem',
        border: 'none',
        background: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        padding: 0,
        touchAction: 'none',
      }}
    >
      <span
        style={{
          position: 'relative',
          width: dim,
          height: dim,
          borderRadius: '9999px',
          display: 'grid',
          placeItems: 'center',
          background: `conic-gradient(rgb(${fill}) ${ringDeg}deg, rgba(255,255,255,0.10) ${ringDeg}deg)`,
          transition: progress === 0 ? 'background 180ms ease' : undefined,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: '3px',
            borderRadius: '9999px',
            background: active ? `rgba(${fill},0.22)` : 'rgba(20,24,33,0.88)',
            display: 'grid',
            placeItems: 'center',
            color: active ? `rgb(${fill})` : 'var(--bp-text-secondary)',
          }}
        >
          {children}
        </span>
      </span>
      {label && <span style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)', lineHeight: 1 }}>{label}</span>}
    </button>
  );
};

// ── A single zone row ────────────────────────────────────────────────────────
const ZoneRow = ({
  zone,
  duration,
  onRun,
  onStop,
  controlsDisabled,
}: {
  zone: ZoneView;
  duration: number;
  onRun: (z: ZoneView, durationMin: number) => void;
  onStop: (z: ZoneView) => void;
  controlsDisabled: boolean;
}) => {
  const unavailable = !zone.available;
  const remaining = remainingLabel(zone.remainingSec);
  return (
    <div
      className="bp-rachio-zone-row flex items-center"
      style={{
        gap: 'clamp(0.4rem, 3cqmin, 0.8rem)',
        padding: 'clamp(0.3rem, 2cqmin, 0.55rem) clamp(0.4rem, 3cqmin, 0.7rem)',
        borderRadius: 'var(--bp-radius-control, 12px)',
        background: zone.running ? 'rgba(56,189,248,0.10)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${zone.running ? 'rgba(56,189,248,0.30)' : 'rgba(255,255,255,0.07)'}`,
        opacity: unavailable ? 0.55 : 1,
      }}
    >
      {/* Watering animation puck — animated droplets when running, static when idle */}
      <span
        className="relative shrink-0"
        style={{
          width: 'clamp(1.5rem, 8cqmin, 2rem)',
          height: 'clamp(1.5rem, 8cqmin, 2rem)',
          borderRadius: '9999px',
          display: 'grid',
          placeItems: 'center',
          background: zone.running ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.05)',
          color: zone.running ? '#38bdf8' : 'var(--bp-text-dim)',
          overflow: 'hidden',
        }}
      >
        <IconDroplets style={{ width: '0.95rem', height: '0.95rem', zIndex: 1 }} />
        {zone.running && (
          <span className="bp-rachio-spray" aria-hidden="true" />
        )}
      </span>

      {/* Name + sub-line */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.05rem' }}>
        <span className="font-semibold truncate text-left" style={{ ...fluidTextSm, color: 'var(--bp-text-primary)' }}>
          {zone.name}
        </span>
        <span className="truncate text-left" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>
          {unavailable
            ? 'Unavailable'
            : zone.running
              ? (remaining ? `Watering · ${remaining} left` : 'Watering')
              : `Last run ${lastWateredLabel(zone.lastWatered)}`}
        </span>
      </div>

      {/* Soil moisture chip (when present) */}
      {zone.moisturePct !== null && (
        <span
          className="flex items-center shrink-0"
          style={{ gap: '0.2rem' }}
          title="Soil moisture"
        >
          <IconDroplets style={{ width: '0.7rem', height: '0.7rem', color: moistureColor(zone.moisturePct) }} />
          <span className="tabular-nums font-semibold" style={{ ...fluidTextXs, color: moistureColor(zone.moisturePct) }}>
            {unavailable ? '—' : `${zone.moisturePct}%`}
          </span>
        </span>
      )}

      {/* Run / Stop — press-and-hold confirm (water) */}
      {zone.running ? (
        <HoldButton
          size="sm"
          danger
          disabled={controlsDisabled || unavailable}
          onCommit={() => onStop(zone)}
        >
          <IconPower style={{ width: '0.85rem', height: '0.85rem' }} />
        </HoldButton>
      ) : (
        <HoldButton
          size="sm"
          disabled={controlsDisabled || unavailable}
          onCommit={() => onRun(zone, duration)}
        >
          <IconPlay style={{ width: '0.85rem', height: '0.85rem' }} />
        </HoldButton>
      )}
    </div>
  );
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div
    className="uppercase font-semibold"
    style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.07em', marginTop: '0.15rem' }}
  >
    {children}
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

const GlassIrrigationTile = ({
  tile,
  device,
  isEditor,
  cornerClassName,
}: {
  tile: TileConfig;
  device: Device;
  isEditor?: boolean;
  cornerClassName?: string;
}) => {
  const { addNotification } = useDashboardActions();
  const isLocked = !!tile.isLocked;

  // Optional tile-level config (real install): a list of homeowner sprinkler
  // scene names + a default run duration. Read defensively off the tile object
  // (no dedicated schema field yet) — the demo path instead discovers tagged
  // scene/script entities. Either source is DATA, never a site hardcode.
  const tileCfg = (tile as any)?.displayOverride ?? (tile as any);
  const configuredScenes: string[] | undefined = (() => {
    const raw = tileCfg?.sceneNames;
    if (Array.isArray(raw)) return raw.map((s: unknown) => String(s));
    if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return undefined;
  })();

  // Default per-zone run duration (minutes). Configurable; defaults to 10.
  const defaultDuration = (() => {
    const n = Number(tileCfg?.defaultDurationMin);
    return Number.isFinite(n) && n > 0 ? clampDuration(n) : 10;
  })();

  const [duration, setDuration] = useState<number>(defaultDuration);
  const [proj, setProj] = useState<IrrigationProjection>(() => projectIrrigation({}, configuredScenes));
  const [status, setStatus] = useState<'connecting' | 'live' | 'stale'>('connecting');
  const entsRef = useRef<EntityMap>({});

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => setStatus('stale'), 45000);
    };
    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents as unknown as EntityMap;
          setStatus('live');
          armStale();
          setProj(projectIrrigation(ents as unknown as EntityMap, configuredScenes));
        });
      } catch {
        if (!cancelled) setStatus('stale');
      }
    })();
    return () => {
      cancelled = true;
      if (staleTimer) clearTimeout(staleTimer);
      if (unsub) unsub();
    };
    // configuredScenes is derived from static tile config; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctrl = proj.controller;
  // The whole surface is "offline" only when the controller reports offline AND
  // we have a connectivity sensor saying so; an absent sensor is not offline.
  const controllerOffline = ctrl.online === false;
  const controlsDisabled = !!isEditor || isLocked || controllerOffline;

  // ── Confirmed actuators (gate re-checked here as defense-in-depth) ─────────
  const runZone = (z: ZoneView, durationMin: number) => {
    const gate = actuationGate('zone-run', { isEditor, isLocked, available: z.available && !controllerOffline, entityId: z.entityId });
    if (!gate.allowed) { addNotification(`${z.name}: cannot start now`, 'warning'); return; }
    const call = zoneRunCall({ entityId: z.entityId, durationMin });
    if (!call) return;
    callService(call.domain, call.service, call.data)
      .then(() => addNotification(`${z.name}: watering started`, 'success'))
      .catch((err: any) => addNotification(`${z.name}: ${err?.message || 'start failed'}`, 'error'));
  };

  const stopZone = (z: ZoneView) => {
    const gate = actuationGate('zone-run', { isEditor, isLocked, available: z.available, entityId: z.entityId });
    if (!gate.allowed) return;
    const call = zoneStopCall(z.entityId);
    if (!call) return;
    callService(call.domain, call.service, call.data)
      .then(() => addNotification(`${z.name}: stopped`, 'success'))
      .catch((err: any) => addNotification(`${z.name}: ${err?.message || 'stop failed'}`, 'error'));
  };

  const runScene = (scene: SceneView) => {
    const gate = actuationGate('scene-run', { isEditor, isLocked, available: scene.available && !controllerOffline, entityId: scene.entityId, sceneName: scene.name });
    if (!gate.allowed) { addNotification(`${scene.name}: cannot run now`, 'warning'); return; }
    const call = sceneRunCall(scene);
    if (!call) return;
    callService(call.domain, call.service, call.data)
      .then(() => addNotification(`Scene "${scene.name}" started`, 'success'))
      .catch((err: any) => addNotification(`${scene.name}: ${err?.message || 'run failed'}`, 'error'));
  };

  const toggleController = (action: 'rain-delay' | 'standby') => {
    const entityId = action === 'rain-delay' ? ctrl.rainDelayEntity : ctrl.standbyEntity;
    const currentlyOn = action === 'rain-delay' ? ctrl.rainDelay : ctrl.standby;
    const gate = actuationGate(action, { isEditor, isLocked, available: !controllerOffline, entityId: entityId || undefined });
    if (!gate.allowed || !entityId) { addNotification(`${action === 'rain-delay' ? 'Rain delay' : 'Standby'}: unavailable`, 'warning'); return; }
    const call = controllerToggleCall(action, entityId, currentlyOn);
    if (!call) return;
    const verb = action === 'rain-delay' ? (currentlyOn ? 'Rain delay cleared' : 'Rain delay started') : (currentlyOn ? 'Standby off' : 'Standby on');
    callService(call.domain, call.service, call.data)
      .then(() => addNotification(verb, 'success'))
      .catch((err: any) => addNotification(`${err?.message || 'command failed'}`, 'error'));
  };

  // ── Empty / honest states ──────────────────────────────────────────────────
  if (!proj.hasZones) {
    const connecting = status === 'connecting';
    return (
      <GlassCard label={tile.label || device.name || 'Irrigation'} accent="pool" isEditor={isEditor} isLocked={isLocked} className={cornerClassName}>
        <div className="flex flex-col items-center justify-center" style={{ gap: '0.4rem', color: 'var(--bp-text-dim)' }}>
          <IconDroplets style={{ width: '1.75rem', height: '1.75rem', opacity: 0.5 }} />
          <span style={fluidTextSm}>{connecting ? 'Connecting…' : 'No irrigation zones'}</span>
        </div>
      </GlassCard>
    );
  }

  const accent = proj.anyRunning ? 'pool' : controllerOffline ? 'warning' : ctrl.weatherSkip ? 'climate' : 'pool';

  return (
    <GlassCard
      label=""
      accent={accent}
      isActive={proj.anyRunning}
      isUnavailable={controllerOffline}
      isLocked={isLocked}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col items-stretch text-left" style={{ gap: 'clamp(0.3rem, 2cqmin, 0.6rem)', overflow: 'hidden' }}>
        {/* ── Header: title + live status chips ── */}
        <div className="flex items-start w-full" style={{ gap: '0.5rem' }}>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold truncate leading-tight" style={{ ...fluidTextLg, color: 'var(--bp-text-primary)' }}>
              {tile.label || device.name || 'Irrigation'}
            </h2>
            <div className="flex items-center" style={{ gap: '0.4rem', marginTop: '0.1rem' }}>
              <span className="rounded-full shrink-0" style={{
                width: '0.5rem', height: '0.5rem',
                background: controllerOffline ? '#9ca3af' : proj.anyRunning ? '#38bdf8' : '#34d399',
                boxShadow: controllerOffline ? 'none' : `0 0 8px ${proj.anyRunning ? '#38bdf8' : '#34d399'}`,
              }} />
              <span className="truncate" style={{ ...fluidTextSm, color: 'var(--bp-text-secondary)' }}>
                {controllerOffline
                  ? 'Controller offline'
                  : proj.anyRunning
                    ? `${proj.runningZones.length} zone${proj.runningZones.length > 1 ? 's' : ''} watering`
                    : ctrl.standby
                      ? 'Standby'
                      : ctrl.rainDelay
                        ? 'Rain delay active'
                        : 'Idle'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Weather / rain row ── */}
        <div className="flex flex-wrap items-center" style={{ gap: '0.3rem' }}>
          {ctrl.rainSensorWet !== null && (
            <Chip
              icon={<IconCloudRain style={{ width: '0.8rem', height: '0.8rem' }} />}
              label="Rain"
              value={controllerOffline ? '—' : ctrl.rainSensorWet ? 'Wet' : 'Dry'}
              color={ctrl.rainSensorWet ? '#38bdf8' : undefined}
            />
          )}
          {ctrl.rainProbability !== null && (
            <Chip
              icon={<IconCloudRain style={{ width: '0.8rem', height: '0.8rem' }} />}
              label="Chance"
              value={controllerOffline ? '—' : `${ctrl.rainProbability}%`}
              color={ctrl.weatherSkip ? '#fbbf24' : undefined}
            />
          )}
          {ctrl.forecastTemp !== null && (
            <Chip
              icon={<IconSun style={{ width: '0.8rem', height: '0.8rem' }} />}
              label="Fcst"
              value={controllerOffline ? '—' : `${Math.round(ctrl.forecastTemp)}${ctrl.forecastTempUnit}`}
            />
          )}
          {ctrl.weatherSkip && !controllerOffline && (
            <Chip
              icon={<IconAlertTriangle style={{ width: '0.8rem', height: '0.8rem' }} />}
              label=""
              value="Weather skip likely"
              color="#fbbf24"
            />
          )}
        </div>

        {/* ── Zones grouped by location ── */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.2rem, 1.5cqmin, 0.4rem)' }}>
          {proj.groups.map((group) => (
            <div key={group.location} style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.2rem, 1.2cqmin, 0.35rem)' }}>
              <SectionLabel>{group.location}</SectionLabel>
              {group.zones.map((z) => (
                <ZoneRow
                  key={z.entityId}
                  zone={z}
                  duration={duration}
                  onRun={runZone}
                  onStop={stopZone}
                  controlsDisabled={controlsDisabled}
                />
              ))}
            </div>
          ))}
        </div>

        {/* ── Duration stepper (applies to a tapped zone-run) ── */}
        <div className="flex items-center justify-between" style={{ gap: '0.5rem', paddingTop: '0.2rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="uppercase font-semibold shrink-0" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>Run for</span>
          <div className="flex items-center" style={{ gap: '0.4rem' }}>
            <button
              type="button"
              aria-label="decrease duration"
              disabled={controlsDisabled}
              onClick={(e) => { e.stopPropagation(); setDuration((d) => clampDuration(d - 1)); }}
              style={stepBtnStyle(controlsDisabled)}
            >
              <IconMinus style={{ width: '0.8rem', height: '0.8rem' }} />
            </button>
            <span className="font-bold tabular-nums" style={{ ...fluidTextSm, color: 'var(--bp-text-primary)', minWidth: '3.2rem', textAlign: 'center' }}>
              {duration} min
            </span>
            <button
              type="button"
              aria-label="increase duration"
              disabled={controlsDisabled}
              onClick={(e) => { e.stopPropagation(); setDuration((d) => clampDuration(d + 1)); }}
              style={stepBtnStyle(controlsDisabled)}
            >
              <IconPlus style={{ width: '0.8rem', height: '0.8rem' }} />
            </button>
          </div>
        </div>

        {/* ── Scenes + controller controls (all press-and-hold) ── */}
        <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
          <div className="flex items-center" style={{ gap: 'clamp(0.5rem, 4cqmin, 1rem)', overflowX: 'auto' }}>
            {proj.scenes.length > 0 ? (
              proj.scenes.slice(0, 3).map((scene) => (
                <HoldButton
                  key={scene.name + (scene.entityId || '')}
                  size="sm"
                  label={scene.name}
                  disabled={controlsDisabled || !scene.available}
                  onCommit={() => runScene(scene)}
                >
                  <IconActivity style={{ width: '0.9rem', height: '0.9rem' }} />
                </HoldButton>
              ))
            ) : (
              <span style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>No scenes</span>
            )}
          </div>

          <div className="flex items-center shrink-0" style={{ gap: 'clamp(0.5rem, 4cqmin, 1rem)' }}>
            {ctrl.rainDelayEntity && (
              <HoldButton
                size="sm"
                label={ctrl.rainDelay ? 'Delay on' : 'Rain delay'}
                active={ctrl.rainDelay}
                disabled={controlsDisabled}
                onCommit={() => toggleController('rain-delay')}
              >
                <IconCloudRain style={{ width: '0.9rem', height: '0.9rem' }} />
              </HoldButton>
            )}
            {ctrl.standbyEntity && (
              <HoldButton
                size="sm"
                label={ctrl.standby ? 'Standby' : 'Active'}
                active={ctrl.standby}
                danger={ctrl.standby}
                disabled={controlsDisabled}
                onCommit={() => toggleController('standby')}
              >
                {ctrl.standby ? <IconPower style={{ width: '0.9rem', height: '0.9rem' }} /> : <IconCheck style={{ width: '0.9rem', height: '0.9rem' }} />}
              </HoldButton>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

const stepBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: 'clamp(1.5rem, 8cqmin, 2rem)',
  height: 'clamp(1.5rem, 8cqmin, 2rem)',
  borderRadius: '9999px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--bp-text-secondary)',
  display: 'grid',
  placeItems: 'center',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
});

export default GlassIrrigationTile;
