/**
 * PoolCompilationTile — Flagship multi-integration Pool Area dashboard.
 *
 * PoolCompilationTile composes three independently self-driven surfaces into one
 * cohesive, immersive view:
 *
 *   (A) IntelliCenter pool/spa controls + telemetry  — reuses usePoolSurface()
 *       and imports PoolSurfaceTile's sub-sections directly (BodyPanel, PumpSection,
 *       ChemSection, LightsSection, WaterFeaturesSection, ProbeTempsSection)
 *
 *   (B) AKVO movable floor monitor + guarded preset console — renders
 *       AkvoFloorSurface as a self-contained embedded section. SAFETY IS FULLY
 *       PRESERVED: the AkvoFloorSurface component is mounted unchanged; its
 *       HoldToRequest, gate logic, and single select.select_option write are
 *       byte-for-byte identical to the standalone surface.
 *
 *   (C) Lutron lights + shades filtered to pool/patio/spa entities — drives
 *       useLutronSurface() with a configurable area/name filter so only
 *       pool-area entities appear in the compilation panel.
 *
 * ANIMATED BACKDROP: a rich SVG + CSS caustics/ripple scene with multi-layer
 * depth gradients, animated caustic shimmer rings, refraction shimmer, and a
 * subtle depth-of-field blur on the pool floor — the liquid-glass cards float
 * above it. The backdrop is purely decorative and pointer-events: none.
 *
 * CONFIGURABLE: All three integration feeds are gated by optional config baked
 * into the virtualDevice's state (a `PoolAreaConfig` object). Every field is
 * optional — sensible defaults cover the common case. In the Admin panel the
 * user can set JSON in the device state to control which sections appear and
 * which Lutron area slug(s) to filter on.
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │  HERO BAND — water temp + pool/spa status + floor position + live dot   │
 *   ├──────────────────┬──────────────────┬──────────────────────────────────┤
 *   │  POOL CONTROLS   │   CHEMISTRY      │   FLOOR (AKVO)                   │
 *   │  bodies          │   salt/pH/ORP    │   cross-section + presets        │
 *   │  heater/heat     │   SWG output     │   (safety-guarded)               │
 *   ├──────────────────┴──────────────────┼──────────────────────────────────┤
 *   │  PUMPS + SENSORS                    │   LIGHTING & SHADES (Lutron)     │
 *   │  arc gauges, speed setpoints        │   pool/patio area filtered       │
 *   │  probe temps                        │                                  │
 *   └─────────────────────────────────────┴──────────────────────────────────┘
 *
 * Responsive: container-query driven. Narrow → single column stacked.
 *
 * SAFETY: AKVO section is display + guarded-preset ONLY. No raw motion. This
 * component NEVER directly calls any AKVO service — the entire AkvoFloorSurface
 * subtree is responsible for its own safety logic.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { TileProps } from '../tileRegistry';

// ── Surface hooks ──────────────────────────────────────────────────────────────
import {
  usePoolSurface,
  type BodyState,
  type PumpTelemetry,
  type LightState,
  type WaterFeatureState,
  type ChemState,
  type ProbeTempState,
  type SpeedSetpointState,
} from '../../hooks/usePoolSurface';
import { useAkvoFloor } from '../../hooks/useAkvoFloor';
import { useLutronSurface } from '../../hooks/useLutronSurface';

// ── Lutron service calls ───────────────────────────────────────────────────────
import {
  toggleLight as lutronToggleLight,
  setLightBrightness as lutronSetBrightness,
  openCover, closeCover, stopCover,
  activateScene, pressButton,
} from '../../services/lutron';
import type { LutronLightState, LutronCoverState, LutronSceneState } from '../../services/lutron';

// ── Design system ──────────────────────────────────────────────────────────────
import { BuildBar, GlassPanel, GlassCard, GlassButton, useReducedMotion } from '../../design-system';

// ── Icons ──────────────────────────────────────────────────────────────────────
import {
  IconThermometer, IconFlame, IconSnowflake, IconDroplets, IconZap,
  IconWaves, IconPower, IconAlertTriangle, IconCheck, IconX,
  IconActivity, IconLightbulb, IconSun, IconInfo,
  IconLoader2, IconWifiOff, IconShieldAlert, IconShieldCheck,
  IconAlertOctagon, IconMoveVertical, IconHand, IconCheckCircle,
  IconLayers, IconChevronDown,
} from '../icons';

// ── Helpers from PoolSurfaceTile ───────────────────────────────────────────────
import {
  fluidTextXs, fluidTextSm, fluidTextBase, fluidTextLg, fluidTextXl,
  fluidText2xl, fluidText3xl, fluidGap, fluidPad,
} from './tileScale';

// ── AKVO types ─────────────────────────────────────────────────────────────────
import type { AkvoState, AkvoFault } from '../../services/akvo';

// ── Accent shorthand ───────────────────────────────────────────────────────────
const WATER = 'var(--accent-water)';
const WARN  = 'var(--accent-warn)';
const ALERT = 'var(--accent-alert)';
const PLUG  = 'var(--accent-plug)';

// ── HOLD duration (must match AkvoFloorSurface) ────────────────────────────────
const AKVO_HOLD_MS = 2000;

// =============================================================================
// PoolAreaConfig — the configurable shape stored in device.state
// =============================================================================

/**
 * Baked into the virtualDevice's `state` field as a JSON object.
 * All fields are optional — defaults shown below.
 */
export interface PoolAreaConfig {
  /** Show IntelliCenter pool/spa section (default: true) */
  showPool?: boolean;
  /** Show AKVO floor section (default: true) */
  showAkvo?: boolean;
  /** Show Lutron lights/shades section (default: true) */
  showLighting?: boolean;

  /**
   * Area slug patterns (lowercase, partial match OK) to filter Lutron
   * entities into the pool-area lighting panel.
   * Default: ['pool', 'patio', 'spa', 'cabana', 'outdoor']
   * Pass [] to include ALL Lutron areas.
   */
  lutronAreaFilter?: string[];

  /**
   * Display name override for the hero header
   * Default: 'Pool Area'
   */
  areaName?: string;
}

const DEFAULTS: Required<PoolAreaConfig> = {
  showPool:         true,
  showAkvo:         true,
  showLighting:     true,
  lutronAreaFilter: ['pool', 'patio', 'spa', 'cabana', 'outdoor'],
  areaName:         'Pool Area',
};

function parseConfig(raw: unknown): Required<PoolAreaConfig> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      showPool:         typeof r.showPool === 'boolean'  ? r.showPool  : DEFAULTS.showPool,
      showAkvo:         typeof r.showAkvo === 'boolean'  ? r.showAkvo  : DEFAULTS.showAkvo,
      showLighting:     typeof r.showLighting === 'boolean' ? r.showLighting : DEFAULTS.showLighting,
      lutronAreaFilter: Array.isArray(r.lutronAreaFilter)
        ? (r.lutronAreaFilter as string[]).map(String)
        : DEFAULTS.lutronAreaFilter,
      areaName:         typeof r.areaName === 'string' ? r.areaName : DEFAULTS.areaName,
    };
  }
  return { ...DEFAULTS };
}

// =============================================================================
// CSS animation keyframes (injected once)
// =============================================================================
let _animsInjected = false;
function ensureAnims() {
  if (_animsInjected || typeof document === 'undefined') return;
  _animsInjected = true;
  const s = document.createElement('style');
  s.textContent = `
/* Pool Compilation Tile - keyframes */
@keyframes pool-comp-caustic-spin {
  0%   { transform: rotate(0deg)   scale(1);    opacity: 0.18; }
  50%  { transform: rotate(180deg) scale(1.08); opacity: 0.26; }
  100% { transform: rotate(360deg) scale(1);    opacity: 0.18; }
}
@keyframes pool-comp-caustic-spin2 {
  0%   { transform: rotate(0deg)   scale(1);    opacity: 0.12; }
  50%  { transform: rotate(-180deg) scale(1.12); opacity: 0.20; }
  100% { transform: rotate(-360deg) scale(1);   opacity: 0.12; }
}
@keyframes pool-comp-ripple-expand {
  0%   { transform: scale(0.8); opacity: 0.35; }
  100% { transform: scale(2.2); opacity: 0;   }
}
@keyframes pool-comp-wave-drift {
  0%   { transform: translateX(0);    }
  100% { transform: translateX(-80px); }
}
@keyframes pool-comp-shimmer-sweep {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center;  }
}
@keyframes pool-comp-depth-pulse {
  0%,100% { opacity: 0.6; }
  50%     { opacity: 0.9; }
}
@keyframes pool-comp-surface-glint {
  0%,100% { opacity: 0; transform: translateX(-100%) skewX(-20deg); }
  50%     { opacity: 1; transform: translateX(100%)  skewX(-20deg); }
}
@keyframes pool-comp-live-pulse {
  0%,100% { opacity: 1; transform: scale(1);   }
  50%     { opacity: 0.4; transform: scale(1.9); }
}
@keyframes pool-comp-akvo-alert {
  0%,100% { opacity: 1;   }
  50%     { opacity: 0.38; }
}
@keyframes pool-comp-akvo-ripple {
  0%   { transform: scale(1);   opacity: 0.7; }
  100% { transform: scale(2.4); opacity: 0;   }
}
@keyframes pool-comp-section-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}
/* Hero scene */
@keyframes pool-comp-hero-wave-drift {
  0%   { transform: translateX(0);     }
  100% { transform: translateX(-120px); }
}
@keyframes pool-comp-hero-wave-drift2 {
  0%   { transform: translateX(0);    }
  100% { transform: translateX(90px);  }
}
@keyframes pool-comp-hero-shimmer {
  0%   { transform: translateY(0)   scaleY(1);    opacity: 0.5; }
  50%  { transform: translateY(-4px) scaleY(1.04); opacity: 0.85; }
  100% { transform: translateY(0)   scaleY(1);    opacity: 0.5; }
}
@keyframes pool-comp-bubble-rise {
  0%   { transform: translateY(0)    scale(1);   opacity: 0;   }
  15%  { opacity: 0.6; }
  100% { transform: translateY(-120px) scale(0.4); opacity: 0; }
}
@keyframes pool-comp-cable-flow {
  0%   { stroke-dashoffset: 16; }
  100% { stroke-dashoffset: 0;  }
}
@keyframes pool-comp-plate-arrow {
  0%,100% { opacity: 0.35; }
  50%     { opacity: 1;    }
}
@keyframes pool-comp-readout-float {
  0%,100% { transform: translateY(0);    }
  50%     { transform: translateY(-3px); }
}

/* ── Full-width balanced control grid ────────────────────────────────────────
   Stretchy equal columns (NOT auto-fill) so cards fill the row edge-to-edge.
   Column count steps up with the container width; tracks always 1fr. */
.pool-comp-deck {
  display: grid;
  grid-template-columns: 1fr;             /* mobile: single column */
  gap: clamp(0.5rem, 2cqw, 0.9rem);
  align-items: start;
  width: 100%;
}
@container (min-width: 40rem) {
  .pool-comp-deck { grid-template-columns: 1fr 1fr; }
  /* A single active section stays full-width even at tablet size. */
  .pool-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
}
@container (min-width: 64rem) {
  .pool-comp-deck { grid-template-columns: 1fr 1fr 1fr; }
  .pool-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
  .pool-comp-deck[data-cols="2"] { grid-template-columns: 1fr 1fr; }
}
`;
  document.head.appendChild(s);
}

// =============================================================================
// ANIMATED WATER BACKDROP
// =============================================================================

/**
 * Subtle deep-water texture behind the CONTROL DECK (below the hero).
 *
 * The hero scene now owns the big animated water + caustics. This backdrop is
 * deliberately quiet — a vertical depth gradient with two faint, edge-anchored
 * caustic washes (NOT a big centered glowing ellipse, which was the prior dead
 * blob). It just keeps the scroll area reading as "underwater" without
 * competing with the hero or leaving a hole in the middle.
 */
const PoolWaterBackdrop: React.FC<{ active: boolean; reduced: boolean }> = ({ active, reduced }) => (
  <div
    className="absolute inset-0 overflow-hidden pointer-events-none"
    aria-hidden="true"
    style={{ borderRadius: 'var(--radius-surface)' }}
  >
    {/* Vertical depth gradient: gets darker toward the bottom (deeper water). */}
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(180deg,
          rgba(8, 50, 78, 0.55) 0%,
          rgba(6, 38, 62, 0.78) 45%,
          rgba(5, 26, 44, 0.92) 100%)`,
      }}
    />

    {/* Faint edge-anchored caustic washes — pinned to the LEFT and RIGHT edges so
        they fill the corners (where the old layout was emptiest) and never form a
        central blob. */}
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity: active ? 0.7 : 0.4, transition: 'opacity 1.2s ease' }}
    >
      <defs>
        <radialGradient id="pcWashL" cx="0%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#2a8fc4" stopOpacity="0.16" />
          <stop offset="60%"  stopColor="#1c6fa0" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#1c6fa0" stopOpacity="0.0" />
        </radialGradient>
        <radialGradient id="pcWashR" cx="100%" cy="60%" r="75%">
          <stop offset="0%"   stopColor="#3aa0d8" stopOpacity="0.14" />
          <stop offset="60%"  stopColor="#1c6fa0" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#1c6fa0" stopOpacity="0.0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="800" height="500" fill="url(#pcWashL)"
        style={!reduced ? { animation: 'pool-comp-depth-pulse 9s ease-in-out infinite' } : {}} />
      <rect x="0" y="0" width="800" height="500" fill="url(#pcWashR)"
        style={!reduced ? { animation: 'pool-comp-depth-pulse 11s ease-in-out infinite 1.5s' } : {}} />
    </svg>
  </div>
);

// =============================================================================
// SHARED MICRO-COMPONENTS
// =============================================================================

const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; accent?: string }> = ({
  children, icon, accent = WATER,
}) => (
  <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
    {icon && (
      <span style={{ color: accent, display: 'flex', alignItems: 'center', width: 14, height: 14 }}>
        {icon}
      </span>
    )}
    <span
      className="font-bold uppercase tracking-widest"
      style={{ fontSize: 'var(--type-2xs)', color: `color-mix(in srgb, ${accent} 65%, rgba(var(--text) / 0.4))` }}
    >
      {children}
    </span>
    <div
      className="flex-1 h-px"
      style={{ background: `color-mix(in srgb, ${accent} 20%, var(--glass-l3-border))` }}
    />
  </div>
);

/** Glass section card — level-2 card with optional accent tint */
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
        ? `color-mix(in srgb, ${accent} 38%, var(--glass-l2-border))`
        : 'var(--glass-l2-border)'}`,
      boxShadow: active && accent
        ? `var(--rim), inset 0 0 24px -6px color-mix(in srgb, ${accent} 22%, transparent), var(--elev-2)`
        : 'var(--rim), var(--elev-1)',
      padding: 'var(--space-4)',
      transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
      animation: 'pool-comp-section-in 380ms var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
      ...style,
    }}
  >
    {children}
  </div>
);

/** Control pill (toggle button with glass bead treatment) */
const ControlPill: React.FC<{
  label: string; isOn: boolean; onClick: () => void; disabled?: boolean; accent?: string;
}> = ({ label, isOn, onClick, disabled, accent = WATER }) => (
  <button
    className={`flex items-center gap-1 rounded-full border ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    style={{
      padding: 'clamp(0.12rem, 1.2cqmin, 0.3rem) clamp(0.4rem, 2.5cqmin, 0.75rem)',
      backdropFilter: 'var(--glass-l3-backdrop)',
      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: isOn ? `color-mix(in srgb, ${accent} 26%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
      backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
      border: `1px solid ${isOn ? `color-mix(in srgb, ${accent} 58%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
      boxShadow: isOn
        ? `var(--rim), inset 0 0 12px -3px color-mix(in srgb, ${accent} 32%, transparent), 0 0 10px -3px color-mix(in srgb, ${accent} 44%, transparent)`
        : 'var(--rim)',
      transition: `all var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))`,
    }}
    onClick={!disabled ? onClick : undefined}
    disabled={disabled}
    onPointerDown={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
    onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
  >
    <div
      className="rounded-full flex-shrink-0"
      style={{
        width: 'clamp(5px, 1.8cqmin, 8px)',
        height: 'clamp(5px, 1.8cqmin, 8px)',
        background: isOn ? accent : 'rgba(var(--text) / 0.3)',
        boxShadow: isOn ? `0 0 5px 1px ${accent}` : 'none',
        transition: 'background var(--dur-fast, 160ms) ease',
      }}
    />
    <span
      className="font-semibold truncate"
      style={{
        fontSize: 'clamp(0.45rem, 3.5cqmin, 0.65rem)',
        color: isOn ? accent : 'rgba(var(--text) / 0.6)',
      }}
    >
      {label}
    </span>
  </button>
);

/** StatCard — small reading chip */
const StatCard: React.FC<{
  label: string; value: string | number | null; unit?: string;
  accent?: 'blue' | 'amber' | 'red' | 'green' | 'gray'; note?: string;
}> = ({ label, value, unit, accent = 'gray', note }) => {
  const colorVar: Record<string, string> = {
    blue:  WATER, amber: WARN, red: ALERT, green: PLUG, gray: 'rgba(var(--text) / 0.4)',
  };
  const c = colorVar[accent];
  const active = accent !== 'gray';
  return (
    <div
      className="flex flex-col items-center justify-center rounded-control flex-1 min-w-0"
      style={{
        backdropFilter: 'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: active ? `color-mix(in srgb, ${c} 16%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: `1px solid ${active ? `color-mix(in srgb, ${c} 45%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
        boxShadow: active
          ? `var(--rim), inset 0 0 20px -6px color-mix(in srgb, ${c} 30%, transparent), 0 0 14px -4px color-mix(in srgb, ${c} 38%, transparent)`
          : 'var(--rim), var(--elev-1)',
        padding: 'clamp(0.2rem, 2cqmin, 0.5rem) clamp(0.15rem, 1.5cqmin, 0.35rem)',
        transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
      }}
    >
      <span className="uppercase font-bold tracking-wider truncate w-full text-center"
        style={{ fontSize: 'clamp(0.42rem, 3.8cqmin, 0.6rem)', color: 'rgba(var(--text) / 0.5)' }}>
        {label}
      </span>
      <span className="font-bold leading-tight tabular-nums"
        style={{ fontSize: 'clamp(0.7rem, 6.5cqmin, 1.05rem)', color: active ? c : 'rgb(var(--text))' }}>
        {value ?? '--'}
        {unit && <span className="font-normal ml-0.5" style={{ fontSize: 'clamp(0.4rem, 3.2cqmin, 0.55rem)', color: 'rgba(var(--text) / 0.5)' }}>{unit}</span>}
      </span>
      {note && <span className="truncate w-full text-center" style={{ fontSize: 'clamp(0.38rem, 3cqmin, 0.5rem)', color: 'rgba(var(--text) / 0.4)' }}>{note}</span>}
    </div>
  );
};

/** Glass arc gauge (pool pump metrics) */
const ArcGauge: React.FC<{ value: number | null; max: number; label: string; unit: string; color?: string }> = ({
  value, max, label, unit, color = '#38bdf8',
}) => {
  const pct = value !== null ? Math.min(1, value / max) : 0;
  const r = 28; const cx = 36; const cy = 36;
  const circ = 2 * Math.PI * r;
  const arcLen = pct * circ * 0.75;
  return (
    <div className="flex flex-col items-center" style={{
      minWidth: 0, flex: '0 0 auto',
      borderRadius: 'var(--radius-control)',
      padding: 'clamp(0.2rem, 1.8cqmin, 0.4rem)',
      backdropFilter: 'var(--glass-l3-backdrop)',
      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: `color-mix(in srgb, ${color} 12%, var(--glass-l3-bg))`,
      backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
      border: `1px solid color-mix(in srgb, ${color} 30%, var(--glass-l3-border))`,
      boxShadow: `var(--rim), inset 0 0 14px -4px color-mix(in srgb, ${color} 22%, transparent), 0 0 10px -3px color-mix(in srgb, ${color} 30%, transparent)`,
    }}>
      <svg viewBox="0 0 72 72" style={{ width: 'clamp(40px, 16cqmin, 72px)', height: 'clamp(40px, 16cqmin, 72px)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5"
          strokeDasharray={`${(circ * 0.75).toFixed(1)} ${circ.toFixed(1)}`}
          strokeDashoffset={-(circ * 0.125).toFixed(1) as any}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }} />
        {value !== null && (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${arcLen.toFixed(1)} ${circ.toFixed(1)}`}
            strokeDashoffset="0" strokeLinecap="round"
            style={{
              transform: `rotate(${135 - 90}deg)`, transformOrigin: `${cx}px ${cy}px`,
              filter: `drop-shadow(0 0 5px ${color})`,
              transition: 'stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1)',
            }} />
        )}
        <text x={cx} y={cy + 5} textAnchor="middle" fill="rgb(var(--text))"
          style={{ fontSize: 'clamp(8px, 3.5cqmin, 14px)', fontWeight: 700 }}>
          {value !== null ? (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))) : '--'}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" fill="rgba(var(--text) / 0.45)"
          style={{ fontSize: 'clamp(5px, 2.2cqmin, 9px)', fontWeight: 600 }}>{unit}</text>
      </svg>
      <span className="uppercase font-bold tracking-wider text-center truncate w-full"
        style={{ fontSize: 'clamp(0.38rem, 3cqmin, 0.55rem)', color: 'rgba(var(--text) / 0.5)' }}>
        {label}
      </span>
    </div>
  );
};

// =============================================================================
// SECTION A — POOL / SPA CONTROLS
// =============================================================================

const PoolBodyPanel: React.FC<{
  body: BodyState;
  onToggle: (on: boolean) => void;
  onHeaterMode: (mode: string) => void;
}> = ({ body, onToggle, onHeaterMode }) => {
  const isPool = body.name.toLowerCase().includes('pool');
  const bodyColor = isPool ? WATER : 'var(--accent)';
  return (
    <div
      className="flex flex-col rounded-control"
      style={{
        backdropFilter: 'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: body.isOn ? `color-mix(in srgb, ${bodyColor} 18%, var(--glass-l2-bg))` : 'var(--glass-l2-bg)',
        backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
        border: `1px solid ${body.isOn ? `color-mix(in srgb, ${bodyColor} 48%, var(--glass-l2-border))` : 'var(--glass-l2-border)'}`,
        boxShadow: body.isOn
          ? `var(--rim), inset 0 0 28px -8px color-mix(in srgb, ${bodyColor} 28%, transparent), 0 0 18px -4px color-mix(in srgb, ${bodyColor} 36%, transparent), var(--elev-2)`
          : 'var(--rim), var(--elev-1)',
        padding: 'clamp(0.25rem, 2cqmin, 0.5rem)',
        gap: 'clamp(0.15rem, 1.5cqmin, 0.35rem)',
        transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconWaves className="flex-shrink-0"
            style={{ width: 'clamp(10px, 4cqmin, 16px)', height: 'clamp(10px, 4cqmin, 16px)',
              color: bodyColor, filter: body.isOn ? `drop-shadow(0 0 4px ${bodyColor})` : undefined }} />
          <span className="font-bold truncate" style={{ ...fluidTextSm, color: bodyColor }}>{body.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="font-bold tabular-nums" style={{ ...fluidTextLg, color: 'rgb(var(--text))' }}>
            {body.waterTempC !== null ? `${Math.round(body.waterTempC)}°` : '--'}
          </span>
          <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.45)' }}>{body.waterTempUnit}</span>
          <ControlPill label={body.isOn ? 'ON' : 'OFF'} isOn={body.isOn} onClick={() => onToggle(!body.isOn)} accent={WATER} />
        </div>
      </div>
      {body.heaterId && (
        <div className="flex items-center gap-1 flex-wrap">
          <IconFlame className="flex-shrink-0"
            style={{ width: 'clamp(9px, 3.5cqmin, 14px)', height: 'clamp(9px, 3.5cqmin, 14px)',
              color: body.heaterIsOn ? WARN : 'rgba(var(--text) / 0.3)',
              filter: body.heaterIsOn ? `drop-shadow(0 0 4px ${WARN})` : undefined }} />
          <ControlPill
            label={body.heaterIsOn ? `Heat ${body.heaterTarget ?? '--'}°` : 'Heater Off'}
            isOn={body.heaterIsOn}
            onClick={() => onHeaterMode(body.heaterIsOn ? 'off' : 'on')}
            accent={WARN}
          />
        </div>
      )}
    </div>
  );
};

const PoolSectionContent: React.FC<{
  surface: ReturnType<typeof usePoolSurface>['surface'];
  toggleBody: (eid: string, on: boolean) => void;
  toggleLight: (eid: string, on: boolean) => void;
  setLightEffect: (eid: string, effect: string) => void;
  toggleWaterFeature: (eid: string, on: boolean) => void;
  setWaterHeaterMode: (heaterId: string, mode: string) => void;
  setWaterHeaterTemp: (heaterId: string, temp: number) => void;
  setClimateMode: (climateId: string, mode: string) => void;
  setClimateTemp: (climateId: string, temp: number) => void;
  setNumberValue: (entityId: string, value: number) => void;
  onOpenEffectPicker: (light: LightState) => void;
}> = ({
  surface, toggleBody, toggleLight, setLightEffect,
  toggleWaterFeature, setWaterHeaterMode, setWaterHeaterTemp,
  setClimateMode, setClimateTemp, setNumberValue, onOpenEffectPicker,
}) => {
  if (!surface.detected) {
    return (
      <div className="flex items-center justify-center p-4 text-center" style={{ gap: 'var(--space-2)', flexDirection: 'column' }}>
        <IconWaves style={{ width: 24, height: 24, color: `color-mix(in srgb, ${WATER} 40%, transparent)` }} />
        <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)' }}>
          IntelliCenter not detected. Add the integration and configure your Pentair system.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
      {/* Bodies */}
      {surface.bodies.length > 0 && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <SectionLabel icon={<IconWaves />}>Pool / Spa</SectionLabel>
          <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
            {surface.bodies.map(body => (
              <PoolBodyPanel
                key={body.entityId}
                body={body}
                onToggle={(on) => toggleBody(body.entityId, on)}
                onHeaterMode={(mode) => {
                  if (body.heaterId) setWaterHeaterMode(body.heaterId, mode);
                  else if (body.climateId) setClimateMode(body.climateId, mode);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Lights */}
      {surface.lights.length > 0 && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <SectionLabel icon={<IconLightbulb />} accent={WARN}>Pool Lights</SectionLabel>
          <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
            {surface.lights.map(light => (
              <div key={light.entityId}
                className="flex items-center gap-1.5 flex-1"
                style={{
                  borderRadius: 'var(--radius-control)',
                  backdropFilter: 'var(--glass-l3-backdrop)',
                  WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                  backgroundColor: light.isOn ? `color-mix(in srgb, ${WARN} 16%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
                  backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                  border: `1px solid ${light.isOn ? `color-mix(in srgb, ${WARN} 40%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
                  boxShadow: light.isOn ? `var(--rim), inset 0 0 14px -4px color-mix(in srgb, ${WARN} 28%, transparent), 0 0 12px -3px color-mix(in srgb, ${WARN} 36%, transparent)` : 'var(--rim)',
                  padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)',
                  minWidth: 'clamp(80px, 25cqw, 150px)',
                  transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                }}>
                <IconLightbulb className="flex-shrink-0" style={{
                  width: 'clamp(10px, 3.5cqmin, 14px)', height: 'clamp(10px, 3.5cqmin, 14px)',
                  color: light.isOn ? WARN : 'rgba(var(--text) / 0.3)',
                  filter: light.isOn ? `drop-shadow(0 0 4px ${WARN})` : undefined,
                }} />
                <span className="truncate flex-1" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.8)' }}>{light.name}</span>
                <ControlPill label={light.isOn ? 'ON' : 'OFF'} isOn={light.isOn}
                  onClick={() => toggleLight(light.entityId, !light.isOn)} accent={WARN} />
                {light.effectList.length > 0 && (
                  <button onClick={() => onOpenEffectPicker(light)}
                    style={{
                      ...fluidTextXs,
                      padding: '2px 5px', borderRadius: 'var(--radius-chip)',
                      backdropFilter: 'var(--glass-l3-backdrop)',
                      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                      backgroundColor: `color-mix(in srgb, ${WATER} 18%, var(--glass-l3-bg))`,
                      border: `1px solid color-mix(in srgb, ${WATER} 38%, var(--glass-l3-border))`,
                      color: WATER, fontWeight: 700, cursor: 'pointer',
                      transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
                    }}
                    onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
                    onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                    onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                    title="Choose effect"
                  >FX</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Water features */}
      {surface.waterFeatures.length > 0 && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <SectionLabel icon={<IconDroplets />}>Water Features</SectionLabel>
          <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
            {surface.waterFeatures.map(feat => (
              <ControlPill key={feat.entityId} label={feat.name} isOn={feat.isOn}
                onClick={() => toggleWaterFeature(feat.entityId, !feat.isOn)} accent={WATER} />
            ))}
          </div>
        </div>
      )}

      {/* Chemistry */}
      {(surface.chem.salt !== null || surface.chem.ph !== null || surface.chem.orp !== null) && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <SectionLabel icon={<IconDroplets />} accent={PLUG}>Chemistry</SectionLabel>
          {surface.chem.salt !== null && (
            <div style={{
              borderRadius: 'var(--radius-control)',
              backdropFilter: 'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: `color-mix(in srgb, ${WATER} 10%, var(--glass-l3-bg))`,
              backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
              border: `1px solid color-mix(in srgb, ${WATER} 28%, var(--glass-l3-border))`,
              boxShadow: 'var(--rim), var(--elev-1)',
              padding: 'clamp(0.2rem, 1.6cqmin, 0.4rem)',
            }}>
              <div className="flex items-center justify-between mb-1">
                <span style={{ fontSize: 'clamp(0.42rem, 3.5cqmin, 0.58rem)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(var(--text) / 0.5)' }}>Salt</span>
                <span style={{ fontSize: 'clamp(0.6rem, 5cqmin, 0.88rem)', fontWeight: 700, color: WATER }}>
                  {Math.round(surface.chem.salt)} <span style={{ fontSize: '0.7em', fontWeight: 400, color: 'rgba(var(--text) / 0.45)' }}>{surface.chem.saltUnit}</span>
                </span>
              </div>
              <BuildBar value={surface.chem.salt} min={0} max={4500} colorVar={WATER} active={false} height={5} label={`Salt ${Math.round(surface.chem.salt)} ${surface.chem.saltUnit}`} />
            </div>
          )}
          <div className="flex" style={{ gap: 'var(--space-2)' }}>
            {surface.chem.ph !== null && (
              <StatCard label="pH" value={surface.chem.ph.toFixed(1)}
                accent={(surface.chem.ph >= 7.2 && surface.chem.ph <= 7.8) ? 'green' : surface.chem.ph < 7.0 || surface.chem.ph > 8.0 ? 'red' : 'amber'} />
            )}
            {surface.chem.orp !== null && (
              <StatCard label="ORP" value={Math.round(surface.chem.orp)} unit={surface.chem.orpUnit}
                accent={(surface.chem.orp >= 650 && surface.chem.orp <= 800) ? 'green' : surface.chem.orp < 500 ? 'red' : 'amber'} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// SECTION B — PUMPS + SENSORS
// =============================================================================

const PumpSectionContent: React.FC<{
  pumps: PumpTelemetry[];
  probes: ProbeTempState[];
  speedSetpoints: SpeedSetpointState[];
  onSetSpeed: (eid: string, v: number) => void;
}> = ({ pumps, probes, speedSetpoints, onSetSpeed }) => {
  if (pumps.length === 0 && probes.length === 0) return null;
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
      {pumps.length > 0 && (
        <>
          <SectionLabel icon={<IconActivity />}>Pumps</SectionLabel>
          <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
            {pumps.map(pump => (
              <div key={pump.entityId}
                className="flex flex-col flex-1 rounded-control overflow-hidden"
                style={{
                  backdropFilter: 'var(--glass-l2-backdrop)',
                  WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
                  backgroundColor: pump.isRunning ? `color-mix(in srgb, ${WATER} 14%, var(--glass-l2-bg))` : 'var(--glass-l2-bg)',
                  backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
                  border: `1px solid ${pump.isRunning ? `color-mix(in srgb, ${WATER} 38%, var(--glass-l2-border))` : 'var(--glass-l2-border)'}`,
                  boxShadow: pump.isRunning ? `var(--rim), inset 0 0 18px -5px color-mix(in srgb, ${WATER} 22%, transparent), var(--elev-2)` : 'var(--rim), var(--elev-1)',
                  minWidth: 'clamp(90px, 30cqw, 160px)',
                  padding: 'clamp(0.2rem, 1.8cqmin, 0.45rem)',
                  transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                }}>
                <div className="flex items-center gap-1 mb-1">
                  <div className="rounded-full flex-shrink-0 relative" style={{
                    width: 'clamp(5px, 1.8cqmin, 7px)', height: 'clamp(5px, 1.8cqmin, 7px)',
                    background: pump.isRunning ? WATER : 'rgba(var(--text) / 0.25)',
                    boxShadow: pump.isRunning ? `0 0 6px 1px ${WATER}` : 'none',
                  }}>
                    {pump.isRunning && (
                      <div className="absolute inset-0 rounded-full"
                        style={{ background: WATER, animation: 'glass-pulse-ring 1.8s ease-out infinite' }} />
                    )}
                  </div>
                  <span className="font-semibold truncate" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.8)' }}>{pump.name}</span>
                </div>
                <div className="flex items-end justify-center" style={{ gap: 'clamp(0.15rem, 1.5cqmin, 0.4rem)' }}>
                  <ArcGauge value={pump.rpm} max={3450} label="RPM" unit="rpm" color="#38bdf8" />
                  <ArcGauge value={pump.powerW} max={2500} label="W" unit="W" color="#fbbf24" />
                  {pump.gpm !== null && <ArcGauge value={pump.gpm} max={150} label="GPM" unit="gpm" color="#34d399" />}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {probes.length > 0 && (
        <>
          <SectionLabel icon={<IconThermometer />} accent={WATER}>Sensors</SectionLabel>
          <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
            {probes.map(p => (
              <StatCard key={p.entityId}
                label={p.name.replace(/temperature/i, 'Temp').replace(/_/g, ' ')}
                value={p.value !== null ? Math.round(p.value) : null}
                unit={p.unit} accent="blue" />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// =============================================================================
// SECTION C — AKVO FLOOR (embedded, safety-intact)
// =============================================================================

/** AKVO live-status dot */
const AkvoStatusPill: React.FC<{ status: 'connecting' | 'live' | 'stale' }> = ({ status }) => {
  if (status === 'live') return (
    <span className="flex items-center gap-1.5"
      style={{ fontSize: 'var(--type-xs)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'rgb(52 211 153)' }}>
      <svg width="8" height="8" viewBox="0 0 8 8" style={{ overflow: 'visible' }}>
        <circle cx="4" cy="4" r="3" fill="rgb(52 211 153)" />
        <circle cx="4" cy="4" r="3" fill="rgb(52 211 153)"
          style={{ animation: 'pool-comp-akvo-ripple 1.8s ease-out infinite' }} />
      </svg>
      Live
    </span>
  );
  if (status === 'connecting') return (
    <span className="flex items-center gap-1.5"
      style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: 'rgba(var(--text) / 0.4)' }}>
      <IconLoader2 className="w-3 h-3 animate-spin" /> Connecting
    </span>
  );
  return (
    <span className="flex items-center gap-1.5"
      style={{ fontSize: 'var(--type-xs)', fontWeight: 700, color: WARN }}>
      <IconWifiOff style={{ width: 12, height: 12 }} /> Stale
    </span>
  );
};

function akvoOverall(s: AkvoState): { label: string; color: string } {
  if (!s.anyAvailable) return { label: 'OFFLINE', color: 'rgba(var(--text) / 0.4)' };
  if (s.emergencyStop === true) return { label: 'EMERGENCY STOP', color: ALERT };
  if (s.systemFault === true) return { label: 'FAULT', color: ALERT };
  if (s.badModbusComm === true) return { label: 'COMMS FAULT', color: ALERT };
  if (s.floorsMoving === true) return { label: 'MOVING', color: WARN };
  if (s.systemReady === true || s.readyForExternalCommands === true) return { label: 'READY', color: PLUG };
  return { label: 'STANDBY', color: 'var(--accent)' };
}

// AKVO floor plate color by state (mirrors AkvoFloorSurface.floorColor).
function akvoFloorColor(s: AkvoState): { plate: string; glow: string } {
  if (s.emergencyStop === true || s.systemFault === true) return { plate: 'rgb(248 113 113)', glow: 'rgb(248 113 113 / 0.5)' };
  if (s.badModbusComm === true) return { plate: 'rgb(251 146 60)', glow: 'rgb(251 146 60 / 0.4)' };
  if (s.floorsMoving === true) return { plate: 'rgb(251 191 36)', glow: 'rgb(251 191 36 / 0.45)' };
  if (s.systemReady === true || s.readyForExternalCommands === true) return { plate: 'rgb(52 211 153)', glow: 'rgb(52 211 153 / 0.32)' };
  return { plate: 'rgb(148 163 184)', glow: 'rgb(148 163 184 / 0.22)' };
}

// =============================================================================
// HERO — POOL DIVE-VIEW SCENE (the centerpiece)
// =============================================================================
//
// A full-bleed cross-section "pool window": you are looking at the pool in
// profile. The water column fills the whole hero; animated caustics and surface
// waves live HERE (not in a separate floating blob). The AKVO movable-floor
// plate is suspended at its REAL depth in the water (negative = above deck,
// positive = submerged), with lifting cables, motion arrows, and a depth
// callout. Glass readout chips (pool/spa temp, floor status, lights) float over
// the scene as legible HUD overlays — so the immersive water IS the UI, edge to
// edge, with no dead zone.
//
// SAFETY: display-only. This scene renders AKVO state; it issues no commands.
// The geometry/animation is adapted from AkvoFloorSurface.CrossSection but
// stretched to fill the hero width.

interface PoolHeroSceneProps {
  areaName: string;
  poolSurface: ReturnType<typeof usePoolSurface>['surface'];
  akvoState: AkvoState;
  lutronLightsOn: number;
  config: Required<PoolAreaConfig>;
  showAkvo: boolean;
  onToggleBody: (entityId: string, on: boolean) => void;
  reduced: boolean;
}

// Hero SVG coordinate system: 1000 wide x 460 tall.
// Deck line at y = HERO_DECK_Y; positive depth goes DOWN.
const HERO_VB_W = 1000;
const HERO_VB_H = 460;
const HERO_DECK_Y = 120;            // water surface / deck reference
const HERO_PX_PER_M = 70;           // 1 m of floor travel = 70 px
const HERO_PLATE_W = 420;           // main floor plate width
const HERO_PLATE_H = 18;
const HERO_BAJA_W = 230;
const HERO_BAJA_H = 12;

function heroDepthToPx(m: number | null): number {
  const v = m ?? 0;
  // Clamp so an out-of-range reading never escapes the water box.
  const px = HERO_DECK_Y + v * HERO_PX_PER_M;
  return Math.max(HERO_DECK_Y - 80, Math.min(HERO_VB_H - 40, px));
}

const PoolHeroScene: React.FC<PoolHeroSceneProps> = ({
  areaName, poolSurface, akvoState, lutronLightsOn, config, showAkvo, onToggleBody, reduced,
}) => {
  const anyBodyOn  = poolSurface.bodies.some(b => b.isOn);
  const anyHeating = poolSurface.bodies.some(b => b.heaterIsOn);
  const poolBody = poolSurface.bodies.find(b => b.name.toLowerCase().includes('pool')) ?? poolSurface.bodies[0] ?? null;
  const spaBody  = poolSurface.bodies.find(b => b.name.toLowerCase().includes('spa')) ?? null;
  const tempUnit = (poolSurface.bodies[0]?.waterTempUnit ?? '°F').replace('°', '');

  const akvoInfo = akvoOverall(akvoState);
  const isMoving = akvoState.floorsMoving === true;
  const isFault  = akvoState.emergencyStop === true || akvoState.systemFault === true;
  const showFloor = showAkvo && akvoState.present;
  const { plate: plateColor, glow: glowColor } = akvoFloorColor(akvoState);

  const mainY = heroDepthToPx(akvoState.mainFloorPosition);
  const bajaY = akvoState.bajaPosition != null ? heroDepthToPx(akvoState.bajaPosition) : null;
  const motionDir: 'up' | 'down' | null = isMoving
    ? (akvoState.mainFloorPosition != null && akvoState.mainFloorPosition < 0 ? 'up' : 'down')
    : null;

  // Water tint warms slightly when heating, cools when idle.
  const waterTop = anyHeating ? 'rgb(45 130 165)' : 'rgb(38 150 200)';

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden"
      style={{
        // Hero is tall on a wide wall, shorter on mobile via aspect clamp.
        height: 'clamp(15rem, 42cqw, 26rem)',
        borderTopLeftRadius: 'var(--radius-surface)',
        borderTopRightRadius: 'var(--radius-surface)',
        borderBottom: `1px solid color-mix(in srgb, ${WATER} 22%, rgba(255,255,255,0.08))`,
      }}
    >
      {/* ── The dive-view SVG (full bleed) ──────────────────────────────────── */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${HERO_VB_W} ${HERO_VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-label={`${areaName} pool cross-section`}
      >
        <defs>
          {/* Deep water column gradient */}
          <linearGradient id="heroWater" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={waterTop}      stopOpacity="0.55" />
            <stop offset="45%"  stopColor="rgb(12 92 135)" stopOpacity="0.78" />
            <stop offset="100%" stopColor="rgb(6 38 62)"   stopOpacity="0.95" />
          </linearGradient>
          {/* Sky / above-deck soft glow */}
          <linearGradient id="heroSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="rgb(10 40 64)" stopOpacity="0.0" />
            <stop offset="100%" stopColor="rgb(14 70 102)" stopOpacity="0.25" />
          </linearGradient>
          {/* Caustic light shafts */}
          <radialGradient id="heroCaustic1" cx="50%" cy="0%" r="80%">
            <stop offset="0%"   stopColor="#7dd3fc" stopOpacity="0.22" />
            <stop offset="55%"  stopColor="#38bdf8" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
          </radialGradient>
          <radialGradient id="heroCaustic2" cx="50%" cy="50%" r="55%">
            <stop offset="0%"   stopColor="#bae6fd" stopOpacity="0.16" />
            <stop offset="60%"  stopColor="#7dd3fc" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.0" />
          </radialGradient>
          {/* Surface wave pattern */}
          <pattern id="heroWavePat" x="0" y="0" width="120" height="20" patternUnits="userSpaceOnUse"
            style={!reduced && anyBodyOn ? { animation: 'pool-comp-hero-wave-drift 5s linear infinite' } : {}}>
            <path d="M0 10 Q15 3 30 10 Q45 17 60 10 Q75 3 90 10 Q105 17 120 10"
              fill="none" stroke="#cdeefe" strokeWidth="2" strokeOpacity="0.5" />
          </pattern>
          <pattern id="heroWavePat2" x="0" y="0" width="90" height="16" patternUnits="userSpaceOnUse"
            style={!reduced && anyBodyOn ? { animation: 'pool-comp-hero-wave-drift2 7s linear infinite' } : {}}>
            <path d="M0 8 Q11 3 22 8 Q34 13 45 8 Q56 3 68 8 Q79 13 90 8"
              fill="none" stroke="#7dd3fc" strokeWidth="1.4" strokeOpacity="0.32" />
          </pattern>
          {/* Plate glow */}
          <filter id="heroPlateGlow" x="-30%" y="-150%" width="160%" height="400%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b" />
            <feFlood floodColor={plateColor} floodOpacity="0.7" result="c" />
            <feComposite in="c" in2="b" operator="in" result="g" />
            <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Above-deck region */}
        <rect x="0" y="0" width={HERO_VB_W} height={HERO_DECK_Y} fill="url(#heroSky)" />

        {/* Water column */}
        <rect x="0" y={HERO_DECK_Y} width={HERO_VB_W} height={HERO_VB_H - HERO_DECK_Y} fill="url(#heroWater)" />

        {/* Caustic light shafts in the water */}
        <ellipse cx="320" cy={HERO_DECK_Y + 40} rx="380" ry="220" fill="url(#heroCaustic1)"
          style={!reduced ? { animation: 'pool-comp-depth-pulse 7s ease-in-out infinite' } : {}} />
        <ellipse cx="760" cy={HERO_DECK_Y + 120} rx="320" ry="200" fill="url(#heroCaustic2)"
          style={!reduced ? { animation: 'pool-comp-depth-pulse 9s ease-in-out infinite 1.5s' } : {}} />

        {/* Rising bubbles when a pump/body is running */}
        {anyBodyOn && !reduced && (
          <g>
            {[
              { x: 180, r: 4, dur: 6, delay: 0 },
              { x: 250, r: 3, dur: 7.5, delay: 1.2 },
              { x: 820, r: 5, dur: 5.5, delay: 0.6 },
              { x: 880, r: 3, dur: 8, delay: 2 },
              { x: 520, r: 3.5, dur: 6.8, delay: 1.8 },
            ].map((b, i) => (
              <circle key={i} cx={b.x} cy={HERO_VB_H - 30} r={b.r}
                fill="#cdeefe" fillOpacity="0.4"
                style={{ animation: `pool-comp-bubble-rise ${b.dur}s ease-in infinite`, animationDelay: `${b.delay}s` }} />
            ))}
          </g>
        )}

        {/* Water surface — animated wave bands */}
        <g style={!reduced ? { animation: 'pool-comp-hero-shimmer 4s ease-in-out infinite' } : {}}>
          <rect x="-120" y={HERO_DECK_Y - 10} width={HERO_VB_W + 240} height="20" fill="url(#heroWavePat)" opacity="0.85" />
          <rect x="-120" y={HERO_DECK_Y - 2}  width={HERO_VB_W + 240} height="16" fill="url(#heroWavePat2)" opacity="0.6" />
        </g>

        {/* Deck reference line + label */}
        <line x1="0" y1={HERO_DECK_Y} x2={HERO_VB_W} y2={HERO_DECK_Y}
          stroke="rgba(205,238,254,0.35)" strokeWidth="1.5" strokeDasharray="8 6" />
        <text x="22" y={HERO_DECK_Y - 12} fontSize="13" fontFamily="var(--font-numeric, monospace)"
          fill="rgba(205,238,254,0.55)" letterSpacing="2" fontWeight="600">
          WATER LINE · 0.00 m
        </text>

        {/* Depth ruler on the right edge */}
        {[0, 1, 2, 3, 4].map((m) => {
          const y = HERO_DECK_Y + m * HERO_PX_PER_M;
          if (y > HERO_VB_H - 20) return null;
          return (
            <g key={m}>
              <line x1={HERO_VB_W - 44} y1={y} x2={HERO_VB_W - 30} y2={y}
                stroke="rgba(205,238,254,0.25)" strokeWidth="1.5" />
              <text x={HERO_VB_W - 26} y={y + 4} fontSize="11" fontFamily="var(--font-numeric, monospace)"
                fill="rgba(205,238,254,0.4)">{m}m</text>
            </g>
          );
        })}

        {/* ── AKVO floor plate (display only) ──────────────────────────────── */}
        {showFloor && (
          <>
            {/* Baja shelf (secondary floor), if present */}
            {bajaY != null && (
              <g style={{
                transition: isMoving ? 'transform 0.6s linear' : 'transform 1.1s cubic-bezier(0.34,1.18,0.64,1)',
                transform: `translateY(${bajaY - HERO_DECK_Y}px)`,
              }}>
                <g transform={`translate(${HERO_VB_W / 2 - HERO_BAJA_W / 2 - 60}, ${HERO_DECK_Y})`}>
                  <rect x="0" y="0" width={HERO_BAJA_W} height={HERO_BAJA_H} rx="3"
                    fill="rgb(71 85 105)" stroke="rgb(148 163 184)" strokeWidth="1" opacity="0.72" />
                  <text x={HERO_BAJA_W / 2} y={HERO_BAJA_H / 2 + 4} textAnchor="middle"
                    fontSize="9" fill="rgb(186 230 253)" fontFamily="monospace" letterSpacing="2">BAJA</text>
                </g>
              </g>
            )}

            {/* Main floor plate — the hero element */}
            <g style={{
              transition: isMoving ? 'transform 0.6s linear' : 'transform 1.1s cubic-bezier(0.34,1.18,0.64,1)',
              transform: `translateY(${mainY - HERO_DECK_Y}px)`,
            }}>
              <g transform={`translate(${HERO_VB_W / 2 - HERO_PLATE_W / 2}, ${HERO_DECK_Y})`}>
                {/* Drop glow */}
                <ellipse cx={HERO_PLATE_W / 2} cy={HERO_PLATE_H + 7} rx={HERO_PLATE_W / 2 - 8} ry="9"
                  fill={glowColor}
                  style={isFault ? { animation: 'pool-comp-akvo-alert 1s ease-in-out infinite' } : {}} />
                {/* Lifting cables */}
                {[40, HERO_PLATE_W - 40].map((cx, i) => (
                  <line key={i} x1={cx} y1="0" x2={cx} y2={-(mainY - HERO_DECK_Y) - 4}
                    stroke="rgb(120 140 165)" strokeWidth="2" strokeOpacity="0.5"
                    strokeDasharray={isMoving ? '6 4' : 'none'}
                    style={isMoving && !reduced ? { animation: `pool-comp-cable-flow 0.5s linear infinite ${i * 0.2}s` } : {}} />
                ))}
                {/* Plate body */}
                <rect x="0" y="0" width={HERO_PLATE_W} height={HERO_PLATE_H} rx="4"
                  fill={plateColor} filter="url(#heroPlateGlow)"
                  opacity={isFault ? undefined : 0.94}
                  style={isFault ? { animation: 'pool-comp-akvo-alert 1s ease-in-out infinite' } : {}} />
                {/* Surface grip lines */}
                {Array.from({ length: 9 }, (_, k) => 40 + k * 42).map(x => (
                  <line key={x} x1={x} y1="3" x2={x} y2={HERO_PLATE_H - 3}
                    stroke="rgba(0,0,0,0.18)" strokeWidth="1.5" />
                ))}
                {/* Label */}
                <text x={HERO_PLATE_W / 2} y={HERO_PLATE_H / 2 + 4} textAnchor="middle"
                  fontSize="11" fill="rgba(0,0,0,0.72)" fontFamily="monospace" fontWeight="bold" letterSpacing="3">
                  MOVABLE FLOOR
                </text>
                {/* Motion arrows */}
                {motionDir === 'up' && [0, 1].map(k => (
                  <polygon key={k}
                    points={`${HERO_PLATE_W / 2 - 9},${-6 - k * 16} ${HERO_PLATE_W / 2 + 9},${-6 - k * 16} ${HERO_PLATE_W / 2},${-18 - k * 16}`}
                    fill={plateColor} style={{ animation: `pool-comp-plate-arrow 0.7s ease-in-out infinite ${k * 0.2}s` }} />
                ))}
                {motionDir === 'down' && [0, 1].map(k => (
                  <polygon key={k}
                    points={`${HERO_PLATE_W / 2 - 9},${HERO_PLATE_H + 6 + k * 16} ${HERO_PLATE_W / 2 + 9},${HERO_PLATE_H + 6 + k * 16} ${HERO_PLATE_W / 2},${HERO_PLATE_H + 18 + k * 16}`}
                    fill={plateColor} style={{ animation: `pool-comp-plate-arrow 0.7s ease-in-out infinite ${k * 0.2}s` }} />
                ))}
              </g>
            </g>

            {/* Depth callout for the main floor */}
            {akvoState.mainFloorPosition != null && (
              <g style={{ transition: 'transform 1.1s cubic-bezier(0.34,1.18,0.64,1)', transform: `translateY(${mainY - HERO_DECK_Y}px)` }}>
                <line x1={HERO_VB_W / 2 - HERO_PLATE_W / 2 - 10} y1={HERO_DECK_Y + HERO_PLATE_H / 2}
                  x2={HERO_VB_W / 2 - HERO_PLATE_W / 2 - 44} y2={HERO_DECK_Y + HERO_PLATE_H / 2}
                  stroke="rgba(205,238,254,0.4)" strokeWidth="1.5" />
                <text x={HERO_VB_W / 2 - HERO_PLATE_W / 2 - 50} y={HERO_DECK_Y + HERO_PLATE_H / 2 + 5}
                  textAnchor="end" fontSize="15" fill={plateColor} fontFamily="var(--font-numeric, monospace)" fontWeight="bold">
                  {akvoState.mainFloorPosition.toFixed(2)} m
                </text>
              </g>
            )}
          </>
        )}
      </svg>

      {/* ── HUD overlay: title + readout chips (legible glass over the scene) ─ */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none"
        style={{ padding: 'clamp(0.6rem, 3cqw, 1.25rem)' }}>

        {/* Top row: area title (left) + lights/floor status (right) */}
        <div className="flex items-start justify-between gap-3">
          {/* Title bead */}
          <div className="flex items-center pointer-events-auto" style={{ gap: 'clamp(0.4rem, 2cqw, 0.75rem)' }}>
            <div style={{
              width: 'clamp(34px, 4.5cqw, 48px)', height: 'clamp(34px, 4.5cqw, 48px)',
              borderRadius: 'var(--radius-control)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: `color-mix(in srgb, ${WATER} 30%, var(--glass-l3-bg))`,
              backgroundImage: 'var(--specular-strong)',
              border: `1px solid color-mix(in srgb, ${WATER} 58%, var(--glass-l3-border))`,
              boxShadow: `var(--rim-light), inset 0 0 18px -4px color-mix(in srgb, ${WATER} 48%, transparent), 0 0 24px -4px color-mix(in srgb, ${WATER} 62%, transparent)`,
            }}>
              <IconWaves style={{ width: 'clamp(18px, 2.6cqw, 24px)', height: 'clamp(18px, 2.6cqw, 24px)', color: WATER }} />
            </div>
            <div className="flex flex-col" style={{ gap: 2 }}>
              <h2 style={{
                margin: 0, fontFamily: 'var(--font-display)',
                fontSize: 'clamp(1.1rem, 3cqw, 1.9rem)', fontWeight: 700, lineHeight: 1.1,
                color: 'rgb(245 250 255)', letterSpacing: 'var(--tracking-tight)',
                textShadow: '0 2px 12px rgba(0,0,0,0.55)',
              }}>{areaName}</h2>
              <div className="flex items-center flex-wrap" style={{ gap: 'var(--space-2)' }}>
                {anyBodyOn && <HeroTag label="Pool Active" color={WATER} />}
                {anyHeating && <HeroTag label="Heating" color={WARN} />}
                {showFloor && isMoving && <HeroTag label="Floor Moving" color={WARN} pulse />}
                {showFloor && isFault && <HeroTag label="Floor Fault" color={ALERT} pulse />}
              </div>
            </div>
          </div>

          {/* Right-side chips: lights + floor status (fills the previously-empty right) */}
          <div className="flex items-center flex-wrap justify-end pointer-events-auto" style={{ gap: 'var(--space-2)' }}>
            {config.showLighting && lutronLightsOn > 0 && (
              <HeroChip color={WARN}>
                <IconLightbulb style={{ width: 15, height: 15, color: WARN, filter: `drop-shadow(0 0 4px ${WARN})` }} />
                <span style={{ fontSize: 'var(--type-sm)', fontWeight: 700, color: WARN }}>{lutronLightsOn} on</span>
              </HeroChip>
            )}
            {showFloor && (
              <HeroChip color={akvoInfo.color} stacked label="Floor">
                <span style={{ fontSize: 'clamp(0.7rem, 1.4cqw, 0.95rem)', fontWeight: 800, color: akvoInfo.color }}>
                  {akvoInfo.label}
                </span>
              </HeroChip>
            )}
          </div>
        </div>

        {/* Bottom row: temperature readouts + body toggles (the legible HUD) */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-end flex-wrap pointer-events-auto" style={{ gap: 'clamp(0.4rem, 1.5cqw, 0.75rem)' }}>
            {poolBody && (
              <HeroTempReadout
                body={poolBody}
                accent={WATER}
                tempUnit={tempUnit}
                onToggle={(on) => onToggleBody(poolBody.entityId, on)}
                reduced={reduced}
              />
            )}
            {spaBody && (
              <HeroTempReadout
                body={spaBody}
                accent={WARN}
                tempUnit={tempUnit}
                onToggle={(on) => onToggleBody(spaBody.entityId, on)}
                reduced={reduced}
              />
            )}
          </div>

          {/* AKVO active config (bottom-right, anchors the right side) */}
          {showFloor && (
            <div className="pointer-events-auto" style={{
              borderRadius: 'var(--radius-control)',
              padding: 'clamp(0.3rem, 1.2cqw, 0.5rem) clamp(0.5rem, 2cqw, 0.85rem)',
              backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: `color-mix(in srgb, ${akvoInfo.color} 14%, var(--glass-l3-bg))`,
              backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
              border: `1px solid color-mix(in srgb, ${akvoInfo.color} 38%, var(--glass-l3-border))`,
              boxShadow: `var(--rim), 0 0 14px -4px color-mix(in srgb, ${akvoInfo.color} 32%, transparent)`,
            }}>
              <div className="flex flex-col items-end">
                <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
                  Configuration
                </span>
                <span style={{ fontSize: 'clamp(0.75rem, 1.5cqw, 1rem)', fontWeight: 700, color: 'rgb(245 250 255)' }}>
                  {akvoState.activeConfiguration ?? '—'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Small HUD tag (status word)
const HeroTag: React.FC<{ label: string; color: string; pulse?: boolean }> = ({ label, color, pulse }) => (
  <span style={{
    fontSize: 'var(--type-2xs)', fontWeight: 700, color,
    letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const,
    textShadow: '0 1px 6px rgba(0,0,0,0.5)',
    animation: pulse ? 'pool-comp-akvo-alert 0.8s ease-in-out infinite' : 'none',
  }}>{label}</span>
);

// HUD chip wrapper (glass)
const HeroChip: React.FC<{ color: string; children: React.ReactNode; stacked?: boolean; label?: string }> = ({
  color, children, stacked, label,
}) => (
  <div style={{
    borderRadius: 'var(--radius-control)',
    padding: 'clamp(0.25rem, 1cqw, 0.45rem) clamp(0.4rem, 1.8cqw, 0.75rem)',
    backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
    backgroundColor: `color-mix(in srgb, ${color} 16%, var(--glass-l3-bg))`,
    backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
    border: `1px solid color-mix(in srgb, ${color} 40%, var(--glass-l3-border))`,
    boxShadow: `var(--rim), 0 0 12px -3px color-mix(in srgb, ${color} 32%, transparent)`,
  }}>
    {stacked ? (
      <div className="flex flex-col items-center">
        {label && <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>{label}</span>}
        {children}
      </div>
    ) : (
      <div className="flex items-center" style={{ gap: 'var(--space-1)' }}>{children}</div>
    )}
  </div>
);

// HUD temperature readout with an integrated body on/off control.
const HeroTempReadout: React.FC<{
  body: BodyState; accent: string; tempUnit: string;
  onToggle: (on: boolean) => void; reduced: boolean;
}> = ({ body, accent, tempUnit, onToggle, reduced }) => {
  const isPool = body.name.toLowerCase().includes('pool');
  return (
    <div style={{
      borderRadius: 'var(--radius-card)',
      padding: 'clamp(0.35rem, 1.4cqw, 0.6rem) clamp(0.5rem, 2cqw, 0.85rem)',
      backdropFilter: 'var(--glass-l2-backdrop)', WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
      backgroundColor: body.isOn ? `color-mix(in srgb, ${accent} 18%, var(--glass-l2-bg))` : 'var(--glass-l2-bg)',
      backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
      border: `1px solid ${body.isOn ? `color-mix(in srgb, ${accent} 48%, var(--glass-l2-border))` : 'var(--glass-l2-border)'}`,
      boxShadow: body.isOn
        ? `var(--rim), inset 0 0 26px -8px color-mix(in srgb, ${accent} 26%, transparent), 0 0 18px -4px color-mix(in srgb, ${accent} 36%, transparent)`
        : 'var(--rim), var(--elev-1)',
      transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
      animation: !reduced ? 'pool-comp-readout-float 6s ease-in-out infinite' : 'none',
    }}>
      <div className="flex items-center" style={{ gap: 'clamp(0.4rem, 1.5cqw, 0.7rem)' }}>
        <div className="flex flex-col">
          <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
            {body.name}
          </span>
          <div className="flex items-baseline" style={{ gap: 2 }}>
            <span style={{ fontSize: 'clamp(1.3rem, 3.4cqw, 2.4rem)', fontWeight: 800, lineHeight: 1, color: 'rgb(245 250 255)', fontVariantNumeric: 'tabular-nums' as const, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
              {body.waterTempC !== null ? Math.round(body.waterTempC) : '--'}
            </span>
            <span style={{ fontSize: 'clamp(0.7rem, 1.2cqw, 1rem)', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>°{tempUnit}</span>
          </div>
          {body.heaterIsOn && body.heaterTarget !== null && (
            <span className="flex items-center" style={{ gap: 3, fontSize: 'var(--type-2xs)', color: WARN, fontWeight: 600, marginTop: 1 }}>
              <IconFlame style={{ width: 10, height: 10 }} /> → {body.heaterTarget}°
            </span>
          )}
        </div>
        <ControlPill label={body.isOn ? 'ON' : 'OFF'} isOn={body.isOn} onClick={() => onToggle(!body.isOn)} accent={accent} />
      </div>
    </div>
  );
};

/**
 * AKVO Hold-to-request button.
 * SAFETY CONTRACT: This is byte-for-byte the same safety logic as AkvoFloorSurface.
 * HOLD_MS, RAF progress ring, onComplete, disabled/requesting gates, and all
 * pointer-event handlers are UNCHANGED. Only visual: embedded in glass level-3.
 */
const AkvoHoldButton: React.FC<{
  preset: string; disabled: boolean; requesting: boolean; onComplete: () => void;
}> = ({ preset, disabled, requesting, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const stop = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setProgress(0);
  };
  useEffect(() => stop, []);

  const tick = () => {
    const elapsed = Date.now() - startRef.current;
    const p = Math.min(1, elapsed / AKVO_HOLD_MS);
    setProgress(p);
    if (p >= 1) { stop(); onComplete(); return; }
    rafRef.current = requestAnimationFrame(tick);
  };
  const begin = (e: React.PointerEvent) => {
    if (disabled || requesting) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      disabled={disabled || requesting}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className="relative flex flex-col items-center justify-center gap-1 select-none touch-none overflow-hidden"
      style={{
        borderRadius: 'var(--radius-control)',
        padding: 'clamp(0.4rem, 2cqmin, 0.65rem) clamp(0.5rem, 2.5cqmin, 0.75rem)',
        minHeight: '3rem',
        backdropFilter: 'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: !disabled ? `color-mix(in srgb, ${WARN} 14%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--sheen-default), var(--specular-strong), var(--glass-l3-tint)',
        border: `1px solid ${!disabled ? `color-mix(in srgb, ${WARN} 40%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
        boxShadow: !disabled
          ? `var(--rim), inset 0 0 16px -4px color-mix(in srgb, ${WARN} 26%, transparent), 0 0 12px -3px color-mix(in srgb, ${WARN} 32%, transparent)`
          : 'var(--rim)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
        fontWeight: 700,
        color: 'rgb(var(--text))',
      }}
      title={disabled ? 'AKVO not ready' : `Hold to request ${preset}`}
    >
      <div className="absolute inset-0 origin-left pointer-events-none" style={{
        transform: `scaleX(${progress})`,
        background: `color-mix(in srgb, ${WARN} 34%, transparent)`,
        transition: progress === 0 ? 'transform 120ms ease-out' : 'none',
        borderRadius: 'inherit',
      }} />
      <span className="relative z-10 flex items-center gap-1" style={{ fontSize: 'var(--type-xs)' }}>
        {requesting ? <IconLoader2 className="w-3.5 h-3.5 animate-spin" /> : <IconHand className="w-3.5 h-3.5" />}
        {preset}
      </span>
      <span className="relative z-10" style={{ fontSize: 'var(--type-2xs)', color: 'rgba(var(--text) / 0.5)' }}>
        {requesting ? 'Requesting…' : disabled ? 'unavailable' : progress > 0 ? 'keep holding…' : 'hold to request'}
      </span>
    </button>
  );
};

const AkvoSectionContent: React.FC = () => {
  const { state, gate, status, requestingPreset, requestConfiguration } = useAkvoFloor();
  const overall = akvoOverall(state);
  const isFault = state.emergencyStop === true || state.systemFault === true;
  const isMoving = state.floorsMoving === true;

  if (!state.present) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-4" style={{ gap: 'var(--space-2)' }}>
        <IconWaves style={{ width: 20, height: 20, color: `color-mix(in srgb, ${WATER} 40%, transparent)` }} />
        <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)' }}>
          {status === 'connecting' ? 'Connecting to AKVO…' : 'AKVO Movable Floor not detected.'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
      {/* Status banner */}
      <div
        className="flex items-center gap-2 rounded-control"
        style={{
          padding: 'clamp(0.4rem, 2cqmin, 0.6rem) clamp(0.5rem, 2.5cqmin, 0.75rem)',
          backdropFilter: 'var(--glass-l2-backdrop)',
          WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
          backgroundColor: `color-mix(in srgb, ${overall.color} 18%, var(--glass-l2-bg))`,
          backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
          border: `1px solid color-mix(in srgb, ${overall.color} 55%, var(--glass-l2-border))`,
          boxShadow: `var(--rim), inset 0 0 24px -6px color-mix(in srgb, ${overall.color} 28%, transparent), 0 0 16px -4px color-mix(in srgb, ${overall.color} 36%, transparent)`,
          animation: isFault ? 'pool-comp-akvo-alert 1s ease-in-out infinite' : 'none',
          transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
        }}
      >
        <span style={{ fontSize: 'clamp(0.85rem, 4.5cqmin, 1.1rem)', fontWeight: 800, color: overall.color,
          textShadow: `0 0 16px color-mix(in srgb, ${overall.color} 50%, transparent)` }}>
          {overall.label}
        </span>
        <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.5)', marginLeft: 'auto' }}>
          {state.activeConfiguration ?? 'No config'}
        </span>
        <AkvoStatusPill status={status} />
      </div>

      {/* Position readout */}
      <div className="grid grid-cols-2" style={{ gap: 'var(--space-2)' }}>
        {[
          { label: 'Main Floor', value: state.mainFloorPosition, moving: isMoving },
          { label: 'Baja', value: state.bajaPosition, moving: false },
        ].map(({ label, value, moving }) => (
          <div key={label} style={{
            borderRadius: 'var(--radius-control)',
            padding: 'clamp(0.3rem, 1.8cqmin, 0.5rem)',
            backdropFilter: 'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)',
            backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
            border: '1px solid var(--glass-l3-border)',
            boxShadow: 'var(--rim), var(--elev-1)',
          }}>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const, color: 'rgba(var(--text) / 0.45)' }}>
                {label}
              </span>
              {moving && <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: WARN, animation: 'pool-comp-akvo-alert 0.9s ease-in-out infinite' }}>moving</span>}
            </div>
            <div className="flex items-baseline gap-1">
              <span style={{ fontSize: 'clamp(1rem, 5.5cqmin, 1.3rem)', fontWeight: 700, color: 'rgb(var(--text))', fontVariantNumeric: 'tabular-nums' as const }}>
                {value != null ? value.toFixed(2) : '--'}
              </span>
              <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)' }}>
                {(state as any).positionUnit ?? 'm'}
              </span>
            </div>
            <span style={{ fontSize: 'var(--type-2xs)', color: value == null ? 'rgba(var(--text) / 0.25)' : value < 0 ? WATER : 'var(--accent-warn)', textTransform: 'uppercase' as const }}>
              {value == null ? 'no reading' : value < 0 ? 'above deck' : value > 0 ? 'below deck' : 'at deck'}
            </span>
          </div>
        ))}
      </div>

      {/* Safety framing */}
      <div style={{
        borderRadius: 'var(--radius-control)',
        padding: 'var(--space-3)',
        backdropFilter: 'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: 'var(--glass-l2-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
        border: '1px solid var(--glass-l2-border)',
        boxShadow: 'var(--rim), var(--elev-1)',
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
      }}>
        <IconShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: WARN, filter: `drop-shadow(0 0 4px ${WARN})` }} />
        <p style={{ fontSize: 'var(--type-2xs)', color: 'rgba(var(--text) / 0.6)', lineHeight: 1.55, margin: 0 }}>
          <span style={{ fontWeight: 700, color: 'rgb(var(--text))' }}>AKVO is the safety authority.</span>{' '}
          These are <span style={{ fontWeight: 600 }}>requests</span> — the controller validates and moves the floor only if safe.
        </p>
      </div>

      {/* Gate blocked */}
      {!gate.enabled && (
        <div style={{
          borderRadius: 'var(--radius-control)',
          padding: 'var(--space-3)',
          backdropFilter: 'var(--glass-l2-backdrop)',
          WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
          backgroundColor: `color-mix(in srgb, ${ALERT} 12%, var(--glass-l2-bg))`,
          backgroundImage: 'var(--specular-default)',
          border: `1px solid color-mix(in srgb, ${ALERT} 35%, var(--glass-l2-border))`,
          boxShadow: 'var(--rim)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          <IconAlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: ALERT }} />
          <span style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: ALERT }}>
            Requests disabled — {gate.reason}
          </span>
        </div>
      )}

      {/* Presets */}
      {state.requestSelect && state.requestSelect.options.length > 0 && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 'var(--type-xs)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const, color: 'rgba(var(--text) / 0.45)' }}>
            <IconLayers style={{ width: 14, height: 14 }} /> Presets
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: 'var(--space-2)' }}>
            {state.requestSelect.options.map(preset => {
              const isActive = state.activeConfiguration === preset;
              const isReq = requestingPreset === preset;
              return (
                <div key={preset} className="flex flex-col gap-0.5">
                  <AkvoHoldButton
                    preset={preset}
                    disabled={!gate.enabled || isActive}
                    requesting={isReq}
                    onComplete={() => { void requestConfiguration(preset); }}
                  />
                  {isActive && (
                    <span style={{ fontSize: 'var(--type-2xs)', textAlign: 'center', color: PLUG, fontWeight: 700, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
                      current
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live motion feedback */}
      {(requestingPreset || isMoving) && (
        <div style={{
          borderRadius: 'var(--radius-control)',
          padding: 'var(--space-3)',
          backdropFilter: 'var(--glass-l2-backdrop)',
          WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
          backgroundColor: `color-mix(in srgb, ${WARN} 12%, var(--glass-l2-bg))`,
          backgroundImage: 'var(--specular-default)',
          border: `1px solid color-mix(in srgb, ${WARN} 35%, var(--glass-l2-border))`,
          boxShadow: 'var(--rim)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          <IconLoader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: WARN }} />
          <span style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: WARN }}>
            {isMoving
              ? `Moving${state.activeConfiguration ? ` → ${state.activeConfiguration}` : ''}…`
              : `Requesting ${requestingPreset}… (AKVO validating)`}
          </span>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// SECTION D — LUTRON LIGHTING (pool-area filtered)
// =============================================================================

const LutronSectionContent: React.FC<{
  areaFilter: string[];
}> = ({ areaFilter }) => {
  const { state, connStatus, getOptimistic, setOptimistic } = useLutronSurface();

  // Filter areas by the configured slugs. Empty filter = show all.
  const filteredAreas = useMemo(() => {
    if (!state.present) return [];
    if (areaFilter.length === 0) return state.areas;
    return state.areas.filter(area =>
      areaFilter.some(slug => area.name.toLowerCase().includes(slug.toLowerCase()))
    );
  }, [state.areas, state.present, areaFilter]);

  // Top-level scenes filtered to area-matching slugs
  const filteredScenes = useMemo(() => {
    if (!state.present) return [];
    if (areaFilter.length === 0) return state.scenes;
    return state.scenes.filter(s =>
      areaFilter.some(slug => s.name.toLowerCase().includes(slug.toLowerCase()))
    );
  }, [state.scenes, state.present, areaFilter]);

  // All hooks must be called unconditionally before any early return (Rules of Hooks).
  const handleToggleLight = useCallback((light: LutronLightState) => {
    void lutronToggleLight(light.entityId, !light.isOn);
  }, []);

  const handleBrightness = useCallback((light: LutronLightState, pct: number) => {
    setOptimistic(light.entityId, pct);
    void lutronSetBrightness(light.entityId, pct);
  }, [setOptimistic]);

  const handleCover = useCallback((cover: LutronCoverState, action: 'open' | 'close' | 'stop') => {
    if (action === 'open') void openCover(cover.entityId);
    else if (action === 'close') void closeCover(cover.entityId);
    else void stopCover(cover.entityId);
  }, []);

  const handleScene = useCallback((scene: LutronSceneState) => {
    void activateScene(scene.entityId);
  }, []);

  if (!state.present) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-4" style={{ gap: 'var(--space-2)' }}>
        <IconLightbulb style={{ width: 20, height: 20, color: `color-mix(in srgb, ${WARN} 40%, transparent)` }} />
        <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)' }}>
          {connStatus === 'connecting' ? 'Connecting to Lutron…' : 'No Lutron entities found.'}
        </span>
      </div>
    );
  }

  if (filteredAreas.length === 0) {
    const filterDesc = areaFilter.length > 0
      ? areaFilter.join(', ')
      : 'any';
    return (
      <div className="flex flex-col items-center justify-center text-center py-4" style={{ gap: 'var(--space-2)' }}>
        <IconLightbulb style={{ width: 20, height: 20, color: `color-mix(in srgb, ${WARN} 40%, transparent)` }} />
        <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)' }}>
          No Lutron areas matching filter: <em>{filterDesc}</em>.<br />
          Adjust <code>lutronAreaFilter</code> in device config.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
      {/* Connection status pill */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 'var(--type-2xs)', color: 'rgba(var(--text) / 0.4)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 'var(--tracking-caps)' }}>
          {filteredAreas.length} area{filteredAreas.length !== 1 ? 's' : ''}
        </span>
        {connStatus !== 'live' && (
          <span style={{ fontSize: 'var(--type-2xs)', color: connStatus === 'stale' ? WARN : 'rgba(var(--text) / 0.4)', fontWeight: 600 }}>
            {connStatus === 'stale' ? 'Stale' : 'Connecting…'}
          </span>
        )}
      </div>

      {filteredAreas.map(area => {
        const anyLightOn = area.lights.some(l => l.isOn);
        const hasCovers = area.covers.length > 0;

        return (
          <div key={area.name}>
            <SectionLabel icon={<IconLightbulb />} accent={anyLightOn ? WARN : 'rgba(var(--text) / 0.4)'}>
              {area.name}
            </SectionLabel>

            {/* Lights */}
            {area.lights.length > 0 && (
              <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
                {area.lights.map(light => {
                  const optBrightness = getOptimistic(light.entityId);
                  const displayBrightness = optBrightness ?? light.brightness;
                  return (
                    <div key={light.entityId}
                      className="flex items-center gap-2 rounded-control"
                      style={{
                        padding: 'clamp(0.2rem, 1.5cqmin, 0.4rem) clamp(0.3rem, 2cqmin, 0.6rem)',
                        backdropFilter: 'var(--glass-l3-backdrop)',
                        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                        backgroundColor: light.isOn ? `color-mix(in srgb, ${WARN} 14%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
                        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                        border: `1px solid ${light.isOn ? `color-mix(in srgb, ${WARN} 36%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
                        boxShadow: light.isOn ? `var(--rim), 0 0 10px -3px color-mix(in srgb, ${WARN} 30%, transparent)` : 'var(--rim)',
                        transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                      }}>
                      <button onClick={() => handleToggleLight(light)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
                        <IconLightbulb style={{ width: 14, height: 14, color: light.isOn ? WARN : 'rgba(var(--text) / 0.3)', filter: light.isOn ? `drop-shadow(0 0 4px ${WARN})` : undefined }} />
                      </button>
                      <span className="truncate flex-1" style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.8)' }}>{light.name}</span>
                      {displayBrightness != null && (
                        <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: light.isOn ? WARN : 'rgba(var(--text) / 0.35)', tabularNums: true } as any}>
                          {Math.round(displayBrightness)}%
                        </span>
                      )}
                      <ControlPill label={light.isOn ? 'ON' : 'OFF'} isOn={light.isOn}
                        onClick={() => handleToggleLight(light)} accent={WARN} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Covers / shades */}
            {hasCovers && (
              <div className="flex flex-wrap mt-2" style={{ gap: 'var(--space-1)' }}>
                {area.covers.map(cover => (
                  <div key={cover.entityId}
                    className="flex items-center gap-1 rounded-control flex-1"
                    style={{
                      padding: 'clamp(0.15rem, 1.2cqmin, 0.35rem)',
                      backdropFilter: 'var(--glass-l3-backdrop)',
                      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                      backgroundColor: 'var(--glass-l3-bg)',
                      backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                      border: '1px solid var(--glass-l3-border)',
                      boxShadow: 'var(--rim)',
                      minWidth: 'clamp(100px, 30cqw, 180px)',
                    }}>
                    <span className="truncate flex-1" style={{ fontSize: 'var(--type-2xs)', color: 'rgba(var(--text) / 0.7)' }}>{cover.name}</span>
                    {[
                      { label: '▲', action: 'open' as const },
                      { label: '■', action: 'stop' as const },
                      { label: '▼', action: 'close' as const },
                    ].map(({ label, action }) => (
                      <button key={action} onClick={() => handleCover(cover, action)}
                        style={{
                          width: 24, height: 24, borderRadius: 'var(--radius-pill)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backdropFilter: 'var(--glass-l3-backdrop)',
                          WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                          backgroundColor: 'var(--glass-l3-bg)',
                          backgroundImage: 'var(--specular-strong)',
                          border: '1px solid var(--glass-l3-border)',
                          boxShadow: 'var(--rim)',
                          color: 'rgba(var(--text) / 0.7)',
                          fontSize: '0.6rem', fontWeight: 600, cursor: 'pointer',
                          transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
                        }}
                        onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.85)'; }}
                        onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                        onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                      >{label}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}

          </div>
        );
      })}

      {/* Scenes panel — top-level Lutron scenes filtered to area slugs */}
      {filteredScenes.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <SectionLabel icon={<IconSun />} accent={WARN}>Scenes</SectionLabel>
          <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>
            {filteredScenes.map(scene => (
              <button key={scene.entityId}
                onClick={() => handleScene(scene)}
                style={{
                  padding: 'clamp(0.2rem, 1.5cqmin, 0.35rem) clamp(0.4rem, 2.5cqmin, 0.65rem)',
                  borderRadius: 'var(--radius-pill)',
                  backdropFilter: 'var(--glass-l3-backdrop)',
                  WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                  backgroundColor: 'var(--glass-l3-bg)',
                  backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                  border: '1px solid var(--glass-l3-border)',
                  boxShadow: 'var(--rim)',
                  fontSize: 'var(--type-2xs)', fontWeight: 600, color: 'rgb(var(--text))', cursor: 'pointer',
                  transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
                }}
                onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.93)'; }}
                onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
              >
                <IconSun style={{ width: 10, height: 10, display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
                {scene.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// EFFECT PICKER MODAL (shared pool lights FX)
// =============================================================================

const EffectPickerModal: React.FC<{
  light: LightState;
  onSelect: (effect: string) => void;
  onClose: () => void;
}> = ({ light, onSelect, onClose }) => ReactDOM.createPortal(
  <div
    className="fixed inset-0 flex items-center justify-center z-[100] p-4"
    style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    onClick={onClose}
  >
    <div
      className="w-full max-w-sm overflow-hidden"
      style={{
        borderRadius: 'var(--radius-surface)',
        backdropFilter: 'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: 'var(--glass-l2-bg)',
        backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
        border: '1px solid var(--glass-l2-border)',
        boxShadow: 'var(--rim), var(--elev-5)',
        animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between"
        style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--glass-l2-border)', backgroundColor: 'var(--glass-l2-tint)' }}>
        <div>
          <h3 className="font-bold" style={{ fontSize: 'var(--type-md)', color: 'rgb(var(--text))' }}>{light.name}</h3>
          <p style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.45)' }}>Light show / effect</p>
        </div>
        <button onClick={onClose}
          style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--specular-default)',
            border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
            color: 'rgba(var(--text) / 0.7)', cursor: 'pointer',
          }}>
          <IconX className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap max-h-72 overflow-y-auto" style={{ padding: 'var(--space-4)', gap: 'var(--space-2)' }}>
        {['none / off', ...light.effectList].map(effect => {
          const key = effect === 'none / off' ? 'none' : effect;
          const isActive = light.effect === key;
          return (
            <button key={effect}
              onClick={() => { onSelect(key); onClose(); }}
              style={{
                padding: 'clamp(0.3rem, 1.5cqmin, 0.4rem) clamp(0.6rem, 3cqmin, 0.85rem)',
                borderRadius: 'var(--radius-pill)',
                backdropFilter: 'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: isActive ? `color-mix(in srgb, ${WATER} 26%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
                backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
                border: `1px solid ${isActive ? `color-mix(in srgb, ${WATER} 58%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
                boxShadow: isActive ? `var(--rim), inset 0 0 12px -3px color-mix(in srgb, ${WATER} 30%, transparent)` : 'var(--rim)',
                fontSize: 'var(--type-sm)', fontWeight: 500, color: isActive ? WATER : 'rgb(var(--text))', cursor: 'pointer',
              }}>
              {effect}
            </button>
          );
        })}
      </div>
    </div>
  </div>,
  document.body,
);


// =============================================================================
// COLLAPSIBLE SECTION WRAPPER
// =============================================================================

const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, accent = WATER, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <SectionCard accent={accent} active={open}>
      <button
        className="flex items-center justify-between w-full text-left"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: open ? 'var(--space-3)' : 0 }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {icon && <span style={{ color: accent }}>{icon}</span>}
          <span style={{ fontSize: 'var(--type-sm)', fontWeight: 700, color: 'rgb(var(--text))' }}>{title}</span>
        </div>
        <IconChevronDown style={{
          width: 16, height: 16, color: 'rgba(var(--text) / 0.45)', flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
        }} />
      </button>
      {open && children}
    </SectionCard>
  );
};

// =============================================================================
// MAIN: PoolCompilationTile
// =============================================================================

const PoolCompilationTile: React.FC<TileProps> = ({ tile, device }) => {
  useMemo(() => ensureAnims(), []);

  // Parse config from device state
  const config = useMemo(() => parseConfig(device.state), [device.state]);

  // ── Pool surface hook ──────────────────────────────────────────────────────
  const {
    surface,
    toggleBody,
    toggleLight: poolToggleLight,
    setLightEffect: poolSetLightEffect,
    toggleWaterFeature,
    setWaterHeaterMode,
    setWaterHeaterTemp,
    setClimateMode,
    setClimateTemp,
    setNumberValue,
  } = usePoolSurface();

  // ── AKVO hook ──────────────────────────────────────────────────────────────
  const { state: akvoState } = useAkvoFloor();

  // ── Lutron hook (for hero stats) ───────────────────────────────────────────
  const { state: lutronState } = useLutronSurface();

  // ── Effect picker modal ────────────────────────────────────────────────────
  const [effectTarget, setEffectTarget] = useState<LightState | null>(null);
  const handleEffectSelect = useCallback((effect: string) => {
    if (!effectTarget) return;
    poolSetLightEffect(effectTarget.entityId, effect);
  }, [effectTarget, poolSetLightEffect]);

  // Lutron lights-on count (for hero chip) — filtered by area
  const lutronLightsOn = useMemo(() => {
    if (!lutronState.present) return 0;
    return lutronState.areas
      .filter(area =>
        config.lutronAreaFilter.length === 0 ||
        config.lutronAreaFilter.some(slug => area.name.toLowerCase().includes(slug.toLowerCase()))
      )
      .reduce((sum, area) => sum + area.lights.filter(l => l.isOn).length, 0);
  }, [lutronState, config.lutronAreaFilter]);

  const anyBodyOn = surface.bodies.some(b => b.isOn);
  // Respect prefers-reduced-motion: the hero scene + backdrop fall back to a
  // static (no-loop) variant, mirroring the standalone surfaces' behavior.
  const reduced = useReducedMotion();

  // Count how many control sections are active — drives the balanced grid so the
  // cards STRETCH edge-to-edge instead of left-packing at fixed width. When fewer
  // than 3 sections are enabled we cap the column count so a lone card doesn't
  // leave a hole on the right.
  const hasPumps = config.showPool && (surface.pumps.length > 0 || surface.probeTemps.length > 0);
  const activeSectionCount =
    (config.showPool ? 1 : 0) + (config.showAkvo ? 1 : 0) + (config.showLighting ? 1 : 0);

  return (
    <>
      <div
        className="relative flex flex-col h-full overflow-hidden"
        style={{
          borderRadius: 'var(--radius-surface)',
          containerType: 'inline-size',
          // Base: dark pool-blue glass
          backdropFilter: 'var(--glass-l1-backdrop)',
          WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
          backgroundColor: anyBodyOn
            ? `color-mix(in srgb, ${WATER} 10%, rgba(5, 25, 45, 0.95))`
            : 'rgba(5, 22, 40, 0.97)',
          border: `1px solid ${anyBodyOn
            ? `color-mix(in srgb, ${WATER} 28%, rgba(255,255,255,0.08))`
            : 'rgba(255,255,255,0.07)'}`,
          boxShadow: anyBodyOn
            ? `var(--rim), inset 0 0 60px -15px color-mix(in srgb, ${WATER} 18%, transparent), var(--elev-5)`
            : 'var(--rim), var(--elev-4)',
          animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
          transition: `background-color var(--dur-slow, 420ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-slow, 420ms) ease, box-shadow var(--dur-slow, 420ms) ease`,
        }}
      >
        {/* Faint decorative caustics in the control region below the hero, so the
            scroll area still reads as "underwater" without a dead blob. */}
        <PoolWaterBackdrop active={anyBodyOn} reduced={reduced} />

        {/* ── HERO: full-bleed pool dive-view scene (the centerpiece) ─────── */}
        <PoolHeroScene
          areaName={tile.label || config.areaName}
          poolSurface={surface}
          akvoState={akvoState}
          lutronLightsOn={lutronLightsOn}
          config={config}
          showAkvo={config.showAkvo}
          onToggleBody={toggleBody}
          reduced={reduced}
        />

        {/* ── Scrollable control deck (full-width balanced grid) ──────────── */}
        <div
          className="relative z-10 flex-1 overflow-y-auto min-h-0"
          style={{
            padding: 'clamp(0.6rem, 2.5cqw, 1.1rem)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(0.5rem, 2cqw, 0.9rem)',
          }}
        >
          {/*
            FULL-WIDTH balanced grid. Unlike the old auto-fill (which capped cards
            at 22rem and packed them left, leaving the right empty), this uses a
            fixed responsive column count whose tracks STRETCH to fill the row:
              wall (≥ 64rem container)  → 3 equal columns
              tablet (≥ 40rem)          → 2 equal columns
              mobile                    → 1 column
            Driven by container queries on `.pool-comp-deck`.
          */}
          <div className="pool-comp-deck" data-cols={activeSectionCount}>
            {/* Pool & Spa controls + chemistry */}
            {config.showPool && (
              <CollapsibleSection
                title="Pool & Spa Controls"
                icon={<IconWaves style={{ width: 16, height: 16 }} />}
                accent={WATER}
                defaultOpen={true}
              >
                <PoolSectionContent
                  surface={surface}
                  toggleBody={toggleBody}
                  toggleLight={poolToggleLight}
                  setLightEffect={poolSetLightEffect}
                  toggleWaterFeature={toggleWaterFeature}
                  setWaterHeaterMode={setWaterHeaterMode}
                  setWaterHeaterTemp={setWaterHeaterTemp}
                  setClimateMode={setClimateMode}
                  setClimateTemp={setClimateTemp}
                  setNumberValue={setNumberValue}
                  onOpenEffectPicker={setEffectTarget}
                />
              </CollapsibleSection>
            )}

            {/* AKVO preset console (guarded) */}
            {config.showAkvo && (
              <CollapsibleSection
                title="Movable Floor Console"
                icon={<IconLayers style={{ width: 16, height: 16 }} />}
                accent={WARN}
                defaultOpen={true}
              >
                <AkvoSectionContent />
              </CollapsibleSection>
            )}

            {/* Pool-area Lutron lights & shades */}
            {config.showLighting && (
              <CollapsibleSection
                title="Lighting & Shades"
                icon={<IconLightbulb style={{ width: 16, height: 16 }} />}
                accent={WARN}
                defaultOpen={true}
              >
                <LutronSectionContent areaFilter={config.lutronAreaFilter} />
              </CollapsibleSection>
            )}
          </div>

          {/* ── Pumps + Sensors — full-width band below the grid ──────────── */}
          {hasPumps && (
            <CollapsibleSection
              title="Pumps & Sensors"
              icon={<IconActivity style={{ width: 16, height: 16 }} />}
              accent={WATER}
              defaultOpen={false}
            >
              <PumpSectionContent
                pumps={surface.pumps}
                probes={surface.probeTemps}
                speedSetpoints={surface.speedSetpoints}
                onSetSpeed={setNumberValue}
              />
            </CollapsibleSection>
          )}

          {/* ── Stale indicator ──────────────────────────────────────────── */}
          {surface.detected && surface.stale && (
            <div className="flex items-center justify-center" style={{ gap: 'var(--space-2)', padding: 'var(--space-2)' }}>
              <IconAlertTriangle style={{ width: 12, height: 12, color: WARN }} />
              <span style={{ fontSize: 'var(--type-2xs)', color: WARN, fontWeight: 600 }}>
                Pool data may be stale — reconnecting
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Effect picker portal ────────────────────────────────────────── */}
      {effectTarget && (
        <EffectPickerModal
          light={effectTarget}
          onSelect={handleEffectSelect}
          onClose={() => setEffectTarget(null)}
        />
      )}
    </>
  );
};

export default PoolCompilationTile;
