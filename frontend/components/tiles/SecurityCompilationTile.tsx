/**
 * SecurityCompilationTile — Security Area compilation panel.
 *
 * Immersive area/function dashboard for cameras and security sensors.
 * Composes:
 *   (A) UniFi Protect camera wall — HA-proxied HLS streams/snapshots,
 *       live smart-detect chips, motion/doorbell pulses, floodlight STATE
 *       (display only).
 *   (B) Recent-events timeline — cross-camera activity feed.
 *   (C) Contact/lock/door sensors — graceful degradation if none present.
 *
 * SECURITY CONTRACT (hard limits — must not be relaxed):
 *   - No RTSP/RTSPS creds ever passed to the browser.
 *   - License plate: boolean indicator only. Plate text = PII, never shown.
 *   - Floodlight: display state only. Control is equipment-gated/deferred.
 *   - No face/biometric data, labels, or UI.
 *   - No arm/disarm, recording-mode change, siren, or floodlight CONTROL
 *     in quick-actions. Those are security-hardware actions (equipment-gated,
 *     deferred). See "Deferred / equipment-gated actions" note below.
 *   - Quick-actions are DISPLAY/NAVIGATION only: focus a camera, show all
 *     events. Nothing that writes to a security device.
 *
 * DEFERRED / EQUIPMENT-GATED ACTIONS (not wired — log this for future work):
 *   - Alarm arm/disarm → AlarmTile/Alarmo path (requires PIN UI + deliberate
 *     human approval; never auto-applied).
 *   - Recording mode toggle → equipment-gated; needs HA service call to
 *     UniFi Protect integration + explicit operator confirmation.
 *   - Floodlight on/off → equipment-gated; display state surfaced only.
 *   - Siren/chime → equipment-gated; must be coordinated with alarm panel.
 *
 * AESTHETIC: calm dark surveillance surface — deep slate/charcoal backdrop,
 * scanline texture, green CLEAR / red ALERT accent pulses. Legible in
 * light + dark (light-mode override pins dark context like Pool does).
 * iPad-landscape (1366×1024) primary; responsive via container queries.
 *
 * LAYOUT:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  HERO — cameras online · any active detection · last-activity    │
 *   ├────────────────────────────┬─────────────────────────────────────┤
 *   │  CAMERA WALL               │  EVENTS + SENSORS                   │
 *   │  (featured + grid)         │  recent-events timeline + contacts  │
 *   └────────────────────────────┴─────────────────────────────────────┘
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { TileProps } from '../tileRegistry';
import { useUnifiSurface } from '../../hooks/useUnifiSurface';
import type { UnifiCamera, UnifiEvent } from '../../hooks/useUnifiSurface';
import UnifiCameraCard from './UnifiCameraCard';
import * as haClient from '../../services/haClient';
import type { HassEntities } from 'home-assistant-js-websocket';
import { useReducedMotion } from '../../design-system';

// ── Icons ──────────────────────────────────────────────────────────────────────
import {
  IconShieldAlert, IconActivity, IconAlertTriangle,
  IconWifiOff, IconLoader2, IconDoorOpen,
  IconLock, IconX,
} from '../icons';

// ── Helpers ────────────────────────────────────────────────────────────────────
import { fluidTextXs, fluidTextSm } from './tileScale';

// =============================================================================
// SecurityAreaConfig — baked into device.state as JSON (all fields optional)
// =============================================================================

export interface SecurityAreaConfig {
  /** Display name shown in the hero. Default: 'Security' */
  areaName?: string;
  /** Show the recent-events panel. Default: true */
  showEvents?: boolean;
  /** Show contact/lock sensor panel (if any found). Default: true */
  showSensors?: boolean;
  /** Limit how many cameras appear in the wall (0 = all). Default: 0 */
  maxCameras?: number;
}

const DEFAULTS: Required<SecurityAreaConfig> = {
  areaName:    'Security',
  showEvents:  true,
  showSensors: true,
  maxCameras:  0,
};

function parseConfig(raw: unknown): Required<SecurityAreaConfig> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      areaName:    typeof r.areaName    === 'string'  ? r.areaName    : DEFAULTS.areaName,
      showEvents:  typeof r.showEvents  === 'boolean' ? r.showEvents  : DEFAULTS.showEvents,
      showSensors: typeof r.showSensors === 'boolean' ? r.showSensors : DEFAULTS.showSensors,
      maxCameras:  typeof r.maxCameras  === 'number'  ? r.maxCameras  : DEFAULTS.maxCameras,
    };
  }
  return { ...DEFAULTS };
}

// =============================================================================
// Contact/lock sensor discovery
// =============================================================================

interface SecuritySensor {
  entityId: string;
  name: string;
  deviceClass: 'door' | 'window' | 'lock' | 'motion' | 'other';
  isOpen: boolean;   // true = open/unlocked/triggered
  isUnavailable: boolean;
}

function classifyContact(entityId: string, deviceClass: string | null): SecuritySensor['deviceClass'] {
  if (entityId.startsWith('lock.') || deviceClass === 'lock') return 'lock';
  if (deviceClass === 'door')   return 'door';
  if (deviceClass === 'window') return 'window';
  if (deviceClass === 'motion') return 'motion';
  return 'other';
}

function buildSensors(entities: HassEntities): SecuritySensor[] {
  const result: SecuritySensor[] = [];
  for (const [eid, e] of Object.entries(entities)) {
    const isContact = eid.startsWith('binary_sensor.') &&
      ['door', 'window', 'motion', 'opening', 'garage_door'].includes(e.attributes?.device_class ?? '');
    const isLock    = eid.startsWith('lock.');

    if (!isContact && !isLock) continue;
    // Skip entities that belong to the UniFi Protect namespace (cameras expose
    // their own binary_sensors; those are already shown in the camera cards).
    if (eid.includes('_motion') || eid.includes('_doorbell') ||
        eid.includes('_person') || eid.includes('_vehicle') ||
        eid.includes('_animal') || eid.includes('_package') ||
        eid.includes('_license_plate')) continue;

    const dc = e.attributes?.device_class ?? null;
    result.push({
      entityId:      eid,
      name:          e.attributes?.friendly_name || eid.replace(/^(binary_sensor|lock)\./, '').replace(/_/g, ' '),
      deviceClass:   classifyContact(eid, dc),
      isOpen:        e.state === 'on' || e.state === 'unlocked' || e.state === 'open',
      isUnavailable: e.state === 'unavailable' || e.state === 'unknown',
    });
  }
  return result.sort((a, b) => {
    // Open/unlocked first, then alphabetical
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// =============================================================================
// CSS animation keyframes — injected once
// =============================================================================

const STYLE_ID = 'sec-comp-anims';
let _animsInjected = false;
function ensureAnims() {
  if (_animsInjected || typeof document === 'undefined') return;
  _animsInjected = true;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
/* ── Security Compilation Tile keyframes ─────────────────────────────────
   Calm, purposeful motion only. No gimmicks. */

/* Slow scanline travel — subtle surveillance aesthetic. */
@keyframes sec-comp-scan {
  0%   { transform: translateY(-100%); opacity: 0.10; }
  100% { transform: translateY(200vh); opacity: 0.03; }
}
/* Status glow pulse — alert state only. */
@keyframes sec-comp-alert-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.42; }
}
/* Section slide-in on mount. */
@keyframes sec-comp-section-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0);   }
}
/* Hero stat count-up feel — a single brief brightness flash on value change. */
@keyframes sec-comp-stat-pop {
  0%   { filter: brightness(1.8); }
  100% { filter: brightness(1);   }
}
/* Sensor open: brief red flash */
@keyframes sec-comp-open-flash {
  0%   { background-color: color-mix(in srgb, var(--accent-alert) 28%, var(--glass-l3-bg)); }
  60%  { background-color: color-mix(in srgb, var(--accent-alert) 14%, var(--glass-l3-bg)); }
  100% { background-color: color-mix(in srgb, var(--accent-alert) 14%, var(--glass-l3-bg)); }
}
/* Live dot blink */
@keyframes sec-comp-live-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

/* ── Light-mode override — same pattern as PoolCompilationTile ─────────────
   The Security surface is intentionally a DARK immersive scene in ALL themes.
   In light mode, pin the dark-surface context so text remains legible. */
body.light-mode .sec-comp-root {
  --text: 220 232 248;
  --glass-l1-bg: rgba(20, 26, 38, 0.68);
  --glass-l1-border: rgba(255, 255, 255, 0.13);
  --glass-l1-tint: rgba(255, 255, 255, 0.05);
  --glass-l1-brightness: 1.06;
  --glass-l1-backdrop: blur(var(--glass-l1-blur)) saturate(var(--glass-l1-saturate)) brightness(1.06);
  --glass-l2-bg: rgba(28, 36, 52, 0.58);
  --glass-l2-border: rgba(255, 255, 255, 0.16);
  --glass-l2-tint: rgba(255, 255, 255, 0.06);
  --glass-l2-brightness: 1.08;
  --glass-l2-backdrop: blur(var(--glass-l2-blur)) saturate(var(--glass-l2-saturate)) brightness(1.08);
  --glass-l3-bg: rgba(38, 48, 68, 0.56);
  --glass-l3-border: rgba(255, 255, 255, 0.14);
  --glass-l3-tint: rgba(255, 255, 255, 0.055);
  --glass-l3-brightness: 1.10;
  --glass-l3-backdrop: blur(var(--glass-l3-blur)) saturate(var(--glass-l3-saturate)) brightness(1.10);
  --glass-l4-bg: rgba(14, 18, 28, 0.50);
  --glass-l4-border: rgba(255, 255, 255, 0.09);
  --glass-l4-tint: rgba(255, 255, 255, 0.03);
  --glass-l4-backdrop: blur(var(--glass-l4-blur)) saturate(var(--glass-l4-saturate)) brightness(1.03);
  --rim: inset 0 1px 0 0 rgba(255,255,255,0.09), inset 0 -1px 0 0 rgba(0,0,0,0.28);
}

/* ── Deck container queries (mirrors pool-comp-deck) ──────────────────────── */
.sec-comp-deck {
  display: grid;
  grid-template-columns: 1fr;
  gap: clamp(0.4rem, 1.4cqw, 0.7rem);
  width: 100%;
}
@container (min-width: 38rem) {
  .sec-comp-deck { grid-template-columns: 1fr 1fr; }
  .sec-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
}
@container (min-width: 60rem) {
  /* Camera wall takes 2 cols, side panel takes 1 */
  .sec-comp-deck { grid-template-columns: 2fr 1fr; }
  .sec-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
  .sec-comp-deck[data-cols="2"] { grid-template-columns: 1fr 1fr; }
}
`;
  document.head.appendChild(s);
}

// =============================================================================
// SECURITY BACKDROP — calm dark slate texture
// =============================================================================

const SecurityBackdrop: React.FC<{ alertActive: boolean; reduced: boolean }> = ({ alertActive, reduced }) => (
  <div
    className="absolute inset-0 overflow-hidden pointer-events-none"
    aria-hidden="true"
    style={{ borderRadius: 'var(--radius-surface)' }}
  >
    {/* Base depth gradient: deep charcoal-slate */}
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(170deg,
          rgba(18, 24, 36, 0.62) 0%,
          rgba(13, 18, 28, 0.82) 48%,
          rgba(8, 12, 20, 0.94) 100%)`,
      }}
    />
    {/* Faint edge-anchored accent washes */}
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity: alertActive ? 0.7 : 0.35, transition: 'opacity 1.0s ease' }}
    >
      <defs>
        <radialGradient id="scWashL" cx="0%" cy="25%" r="65%">
          <stop offset="0%"   stopColor={alertActive ? '#dc2626' : '#1e3a5f'} stopOpacity="0.14" />
          <stop offset="100%" stopColor="#0f1a2e" stopOpacity="0.0" />
        </radialGradient>
        <radialGradient id="scWashR" cx="100%" cy="65%" r="70%">
          <stop offset="0%"   stopColor={alertActive ? '#dc2626' : '#1e3a5f'} stopOpacity="0.10" />
          <stop offset="100%" stopColor="#0f1a2e" stopOpacity="0.0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="500" fill="url(#scWashL)"
        style={!reduced ? { animation: 'sec-comp-section-in 2s ease both, none' } : {}} />
      <rect x="0" y="0" width="800" height="500" fill="url(#scWashR)" />
    </svg>
  </div>
);

// =============================================================================
// SHARED MICRO-COMPONENTS
// =============================================================================

const CLEAR_COLOR = 'rgb(52 211 153)';
const ALERT_COLOR = 'var(--accent-alert)';
const WARN_COLOR  = 'var(--accent-warn)';
const MONO = '"JetBrains Mono", "Fira Code", "Courier New", monospace';

const SectionLabel: React.FC<{
  children: React.ReactNode;
  icon?: React.ReactNode;
  accent?: string;
}> = ({ children, icon, accent = CLEAR_COLOR }) => (
  <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
    {icon && (
      <span style={{ color: accent, display: 'flex', alignItems: 'center', width: 13, height: 13 }}>
        {icon}
      </span>
    )}
    <span
      className="font-bold uppercase tracking-widest"
      style={{
        fontFamily: MONO,
        fontSize: 'clamp(0.44rem, 3.6cqmin, 0.6rem)',
        color: `color-mix(in srgb, ${accent} 70%, rgba(var(--text) / 0.35))`,
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </span>
    <div
      className="flex-1 h-px"
      style={{ background: `color-mix(in srgb, ${accent} 22%, var(--glass-l3-border))` }}
    />
  </div>
);

/** Glass section card */
const SectionCard: React.FC<{
  children: React.ReactNode;
  accent?: string;
  active?: boolean;
  style?: React.CSSProperties;
  className?: string;
}> = ({ children, accent, active = false, style, className }) => (
  <div
    className={className}
    style={{
      borderRadius: 'var(--radius-card)',
      backdropFilter:       'var(--glass-l2-backdrop)',
      WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
      backgroundColor: active && accent
        ? `color-mix(in srgb, ${accent} 14%, var(--glass-l2-bg))`
        : 'var(--glass-l2-bg)',
      backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
      border: `1px solid ${active && accent
        ? `color-mix(in srgb, ${accent} 36%, var(--glass-l2-border))`
        : 'var(--glass-l2-border)'}`,
      boxShadow: active && accent
        ? `var(--rim), inset 0 0 22px -6px color-mix(in srgb, ${accent} 20%, transparent), var(--elev-2)`
        : 'var(--rim), var(--elev-1)',
      padding: 'clamp(0.5rem, 1.6cqw, 0.85rem)',
      transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
      animation: 'sec-comp-section-in 380ms var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
      ...style,
    }}
  >
    {children}
  </div>
);

// =============================================================================
// HERO — SECURITY OVERVIEW
// =============================================================================

interface SecurityHeroProps {
  areaName: string;
  cameras: UnifiCamera[];
  hasAnyActivity: boolean;
  reduced: boolean;
}

function relativeTime(isoStr: string): string {
  if (!isoStr) return '';
  const delta = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (delta < 5)    return 'just now';
  if (delta < 60)   return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

/** A compact summary of the most recent event across all cameras. */
function lastActivitySummary(cameras: UnifiCamera[]): { label: string; ago: string } | null {
  let best: UnifiEvent | null = null;
  for (const cam of cameras) {
    for (const ev of cam.recentEvents) {
      if (!best || ev.lastUpdated > best.lastUpdated) best = ev;
    }
  }
  if (!best) return null;
  const label =
    best.kind === 'doorbell' ? 'Doorbell ring'
    : best.kind === 'vehicle' ? 'Vehicle detected'
    : best.eventType ?? 'Activity';
  return { label, ago: relativeTime(best.lastUpdated) };
}

const SecurityHero: React.FC<SecurityHeroProps> = ({
  areaName, cameras, hasAnyActivity, reduced,
}) => {
  const onlineCount  = cameras.filter(c => !c.isStale).length;
  const activeCount  = cameras.filter(
    c => c.motionActive || c.doorbellActive || Object.values(c.detections).some(Boolean) || c.licensePlateDetected
  ).length;
  const doorbellActive  = cameras.some(c => c.doorbellActive);
  const floodlightsOn   = cameras.filter(c => c.floodlightOn).length;
  const lastActivity    = lastActivitySummary(cameras);
  const statusLabel     = hasAnyActivity ? 'DETECTION ACTIVE' : 'ALL CLEAR';
  const statusColor     = hasAnyActivity ? ALERT_COLOR : CLEAR_COLOR;

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden"
      style={{
        height: 'clamp(9.5rem, 22cqw, 14.5rem)',
        borderTopLeftRadius:  'var(--radius-surface)',
        borderTopRightRadius: 'var(--radius-surface)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        // Base: deep security-dark gradient
        background: hasAnyActivity
          ? `linear-gradient(170deg,
              rgba(38, 18, 18, 0.72) 0%,
              rgba(28, 12, 12, 0.88) 50%,
              rgba(14, 8, 8, 0.96)   100%)`
          : `linear-gradient(170deg,
              rgba(16, 22, 34, 0.72) 0%,
              rgba(12, 16, 26, 0.88) 50%,
              rgba(7,  10, 18, 0.96) 100%)`,
        transition: 'background 1.0s ease',
      }}
    >
      {/* Scanline grid texture — surveillance feel */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)',
          mixBlendMode: 'multiply',
          zIndex: 1,
        }}
      />
      {/* Moving scan line */}
      {!reduced && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            height: '2px',
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${statusColor} 8%, transparent) 50%, transparent 100%)`,
            animation: 'sec-comp-scan 10s linear infinite',
            zIndex: 2,
          }}
        />
      )}
      {/* Alert bloom — red radial glow when activity detected */}
      {hasAnyActivity && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(120% 80% at 50% 120%, rgba(220,38,38,0.22), rgba(220,38,38,0.06) 40%, transparent 65%)',
            mixBlendMode: 'screen',
            animation: !reduced ? 'sec-comp-alert-pulse 2.2s ease-in-out infinite' : 'none',
            zIndex: 1,
          }}
        />
      )}

      {/* ── HUD overlay ──────────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 flex flex-col justify-between"
        style={{ padding: 'clamp(0.55rem, 2.4cqw, 0.95rem)', zIndex: 5 }}
      >
        {/* Top row: title + status */}
        <div className="flex items-start justify-between gap-3">
          {/* Title bead */}
          <div className="flex items-center" style={{ gap: 'clamp(0.35rem, 1.8cqw, 0.65rem)' }}>
            <div style={{
              width:  'clamp(30px, 4cqw, 44px)',
              height: 'clamp(30px, 4cqw, 44px)',
              borderRadius: 'var(--radius-control)',
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: hasAnyActivity
                ? `color-mix(in srgb, ${ALERT_COLOR} 28%, var(--glass-l3-bg))`
                : `color-mix(in srgb, ${CLEAR_COLOR} 22%, var(--glass-l3-bg))`,
              backgroundImage: 'var(--specular-strong)',
              border: `1px solid ${hasAnyActivity
                ? `color-mix(in srgb, ${ALERT_COLOR} 55%, var(--glass-l3-border))`
                : `color-mix(in srgb, ${CLEAR_COLOR} 50%, var(--glass-l3-border))`}`,
              boxShadow: `var(--rim), 0 0 20px -4px ${hasAnyActivity ? ALERT_COLOR : CLEAR_COLOR}55`,
              transition: 'all 0.4s ease',
            }}>
              <IconShieldAlert style={{
                width:  'clamp(16px, 2.4cqw, 22px)',
                height: 'clamp(16px, 2.4cqw, 22px)',
                color:  hasAnyActivity ? ALERT_COLOR : CLEAR_COLOR,
                filter: `drop-shadow(0 0 5px ${hasAnyActivity ? ALERT_COLOR : CLEAR_COLOR})`,
                animation: hasAnyActivity && !reduced ? 'sec-comp-alert-pulse 1.8s ease-in-out infinite' : 'none',
              }} />
            </div>
            <div className="flex flex-col" style={{ gap: 2 }}>
              <h2 style={{
                margin: 0,
                fontFamily: MONO,
                fontSize: 'clamp(0.95rem, 2.6cqw, 1.65rem)',
                fontWeight: 700,
                lineHeight: 1.1,
                color: 'rgb(225 235 248)',
                letterSpacing: '-0.01em',
                textShadow: '0 2px 12px rgba(0,0,0,0.65)',
              }}>{areaName}</h2>
              {/* Status chip */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                fontFamily: MONO,
                fontSize: 'clamp(0.42rem, 3.4cqmin, 0.58rem)',
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: statusColor,
                backdropFilter: 'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: `color-mix(in srgb, ${statusColor} 14%, var(--glass-l3-bg))`,
                border: `1px solid color-mix(in srgb, ${statusColor} 36%, transparent)`,
                width: 'fit-content',
                animation: hasAnyActivity && !reduced ? 'sec-comp-alert-pulse 1.6s ease-in-out infinite' : 'none',
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: 999,
                  background: statusColor,
                  boxShadow: `0 0 5px ${statusColor}`,
                  animation: !reduced ? 'sec-comp-live-blink 1.4s ease-in-out infinite' : 'none',
                  flexShrink: 0,
                }} />
                {statusLabel}
              </span>
            </div>
          </div>

          {/* Right: stat beads */}
          <div className="flex items-start flex-wrap justify-end" style={{ gap: 'clamp(0.3rem, 1.2cqw, 0.5rem)' }}>
            {/* Cameras online */}
            <HeroStatBead label="CAMERAS" value={cameras.length > 0 ? `${onlineCount}/${cameras.length}` : '--'} color={CLEAR_COLOR} />
            {/* Active detections */}
            {activeCount > 0 && (
              <HeroStatBead label="ACTIVE" value={String(activeCount)} color={ALERT_COLOR} pulse={!reduced} />
            )}
            {/* Floodlights on */}
            {floodlightsOn > 0 && (
              <HeroStatBead label="FLOOD" value={`${floodlightsOn} ON`} color="rgb(254 240 138)" />
            )}
            {/* Doorbell */}
            {doorbellActive && (
              <HeroStatBead label="DOORBELL" value="RING" color="rgb(251 191 36)" pulse={!reduced} />
            )}
          </div>
        </div>

        {/* Bottom row: last activity summary */}
        <div className="flex items-end justify-between gap-3">
          {lastActivity ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              backdropFilter: 'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: 'var(--glass-l3-bg)',
              backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
              border: '1px solid var(--glass-l3-border)',
              boxShadow: 'var(--rim)',
              borderRadius: 'var(--radius-control)',
              padding: 'clamp(0.2rem, 1cqw, 0.38rem) clamp(0.45rem, 1.8cqw, 0.7rem)',
            }}>
              <IconActivity style={{ width: 12, height: 12, color: 'rgba(var(--text) / 0.45)', flexShrink: 0 }} />
              <span style={{
                fontFamily: MONO,
                fontSize: 'clamp(0.44rem, 3.8cqmin, 0.62rem)',
                color: 'rgba(255,255,255,0.72)',
                fontWeight: 500,
              }}>{lastActivity.label}</span>
              <span style={{
                fontFamily: MONO,
                fontSize: 'clamp(0.4rem, 3.2cqmin, 0.55rem)',
                color: 'rgba(255,255,255,0.38)',
                marginLeft: 4,
              }}>{lastActivity.ago}</span>
            </div>
          ) : (
            <div style={{
              fontFamily: MONO,
              fontSize: 'clamp(0.44rem, 3.8cqmin, 0.6rem)',
              color: 'rgba(255,255,255,0.28)',
              letterSpacing: '0.04em',
            }}>No recent activity</div>
          )}
          {/* Live dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: '0.42rem', height: '0.42rem',
              borderRadius: 999,
              background: CLEAR_COLOR,
              boxShadow: `0 0 6px ${CLEAR_COLOR}`,
              animation: !reduced ? 'sec-comp-live-blink 1.8s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontFamily: MONO, fontSize: 'clamp(0.38rem, 3cqmin, 0.5rem)', color: CLEAR_COLOR, fontWeight: 700, letterSpacing: '0.06em' }}>LIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Small glass bead for hero stats */
const HeroStatBead: React.FC<{
  label: string; value: string; color: string; pulse?: boolean;
}> = ({ label, value, color, pulse }) => (
  <div style={{
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    padding: 'clamp(0.2rem, 0.9cqw, 0.35rem) clamp(0.35rem, 1.4cqw, 0.6rem)',
    borderRadius: 'var(--radius-control)',
    backdropFilter: 'var(--glass-l3-backdrop)',
    WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
    backgroundColor: `color-mix(in srgb, ${color} 14%, var(--glass-l3-bg))`,
    backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
    border: `1px solid color-mix(in srgb, ${color} 40%, var(--glass-l3-border))`,
    boxShadow: `var(--rim), 0 0 12px -4px color-mix(in srgb, ${color} 35%, transparent)`,
    animation: pulse ? 'sec-comp-alert-pulse 1.6s ease-in-out infinite' : 'none',
    transition: 'all 0.3s ease',
    minWidth: 'clamp(36px, 6cqw, 52px)',
  }}>
    <span style={{ fontFamily: MONO, fontSize: 'clamp(0.38rem, 2.8cqmin, 0.5rem)', color: 'rgba(var(--text) / 0.45)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>{label}</span>
    <span style={{ fontFamily: MONO, fontSize: 'clamp(0.62rem, 5.5cqmin, 0.9rem)', color, fontWeight: 800, letterSpacing: '0.02em', lineHeight: 1.15, textShadow: `0 0 8px color-mix(in srgb, ${color} 55%, transparent)` }}>{value}</span>
  </div>
);

// =============================================================================
// QUICK-ACTIONS BAR
// NOTE: display/navigation actions only. See file header for deferred actions.
// Quick-actions are NAVIGATION only — they focus a camera in the wall or
// scroll to the events panel. No security-hardware writes are wired.
// =============================================================================

interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

const QuickActionsBar: React.FC<{ actions: QuickAction[] }> = ({ actions }) => {
  if (actions.length === 0) return null;
  return (
    <div
      className="flex items-center flex-wrap"
      style={{
        gap: 'clamp(0.3rem, 1.2cqw, 0.5rem)',
        padding: 'clamp(0.3rem, 1.2cqw, 0.5rem) 0',
      }}
    >
      {actions.map(action => (
        <button
          key={action.id}
          onClick={action.onClick}
          className="flex items-center"
          style={{
            gap: 6,
            padding: 'clamp(0.2rem, 1cqw, 0.35rem) clamp(0.45rem, 1.8cqw, 0.7rem)',
            borderRadius: 'var(--radius-control)',
            backdropFilter: 'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)',
            backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
            border: '1px solid var(--glass-l3-border)',
            boxShadow: 'var(--rim)',
            cursor: 'pointer',
            color: 'rgba(var(--text) / 0.75)',
            transition: 'all var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
          }}
          onPointerDown={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
          onPointerUp={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
          onPointerLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
        >
          <span style={{ width: 13, height: 13, display: 'flex', alignItems: 'center', color: CLEAR_COLOR }}>
            {action.icon}
          </span>
          <span style={{
            fontFamily: MONO,
            fontSize: 'clamp(0.44rem, 3.6cqmin, 0.6rem)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'rgba(255,255,255,0.7)',
          }}>{action.label}</span>
        </button>
      ))}
    </div>
  );
};

// =============================================================================
// CAMERA WALL SECTION
// =============================================================================

function cameraGridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 3;
}

const CameraWallSection: React.FC<{
  cameras: UnifiCamera[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
}> = ({ cameras, focusedId, onFocus }) => {
  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full" style={{ gap: 8, padding: '1.5rem' }}>
        <svg width="2.5rem" height="2.5rem" viewBox="0 0 24 24" fill="none">
          <path d="M3 7c0-.6.4-1 1-1h12c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V7Z"
            stroke="rgba(var(--text) / 0.18)" strokeWidth="1.5" />
          <path d="M17 9.5l4-2v7l-4-2V9.5Z" stroke="rgba(var(--text) / 0.18)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'rgba(var(--text) / 0.25)', letterSpacing: '0.06em', textAlign: 'center' }}>
          No cameras found
        </span>
      </div>
    );
  }

  const focused = focusedId ? cameras.find(c => c.entityId === focusedId) : null;
  const rest    = focused ? cameras.filter(c => c.entityId !== focusedId) : cameras;
  const cols    = cameraGridCols(rest.length + (focused ? 0 : 0));

  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.3rem, 1.2cqw, 0.5rem)' }}>
      <SectionLabel icon={<IconShieldAlert />} accent={CLEAR_COLOR}>Camera Wall</SectionLabel>

      {/* Focused camera (full-width when selected) */}
      {focused && (
        <div className="relative" style={{ marginBottom: 'clamp(0.2rem, 0.8cqw, 0.4rem)' }}>
          <UnifiCameraCard
            camera={focused}
            featured={false}
            style={{ width: '100%', aspectRatio: '16/9' }}
          />
          {/* Dismiss focus button */}
          <button
            onClick={() => onFocus(null)}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 24, height: 24, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: 'var(--glass-l3-bg)',
              border: '1px solid var(--glass-l3-border)',
              cursor: 'pointer',
              zIndex: 20,
            }}
          >
            <IconX style={{ width: 12, height: 12, color: 'rgba(var(--text) / 0.7)' }} />
          </button>
        </div>
      )}

      {/* Camera grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cameraGridCols(cameras.length)}, 1fr)`,
        gap: 'clamp(0.2rem, 0.8cqw, 0.35rem)',
      }}>
        {(focused ? rest : cameras).map((cam, i) => (
          <div
            key={cam.entityId}
            style={{ cursor: 'pointer', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}
            onClick={() => onFocus(focusedId === cam.entityId ? null : cam.entityId)}
            title={`Focus ${cam.name}`}
          >
            <UnifiCameraCard
              camera={cam}
              featured={!focused && i === 0 && cameras.length > 2 && cameras.length <= 5}
              style={
                !focused && i === 0 && cameras.length > 2 && cameras.length <= 5
                  ? { gridRow: 'span 2', gridColumn: '1 / 2' }
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// EVENTS TIMELINE SECTION
// =============================================================================

const EVENT_KIND_META: Record<UnifiEvent['kind'], { label: string; color: string }> = {
  doorbell:    { label: 'RING',      color: 'rgb(251 191 36)' },
  vehicle:     { label: 'VEHICLE',   color: 'rgb(251 146 60)' },
  nfc:         { label: 'NFC',       color: 'rgb(96 165 250)' },
  fingerprint: { label: 'FPRINT',    color: 'rgb(167 139 250)' },
  unknown:     { label: 'EVENT',     color: 'rgba(var(--text) / 0.45)' },
};

const RecentEventsSection: React.FC<{ cameras: UnifiCamera[] }> = ({ cameras }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Flatten + sort all events across all cameras, newest first
  const allEvents = useMemo(() => {
    const flat: Array<{ cam: UnifiCamera; ev: UnifiEvent }> = [];
    for (const cam of cameras) {
      for (const ev of cam.recentEvents) {
        flat.push({ cam, ev });
      }
    }
    return flat.sort((a, b) => b.ev.lastUpdated.localeCompare(a.ev.lastUpdated)).slice(0, 12);
  }, [cameras, tick]);

  if (allEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ gap: 6, padding: '1rem', minHeight: '4rem' }}>
        <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: 'rgba(var(--text) / 0.25)', letterSpacing: '0.05em' }}>
          No recent events
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.2rem, 0.8cqw, 0.35rem)' }}>
      {allEvents.map(({ cam, ev }, i) => {
        const meta = EVENT_KIND_META[ev.kind];
        return (
          <div
            key={ev.entityId + ev.lastUpdated}
            className="flex items-center"
            style={{
              gap: 8,
              padding: 'clamp(0.18rem, 0.9cqw, 0.3rem) clamp(0.35rem, 1.4cqw, 0.55rem)',
              borderRadius: 'var(--radius-control)',
              backdropFilter: 'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: 'var(--glass-l3-bg)',
              backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
              border: '1px solid var(--glass-l3-border)',
              boxShadow: 'var(--rim)',
              opacity: 1 - i * 0.055,
              animation: i === 0 ? 'sec-comp-section-in 0.3s ease both' : 'none',
            }}
          >
            {/* Colored dot */}
            <span style={{
              width: '0.38rem', height: '0.38rem',
              borderRadius: 999, flexShrink: 0,
              background: meta.color,
              boxShadow: `0 0 4px ${meta.color}`,
            }} />
            {/* Kind chip */}
            <span style={{
              fontFamily: MONO, fontSize: 'clamp(0.4rem, 3.2cqmin, 0.54rem)',
              fontWeight: 700, letterSpacing: '0.04em',
              color: meta.color,
              minWidth: '3.5rem',
            }}>{meta.label}</span>
            {/* Camera name */}
            <span className="flex-1 truncate" style={{ fontFamily: MONO, fontSize: 'clamp(0.42rem, 3.4cqmin, 0.56rem)', color: 'rgba(255,255,255,0.58)', fontWeight: 500 }}>{cam.name}</span>
            {/* Timestamp */}
            <span style={{ fontFamily: MONO, fontSize: 'clamp(0.38rem, 3cqmin, 0.5rem)', color: 'rgba(255,255,255,0.32)', flexShrink: 0 }}>{relativeTime(ev.lastUpdated)}</span>
          </div>
        );
      })}
    </div>
  );
};

// =============================================================================
// SENSORS SECTION (contact/lock — graceful degradation if none)
// =============================================================================

const SensorDotIcon: React.FC<{ dc: SecuritySensor['deviceClass']; isOpen: boolean }> = ({ dc, isOpen }) => {
  const color = isOpen ? ALERT_COLOR : CLEAR_COLOR;
  if (dc === 'lock') {
    return <IconLock style={{ width: 12, height: 12, color }} />;
  }
  if (dc === 'door' || dc === 'window') {
    return <IconDoorOpen style={{ width: 12, height: 12, color }} />;
  }
  return (
    <span style={{ width: 8, height: 8, borderRadius: 999, background: color, boxShadow: `0 0 4px ${color}`, flexShrink: 0, display: 'inline-block' }} />
  );
};

const SensorsSection: React.FC<{ sensors: SecuritySensor[] }> = ({ sensors }) => {
  const openCount = sensors.filter(s => s.isOpen).length;

  if (sensors.length === 0) {
    return (
      <div style={{ padding: 'clamp(0.4rem, 1.6cqw, 0.6rem)' }}>
        <span style={{ fontFamily: MONO, fontSize: 'clamp(0.42rem, 3.4cqmin, 0.56rem)', color: 'rgba(var(--text) / 0.25)', letterSpacing: '0.04em' }}>
          No door/window/lock sensors found
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.18rem, 0.7cqw, 0.3rem)' }}>
      {openCount > 0 && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginBottom: 'clamp(0.2rem, 0.8cqw, 0.35rem)',
          padding: '3px 10px',
          borderRadius: 'var(--radius-pill)',
          backgroundColor: `color-mix(in srgb, ${ALERT_COLOR} 16%, var(--glass-l3-bg))`,
          border: `1px solid color-mix(in srgb, ${ALERT_COLOR} 38%, var(--glass-l3-border))`,
          width: 'fit-content',
        }}>
          <IconAlertTriangle style={{ width: 11, height: 11, color: ALERT_COLOR }} />
          <span style={{ fontFamily: MONO, fontSize: 'clamp(0.42rem, 3.4cqmin, 0.56rem)', fontWeight: 700, color: ALERT_COLOR, letterSpacing: '0.04em' }}>
            {openCount} OPEN
          </span>
        </div>
      )}
      {sensors.slice(0, 12).map(sensor => (
        <div
          key={sensor.entityId}
          className="flex items-center"
          style={{
            gap: 8,
            padding: 'clamp(0.18rem, 0.9cqw, 0.3rem) clamp(0.35rem, 1.4cqw, 0.55rem)',
            borderRadius: 'var(--radius-control)',
            backdropFilter: 'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: sensor.isOpen
              ? `color-mix(in srgb, ${ALERT_COLOR} 14%, var(--glass-l3-bg))`
              : 'var(--glass-l3-bg)',
            backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
            border: `1px solid ${sensor.isOpen
              ? `color-mix(in srgb, ${ALERT_COLOR} 36%, var(--glass-l3-border))`
              : 'var(--glass-l3-border)'}`,
            boxShadow: sensor.isOpen
              ? `var(--rim), 0 0 10px -3px color-mix(in srgb, ${ALERT_COLOR} 28%, transparent)`
              : 'var(--rim)',
            animation: sensor.isOpen ? 'sec-comp-open-flash 0.5s ease both' : 'sec-comp-section-in 380ms ease both',
            transition: 'background-color 0.3s ease, border-color 0.3s ease',
          }}
        >
          <SensorDotIcon dc={sensor.deviceClass} isOpen={sensor.isOpen} />
          <span className="flex-1 truncate" style={{ fontFamily: MONO, fontSize: 'clamp(0.44rem, 3.6cqmin, 0.58rem)', color: sensor.isOpen ? 'rgba(255,255,255,0.88)' : 'rgba(var(--text) / 0.65)', fontWeight: sensor.isOpen ? 700 : 500 }}>
            {sensor.name}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 'clamp(0.4rem, 3.2cqmin, 0.54rem)', fontWeight: 700, letterSpacing: '0.04em', color: sensor.isUnavailable ? WARN_COLOR : sensor.isOpen ? ALERT_COLOR : CLEAR_COLOR }}>
            {sensor.isUnavailable ? 'N/A' : sensor.isOpen ? (sensor.deviceClass === 'lock' ? 'UNLOCKED' : 'OPEN') : (sensor.deviceClass === 'lock' ? 'LOCKED' : 'CLOSED')}
          </span>
        </div>
      ))}
      {sensors.length > 12 && (
        <span style={{ fontFamily: MONO, fontSize: 'clamp(0.4rem, 3.2cqmin, 0.54rem)', color: 'rgba(var(--text) / 0.3)', padding: '0.15rem 0.35rem' }}>
          +{sensors.length - 12} more
        </span>
      )}
    </div>
  );
};

// =============================================================================
// CLOCK TICK (for live timestamps)
// =============================================================================

function useClockTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

// =============================================================================
// MAIN EXPORT — SecurityCompilationTile
// =============================================================================

const SecurityCompilationTile: React.FC<TileProps> = ({ tile, device }) => {
  ensureAnims();
  const reduced = useReducedMotion();
  useClockTick();

  const config = useMemo(() => parseConfig(device.state), [device.state]);
  const { cameras, floodlights, isLoading, hasAnyActivity, isEmpty } = useUnifiSurface();

  // ── Contact/lock sensor discovery ──────────────────────────────────────────
  const [sensors, setSensors] = useState<SecuritySensor[]>([]);
  const unsubRef = React.useRef<(() => void) | null>(null);

  const onEntities = useCallback((entities: HassEntities) => {
    if (config.showSensors) {
      setSensors(buildSensors(entities));
    }
  }, [config.showSensors]);

  useEffect(() => {
    let cancelled = false;
    haClient.subscribeEntities((ents: HassEntities) => {
      if (!cancelled) onEntities(ents);
    }).then(unsub => {
      if (cancelled) { unsub(); return; }
      unsubRef.current = unsub;
    }).catch(() => {});
    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [onEntities]);

  // ── Camera focus state ─────────────────────────────────────────────────────
  const [focusedCamId, setFocusedCamId] = useState<string | null>(null);

  // ── Displayed cameras (respect maxCameras cap) ─────────────────────────────
  const displayedCameras = useMemo(() => {
    const max = config.maxCameras ?? 0;
    return max > 0 ? cameras.slice(0, max) : cameras;
  }, [cameras, config.maxCameras]);

  // ── Quick-actions (DISPLAY/NAVIGATION ONLY) ────────────────────────────────
  // NOTE: No arm/disarm, no recording mode, no siren, no floodlight control.
  // Focus-camera is a pure UI navigation action (local state update, no HA write).
  // "Show All Events" scrolls the events panel into view — also display-only.
  const eventsRef = React.useRef<HTMLDivElement>(null);

  const quickActions = useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [];

    // "Focus most-active camera" — local UI focus change only (no HA service call)
    if (displayedCameras.length > 0) {
      const mostActive = [...displayedCameras].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
      actions.push({
        id: 'focus-active',
        label: 'Focus Active Cam',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="14" height="10" rx="1.5" /><path d="M16 9l5-2v8l-5-2V9Z" /></svg>,
        onClick: () => setFocusedCamId(prev => prev === mostActive.entityId ? null : mostActive.entityId),
      });
    }

    // "All Cameras" — clears any focus (display navigation only)
    if (focusedCamId !== null) {
      actions.push({
        id: 'all-cams',
        label: 'All Cameras',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="10" height="7" rx="1" /><rect x="13" y="3" width="10" height="7" rx="1" /><rect x="1" y="14" width="10" height="7" rx="1" /><rect x="13" y="14" width="10" height="7" rx="1" /></svg>,
        onClick: () => setFocusedCamId(null),
      });
    }

    // "Show Events" — scrolls the events panel into view (display navigation)
    if (config.showEvents) {
      actions.push({
        id: 'show-events',
        label: 'Show Events',
        icon: <IconActivity style={{ width: 13, height: 13 }} />,
        onClick: () => eventsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      });
    }

    return actions;
  }, [displayedCameras, focusedCamId, config.showEvents]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="sec-comp-root relative w-full h-full flex items-center justify-center"
        style={{ borderRadius: 'var(--radius-surface)', backgroundColor: 'var(--glass-l1-bg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 10 }}>
          <div style={{ width: '2rem', height: '2rem', borderRadius: 999, border: '2px solid var(--glass-l2-border)', borderTopColor: CLEAR_COLOR, animation: 'unifi-spinner 0.9s linear infinite' }} />
          <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'rgba(var(--text) / 0.3)', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>Connecting…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="sec-comp-root relative w-full h-full overflow-auto"
      style={{
        containerType: 'inline-size',
        borderRadius: 'var(--radius-surface)',
        backgroundColor: 'var(--glass-l1-bg)',
        backdropFilter: 'var(--glass-l1-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
        border: '1px solid var(--glass-l1-border)',
        boxShadow: hasAnyActivity
          ? `var(--rim), 0 0 40px -8px color-mix(in srgb, ${ALERT_COLOR} 25%, transparent), var(--elev-4)`
          : 'var(--rim), var(--elev-3)',
        display: 'flex',
        flexDirection: 'column' as const,
        transition: 'box-shadow 0.5s ease',
      }}
    >
      {/* ── Ambient scanlines (surface-level) ─────────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)',
          mixBlendMode: 'multiply',
          zIndex: 20,
          borderRadius: 'inherit',
        }}
      />
      {/* Moving scan line (surface-level) */}
      {!reduced && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            height: '2px',
            background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${CLEAR_COLOR} 5%, transparent) 50%, transparent 100%)`,
            animation: 'sec-comp-scan 12s linear infinite',
            zIndex: 21,
          }}
        />
      )}
      {/* Background */}
      <SecurityBackdrop alertActive={hasAnyActivity} reduced={reduced} />

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <div className="relative" style={{ zIndex: 2 }}>
        <SecurityHero
          areaName={config.areaName}
          cameras={displayedCameras}
          hasAnyActivity={hasAnyActivity}
          reduced={reduced}
        />
      </div>

      {/* ── QUICK-ACTIONS ───────────────────────────────────────────────────── */}
      {quickActions.length > 0 && (
        <div
          className="relative shrink-0"
          style={{
            padding: '0 clamp(0.55rem, 2.4cqw, 0.95rem)',
            borderBottom: '1px solid var(--glass-l1-border)',
            zIndex: 3,
          }}
        >
          <QuickActionsBar actions={quickActions} />
        </div>
      )}

      {/* ── MAIN DECK ────────────────────────────────────────────────────────
          Camera wall (left/2fr) + Events+Sensors panel (right/1fr).
          Falls to single column on narrow containers. */}
      <div
        className="relative sec-comp-deck"
        style={{
          padding: 'clamp(0.55rem, 2.4cqw, 0.95rem)',
          flex: 1,
          zIndex: 2,
          alignItems: 'start',
        }}
        data-cols="2"
      >
        {/* ── LEFT: Camera wall ──────────────────────────────────────────────── */}
        <SectionCard active={hasAnyActivity} accent={hasAnyActivity ? ALERT_COLOR : CLEAR_COLOR}>
          <CameraWallSection
            cameras={displayedCameras}
            focusedId={focusedCamId}
            onFocus={setFocusedCamId}
          />
        </SectionCard>

        {/* ── RIGHT: Events + Sensors ─────────────────────────────────────────── */}
        <div className="flex flex-col" style={{ gap: 'clamp(0.4rem, 1.4cqw, 0.7rem)' }}>
          {config.showEvents && (
            <SectionCard>
              <div ref={eventsRef}>
                <SectionLabel icon={<IconActivity />} accent={CLEAR_COLOR}>Recent Events</SectionLabel>
                <RecentEventsSection cameras={displayedCameras} />
              </div>
            </SectionCard>
          )}

          {config.showSensors && (
            <SectionCard active={sensors.some(s => s.isOpen)} accent={ALERT_COLOR}>
              <SectionLabel icon={<IconDoorOpen />} accent={sensors.some(s => s.isOpen) ? ALERT_COLOR : CLEAR_COLOR}>
                Doors / Locks
              </SectionLabel>
              <SensorsSection sensors={sensors} />
            </SectionCard>
          )}

          {/* Floodlight state summary — display only */}
          {floodlights.length > 0 && (
            <SectionCard>
              <SectionLabel icon={<IconShieldAlert />} accent="rgb(254 240 138)">Floodlights</SectionLabel>
              <div className="flex flex-col" style={{ gap: 'clamp(0.18rem, 0.7cqw, 0.28rem)' }}>
                {floodlights.map(fl => (
                  <div
                    key={fl.entityId}
                    className="flex items-center"
                    style={{
                      gap: 8,
                      padding: 'clamp(0.18rem, 0.9cqw, 0.3rem) clamp(0.35rem, 1.4cqw, 0.55rem)',
                      borderRadius: 'var(--radius-control)',
                      backdropFilter: 'var(--glass-l3-backdrop)',
                      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                      backgroundColor: fl.isOn
                        ? 'color-mix(in srgb, rgb(254 240 138) 12%, var(--glass-l3-bg))'
                        : 'var(--glass-l3-bg)',
                      border: `1px solid ${fl.isOn ? 'color-mix(in srgb, rgb(254 240 138) 35%, var(--glass-l3-border))' : 'var(--glass-l3-border)'}`,
                      boxShadow: 'var(--rim)',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: fl.isOn ? 'rgb(254 240 138)' : 'rgba(var(--text) / 0.2)', boxShadow: fl.isOn ? '0 0 6px rgb(254 240 138)' : 'none', flexShrink: 0 }} />
                    <span className="flex-1 truncate" style={{ fontFamily: MONO, fontSize: 'clamp(0.44rem, 3.6cqmin, 0.58rem)', color: 'rgba(var(--text) / 0.7)' }}>{fl.name}</span>
                    {/* DISPLAY ONLY — no control button */}
                    <span style={{ fontFamily: MONO, fontSize: 'clamp(0.4rem, 3.2cqmin, 0.54rem)', fontWeight: 700, color: fl.isOn ? 'rgb(254 240 138)' : 'rgba(var(--text) / 0.3)', letterSpacing: '0.04em' }}>
                      {fl.isOn ? 'ON' : 'OFF'}
                    </span>
                  </div>
                ))}
                <span style={{ fontFamily: MONO, fontSize: 'clamp(0.38rem, 3cqmin, 0.5rem)', color: 'rgba(var(--text) / 0.28)', padding: '0.1rem 0', letterSpacing: '0.04em' }}>
                  DISPLAY ONLY · control deferred
                </span>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* ── Footer label ────────────────────────────────────────────────────── */}
      {tile.label && (
        <div
          className="relative shrink-0 text-center"
          style={{
            padding: '0.2rem 0.5rem 0.3rem',
            background: 'var(--glass-l1-tint)',
            borderTop: '1px solid var(--glass-l1-border)',
            zIndex: 3,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 'clamp(0.44rem, 4.5cqmin, 0.6rem)', fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(var(--text) / 0.5)', textTransform: 'uppercase' as const }}>
            {tile.label}
          </span>
        </div>
      )}
    </div>
  );
};

export default SecurityCompilationTile;
