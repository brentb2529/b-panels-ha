/**
 * HomeOverview — the Home landing page for the Bensten Residence dashboard.
 *
 * iPad-landscape (1366×1024), below the 64px header and beside the 72px NavRail:
 * usable canvas = (1366 − 72) × (1024 − 64) = 1294 × 960px
 *
 * LAYOUT:
 *   Row 1 (top, taller): Pool card + Climate card  — 2 columns
 *   Row 2 (bottom):      Security + Lights + Generator  — 3 columns
 *
 * Each card shows:
 *   - Area name  (large, sans-serif, high contrast)
 *   - 2–4 roll-up data points  (compact stat pills)
 *   - 1–2 low-hazard inline quick controls  (heat toggle, setpoint nudge, lights off/on)
 *   - "Open →" affordance
 *
 * HARD RULES (per CLAUDE.md + task brief):
 *   - NO arm/disarm, NO lock/unlock, NO AKVO floor motion, NO generator control.
 *   - Only low-hazard controls: pool heat, climate setpoint, lights all-off/all-on.
 *   - Optimistic UI: reflect service calls immediately, reconcile on state push.
 *
 * Design language: same glass material as rest of b-panels (--surface, --tile-alpha,
 * --tile-border, --tile-blur, --bg-gradient). No new design tokens introduced.
 * Light/dark/ambient-night legible via the existing CSS variable system.
 *
 * Data: exclusively from usePoolSurface, useClimateZones, useLutronSurface,
 * useUnifiSurface, and useDashboard — same live HA websocket paths as the full
 * area surfaces. No new data paths, no business logic beyond reading entities and
 * calling safe services.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { useWeather } from '../hooks/useWeather';
import { useScopedPanel } from '../hooks/useScopedPanel';
import { usePoolSurface } from '../hooks/usePoolSurface';
import { useClimateZones } from '../hooks/useClimateZones';
import { useLutronSurface } from '../hooks/useLutronSurface';
import { useUnifiSurface } from '../hooks/useUnifiSurface';
import { callService } from '../services/haClient';
import { DeviceType } from '../types';
import {
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconLightbulb,
  IconLightbulbOff,
  IconZap,
  IconThermometer,
  IconSnowflake,
  IconFlame,
  IconShieldCheck,
  IconCamera,
  IconAlertTriangle,
  IconPlus,
  IconMinus,
  IconPower,
  IconFan,
} from './icons';

// ── Helpers ─────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pull the first entity whose id matches a regexp from the device map. */
function findDeviceByPattern(devices: any[], pattern: RegExp) {
  return devices.find(d => pattern.test(d.id));
}

// ── Area status derivations ─────────────────────────────────────────────────

interface AreaStatus {
  summary: string;
  detail?: string;
  ok: boolean;
  alertLevel: 'ok' | 'warn' | 'alert';
}

/** A single compact data-point for the roll-up row */
interface RollupItem {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: string;
}

// ── Roll-up data derivations ────────────────────────────────────────────────

function useSecurityStatus(alarmState: any, devices: any[]): AreaStatus {
  return useMemo(() => {
    if (alarmState) {
      const arm = alarmState.armState;
      const violation = alarmState.securityState === 'VIOLATION';
      if (violation) {
        return { summary: 'Intrusion detected', ok: false, alertLevel: 'alert' };
      }
      if (arm === 'armedAway') return { summary: 'Armed Away', ok: true, alertLevel: 'warn' };
      if (arm === 'armedStay') return { summary: 'Armed Stay', ok: true, alertLevel: 'warn' };
      return { summary: 'Disarmed · All clear', ok: true, alertLevel: 'ok' };
    }
    // Fallback: count cameras
    const cameras = devices.filter(d => d.type === DeviceType.Camera || d.type === DeviceType.CameraGroup || d.type === DeviceType.UnifiSecurity);
    if (cameras.length > 0) {
      return { summary: `${cameras.length} camera${cameras.length > 1 ? 's' : ''} active`, ok: true, alertLevel: 'ok' };
    }
    // No alarm or camera entities yet — standby ring dot, deliberate state
    return { summary: 'Monitoring · Not yet armed', ok: false, alertLevel: 'ok' };
  }, [alarmState, devices]);
}

function useGeneratorStatus(devices: any[]): AreaStatus {
  return useMemo(() => {
    const gen = devices.find(d =>
      d.type === DeviceType.Generator ||
      d.type === DeviceType.GeneratorRehlko ||
      (d.id && /generator|kohler|rehlko/i.test(d.id))
    );
    // Generator not yet connected — standby ring dot, deliberate state
    if (!gen) return { summary: 'Standby · Offline', ok: false, alertLevel: 'ok' };
    const s = gen.state;
    if (typeof s === 'object' && s !== null) {
      const status = (s as any).status || (s as any).normalizedStatus || '';
      if (/running|active|on/i.test(status)) {
        return { summary: `Running · ${status}`, ok: true, alertLevel: 'warn' };
      }
      return { summary: `Standby · ${status || 'Ready'}`, ok: true, alertLevel: 'ok' };
    }
    if (typeof s === 'string') {
      if (/running|active|on/i.test(s)) return { summary: `Running · ${s}`, ok: true, alertLevel: 'warn' };
      return { summary: `Standby · ${s}`, ok: true, alertLevel: 'ok' };
    }
    return { summary: 'Standby', ok: true, alertLevel: 'ok' };
  }, [devices]);
}

// ── Roll-up stat pill ────────────────────────────────────────────────────────

const RollupPill: React.FC<{ item: RollupItem }> = ({ item }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      padding: '4px 8px',
      borderRadius: 8,
      backgroundColor: 'rgb(var(--surface) / 0.45)',
      border: '1px solid rgb(var(--text) / 0.08)',
      minWidth: 0,
    }}
  >
    {item.icon && (
      <span style={{ color: item.accent || 'rgb(var(--text) / 0.5)', flexShrink: 0, display: 'flex' }}>
        {item.icon}
      </span>
    )}
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'rgb(var(--text) / 0.38)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          lineHeight: 1,
          marginBottom: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {item.label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: item.accent || 'rgb(var(--text) / 0.85)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {item.value}
      </div>
    </div>
  </div>
);

// ── Quick control pill (toggle or nudge) ────────────────────────────────────

interface QuickControlProps {
  label: string;
  active?: boolean;
  danger?: boolean;
  accentColor: string;
  icon?: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
}

const QuickControl: React.FC<QuickControlProps> = ({
  label,
  active,
  danger,
  accentColor,
  icon,
  onClick,
  disabled,
  title,
}) => (
  <button
    disabled={disabled}
    title={title}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '5px 10px',
      borderRadius: 9,
      border: `1px solid ${active ? accentColor + '66' : danger ? 'rgba(248,113,113,0.3)' : 'rgb(var(--text) / 0.12)'}`,
      backgroundColor: active
        ? `${accentColor}22`
        : danger
        ? 'rgba(248,113,113,0.1)'
        : 'rgb(var(--surface) / 0.5)',
      color: active ? accentColor : danger ? 'rgb(248,113,113)' : 'rgb(var(--text) / 0.65)',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.03em',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'background 0.14s ease, border-color 0.14s ease, color 0.14s ease',
      outline: 'none',
      whiteSpace: 'nowrap',
    }}
    aria-label={label}
  >
    {icon && <span style={{ display: 'flex' }}>{icon}</span>}
    {label}
  </button>
);

// ── Setpoint nudge control pair ──────────────────────────────────────────────

interface NudgeControlProps {
  value: number | null;
  unit: string;
  accentColor: string;
  onNudge: (delta: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

const NudgeControl: React.FC<NudgeControlProps> = ({
  value,
  unit,
  accentColor,
  onNudge,
  min = 50,
  max = 104,
  disabled,
}) => {
  const btnStyle = (extraBorder?: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: 7,
    border: `1px solid ${accentColor}44`,
    backgroundColor: `${accentColor}18`,
    color: accentColor,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    padding: 0,
    outline: 'none',
    flexShrink: 0,
  });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 6px',
        borderRadius: 9,
        border: `1px solid ${accentColor}33`,
        backgroundColor: `${accentColor}0d`,
      }}
    >
      <button
        style={btnStyle()}
        disabled={disabled || (value !== null && value <= min)}
        onClick={e => { e.stopPropagation(); onNudge(-1); }}
        aria-label="Decrease setpoint"
      >
        <IconMinus className="w-3 h-3" />
      </button>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: accentColor,
          minWidth: 38,
          textAlign: 'center',
          lineHeight: 1,
        }}
      >
        {value != null ? `${Math.round(value)}${unit}` : `--${unit}`}
      </span>
      <button
        style={btnStyle()}
        disabled={disabled || (value !== null && value >= max)}
        onClick={e => { e.stopPropagation(); onNudge(+1); }}
        aria-label="Increase setpoint"
      >
        <IconPlus className="w-3 h-3" />
      </button>
    </div>
  );
};

// ── Area card component ──────────────────────────────────────────────────────

interface AreaCardProps {
  areaKey: string;
  title: string;
  subtitle?: string;
  status: AreaStatus;
  icon: React.ReactNode;
  accentColor: string;
  onClick: () => void;
  style?: React.CSSProperties;
  rollup?: RollupItem[];
  controls?: React.ReactNode;
}

const ALERT_COLORS: Record<AreaStatus['alertLevel'], string> = {
  ok: 'rgba(52,211,153,0.18)',
  warn: 'rgba(251,146,60,0.18)',
  alert: 'rgba(248,113,113,0.22)',
};

const AreaCard: React.FC<AreaCardProps> = ({
  title,
  subtitle,
  status,
  icon,
  accentColor,
  onClick,
  style,
  rollup,
  controls,
}) => {
  const [hovered, setHovered] = React.useState(false);

  const alertBg = ALERT_COLORS[status.alertLevel];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex flex-col text-left transition-all"
      style={{
        // Liquid-glass material
        backgroundColor: `rgb(var(--surface) / var(--tile-alpha))`,
        backdropFilter: `blur(var(--tile-blur))`,
        WebkitBackdropFilter: `blur(var(--tile-blur))`,
        border: `1px solid var(--tile-border)`,
        borderRadius: 'var(--radius-tile)',
        boxShadow: hovered
          ? `var(--elev-2), 0 0 32px -8px ${accentColor}88`
          : 'var(--elev-1)',
        transform: hovered ? 'translateY(-2px) scale(1.008)' : 'translateY(0) scale(1)',
        padding: '20px',
        cursor: 'pointer',
        outline: 'none',
        overflow: 'hidden',
        ...style,
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${title} area`}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {/* Alert-level tint overlay */}
      {status.alertLevel !== 'ok' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: alertBg,
            borderRadius: 'inherit',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Background accent blot — subtle, behind content */}
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accentColor}22 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Top row: icon + status indicator */}
      <div className="relative flex items-start justify-between" style={{ marginBottom: 10 }}>
        {/* Icon badge */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            backgroundColor: `${accentColor}22`,
            border: `1px solid ${accentColor}44`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accentColor,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>

        {/* Status dot */}
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            flexShrink: 0,
            ...(status.alertLevel === 'alert'
              ? {
                  backgroundColor: 'rgb(var(--accent-alert))',
                  boxShadow: '0 0 8px rgb(var(--accent-alert))',
                }
              : status.alertLevel === 'warn'
              ? {
                  backgroundColor: 'rgb(var(--accent-warn))',
                  boxShadow: '0 0 6px rgba(251,146,60,0.7)',
                }
              : status.ok
              ? {
                  backgroundColor: 'rgb(52,211,153)',
                  boxShadow: '0 0 6px rgba(52,211,153,0.65)',
                }
              : {
                  backgroundColor: 'transparent',
                  border: '1.5px solid rgb(var(--text) / 0.22)',
                  width: 8,
                  height: 8,
                }),
          }}
        />
      </div>

      {/* Area name */}
      <div className="relative" style={{ marginBottom: 6 }}>
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: 'rgb(var(--text))',
            marginBottom: 3,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'rgb(var(--text) / 0.45)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Status line */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color:
              status.alertLevel === 'alert'
                ? 'rgb(var(--accent-alert))'
                : status.alertLevel === 'warn'
                ? 'rgb(var(--accent-warn))'
                : 'rgb(var(--text) / 0.6)',
            lineHeight: 1.4,
          }}
        >
          {status.summary}
        </div>
        {status.detail && (
          <div style={{ fontSize: 11, color: 'rgb(var(--text) / 0.38)', marginTop: 2 }}>
            {status.detail}
          </div>
        )}
      </div>

      {/* Roll-up data row — grows to fill available vertical space */}
      {rollup && rollup.length > 0 && (
        <div
          className="relative flex flex-wrap gap-1.5"
          style={{ marginBottom: 10, flex: 1, alignContent: 'flex-start' }}
          onClick={e => e.stopPropagation()}
        >
          {rollup.map((item, i) => (
            <RollupPill key={i} item={item} />
          ))}
        </div>
      )}

      {/* Spacer when no rollup, to push footer down */}
      {(!rollup || rollup.length === 0) && <div style={{ flex: 1 }} />}

      {/* Quick controls + Open chevron row */}
      <div className="relative flex items-center justify-between gap-2" style={{ marginTop: 'auto' }}>
        {/* Quick controls */}
        {controls && (
          <div
            className="flex flex-wrap items-center gap-1.5"
            onClick={e => e.stopPropagation()}
          >
            {controls}
          </div>
        )}

        {/* Open chevron — right-aligned */}
        <div
          className="flex items-center gap-1 ml-auto"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: accentColor,
            letterSpacing: '0.04em',
            opacity: hovered ? 1 : 0.65,
            transition: 'opacity 0.18s ease',
            flexShrink: 0,
          }}
        >
          <span>Open</span>
          <span
            style={{
              display: 'inline-block',
              transform: hovered ? 'translateX(3px)' : 'translateX(0)',
              transition: 'transform 0.18s ease',
            }}
          >
            →
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Welcome greeting ─────────────────────────────────────────────────────────

const Greeting: React.FC = () => {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div style={{ marginBottom: 28 }}>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: 'rgb(var(--text))',
          lineHeight: 1.1,
          marginBottom: 6,
        }}
      >
        {greeting}
      </h1>
      <p
        style={{
          fontSize: 14,
          color: 'rgb(var(--text) / 0.45)',
          fontWeight: 500,
        }}
      >
        {now.toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </p>
    </div>
  );
};

// ── Quick-status bar ─────────────────────────────────────────────────────────

interface QuickStatProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

const QuickStat: React.FC<QuickStatProps> = ({ label, value, icon, color }) => (
  <div
    className="flex items-center gap-3 px-4 py-3 rounded-xl"
    style={{
      backgroundColor: 'rgb(var(--surface) / 0.6)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      border: '1px solid var(--tile-border)',
      minWidth: 140,
    }}
  >
    <div style={{ color, flexShrink: 0 }}>{icon}</div>
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'rgb(var(--text) / 0.4)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          lineHeight: 1,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: 'rgb(var(--text))',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  </div>
);

// ── Per-card roll-up + control hooks ────────────────────────────────────────

/**
 * Pool card — roll-up: water temp, air/probe temp, pump state + power,
 *             heater state. Quick controls: heat toggle + setpoint nudge.
 */
function usePoolCardData(poolSurface: ReturnType<typeof usePoolSurface>) {
  const { surface, setWaterHeaterMode, setWaterHeaterTemp } = poolSurface;

  // Optimistic heat-toggle state: null = follow real state
  const [optimisticHeat, setOptimisticHeat] = useState<boolean | null>(null);
  const [optimisticTarget, setOptimisticTarget] = useState<number | null>(null);

  const primaryBody = surface.bodies[0] ?? null;
  const primaryPump = surface.pumps.find(p => p.isRunning) ?? surface.pumps[0] ?? null;
  const airProbe = surface.probeTemps.find(p => /air|amb/i.test(p.name)) ?? surface.probeTemps[0] ?? null;

  const waterTempStr = primaryBody?.waterTempC != null
    ? `${Math.round(primaryBody.waterTempC)}${primaryBody.waterTempUnit}`
    : null;

  const airTempStr = airProbe?.value != null
    ? `${Math.round(airProbe.value)}${airProbe.unit}`
    : null;

  const pumpStr = primaryPump
    ? (primaryPump.isRunning
      ? (primaryPump.powerW != null
          ? `${Math.round(primaryPump.powerW)}W`
          : primaryPump.rpm != null
          ? `${Math.round(primaryPump.rpm)} rpm`
          : 'Running')
      : 'Off')
    : null;

  const heaterIsOn = optimisticHeat !== null
    ? optimisticHeat
    : (primaryBody?.heaterIsOn ?? false);

  const heaterTarget = optimisticTarget !== null
    ? optimisticTarget
    : (primaryBody?.heaterTarget ?? null);

  const heaterEntityId = primaryBody?.heaterId ?? null;
  const heaterMode = primaryBody?.heaterMode ?? null;

  const toggleHeat = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!heaterEntityId) return;
    const newOn = !heaterIsOn;
    setOptimisticHeat(newOn);
    try {
      await setWaterHeaterMode(heaterEntityId, newOn ? 'heat_pump' : 'off');
    } catch {
      setOptimisticHeat(null);
    }
    // Reconcile after 5 s
    setTimeout(() => setOptimisticHeat(null), 5000);
  }, [heaterEntityId, heaterIsOn, setWaterHeaterMode]);

  const nudgeTarget = useCallback(async (delta: number) => {
    if (!heaterEntityId) return;
    const base = heaterTarget ?? 78;
    const next = clamp(base + delta, 50, 104);
    setOptimisticTarget(next);
    try {
      await setWaterHeaterTemp(heaterEntityId, next);
    } catch {
      setOptimisticTarget(null);
    }
    setTimeout(() => setOptimisticTarget(null), 8000);
  }, [heaterEntityId, heaterTarget, setWaterHeaterTemp]);

  const rollup: RollupItem[] = [];
  if (waterTempStr) {
    rollup.push({ label: 'Water', value: waterTempStr, icon: <IconWaves className="w-3 h-3" />, accent: 'rgb(56,189,248)' });
  }
  if (airTempStr) {
    rollup.push({ label: 'Air', value: airTempStr, icon: <IconThermometer className="w-3 h-3" /> });
  }
  if (pumpStr) {
    rollup.push({ label: 'Pump', value: pumpStr, icon: <IconFan className="w-3 h-3" />, accent: primaryPump?.isRunning ? 'rgb(56,189,248)' : undefined });
  }
  if (heaterEntityId || heaterMode !== null) {
    const heaterLabel = heaterIsOn ? 'Heating' : 'Heater off';
    rollup.push({ label: 'Heater', value: heaterLabel, icon: <IconFlame className="w-3 h-3" />, accent: heaterIsOn ? 'rgb(251,146,60)' : undefined });
  }

  return {
    rollup,
    heaterEntityId,
    heaterIsOn,
    heaterTarget,
    heaterUnit: primaryBody?.waterTempUnit ?? '°F',
    toggleHeat,
    nudgeTarget,
    detected: surface.detected,
  };
}

/**
 * Climate card — roll-up: zone count, dominant mode, avg temp, hi/lo range.
 *                Quick control: master setpoint nudge.
 */
function useClimateCardData(climateHook: ReturnType<typeof useClimateZones>) {
  const { zones, setTargetTemperature } = climateHook;

  const [optimisticTarget, setOptimisticTarget] = useState<{ entityId: string; value: number } | null>(null);

  // Find the first standalone or cluster-master zone that supports temperature
  const primaryZone = useMemo(() => {
    return zones.find(z => z.targetTemperature != null && z.hvacModes.includes('heat')) ?? zones[0] ?? null;
  }, [zones]);

  const temps = zones.map(z => z.currentTemperature).filter((t): t is number => t != null);
  const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b) / temps.length) : null;
  const hiTemp = temps.length > 0 ? Math.round(Math.max(...temps)) : null;
  const loTemp = temps.length > 0 ? Math.round(Math.min(...temps)) : null;

  const heating = zones.filter(z => z.hvacMode === 'heat' || z.hvacMode === 'heat_cool').length;
  const cooling = zones.filter(z => z.hvacMode === 'cool').length;
  const idle = zones.filter(z => z.hvacMode === 'off' || z.hvacMode === 'fan_only').length;
  const modeLabel = heating > cooling ? 'Heating' : cooling > heating ? 'Cooling' : idle === zones.length ? 'All off' : 'Idle';

  const targetValue = optimisticTarget?.entityId === primaryZone?.entityId
    ? optimisticTarget.value
    : (primaryZone?.targetTemperature ?? null);

  const tempUnit = primaryZone?.temperatureUnit ?? '°F';

  const nudgeTarget = useCallback(async (delta: number) => {
    if (!primaryZone) return;
    const base = targetValue ?? 70;
    const next = clamp(base + delta, 60, 85);
    setOptimisticTarget({ entityId: primaryZone.entityId, value: next });
    try {
      await setTargetTemperature(primaryZone.entityId, next);
    } catch {
      setOptimisticTarget(null);
    }
    setTimeout(() => setOptimisticTarget(null), 8000);
  }, [primaryZone, targetValue, setTargetTemperature]);

  const rollup: RollupItem[] = [];
  if (zones.length > 0) {
    rollup.push({ label: 'Zones', value: `${zones.length}`, icon: <IconWind className="w-3 h-3" /> });
  }
  rollup.push({ label: 'Mode', value: modeLabel, icon: modeLabel === 'Heating' ? <IconFlame className="w-3 h-3" /> : modeLabel === 'Cooling' ? <IconSnowflake className="w-3 h-3" /> : <IconWind className="w-3 h-3" />, accent: modeLabel === 'Heating' ? 'rgb(251,146,60)' : modeLabel === 'Cooling' ? 'rgb(56,189,248)' : undefined });
  if (avgTemp != null) {
    rollup.push({ label: 'Avg', value: `${avgTemp}${tempUnit}`, icon: <IconThermometer className="w-3 h-3" /> });
  }
  if (hiTemp != null && loTemp != null && hiTemp !== loTemp) {
    rollup.push({ label: 'Range', value: `${loTemp}–${hiTemp}${tempUnit}` });
  }

  return { rollup, primaryZone, targetValue, tempUnit, nudgeTarget };
}

/**
 * Lights card — roll-up: # on / total, # scenes.
 *               Quick controls: All Off, All On.
 */
function useLightsCardData(lutronHook: ReturnType<typeof useLutronSurface>) {
  const { state: lutron } = lutronHook;

  const allLights = useMemo(() => lutron.areas.flatMap(a => a.lights), [lutron.areas]);
  const onCount = allLights.filter(l => l.isOn).length;
  const total = allLights.length;
  const sceneCount = lutron.scenes.length;

  const [optimisticAllOff, setOptimisticAllOff] = useState(false);
  const [optimisticAllOn, setOptimisticAllOn] = useState(false);

  // "All Off": turn off all Lutron lights
  const doAllOff = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOptimisticAllOff(true);
    setOptimisticAllOn(false);
    try {
      await Promise.all(
        allLights.filter(l => l.isOn).map(l =>
          callService('light', 'turn_off', {}, { entity_id: l.entityId })
        )
      );
    } catch { /* optimistic */ }
    setTimeout(() => setOptimisticAllOff(false), 5000);
  }, [allLights]);

  // "All On": turn on all Lutron lights at 100%
  const doAllOn = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOptimisticAllOn(true);
    setOptimisticAllOff(false);
    try {
      await Promise.all(
        allLights.filter(l => !l.isOn).map(l =>
          callService('light', 'turn_on', { brightness_pct: 100 }, { entity_id: l.entityId })
        )
      );
    } catch { /* optimistic */ }
    setTimeout(() => setOptimisticAllOn(false), 5000);
  }, [allLights]);

  // Effective on count (considering optimistic state)
  const effectiveOn = optimisticAllOff ? 0 : optimisticAllOn ? total : onCount;

  const rollup: RollupItem[] = [];
  if (total > 0) {
    rollup.push({
      label: 'On',
      value: effectiveOn === 0 ? 'All off' : `${effectiveOn} / ${total}`,
      icon: <IconLightbulb className="w-3 h-3" />,
      accent: effectiveOn > 0 ? 'rgb(var(--accent-light))' : undefined,
    });
  } else {
    rollup.push({ label: 'Status', value: 'Lutron ready', icon: <IconLightbulb className="w-3 h-3" /> });
  }
  if (sceneCount > 0) {
    rollup.push({ label: 'Scenes', value: `${sceneCount}`, icon: <IconLightbulb className="w-3 h-3" /> });
  }

  const disableAllOff = total === 0 || effectiveOn === 0;
  const disableAllOn = total === 0 || effectiveOn === total;

  return { rollup, total, effectiveOn, doAllOff, doAllOn, disableAllOff, disableAllOn };
}

/**
 * Security card — roll-up: arm state, camera count, active detections.
 *                 DISPLAY ONLY — no controls.
 */
function useSecurityRollup(
  alarmState: any,
  unifi: ReturnType<typeof useUnifiSurface>
): RollupItem[] {
  return useMemo(() => {
    const items: RollupItem[] = [];

    // Arm state
    if (alarmState) {
      const arm = alarmState.armState;
      const label =
        arm === 'armedAway' ? 'Armed Away' :
        arm === 'armedStay' ? 'Armed Stay' :
        'Disarmed';
      items.push({
        label: 'Alarm',
        value: label,
        icon: <IconShieldCheck className="w-3 h-3" />,
        accent: arm !== 'disarmed' ? 'rgb(var(--accent-warn))' : 'rgb(52,211,153)',
      });
    }

    // Camera count
    const camCount = unifi.cameras.length;
    if (camCount > 0) {
      items.push({
        label: 'Cameras',
        value: `${camCount}`,
        icon: <IconCamera className="w-3 h-3" />,
      });
    }

    // Active detections
    const activeDetections = unifi.cameras.filter(
      c => c.motionActive || c.doorbellActive || Object.values(c.detections).some(Boolean)
    ).length;
    if (activeDetections > 0) {
      items.push({
        label: 'Detections',
        value: `${activeDetections} active`,
        icon: <IconAlertTriangle className="w-3 h-3" />,
        accent: 'rgb(var(--accent-warn))',
      });
    }

    return items;
  }, [alarmState, unifi.cameras]);
}

/**
 * Generator card — roll-up: status, run state.
 *                  DISPLAY ONLY — no controls.
 */
function useGeneratorRollup(devices: any[]): RollupItem[] {
  return useMemo(() => {
    const gen = devices.find(d =>
      d.type === DeviceType.Generator ||
      d.type === DeviceType.GeneratorRehlko ||
      (d.id && /generator|kohler|rehlko/i.test(d.id))
    );
    if (!gen) return [{ label: 'Status', value: 'Offline' }];
    const s = gen.state;
    const items: RollupItem[] = [];
    if (typeof s === 'object' && s !== null) {
      const status = (s as any).status || (s as any).normalizedStatus || '';
      const running = /running|active|on/i.test(status);
      items.push({
        label: 'Status',
        value: running ? 'Running' : 'Standby',
        icon: <IconZap className="w-3 h-3" />,
        accent: running ? 'rgb(var(--accent-warn))' : undefined,
      });
      const output = (s as any).outputW ?? (s as any).outputKW ?? null;
      if (output != null) {
        items.push({ label: 'Output', value: output >= 1000 ? `${(output / 1000).toFixed(1)} kW` : `${Math.round(output)} W` });
      }
      const runHours = (s as any).runHours ?? (s as any).engineRunTime ?? null;
      if (runHours != null) {
        items.push({ label: 'Run hrs', value: `${Math.round(runHours)}` });
      }
    } else if (typeof s === 'string') {
      const running = /running|active|on/i.test(s);
      items.push({
        label: 'Status',
        value: running ? 'Running' : s || 'Standby',
        icon: <IconZap className="w-3 h-3" />,
        accent: running ? 'rgb(var(--accent-warn))' : undefined,
      });
    }
    return items;
  }, [devices]);
}

// ── Main component ───────────────────────────────────────────────────────────

const HomeOverview: React.FC = () => {
  const { devices, alarmState } = useDashboard();
  const { weather } = useWeather();
  const navigate = useNavigate();
  const { isAreaAllowed } = useScopedPanel();

  // Surface hooks — same subscriptions the full area views use
  const poolSurface = usePoolSurface();
  const climateHook = useClimateZones();
  const lutronHook = useLutronSurface();
  const unifi = useUnifiSurface();

  // Per-card derived data
  const poolCard = usePoolCardData(poolSurface);
  const climateCard = useClimateCardData(climateHook);
  const lightsCard = useLightsCardData(lutronHook);
  const securityRollup = useSecurityRollup(alarmState, unifi);
  const generatorRollup = useGeneratorRollup(devices);

  // Summary statuses for the card status lines
  const poolStatus: AreaStatus = useMemo(() => {
    const s = poolSurface.surface;
    if (!s.detected) return { summary: 'Waiting for controller', ok: false, alertLevel: 'ok' };
    const body = s.bodies[0];
    if (body?.waterTempC != null) {
      return {
        summary: `Water ${Math.round(body.waterTempC)}${body.waterTempUnit}`,
        detail: body.heaterIsOn ? 'Heating' : undefined,
        ok: true,
        alertLevel: 'ok',
      };
    }
    return { summary: 'Pool active', ok: true, alertLevel: 'ok' };
  }, [poolSurface.surface]);

  const climateStatus: AreaStatus = useMemo(() => {
    const zones = climateHook.zones;
    if (zones.length === 0) return { summary: 'Zones not yet discovered', ok: false, alertLevel: 'ok' };
    const temps = zones.map(z => z.currentTemperature).filter((t): t is number => t != null);
    const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b) / temps.length) : null;
    const heating = zones.filter(z => z.hvacMode === 'heat' || z.hvacMode === 'heat_cool').length;
    const cooling = zones.filter(z => z.hvacMode === 'cool').length;
    const mode = heating > cooling ? 'Heating' : cooling > heating ? 'Cooling' : 'Idle';
    const tempStr = avgTemp != null ? ` · ${avgTemp}°F avg` : '';
    return { summary: `${zones.length} zones · ${mode}${tempStr}`, ok: true, alertLevel: 'ok' };
  }, [climateHook.zones]);

  const securityStatus = useSecurityStatus(alarmState, devices);

  const lightStatus: AreaStatus = useMemo(() => {
    const { total, effectiveOn } = lightsCard;
    if (total === 0) return { summary: 'All off · Lutron ready', ok: true, alertLevel: 'ok' };
    if (effectiveOn === 0) return { summary: `All off · ${total} lights`, ok: true, alertLevel: 'ok' };
    return { summary: `${effectiveOn} light${effectiveOn > 1 ? 's' : ''} on · ${total} total`, ok: true, alertLevel: 'ok' };
  }, [lightsCard]);

  const generatorStatus = useGeneratorStatus(devices);

  // Quick stats bar data
  const outsideTemp = weather?.temperature != null ? `${weather.temperature}°F` : '--';
  const lightsOnCount = lightsCard.effectiveOn;

  const securityQuickLabel = useMemo(() => {
    if (!alarmState) return 'Unknown';
    if (alarmState.securityState === 'VIOLATION') return 'ALERT';
    if (alarmState.armState === 'armedAway') return 'Armed Away';
    if (alarmState.armState === 'armedStay') return 'Armed Stay';
    return 'Disarmed';
  }, [alarmState]);

  const climateZones = climateHook.zones.length;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ padding: '28px 28px 20px 28px' }}
    >
      {/* Greeting + quick stats row */}
      <div className="flex items-end justify-between" style={{ marginBottom: 24 }}>
        <Greeting />

        {/* Quick stats bar */}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <QuickStat
            label="Outside"
            value={outsideTemp}
            icon={<IconThermometer className="w-4 h-4" />}
            color="rgb(var(--accent-water))"
          />
          {isAreaAllowed('lights') && (
            <QuickStat
              label="Lights on"
              value={lightsOnCount === 0 ? 'All off' : `${lightsOnCount}`}
              icon={<IconLightbulb className="w-4 h-4" />}
              color="rgb(var(--accent-light))"
            />
          )}
          {isAreaAllowed('security') && (
            <QuickStat
              label="Security"
              value={securityQuickLabel}
              icon={
                alarmState?.securityState === 'VIOLATION' ? (
                  <IconAlertTriangle className="w-4 h-4" />
                ) : alarmState?.armState !== 'disarmed' ? (
                  <IconShieldAlert className="w-4 h-4" />
                ) : (
                  <IconShieldCheck className="w-4 h-4" />
                )
              }
              color={
                alarmState?.securityState === 'VIOLATION'
                  ? 'rgb(var(--accent-alert))'
                  : alarmState?.armState !== 'disarmed'
                  ? 'rgb(var(--accent-warn))'
                  : 'rgb(52,211,153)'
              }
            />
          )}
          {isAreaAllowed('climate') && climateZones > 0 && (
            <QuickStat
              label="Climate zones"
              value={`${climateZones}`}
              icon={<IconWind className="w-4 h-4" />}
              color="rgb(var(--accent))"
            />
          )}
        </div>
      </div>

      {/* Area cards grid */}
      {(() => {
        const POOL_ACCENT = 'rgb(56,189,248)';
        const CLIMATE_ACCENT = 'rgb(var(--accent))';
        const LIGHTS_ACCENT = 'rgb(var(--accent-light))';
        const GEN_ACCENT = 'rgb(var(--accent-plug))';
        const SEC_ACCENT =
          securityStatus.alertLevel === 'alert'
            ? 'rgb(var(--accent-alert))'
            : securityStatus.alertLevel === 'warn'
            ? 'rgb(var(--accent-warn))'
            : 'rgb(52,211,153)';

        // Pool quick controls
        const poolControls = poolCard.detected && poolCard.heaterEntityId ? (
          <>
            <QuickControl
              label={poolCard.heaterIsOn ? 'Heat on' : 'Heat off'}
              active={poolCard.heaterIsOn}
              accentColor="rgb(251,146,60)"
              icon={<IconFlame className="w-3 h-3" />}
              onClick={poolCard.toggleHeat}
              title="Toggle pool heater"
            />
            {poolCard.heaterIsOn && (
              <NudgeControl
                value={poolCard.heaterTarget}
                unit={poolCard.heaterUnit}
                accentColor="rgb(251,146,60)"
                onNudge={delta => poolCard.nudgeTarget(delta)}
                min={50}
                max={104}
              />
            )}
          </>
        ) : null;

        // Climate quick controls — only if a primary zone with temp control exists
        const climateControls = climateCard.primaryZone?.targetTemperature != null ? (
          <NudgeControl
            value={climateCard.targetValue}
            unit={climateCard.tempUnit}
            accentColor="rgb(var(--accent))"
            onNudge={delta => climateCard.nudgeTarget(delta)}
            min={60}
            max={85}
          />
        ) : null;

        // Lights quick controls
        const lightsControls = lightsCard.total > 0 ? (
          <>
            <QuickControl
              label="All off"
              accentColor={LIGHTS_ACCENT}
              icon={<IconLightbulbOff className="w-3 h-3" />}
              onClick={lightsCard.doAllOff}
              disabled={lightsCard.disableAllOff}
              title="Turn all Lutron lights off"
            />
            <QuickControl
              label="All on"
              active={lightsCard.effectiveOn === lightsCard.total}
              accentColor={LIGHTS_ACCENT}
              icon={<IconLightbulb className="w-3 h-3" />}
              onClick={lightsCard.doAllOn}
              disabled={lightsCard.disableAllOn}
              title="Turn all Lutron lights on"
            />
          </>
        ) : null;

        const allCards = [
          {
            key: 'pool',
            el: (style: React.CSSProperties) => (
              <AreaCard
                key="pool"
                areaKey="pool"
                title="Pool"
                subtitle="Backyard"
                status={poolStatus}
                icon={<IconWaves className="w-6 h-6" />}
                accentColor={POOL_ACCENT}
                onClick={() => navigate('/area/pool')}
                style={style}
                rollup={poolCard.rollup}
                controls={poolControls}
              />
            ),
          },
          {
            key: 'climate',
            el: (style: React.CSSProperties) => (
              <AreaCard
                key="climate"
                areaKey="climate"
                title="Heating & Cooling"
                subtitle="Whole home"
                status={climateStatus}
                icon={<IconWind className="w-6 h-6" />}
                accentColor={CLIMATE_ACCENT}
                onClick={() => navigate('/area/climate')}
                style={style}
                rollup={climateCard.rollup}
                controls={climateControls}
              />
            ),
          },
          {
            key: 'security',
            el: (style: React.CSSProperties) => (
              <AreaCard
                key="security"
                areaKey="security"
                title="Security"
                subtitle="Cameras & sensors"
                status={securityStatus}
                icon={
                  securityStatus.alertLevel === 'alert' ? (
                    <IconAlertTriangle className="w-6 h-6" />
                  ) : securityStatus.alertLevel === 'warn' ? (
                    <IconShieldAlert className="w-6 h-6" />
                  ) : (
                    <IconShieldCheck className="w-6 h-6" />
                  )
                }
                accentColor={SEC_ACCENT}
                onClick={() => navigate('/area/security')}
                style={style}
                rollup={securityRollup}
                // DISPLAY ONLY — no controls on security card (arm/disarm is gated)
              />
            ),
          },
          {
            key: 'lights',
            el: (style: React.CSSProperties) => (
              <AreaCard
                key="lights"
                areaKey="lights"
                title="Lights"
                subtitle="Lutron & HA"
                status={lightStatus}
                icon={<IconLightbulb className="w-6 h-6" />}
                accentColor={LIGHTS_ACCENT}
                onClick={() => navigate('/area/lights')}
                style={style}
                rollup={lightsCard.rollup}
                controls={lightsControls}
              />
            ),
          },
          {
            key: 'generator',
            el: (style: React.CSSProperties) => (
              <AreaCard
                key="generator"
                areaKey="generator"
                title="Generator"
                subtitle="Standby power"
                status={generatorStatus}
                icon={<IconZap className="w-6 h-6" />}
                accentColor={GEN_ACCENT}
                onClick={() => navigate('/area/generator')}
                style={style}
                rollup={generatorRollup}
                // DISPLAY ONLY — no generator controls on home card
              />
            ),
          },
        ];

        const visible = allCards.filter(c => isAreaAllowed(c.key));
        const count = visible.length;

        // Full 5-card layout: use the original fixed grid placement.
        if (count === 5) {
          const positions: Record<string, React.CSSProperties> = {
            pool:      { gridColumn: '1 / 2', gridRow: '1 / 2' },
            climate:   { gridColumn: '2 / 4', gridRow: '1 / 2' },
            security:  { gridColumn: '1 / 2', gridRow: '2 / 3' },
            lights:    { gridColumn: '2 / 3', gridRow: '2 / 3' },
            generator: { gridColumn: '3 / 4', gridRow: '2 / 3' },
          };
          return (
            <div
              className="flex-1 grid gap-4 overflow-hidden"
              style={{ gridTemplateRows: '1fr 1fr', gridTemplateColumns: '1fr 1fr 1fr' }}
            >
              {visible.map(c => c.el(positions[c.key] ?? {}))}
            </div>
          );
        }

        // LOW COUNTS (1–2 cards): centered, well-proportioned cluster.
        if (count <= 2) {
          return (
            <div className="flex-1 flex items-center justify-center overflow-hidden">
              <div
                className="grid gap-4 w-full"
                style={{
                  gridTemplateColumns:
                    count === 1
                      ? 'minmax(0, 1fr)'
                      : 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
                  maxWidth: count === 1 ? '34rem' : '52rem',
                  maxHeight: '36rem',
                  height: '100%',
                  gridAutoRows: '1fr',
                  marginInline: 'auto',
                }}
              >
                {visible.map(c => c.el({}))}
              </div>
            </div>
          );
        }

        // 3–4 cards: responsive multi-column grid filling the full canvas.
        const cols = count === 3 ? 3 : 2;
        return (
          <div
            className="flex-1 grid gap-4 overflow-hidden"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridAutoRows: '1fr',
            }}
          >
            {visible.map(c => c.el({}))}
          </div>
        );
      })()}
    </div>
  );
};

export default HomeOverview;
