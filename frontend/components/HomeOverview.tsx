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
 * Each card is a tappable liquid-glass tile showing:
 *   - Area name  (large, sans-serif, high contrast)
 *   - 1-line status summary  (sourced from HA device/entity state)
 *   - Contextual icon  (area-appropriate, coloured)
 *   - "Open →" affordance
 *
 * Design language: same glass material as rest of b-panels (--surface, --tile-alpha,
 * --tile-border, --tile-blur, --bg-gradient). No new design tokens introduced.
 * Light/dark/ambient-night legible via the existing CSS variable system.
 *
 * Data: reads from useDashboard() devices + HA state. Each card's summary derives
 * from whichever HA entities are available, with graceful "No data" fallback.
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { useWeather } from '../hooks/useWeather';
import { DeviceType } from '../types';
import {
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconLightbulb,
  IconZap,
  IconThermometer,
  IconSnowflake,
  IconFlame,
  IconShieldCheck,
  IconCamera,
  IconCheckCircle,
  IconAlertTriangle,
} from './icons';
import { useSecurityIndicator } from '../hooks/useSecurityIndicator';
import { SECURITY_LEVEL_CONFIG } from './SecurityStatusIndicator';
import SecurityStatusIndicator from './SecurityStatusIndicator';

// ── Security card animation keyframes (injected once) ─────────────────────────
const HOME_SEC_STYLE_ID = 'home-sec-card-anims';
if (typeof document !== 'undefined' && !document.getElementById(HOME_SEC_STYLE_ID)) {
  const s = document.createElement('style');
  s.id = HOME_SEC_STYLE_ID;
  s.textContent = `
@keyframes home-sec-active-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.72; }
}
@keyframes home-sec-ring-out {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2.2); opacity: 0;   }
}
@keyframes home-sec-dot-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}
  `;
  document.head.appendChild(s);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pull the first entity whose id matches a regexp from the device map. */
function findDeviceByPattern(devices: any[], pattern: RegExp) {
  return devices.find(d => pattern.test(d.id));
}

function entityState(deviceMap: Map<string, any>, entityId: string): string | null {
  const d = deviceMap.get(entityId);
  if (!d) return null;
  if (typeof d.state === 'string') return d.state;
  if (typeof d.state === 'number') return String(d.state);
  if (typeof d.state === 'object' && d.state !== null && 'mode' in d.state) {
    return String((d.state as any).mode);
  }
  return null;
}

// ── Area status derivations ─────────────────────────────────────────────────

interface AreaStatus {
  summary: string;
  detail?: string;
  ok: boolean;
  alertLevel: 'ok' | 'warn' | 'alert';
}

function usePoolStatus(devices: any[], deviceMap: Map<string, any>): AreaStatus {
  return useMemo(() => {
    // Look for IntelliCenter pool virtual device state
    const poolDevice = devices.find(d => d.type === DeviceType.IntelliCenterPool || d.type === DeviceType.PoolArea);
    if (poolDevice) {
      const s = poolDevice.state;
      if (typeof s === 'object' && s !== null) {
        const bodies = (s as any).bodies || [];
        if (bodies.length > 0) {
          const pool = bodies.find((b: any) => b.type === 'pool') || bodies[0];
          const temp = pool.waterTemp != null ? `${Math.round(pool.waterTemp)}°F` : null;
          const heating = pool.heaterState === 'heating';
          return {
            summary: temp ? `Water ${temp}` : 'Pool active',
            detail: heating ? 'Heating' : undefined,
            ok: true,
            alertLevel: 'ok',
          };
        }
      }
    }
    // Fallback: scan for any pool-related temperature sensor
    const poolTemp = findDeviceByPattern(devices, /intellicenter|pool.*temp|spa.*temp/i);
    if (poolTemp && typeof poolTemp.state === 'number') {
      return { summary: `Water ${Math.round(poolTemp.state)}°F`, ok: true, alertLevel: 'ok' };
    }
    if (poolTemp) {
      return { summary: 'Pool available', ok: true, alertLevel: 'ok' };
    }
    // No IntelliCenter entities yet — standby/offline ring dot, deliberate state
    return { summary: 'Waiting for controller', ok: false, alertLevel: 'ok' };
  }, [devices, deviceMap]);
}

function useClimateStatus(devices: any[], deviceMap: Map<string, any>): AreaStatus {
  return useMemo(() => {
    // Gather all climate entities
    const climateDevices = devices.filter(d => d.type === DeviceType.Thermostat);
    if (climateDevices.length === 0) {
      // No zones discovered yet — standby ring dot, deliberate state
      return { summary: 'Zones not yet discovered', ok: false, alertLevel: 'ok' };
    }
    let heating = 0, cooling = 0, idle = 0;
    let temps: number[] = [];
    climateDevices.forEach(d => {
      const s = d.state;
      if (typeof s === 'object' && s !== null) {
        const mode = (s as any).mode || '';
        const ct = (s as any).currentTemp;
        if (typeof ct === 'number' && ct > 0) temps.push(ct);
        if (mode === 'heat' || mode === 'heat_cool') heating++;
        else if (mode === 'cool') cooling++;
        else idle++;
      }
    });
    const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
    const mode = heating > cooling ? 'Heating' : cooling > heating ? 'Cooling' : 'Idle';
    const tempStr = avgTemp != null ? ` · ${avgTemp}°F avg` : '';
    return {
      summary: `${climateDevices.length} zones · ${mode}${tempStr}`,
      ok: true,
      alertLevel: 'ok',
    };
  }, [devices, deviceMap]);
}

/**
 * useSecurityStatus is now a thin shim that maps SecurityAlertLevel from
 * useSecurityIndicator (real UniFi data) to an AreaStatus for the generic
 * AreaCard. The enhanced SecurityCard below renders its own richer UI.
 */
function useSecurityStatus(alarmState: any, devices: any[]): AreaStatus {
  return useMemo(() => {
    // Keep the alarmState VIOLATION path for the legacy alarm panel (if ever wired).
    if (alarmState?.securityState === 'VIOLATION') {
      return { summary: 'Intrusion detected', ok: false, alertLevel: 'alert' };
    }
    if (alarmState?.armState === 'armedAway') return { summary: 'Armed Away', ok: true, alertLevel: 'warn' };
    if (alarmState?.armState === 'armedStay') return { summary: 'Armed Stay', ok: true, alertLevel: 'warn' };

    // Fallback: count cameras from device registry
    const cameras = devices.filter(d =>
      d.type === DeviceType.Camera || d.type === DeviceType.CameraGroup || d.type === DeviceType.UnifiSecurity
    );
    if (cameras.length > 0) {
      return { summary: `${cameras.length} camera${cameras.length > 1 ? 's' : ''} active`, ok: true, alertLevel: 'ok' };
    }
    return { summary: 'Monitoring · All clear', ok: true, alertLevel: 'ok' };
  }, [alarmState, devices]);
}

function useLightStatus(devices: any[]): AreaStatus {
  return useMemo(() => {
    const lights = devices.filter(d =>
      d.type === DeviceType.Light || d.type === DeviceType.Dimmer || d.type === DeviceType.LutronSurface
    );
    // LutronSurface is self-driven — it discovers entities live even without
    // explicit device entries. Show a clean "all off" state, not an error.
    if (lights.length === 0) return { summary: 'All off · Lutron ready', ok: true, alertLevel: 'ok' };

    let on = 0;
    lights.forEach(d => {
      if (d.type === DeviceType.Dimmer) {
        const s = d.state;
        if (typeof s === 'object' && (s as any).isOn) on++;
        else if (typeof s === 'number' && s > 0) on++;
      } else if (d.type === DeviceType.Light) {
        if (d.state === true) on++;
      }
    });
    if (on === 0) return { summary: `All off · ${lights.length} lights`, ok: true, alertLevel: 'ok' };
    return { summary: `${on} light${on > 1 ? 's' : ''} on · ${lights.length} total`, ok: true, alertLevel: 'ok' };
  }, [devices]);
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

// ── Area card component ──────────────────────────────────────────────────────

interface AreaCardProps {
  areaKey: string;
  title: string;
  subtitle?: string;
  status: AreaStatus;
  icon: React.ReactNode;
  accentColor: string; // CSS color string for the accent glow/icon
  onClick: () => void;
  style?: React.CSSProperties;
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
}) => {
  const [hovered, setHovered] = React.useState(false);

  const alertBg = ALERT_COLORS[status.alertLevel];

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex flex-col justify-between text-left transition-all"
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
        padding: '24px',
        cursor: 'pointer',
        outline: 'none',
        overflow: 'hidden',
        ...style,
      }}
      aria-label={`Open ${title} area`}
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
      <div className="relative flex items-start justify-between">
        {/* Icon badge */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
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

        {/* Status dot — 3 states: active (green glow), alert/warn (coloured glow),
             standby/offline (muted ring — intentional, not broken) */}
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
                  // Standby / not configured — muted ring, reads as "offline/idle", not error
                  // Use opacity on --text so the ring is visible in both light and dark mode
                  backgroundColor: 'transparent',
                  border: '1.5px solid rgb(var(--text) / 0.22)',
                  width: 8,
                  height: 8,
                }),
          }}
        />
      </div>

      {/* Area name */}
      <div className="relative">
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: 'rgb(var(--text))',
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'rgb(var(--text) / 0.45)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Status line */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color:
              status.alertLevel === 'alert'
                ? 'rgb(var(--accent-alert))'
                : status.alertLevel === 'warn'
                ? 'rgb(var(--accent-warn))'
                : 'rgb(var(--text) / 0.65)',
            lineHeight: 1.4,
          }}
        >
          {status.summary}
        </div>
        {status.detail && (
          <div
            style={{
              fontSize: 12,
              color: 'rgb(var(--text) / 0.4)',
              marginTop: 2,
            }}
          >
            {status.detail}
          </div>
        )}
      </div>

      {/* Open chevron */}
      <div
        className="relative flex items-center gap-1"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: accentColor,
          letterSpacing: '0.04em',
          opacity: hovered ? 1 : 0.7,
          transition: 'opacity 0.18s ease',
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
    </button>
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

// ── Security card — enhanced, always color-coded by real UniFi state ──────────
/**
 * SecurityCard replaces the generic AreaCard for the security area.
 * It consumes useSecurityIndicator directly so it shows:
 *   - CLEAR  → green, calm
 *   - RECENT → amber, subtle pulse ring
 *   - ACTIVE → RED, impossible to miss: pulsing glow, red background bloom,
 *               detection count badge, doorbell flash
 *
 * No arm/disarm state fabricated — that requires a real alarm_control_panel.
 * Opening this card taps the SecurityStatusIndicator (which shows the modal
 * and navigates to /area/security from there).
 */
const SecurityCard: React.FC<{ onClick: () => void; style?: React.CSSProperties }> = ({ onClick, style }) => {
  const secIndicator = useSecurityIndicator();
  const { level, summary, activeCameraCount, doorbellActive, hasCameras, isLoading } = secIndicator;
  const cfg = SECURITY_LEVEL_CONFIG[level];

  const [hovered, setHovered] = React.useState(false);
  const MONO = '"JetBrains Mono", "Fira Code", "Courier New", monospace';

  const cardBorderColor = level === 'active'
    ? `color-mix(in srgb, ${cfg.accent} 65%, rgba(255,255,255,0.1))`
    : level === 'recent'
    ? `color-mix(in srgb, ${cfg.accent} 42%, var(--tile-border))`
    : 'var(--tile-border)';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex flex-col justify-between text-left transition-all overflow-hidden"
      style={{
        backgroundColor: `rgb(var(--surface) / var(--tile-alpha))`,
        backdropFilter: `blur(var(--tile-blur))`,
        WebkitBackdropFilter: `blur(var(--tile-blur))`,
        border: `1px solid ${cardBorderColor}`,
        borderRadius: 'var(--radius-tile)',
        boxShadow: level === 'active'
          ? [
              hovered ? 'var(--elev-2)' : 'var(--elev-1)',
              `0 0 ${hovered ? '48px' : '28px'} -6px ${cfg.accent}88`,
              `inset 0 0 32px -8px ${cfg.accent}33`,
            ].join(', ')
          : level === 'recent'
          ? [
              hovered ? 'var(--elev-2)' : 'var(--elev-1)',
              `0 0 20px -6px ${cfg.accent}66`,
            ].join(', ')
          : hovered ? `var(--elev-2), 0 0 24px -8px ${cfg.accent}55` : 'var(--elev-1)',
        transform: hovered ? 'translateY(-2px) scale(1.008)' : 'translateY(0) scale(1)',
        padding: '24px',
        cursor: 'pointer',
        outline: 'none',
        animation: level === 'active' ? 'home-sec-active-pulse 2s ease-in-out infinite' : 'none',
        transition: 'all 280ms cubic-bezier(0.22,1,0.36,1)',
        ...style,
      }}
      aria-label={`Security: ${summary}. Open security overview.`}
    >
      {/* Background color bloom for active state */}
      {level !== 'clear' && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          background: level === 'active'
            ? `radial-gradient(130% 80% at 50% 120%, ${cfg.accent}22, transparent 65%)`
            : `radial-gradient(100% 60% at 50% 100%, ${cfg.accent}14, transparent 70%)`,
          transition: 'opacity 0.5s ease',
        }} />
      )}

      {/* Background accent blot */}
      <div style={{
        position: 'absolute', top: -40, right: -40,
        width: 180, height: 180, borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${cfg.accent}${level === 'active' ? '40' : '20'} 0%, transparent 70%)`,
        transition: 'all 0.4s ease',
      }} />

      {/* Expanding pulse ring — active state only */}
      {level === 'active' && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          border: `2px solid ${cfg.accent}`,
          animation: 'home-sec-ring-out 2.2s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Top row: icon + status dot */}
      <div className="relative flex items-start justify-between">
        {/* Icon badge */}
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          backgroundColor: `${cfg.accent}${level === 'active' ? '33' : '22'}`,
          border: `1px solid ${cfg.accent}${level === 'active' ? '66' : '44'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: cfg.accent, flexShrink: 0,
          boxShadow: level === 'active' ? `0 0 16px -4px ${cfg.accent}88` : 'none',
          transition: 'all 0.3s ease',
        }}>
          {level === 'active'
            ? <IconAlertTriangle className="w-6 h-6" />
            : level === 'recent'
            ? <IconShieldAlert className="w-6 h-6" />
            : <IconShieldCheck className="w-6 h-6" />}
        </div>

        {/* Status live dot */}
        <div style={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
          <div style={{
            width: 9, height: 9, borderRadius: '50%',
            backgroundColor: cfg.accent,
            boxShadow: `0 0 8px ${cfg.accent}`,
            animation: level !== 'clear' ? 'home-sec-dot-blink 1.2s ease-in-out infinite' : 'none',
          }} />
        </div>
      </div>

      {/* Text block */}
      <div className="relative">
        <div style={{
          fontSize: 26, fontWeight: 700, lineHeight: 1.1,
          letterSpacing: '-0.02em', color: 'rgb(var(--text))', marginBottom: 6,
        }}>Security</div>
        <div style={{
          fontSize: 12, fontWeight: 500,
          color: 'rgb(var(--text) / 0.45)',
          letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10,
        }}>Cameras & sensors</div>

        {/* Status line */}
        <div style={{
          fontSize: 14, fontWeight: 600, color: cfg.accent, lineHeight: 1.4,
          textShadow: level === 'active' ? `0 0 12px ${cfg.accent}88` : 'none',
        }}>{summary}</div>

        {/* Detection badges when active */}
        {(activeCameraCount > 0 || doorbellActive) && (
          <div className="flex items-center flex-wrap" style={{ gap: 5, marginTop: 8 }}>
            {activeCameraCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 99,
                fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700,
                letterSpacing: '0.05em', color: cfg.accent,
                backgroundColor: `${cfg.accent}22`,
                border: `1px solid ${cfg.accent}44`,
                animation: 'home-sec-active-pulse 1.5s ease-in-out infinite',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: cfg.accent, boxShadow: `0 0 4px ${cfg.accent}`, flexShrink: 0 }} />
                {activeCameraCount} ACTIVE
              </span>
            )}
            {doorbellActive && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 99,
                fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700,
                letterSpacing: '0.05em', color: '#1a0a00',
                backgroundColor: 'rgb(251 191 36)',
                animation: 'home-sec-active-pulse 0.9s ease-in-out infinite',
              }}>DOORBELL</span>
            )}
          </div>
        )}
      </div>

      {/* Open chevron */}
      <div
        className="relative flex items-center gap-1"
        style={{
          fontSize: 12, fontWeight: 600, color: cfg.accent,
          letterSpacing: '0.04em',
          opacity: hovered ? 1 : 0.7,
          transition: 'opacity 0.18s ease',
        }}
      >
        <span>Open</span>
        <span style={{ display: 'inline-block', transform: hovered ? 'translateX(3px)' : 'translateX(0)', transition: 'transform 0.18s ease' }}>→</span>
      </div>
    </button>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

const HomeOverview: React.FC = () => {
  const { devices, deviceMap, alarmState } = useDashboard();
  const { weather } = useWeather();
  const navigate = useNavigate();

  const poolStatus = usePoolStatus(devices, deviceMap);
  const climateStatus = useClimateStatus(devices, deviceMap);
  // securityStatus kept for legacy alarmState compatibility
  const securityStatus = useSecurityStatus(alarmState, devices);
  const lightStatus = useLightStatus(devices);
  const generatorStatus = useGeneratorStatus(devices);

  // Real security indicator — drives QuickStat and SecurityCard color
  const secIndicator = useSecurityIndicator();
  const secCfg = SECURITY_LEVEL_CONFIG[secIndicator.level];

  // Quick stats bar data
  const outsideTemp = weather?.temperature != null ? `${weather.temperature}°F` : '--';
  const lightsOnCount = useMemo(() => {
    return devices.filter(d => {
      if (d.type === DeviceType.Light) return d.state === true;
      if (d.type === DeviceType.Dimmer) {
        if (typeof d.state === 'number') return d.state > 0;
        if (typeof d.state === 'object' && d.state !== null) return (d.state as any).isOn === true;
      }
      return false;
    }).length;
  }, [devices]);

  const climateZones = devices.filter(d => d.type === DeviceType.Thermostat).length;

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
          <QuickStat
            label="Lights on"
            value={lightsOnCount === 0 ? 'All off' : `${lightsOnCount}`}
            icon={<IconLightbulb className="w-4 h-4" />}
            color="rgb(var(--accent-light))"
          />
          {/* Security QuickStat — now color-coded from real UniFi data.
              Label shows live summary. Tapping opens the SecurityModal via
              the SecurityStatusIndicator pill. No arm/disarm state fabricated. */}
          <QuickStat
            label="Security"
            value={secIndicator.isLoading ? '…' : secCfg.label}
            icon={
              secIndicator.level === 'active'
                ? <IconAlertTriangle className="w-4 h-4" />
                : secIndicator.level === 'recent'
                ? <IconShieldAlert className="w-4 h-4" />
                : <IconShieldCheck className="w-4 h-4" />
            }
            color={secCfg.accent}
          />
          {climateZones > 0 && (
            <QuickStat
              label="Climate zones"
              value={`${climateZones}`}
              icon={<IconWind className="w-4 h-4" />}
              color="rgb(var(--accent))"
            />
          )}
        </div>
      </div>

      {/* Area cards grid — fills remaining height */}
      <div
        className="flex-1 grid gap-4 overflow-hidden"
        style={{
          // 2 rows: top row (Pool + Climate, 55%) + bottom row (Security + Lights + Generator, 45%)
          gridTemplateRows: '1fr 1fr',
          gridTemplateColumns: '1fr 1fr 1fr',
        }}
      >
        {/* Pool — large, top-left */}
        <AreaCard
          areaKey="pool"
          title="Pool"
          subtitle="Backyard"
          status={poolStatus}
          icon={<IconWaves className="w-6 h-6" />}
          accentColor="rgb(56,189,248)"
          onClick={() => navigate('/area/pool')}
          style={{ gridColumn: '1 / 2', gridRow: '1 / 2' }}
        />

        {/* Climate — large, top-center+right */}
        <AreaCard
          areaKey="climate"
          title="Heating & Cooling"
          subtitle="Whole home"
          status={climateStatus}
          icon={<IconWind className="w-6 h-6" />}
          accentColor="rgb(var(--accent))"
          onClick={() => navigate('/area/climate')}
          style={{ gridColumn: '2 / 4', gridRow: '1 / 2' }}
        />

        {/* Security — bottom-left.
            Uses SecurityCard (not generic AreaCard) for rich, real-state display.
            Clicking SecurityCard navigates to /area/security.
            The SecurityModal auto-surfaces on 'active' state via
            SecurityStatusIndicator in the Header. */}
        <SecurityCard
          onClick={() => navigate('/area/security')}
          style={{ gridColumn: '1 / 2', gridRow: '2 / 3' }}
        />

        {/* Lights — bottom-center */}
        <AreaCard
          areaKey="lights"
          title="Lights"
          subtitle="Lutron & HA"
          status={lightStatus}
          icon={<IconLightbulb className="w-6 h-6" />}
          accentColor="rgb(var(--accent-light))"
          onClick={() => navigate('/area/lights')}
          style={{ gridColumn: '2 / 3', gridRow: '2 / 3' }}
        />

        {/* Generator — bottom-right */}
        <AreaCard
          areaKey="generator"
          title="Generator"
          subtitle="Standby power"
          status={generatorStatus}
          icon={<IconZap className="w-6 h-6" />}
          accentColor="rgb(var(--accent-plug))"
          onClick={() => navigate('/area/generator')}
          style={{ gridColumn: '3 / 4', gridRow: '2 / 3' }}
        />
      </div>
    </div>
  );
};

export default HomeOverview;
