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
 * AESTHETIC: sophisticated, tight, high-definition — a premium product surface,
 * not a busy schematic. The HERO is a high-fidelity CSS gradient-mesh water
 * treatment (retina-sharp, slow/minimal motion only — no toy bubbles/ripples).
 * The control deck is a tight full-width grid of VISUAL INSTRUMENT widgets (arc
 * gauges, chemistry dials with healthy-range coloring, color swatches, shade
 * glyphs, sliders) — minimal plain text rows. Primary target: iPad landscape
 * 1366×1024 (one screen, minimal scroll); mobile stays responsive.
 *
 * CONFIGURABLE: All three integration feeds are gated by optional config baked
 * into the virtualDevice's state (a `PoolAreaConfig` object). Every field is
 * optional — sensible defaults cover the common case.
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │  HERO — high-fidelity water + temps/body toggles + AKVO depth gauge     │
 *   ├──────────────────┬──────────────────┬──────────────────────────────────┤
 *   │  POOL & SPA      │   MOVABLE FLOOR  │   LIGHTING & SHADES              │
 *   │  bodies, lights, │   guarded preset │   swatch cards + shade glyphs    │
 *   │  chem dials, SWG │   console        │   (pool-area filtered)           │
 *   ├──────────────────┴──────────────────┴──────────────────────────────────┤
 *   │  PUMPS & SENSORS (collapsed) — arc gauges, speed sliders, probes        │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * Responsive: container-query driven. Narrow → single column stacked.
 *
 * SAFETY: AKVO section is display + guarded-preset ONLY. No raw motion. The hero
 * floor depth gauge renders state only; the guarded console owns the single
 * sanctioned write (select.select_option via requestConfiguration).
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
  activateScene,
} from '../../services/lutron';
import type { LutronLightState, LutronCoverState, LutronSceneState } from '../../services/lutron';

// ── Design system ──────────────────────────────────────────────────────────────
import { useReducedMotion } from '../../design-system';

// ── Icons ──────────────────────────────────────────────────────────────────────
import {
  IconThermometer, IconFlame, IconDroplets,
  IconWaves, IconAlertTriangle, IconX,
  IconActivity, IconLightbulb, IconSun,
  IconLoader2, IconWifiOff, IconShieldAlert,
  IconHand,
  IconLayers, IconChevronDown,
} from '../icons';

// ── Helpers from PoolSurfaceTile ───────────────────────────────────────────────
import {
  fluidTextXs, fluidTextSm, fluidTextLg,
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

  /**
   * Show the one-tap quick-actions / routines bar between the hero and the
   * control deck. Default: true.
   */
  showQuickActions?: boolean;

  /**
   * The routines shown in the quick-actions bar, in order. Each entry is a
   * `QuickAction`. Omit to use a sensible default set (see DEFAULT_QUICK_ACTIONS).
   * Pass [] to hide the bar entirely (equivalent to showQuickActions:false).
   *
   * SAFETY: a `{ kind: 'floor' }` action commands AKVO floor MOTION and is ALWAYS
   * rendered as a guarded press-and-hold gated by the AKVO ready/fault/enable
   * state — never a bare one-tap. Heat / lights / feature / body actions are
   * low-hazard one-tap.
   */
  quickActions?: QuickAction[];
}

/**
 * A single quick-action / routine. `kind` selects how it is wired to real HA
 * service calls and (for `floor`) whether it must use the guarded path.
 */
export type QuickAction =
  // Set a heat setpoint on the matching body's water_heater (one-tap).
  | { kind: 'heat'; label?: string; body?: string; temp: number; turnOn?: boolean }
  // Turn the matching body's heater off (one-tap).
  | { kind: 'heatOff'; label?: string; body?: string }
  // Turn ALL pool-area + IntelliCenter lights on/off (one-tap).
  | { kind: 'lights'; label?: string; on: boolean }
  // Turn a body on/off, e.g. "Spa Mode" (one-tap).
  | { kind: 'body'; label?: string; body: string; on: boolean }
  // Toggle a water feature by name match (one-tap).
  | { kind: 'feature'; label?: string; match: string; on: boolean }
  // Request an AKVO floor configuration preset (GUARDED press-and-hold).
  | { kind: 'floor'; label?: string; preset: string };

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { kind: 'floor',   preset: 'Deep',  label: 'Floor → Deep' },
  { kind: 'floor',   preset: 'Deck',  label: 'Floor → Deck' },
  { kind: 'heat',    body: 'pool', temp: 84, turnOn: true, label: 'Pool Heat 84°' },
  { kind: 'body',    body: 'spa',  on: true, label: 'Spa Mode' },
  { kind: 'lights',  on: true,  label: 'Lights On' },
  { kind: 'lights',  on: false, label: 'Lights Off' },
];

const DEFAULTS: Required<PoolAreaConfig> = {
  showPool:         true,
  showAkvo:         true,
  showLighting:     true,
  lutronAreaFilter: ['pool', 'patio', 'spa', 'cabana', 'outdoor'],
  areaName:         'Pool Area',
  showQuickActions: true,
  quickActions:     DEFAULT_QUICK_ACTIONS,
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
      showQuickActions: typeof r.showQuickActions === 'boolean' ? r.showQuickActions : DEFAULTS.showQuickActions,
      quickActions:     Array.isArray(r.quickActions)
        ? (r.quickActions as QuickAction[])
        : DEFAULTS.quickActions,
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
/* ── Pool Compilation Tile keyframes ─────────────────────────────────────────
   SOPHISTICATED / RESTRAINED: motion is minimal, slow, and purposeful only.
   No bubbles, no spinning caustics, no glint sweeps, no toy ripples. */

/* Very slow, subtle caustic light drift across the hero water (15s+). */
@keyframes pool-comp-caustic-drift {
  0%   { transform: translate3d(0,0,0)        scale(1);    }
  50%  { transform: translate3d(-2%, 1.5%, 0) scale(1.04); }
  100% { transform: translate3d(0,0,0)        scale(1);    }
}
/* Gentle luminance breathing for depth shafts — barely perceptible. */
@keyframes pool-comp-depth-pulse {
  0%,100% { opacity: 0.55; }
  50%     { opacity: 0.78; }
}
/* Slow surface specular travel (sophisticated highlight, ~14s). */
@keyframes pool-comp-specular-travel {
  0%   { transform: translateX(-12%); opacity: 0.0; }
  35%  { opacity: 0.55; }
  65%  { opacity: 0.55; }
  100% { transform: translateX(12%);  opacity: 0.0; }
}
/* Alert pulse — reserved strictly for fault/moving states. */
@keyframes pool-comp-akvo-alert {
  0%,100% { opacity: 1;   }
  50%     { opacity: 0.42; }
}
@keyframes pool-comp-akvo-ripple {
  0%   { transform: scale(1);   opacity: 0.7; }
  100% { transform: scale(2.4); opacity: 0;   }
}
@keyframes pool-comp-section-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0);   }
}
/* Gauge needle/arc settle on mount + value change. */
@keyframes pool-comp-gauge-sweep {
  from { stroke-dashoffset: var(--gauge-circ); }
  to   { stroke-dashoffset: var(--gauge-target); }
}
/* Floor MOVING: directional chevrons travel + fade (purposeful state cue). */
@keyframes pool-comp-chev-up {
  0%   { opacity: 0;   transform: translateY(4px);  }
  40%  { opacity: 0.95; }
  100% { opacity: 0;   transform: translateY(-7px); }
}
@keyframes pool-comp-chev-down {
  0%   { opacity: 0;   transform: translateY(-4px); }
  40%  { opacity: 0.95; }
  100% { opacity: 0;   transform: translateY(7px);  }
}
/* Moving marker glow breathes brighter while in motion. */
@keyframes pool-comp-floor-move {
  0%,100% { box-shadow: 0 0 8px 1px currentColor; }
  50%     { box-shadow: 0 0 16px 4px currentColor; }
}
/* Heating: warm caustic glow rises + breathes through the heated body's water. */
@keyframes pool-comp-heat-rise {
  0%   { opacity: 0.35; transform: translateY(8%)  scale(1.02); }
  50%  { opacity: 0.7;  transform: translateY(-2%) scale(1.05); }
  100% { opacity: 0.35; transform: translateY(8%)  scale(1.02); }
}

/* ── Tight, full-width control grid (iPad-landscape first) ────────────────────
   Stretchy equal columns (NOT auto-fill) so cards fill the row edge-to-edge.
   Primary target: iPad landscape 1366×1024 → 3 columns on one screen. */
.pool-comp-deck {
  display: grid;
  grid-template-columns: 1fr;             /* mobile: single column */
  gap: clamp(0.4rem, 1.4cqw, 0.7rem);
  align-items: stretch;
  width: 100%;
}
@container (min-width: 38rem) {
  .pool-comp-deck { grid-template-columns: 1fr 1fr; }
  .pool-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
}
@container (min-width: 60rem) {
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
      padding: 'clamp(0.5rem, 1.6cqw, 0.85rem)',
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
// INSTRUMENT WIDGETS (chemistry dial, visual slider, light/shade glyphs)
// =============================================================================

/**
 * ChemDial — a 270° radial dial reading a chemistry value, with a healthy band
 * drawn into the track and a needle/value colored by whether the reading is in
 * range. Sophisticated instrument, not a text row.
 */
const ChemDial: React.FC<{
  label: string;
  value: number | null;
  unit?: string;
  min: number;
  max: number;
  /** [lo, hi] healthy band in value units */
  healthy: [number, number];
  /** value formatting */
  format?: (v: number) => string;
  reduced: boolean;
}> = ({ label, value, unit, min, max, healthy, format, reduced }) => {
  const cx = 40, cy = 40, r = 30;
  const circ = 2 * Math.PI * r;
  const sweep = 0.75;                       // 270° dial
  const trackLen = circ * sweep;
  const norm = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const inRange = value != null && value >= healthy[0] && value <= healthy[1];
  const tone = value == null
    ? 'rgba(var(--text) / 0.4)'
    : inRange ? PLUG
    : (value < healthy[0] - (healthy[1] - healthy[0]) || value > healthy[1] + (healthy[1] - healthy[0])) ? ALERT
    : WARN;
  const valFrac = value != null ? norm(value) : 0;
  const valLen = valFrac * trackLen;
  // healthy band arc
  const hLo = norm(healthy[0]) * trackLen;
  const hHi = norm(healthy[1]) * trackLen;
  const startRot = 135; // begin bottom-left, sweep clockwise

  return (
    <div className="flex flex-col items-center flex-1 min-w-0" style={{
      borderRadius: 'var(--radius-control)',
      padding: 'clamp(0.3rem, 1.6cqw, 0.55rem) clamp(0.2rem, 1.2cqw, 0.4rem)',
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: value != null ? `color-mix(in srgb, ${tone} 13%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
      backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
      border: `1px solid ${value != null ? `color-mix(in srgb, ${tone} 34%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
      boxShadow: value != null ? `var(--rim), 0 0 12px -4px color-mix(in srgb, ${tone} 30%, transparent)` : 'var(--rim), var(--elev-1)',
      transition: 'all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
    }}>
      <svg viewBox="0 0 80 80" style={{ width: 'clamp(48px, 14cqw, 76px)', height: 'clamp(48px, 14cqw, 76px)' }}>
        {/* base track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6"
          strokeDasharray={`${trackLen.toFixed(1)} ${circ.toFixed(1)}`} strokeLinecap="round"
          style={{ transform: `rotate(${startRot - 90}deg)`, transformOrigin: `${cx}px ${cy}px` }} />
        {/* healthy band */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={`color-mix(in srgb, ${PLUG} 60%, transparent)`} strokeWidth="6"
          strokeDasharray={`${(hHi - hLo).toFixed(1)} ${circ.toFixed(1)}`} strokeDashoffset={`${(-hLo).toFixed(1)}`} strokeLinecap="butt"
          style={{ transform: `rotate(${startRot - 90}deg)`, transformOrigin: `${cx}px ${cy}px`, opacity: 0.5 }} />
        {/* value arc */}
        {value != null && (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={tone} strokeWidth="6"
            strokeDasharray={`${valLen.toFixed(1)} ${circ.toFixed(1)}`} strokeLinecap="round"
            style={{
              transform: `rotate(${startRot - 90}deg)`, transformOrigin: `${cx}px ${cy}px`,
              filter: `drop-shadow(0 0 4px ${tone})`,
              transition: reduced ? 'none' : 'stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1)',
            }} />
        )}
        <text x={cx} y={cy + 2} textAnchor="middle" fill="rgb(var(--text))"
          style={{ fontSize: '17px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {value != null ? (format ? format(value) : String(Math.round(value))) : '--'}
        </text>
        {unit && (
          <text x={cx} y={cy + 14} textAnchor="middle" fill="rgba(var(--text) / 0.45)" style={{ fontSize: '8px', fontWeight: 600 }}>{unit}</text>
        )}
      </svg>
      <span className="uppercase font-bold tracking-wider text-center truncate w-full"
        style={{ fontSize: 'clamp(0.42rem, 2.6cqw, 0.58rem)', color: 'rgba(var(--text) / 0.55)', marginTop: 1 }}>
        {label}
      </span>
    </div>
  );
};

/**
 * VisualSlider — a glass track + fill + stepper beads for a 0..max value
 * (SWG output %, pump speed). Visual instrument, not a text row.
 */
const VisualSlider: React.FC<{
  label: string; value: number | null; min: number; max: number; step: number;
  unit?: string; color?: string; onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit, color = WATER, onChange }) => {
  const [local, setLocal] = useState<number | null>(null);
  const v = local ?? value ?? min;
  const pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const dec = () => { const n = Math.max(min, v - step); setLocal(n); onChange(n); };
  const inc = () => { const n = Math.min(max, v + step); setLocal(n); onChange(n); };
  const Bead = ({ symbol, onClick }: { symbol: string; onClick: () => void }) => (
    <button onClick={onClick} style={{
      width: 22, height: 22, borderRadius: 999, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
      border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
      color: 'rgb(var(--text))', fontSize: '0.85rem', fontWeight: 300, lineHeight: 1, cursor: 'pointer',
      transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
    }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.85)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >{symbol}</button>
  );
  return (
    <div className="flex flex-col" style={{
      borderRadius: 'var(--radius-control)', padding: 'clamp(0.3rem, 1.4cqw, 0.5rem)', gap: 4,
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: `color-mix(in srgb, ${color} 9%, var(--glass-l3-bg))`,
      backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
      border: `1px solid color-mix(in srgb, ${color} 26%, var(--glass-l3-border))`,
      boxShadow: 'var(--rim), var(--elev-1)',
    }}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(var(--text) / 0.6)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>{label}</span>
        <span style={{ fontSize: 'var(--type-sm)', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' as const }}>
          {Math.round(v)}<span style={{ fontSize: '0.7em', fontWeight: 500, color: 'rgba(var(--text) / 0.45)', marginLeft: 1 }}>{unit}</span>
        </span>
      </div>
      <div className="flex items-center" style={{ gap: 6 }}>
        <Bead symbol="−" onClick={dec} />
        <div className="relative flex-1 overflow-hidden" style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.07)' }}>
          <div className="absolute inset-y-0 left-0" style={{
            width: `${pct}%`, borderRadius: 999,
            background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})`,
            boxShadow: pct > 4 ? `0 0 6px ${color}` : 'none',
            transition: 'width var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
          }} />
        </div>
        <Bead symbol="+" onClick={inc} />
      </div>
    </div>
  );
};

// HS (hue 0-360, sat 0-100) → RGB triplet.
function hsToRgb(h: number, s: number): [number, number, number] {
  const sat = s / 100, l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
// Kelvin → approximate RGB (2000–7000K range warm→cool).
function kelvinToRgb(k: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (k - 2000) / 5000));
  // warm amber (255,180,107) → cool white (201,226,255)
  return [
    Math.round(255 + t * (201 - 255)),
    Math.round(180 + t * (226 - 180)),
    Math.round(107 + t * (255 - 107)),
  ];
}
function lutronLightRgb(l: LutronLightState): [number, number, number] | null {
  if (l.hsColor) return hsToRgb(l.hsColor[0], l.hsColor[1]);
  if (l.colorTempKelvin) return kelvinToRgb(l.colorTempKelvin);
  return null;
}

/**
 * LightSwatchCard — a light tile with a live COLOR SWATCH disk (reflecting the
 * bulb's actual rgb/effect when on), a brightness ring, name, and toggle.
 */
const LightSwatchCard: React.FC<{
  name: string; isOn: boolean; rgb?: [number, number, number] | null; brightness?: number | null;
  hasFx?: boolean; onToggle: () => void; onFx?: () => void;
}> = ({ name, isOn, rgb, brightness, hasFx, onToggle, onFx }) => {
  const swatch = isOn
    ? (rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : 'rgb(255 214 140)')
    : 'rgba(255,255,255,0.10)';
  const bpct = brightness != null ? Math.round(brightness) : null;
  return (
    <div className="flex items-center" style={{
      gap: 8, borderRadius: 'var(--radius-control)', padding: 'clamp(0.3rem, 1.4cqw, 0.5rem) clamp(0.4rem, 1.6cqw, 0.6rem)',
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: isOn ? `color-mix(in srgb, ${WARN} 12%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
      backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
      border: `1px solid ${isOn ? `color-mix(in srgb, ${WARN} 34%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
      boxShadow: isOn ? `var(--rim), 0 0 10px -3px color-mix(in srgb, ${WARN} 30%, transparent)` : 'var(--rim)',
      transition: 'all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
    }}>
      {/* swatch disk */}
      <button onClick={onToggle} aria-label={`${name} toggle`} style={{
        position: 'relative', width: 26, height: 26, borderRadius: 999, flexShrink: 0, cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.25)', padding: 0,
        background: swatch,
        boxShadow: isOn ? `0 0 10px 1px ${swatch}, inset 0 1px 2px rgba(255,255,255,0.5)` : 'inset 0 1px 2px rgba(255,255,255,0.12)',
        transition: 'all var(--dur-medium, 260ms) ease',
      }}>
        {!isOn && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconLightbulb style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.4)' }} />
        </span>}
      </button>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="truncate" style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: 'rgba(var(--text) / 0.85)' }}>{name}</span>
        <span style={{ fontSize: 'var(--type-2xs)', color: isOn ? WARN : 'rgba(var(--text) / 0.35)', fontWeight: 600 }}>
          {isOn ? (bpct != null ? `${bpct}%` : 'On') : 'Off'}
        </span>
      </div>
      {hasFx && (
        <button onClick={onFx} title="Effect" style={{
          fontSize: 'var(--type-2xs)', fontWeight: 700, color: WATER, cursor: 'pointer',
          padding: '2px 6px', borderRadius: 'var(--radius-chip)',
          backgroundColor: `color-mix(in srgb, ${WATER} 16%, var(--glass-l3-bg))`,
          border: `1px solid color-mix(in srgb, ${WATER} 36%, var(--glass-l3-border))`,
        }}>FX</button>
      )}
    </div>
  );
};

/**
 * ShadeGlyphCard — a window glyph with the shade drawn at its real position
 * (0 = closed/down, 100 = open/up), plus open/stop/close beads.
 */
const ShadeGlyphCard: React.FC<{
  name: string; position: number | null; onOpen: () => void; onStop: () => void; onClose: () => void;
}> = ({ name, position, onOpen, onStop, onClose }) => {
  const pos = position ?? 0;                  // 0..100 open
  const shadeDrop = 100 - pos;                // % of window the shade covers from top
  const Bead = ({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) => (
    <button onClick={onClick} aria-label={label} title={label} style={{
      width: 22, height: 22, borderRadius: 999, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--specular-strong)',
      border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
      color: 'rgba(var(--text) / 0.75)', fontSize: '0.6rem', cursor: 'pointer',
      transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
    }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.85)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >{children}</button>
  );
  return (
    <div className="flex items-center" style={{
      gap: 8, borderRadius: 'var(--radius-control)', padding: 'clamp(0.3rem, 1.4cqw, 0.5rem) clamp(0.4rem, 1.6cqw, 0.6rem)',
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
      border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
    }}>
      {/* window glyph */}
      <div className="relative flex-shrink-0 overflow-hidden" style={{
        width: 22, height: 26, borderRadius: 4,
        background: 'linear-gradient(180deg, rgba(125,211,252,0.28), rgba(56,189,248,0.10))',
        border: '1px solid rgba(255,255,255,0.22)',
      }}>
        {/* shade */}
        <div className="absolute left-0 right-0 top-0" style={{
          height: `${shadeDrop}%`,
          background: 'linear-gradient(180deg, rgba(80,96,120,0.95), rgba(60,74,96,0.92))',
          borderBottom: '1px solid rgba(255,255,255,0.35)',
          transition: 'height var(--dur-slow, 420ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
        }} />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="truncate" style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: 'rgba(var(--text) / 0.85)' }}>{name}</span>
        <span style={{ fontSize: 'var(--type-2xs)', color: 'rgba(var(--text) / 0.45)', fontWeight: 600 }}>
          {position != null ? `${Math.round(pos)}% open` : 'Shade'}
        </span>
      </div>
      <div className="flex items-center" style={{ gap: 3 }}>
        <Bead onClick={onOpen} label="Open">▲</Bead>
        <Bead onClick={onStop} label="Stop">■</Bead>
        <Bead onClick={onClose} label="Close">▼</Bead>
      </div>
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
  reduced?: boolean;
}> = ({ body, onToggle, onHeaterMode, reduced }) => {
  const isPool = body.name.toLowerCase().includes('pool');
  const bodyColor = isPool ? WATER : 'var(--accent)';
  const heating = body.heaterIsOn;
  return (
    <div
      className="relative flex flex-col rounded-control overflow-hidden"
      style={{
        backdropFilter: 'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: heating
          ? `color-mix(in srgb, ${WARN} 16%, var(--glass-l2-bg))`
          : body.isOn ? `color-mix(in srgb, ${bodyColor} 18%, var(--glass-l2-bg))` : 'var(--glass-l2-bg)',
        backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
        border: `1px solid ${heating
          ? `color-mix(in srgb, ${WARN} 50%, var(--glass-l2-border))`
          : body.isOn ? `color-mix(in srgb, ${bodyColor} 48%, var(--glass-l2-border))` : 'var(--glass-l2-border)'}`,
        boxShadow: heating
          ? `var(--rim), inset 0 0 26px -8px color-mix(in srgb, ${WARN} 30%, transparent), 0 0 18px -4px color-mix(in srgb, ${WARN} 42%, transparent), var(--elev-2)`
          : body.isOn
          ? `var(--rim), inset 0 0 28px -8px color-mix(in srgb, ${bodyColor} 28%, transparent), 0 0 18px -4px color-mix(in srgb, ${bodyColor} 36%, transparent), var(--elev-2)`
          : 'var(--rim), var(--elev-1)',
        padding: 'clamp(0.25rem, 2cqmin, 0.5rem)',
        gap: 'clamp(0.15rem, 1.5cqmin, 0.35rem)',
        transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
      }}
    >
      {/* warm heating bloom rising through the body card */}
      {heating && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{
          background: 'radial-gradient(100% 80% at 50% 120%, rgba(255,150,60,0.34), rgba(255,120,40,0.10) 48%, transparent 72%)',
          mixBlendMode: 'screen',
          animation: reduced ? 'none' : 'pool-comp-heat-rise 4.5s ease-in-out infinite',
        }} />
      )}
      <div className="relative flex items-center justify-between">
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
        <div className="relative flex items-center gap-1 flex-wrap">
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
  reduced: boolean;
}> = ({
  surface, toggleBody, toggleLight, setLightEffect,
  toggleWaterFeature, setWaterHeaterMode, setWaterHeaterTemp,
  setClimateMode, setClimateTemp, setNumberValue, onOpenEffectPicker, reduced,
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
                reduced={reduced}
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

      {/* Pool lights — swatch cards */}
      {surface.lights.length > 0 && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <SectionLabel icon={<IconLightbulb />} accent={WARN}>Pool Lights</SectionLabel>
          <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
            {surface.lights.map(light => (
              <LightSwatchCard key={light.entityId}
                name={light.name}
                isOn={light.isOn}
                rgb={null}
                brightness={null}
                hasFx={light.effectList.length > 0}
                onToggle={() => toggleLight(light.entityId, !light.isOn)}
                onFx={() => onOpenEffectPicker(light)}
              />
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

      {/* Chemistry — instrument dials + salt gauge + SWG sliders */}
      {(surface.chem.salt !== null || surface.chem.ph !== null || surface.chem.orp !== null || surface.chem.swgOutputs.length > 0) && (
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <SectionLabel icon={<IconDroplets />} accent={PLUG}>Chemistry</SectionLabel>

          {/* pH + ORP dials side by side */}
          {(surface.chem.ph !== null || surface.chem.orp !== null) && (
            <div className="flex" style={{ gap: 'var(--space-2)' }}>
              {surface.chem.ph !== null && (
                <ChemDial label="pH" value={surface.chem.ph} min={6.6} max={8.4}
                  healthy={[7.2, 7.8]} format={(v) => v.toFixed(1)} reduced={reduced} />
              )}
              {surface.chem.orp !== null && (
                <ChemDial label="ORP" value={surface.chem.orp} unit={surface.chem.orpUnit} min={400} max={900}
                  healthy={[650, 800]} reduced={reduced} />
              )}
              {surface.chem.salt !== null && (
                <ChemDial label="Salt" value={surface.chem.salt} unit={surface.chem.saltUnit} min={0} max={4500}
                  healthy={[2700, 3400]} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} reduced={reduced} />
              )}
            </div>
          )}

          {/* SWG output sliders */}
          {surface.chem.swgOutputs.length > 0 && (
            <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
              {surface.chem.swgOutputs.map(swg => (
                <VisualSlider key={swg.entityId}
                  label={`SWG ${swg.bodyLabel}`} value={swg.value} min={0} max={100} step={5} unit="%"
                  color={PLUG} onChange={(v) => setNumberValue(swg.entityId, v)} />
              ))}
            </div>
          )}
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
  if (pumps.length === 0 && probes.length === 0 && speedSetpoints.length === 0) return null;
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

      {/* Pump speed setpoints — visual sliders */}
      {speedSetpoints.length > 0 && (
        <>
          <SectionLabel icon={<IconActivity />} accent={WATER}>Pump Speed</SectionLabel>
          <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
            {speedSetpoints.map(sp => (
              <VisualSlider key={sp.entityId}
                label={sp.name}
                value={sp.value}
                min={sp.min} max={sp.max}
                step={sp.unit === 'gpm' ? 5 : 50}
                unit={sp.unit}
                color={WATER}
                onChange={(v) => onSetSpeed(sp.entityId, v)} />
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
// HERO — HIGH-FIDELITY POOL WATER SURFACE (the centerpiece)
// =============================================================================
//
// SOPHISTICATED, not schematic. This is a refined "looking down into a calm,
// deep, lit pool" treatment built entirely from layered CSS gradient meshes +
// blurred radial light — photographic in feel, retina-sharp at any DPI (no
// low-res SVG diagram). Motion is minimal: one very slow caustic drift, a slow
// specular travel, and a barely-perceptible depth breathe. Everything else is
// still.
//
// The AKVO floor is expressed as an ELEGANT depth indicator (a thin luminous
// rule that sits at the floor's real depth within a slim gauge), NOT a cartoon
// platform diagram. Crisp glass HUD chips carry the live readouts.
//
// SAFETY: display-only. Renders AKVO state; issues no commands.

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

// Map a signed depth (m, negative = above deck) to a 0..1 fraction down a slim
// vertical depth gauge. Range −1m … +4m.
function depthFraction(m: number | null): number {
  if (m == null) return 0.5;
  const min = -1, max = 4;
  return Math.max(0, Math.min(1, (m - min) / (max - min)));
}

// A small directional chevron used as the floor-motion indicator.
const ChevronMark: React.FC<{ dir: 'up' | 'down'; color: string; style?: React.CSSProperties }> = ({ dir, color, style }) => (
  <svg width="11" height="6" viewBox="0 0 11 6" style={{ display: 'block', ...style }} aria-hidden="true">
    <path
      d={dir === 'up' ? 'M1 5 L5.5 1 L10 5' : 'M1 1 L5.5 5 L10 1'}
      fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

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
  const { plate: plateColor } = akvoFloorColor(akvoState);

  const floorFrac = depthFraction(akvoState.mainFloorPosition);
  // Direction the floor is travelling (for moving chevrons): a rising floor
  // (toward deck, value decreasing / negative) shows up-chevrons, else down.
  const movingDir: 'up' | 'down' = (akvoState.mainFloorPosition ?? 0) < 0 ? 'up' : 'down';

  // Heating signal: which body (if any) is actively calling for heat, and where
  // it sits in the hero (pool → left half, spa → right half). Drives the warm
  // heating gradient so it reads at a glance which body is heating.
  const poolHeating = !!poolBody?.heaterIsOn;
  const spaHeating  = !!spaBody?.heaterIsOn;

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden"
      style={{
        // Shorter, tighter hero so the deck fits one iPad-landscape screen.
        height: 'clamp(11rem, 26cqw, 17rem)',
        borderTopLeftRadius: 'var(--radius-surface)',
        borderTopRightRadius: 'var(--radius-surface)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* ── Layer 1: deep calm water — base depth gradient (navy → teal → abyss) */}
      <div className="absolute inset-0" style={{
        background: anyHeating
          ? `linear-gradient(176deg,
              rgb(20 78 104) 0%, rgb(13 74 104) 22%,
              rgb(9 58 92) 52%, rgb(6 40 68) 80%, rgb(4 26 47) 100%)`
          : `linear-gradient(176deg,
              rgb(16 86 122) 0%, rgb(11 74 112) 22%,
              rgb(8 58 96) 52%, rgb(5 40 70) 80%, rgb(3 26 48) 100%)`,
        transition: 'background 1.2s ease',
      }} />

      {/* ── Layer 2: refraction mesh — soft overlapping radial lights give the
          water real depth + body without any cartoon ripple. Very slow drift. */}
      <div className="absolute pointer-events-none" style={{
        inset: '-8%',
        background: `
          radial-gradient(38% 44% at 22% 18%, rgba(120,200,238,0.30), transparent 70%),
          radial-gradient(46% 52% at 78% 30%, rgba(86,176,224,0.24), transparent 72%),
          radial-gradient(60% 60% at 55% 88%, rgba(6,30,54,0.55), transparent 70%),
          radial-gradient(30% 36% at 88% 72%, rgba(150,222,255,0.16), transparent 70%)
        `,
        filter: 'blur(2px)',
        animation: reduced ? 'none' : 'pool-comp-caustic-drift 22s ease-in-out infinite',
      }} />

      {/* ── Layer 3: fine caustic web — a crisp, high-frequency light lattice at
          low opacity reads as real sunlit-water caustics (not toy rings). */}
      <div className="absolute inset-0 pointer-events-none" style={{
        opacity: reduced ? 0.12 : 0.18,
        mixBlendMode: 'screen',
        backgroundImage: `
          repeating-linear-gradient(58deg,  rgba(170,225,255,0.10) 0 1px, transparent 1px 26px),
          repeating-linear-gradient(-46deg, rgba(170,225,255,0.08) 0 1px, transparent 1px 34px)`,
        maskImage: 'radial-gradient(120% 90% at 50% 0%, #000 35%, transparent 85%)',
        WebkitMaskImage: 'radial-gradient(120% 90% at 50% 0%, #000 35%, transparent 85%)',
        animation: reduced ? 'none' : 'pool-comp-depth-pulse 12s ease-in-out infinite',
      }} />

      {/* ── Layer 4: surface specular — a single slow, wide, soft highlight band
          travels gently across the top third (premium, restrained). */}
      {!reduced && (
        <div className="absolute pointer-events-none" style={{
          top: 0, left: 0, right: 0, height: '52%',
          background: 'linear-gradient(100deg, transparent 30%, rgba(190,232,255,0.16) 50%, transparent 70%)',
          animation: 'pool-comp-specular-travel 16s ease-in-out infinite',
        }} />
      )}

      {/* ── Layer 5: top sheen + bottom vignette for crisp, contained depth. */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          linear-gradient(180deg, rgba(220,244,255,0.10) 0%, transparent 14%),
          radial-gradient(140% 100% at 50% 120%, rgba(2,16,32,0.66), transparent 60%)`,
      }} />

      {/* ── Layer 5b: HEATING gradient — a warm amber/orange glow rising from the
          bottom of the heating body's side of the pool. Reads "this body is
          calling for heat" at a glance. Pool=left half, spa=right half; both
          → full-width warm bloom. Breathes slowly when not reduced-motion. */}
      {(poolHeating || spaHeating) && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{
          background: poolHeating && spaHeating
            ? `radial-gradient(120% 90% at 50% 118%, rgba(255,150,60,0.40), rgba(255,120,40,0.16) 38%, transparent 66%)`
            : poolHeating
            ? `radial-gradient(95% 95% at 24% 120%, rgba(255,150,60,0.44), rgba(255,120,40,0.16) 40%, transparent 64%)`
            : `radial-gradient(95% 95% at 76% 120%, rgba(255,150,60,0.44), rgba(255,120,40,0.16) 40%, transparent 64%)`,
          mixBlendMode: 'screen',
          animation: reduced ? 'none' : 'pool-comp-heat-rise 4.5s ease-in-out infinite',
        }} />
      )}

      {/* ── Layer 6: AKVO depth indicator — elegant, NOT a diagram ───────────
          A slim vertical depth gauge pinned to the right; a thin luminous rule
          marks the movable-floor's real depth. Display-only. */}
      {showFloor && (
        <div className="absolute pointer-events-none" style={{
          top: 'clamp(2.5rem, 7cqw, 3.5rem)', bottom: 'clamp(2.5rem, 7cqw, 3.5rem)',
          right: 'clamp(0.75rem, 3cqw, 1.5rem)', width: 3,
          borderRadius: 999,
          background: 'linear-gradient(180deg, rgba(190,232,255,0.30), rgba(190,232,255,0.06))',
        }}>
          {/* depth tick marks (0..4 m) */}
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((f, i) => (
            <div key={i} className="absolute" style={{
              top: `${f * 100}%`, right: 6, width: 5, height: 1,
              background: 'rgba(190,232,255,0.35)',
            }} />
          ))}
          {/* floor marker — luminous rule at real depth, color reflects state.
              When MOVING it travels smoothly toward target, glows brighter, and
              shows directional chevrons; when stopped it settles at real depth. */}
          <div className="absolute" style={{
            top: `${floorFrac * 100}%`, left: -7, right: -12,
            color: plateColor,
            transform: 'translateY(-50%)',
            transition: isMoving ? 'top 0.6s linear' : 'top 1.1s cubic-bezier(0.34,1.18,0.64,1)',
          }}>
            {/* up chevrons (shown when rising) */}
            {isMoving && movingDir === 'up' && !reduced && (
              <div className="absolute" style={{ left: 0, right: 0, bottom: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, marginBottom: 2 }}>
                {[0, 1].map(k => (
                  <ChevronMark key={k} dir="up" color={plateColor}
                    style={{ animation: `pool-comp-chev-up 1s ease-in-out infinite`, animationDelay: `${k * 0.22}s` }} />
                ))}
              </div>
            )}
            {/* the rule itself */}
            <div style={{
              height: 2, borderRadius: 999, background: plateColor,
              boxShadow: `0 0 8px 1px ${plateColor}`,
              animation: isFault && !reduced
                ? 'pool-comp-akvo-alert 1.1s ease-in-out infinite'
                : (isMoving && !reduced ? 'pool-comp-floor-move 1.2s ease-in-out infinite' : 'none'),
            }} />
            {/* down chevrons (shown when lowering) */}
            {isMoving && movingDir === 'down' && !reduced && (
              <div className="absolute" style={{ left: 0, right: 0, top: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, marginTop: 2 }}>
                {[0, 1].map(k => (
                  <ChevronMark key={k} dir="down" color={plateColor}
                    style={{ animation: `pool-comp-chev-down 1s ease-in-out infinite`, animationDelay: `${k * 0.22}s` }} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HUD overlay: title + readout chips (crisp glass over the scene) ─── */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none"
        style={{ padding: 'clamp(0.55rem, 2.4cqw, 1rem)' }}>

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

          {/* AKVO config + floor depth (bottom-right; sits left of the depth gauge) */}
          {showFloor && (
            <div className="pointer-events-auto flex items-stretch" style={{
              gap: 1, marginRight: 'clamp(1.25rem, 4cqw, 2rem)',
              borderRadius: 'var(--radius-control)', overflow: 'hidden',
              backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: `color-mix(in srgb, ${akvoInfo.color} 13%, var(--glass-l3-bg))`,
              backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
              border: `1px solid color-mix(in srgb, ${akvoInfo.color} 36%, var(--glass-l3-border))`,
              boxShadow: `var(--rim), 0 0 14px -4px color-mix(in srgb, ${akvoInfo.color} 30%, transparent)`,
            }}>
              <div className="flex flex-col items-start justify-center" style={{ padding: 'clamp(0.25rem, 1cqw, 0.45rem) clamp(0.45rem, 1.8cqw, 0.7rem)' }}>
                <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
                  Floor
                </span>
                <span style={{ fontSize: 'clamp(0.72rem, 1.5cqw, 0.95rem)', fontWeight: 700, color: 'rgb(245 250 255)', lineHeight: 1.15 }}>
                  {akvoState.activeConfiguration ?? '—'}
                </span>
              </div>
              {akvoState.mainFloorPosition != null && (
                <div className="flex flex-col items-end justify-center"
                  style={{ padding: 'clamp(0.25rem, 1cqw, 0.45rem) clamp(0.45rem, 1.8cqw, 0.7rem)', borderLeft: `1px solid color-mix(in srgb, ${akvoInfo.color} 24%, transparent)` }}>
                  <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
                    Depth
                  </span>
                  <span style={{ fontSize: 'clamp(0.72rem, 1.5cqw, 0.95rem)', fontWeight: 700, color: akvoInfo.color, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' as const }}>
                    {akvoState.mainFloorPosition.toFixed(2)}m
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Small HUD tag (status word) — a refined glass pill, not bare text.
const HeroTag: React.FC<{ label: string; color: string; pulse?: boolean }> = ({ label, color, pulse }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '2px 8px', borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--type-2xs)', fontWeight: 700, color,
    letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const,
    backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
    backgroundColor: `color-mix(in srgb, ${color} 14%, var(--glass-l3-bg))`,
    border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
    boxShadow: 'var(--rim)',
    animation: pulse ? 'pool-comp-akvo-alert 1.4s ease-in-out infinite' : 'none',
  }}>
    <span style={{ width: 5, height: 5, borderRadius: 999, background: color, boxShadow: `0 0 5px ${color}` }} />
    {label}
  </span>
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
  const heating = body.heaterIsOn;
  return (
    <div className="relative overflow-hidden" style={{
      borderRadius: 'var(--radius-card)',
      padding: 'clamp(0.3rem, 1.2cqw, 0.5rem) clamp(0.45rem, 1.8cqw, 0.75rem)',
      backdropFilter: 'var(--glass-l2-backdrop)', WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
      backgroundColor: heating
        ? `color-mix(in srgb, ${WARN} 18%, var(--glass-l2-bg))`
        : body.isOn ? `color-mix(in srgb, ${accent} 16%, var(--glass-l2-bg))` : 'var(--glass-l2-bg)',
      backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
      border: `1px solid ${heating
        ? `color-mix(in srgb, ${WARN} 50%, var(--glass-l2-border))`
        : body.isOn ? `color-mix(in srgb, ${accent} 44%, var(--glass-l2-border))` : 'var(--glass-l2-border)'}`,
      boxShadow: heating
        ? `var(--rim), 0 0 18px -4px color-mix(in srgb, ${WARN} 45%, transparent)`
        : body.isOn ? `var(--rim), 0 0 16px -5px color-mix(in srgb, ${accent} 34%, transparent)` : 'var(--rim), var(--elev-1)',
      transition: `all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
    }}>
      {/* warm heating bloom rising from the bottom of the card */}
      {heating && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{
          background: 'radial-gradient(90% 80% at 50% 118%, rgba(255,150,60,0.42), rgba(255,120,40,0.12) 45%, transparent 70%)',
          mixBlendMode: 'screen',
          animation: reduced ? 'none' : 'pool-comp-heat-rise 4s ease-in-out infinite',
        }} />
      )}
      <div className="relative flex items-center" style={{ gap: 'clamp(0.4rem, 1.5cqw, 0.7rem)' }}>
        <div className="flex flex-col">
          <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
            {body.name}
          </span>
          <div className="flex items-baseline" style={{ gap: 2 }}>
            <span style={{ fontSize: 'clamp(1.2rem, 3cqw, 2rem)', fontWeight: 800, lineHeight: 1, color: 'rgb(245 250 255)', fontVariantNumeric: 'tabular-nums' as const, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
              {body.waterTempC !== null ? Math.round(body.waterTempC) : '--'}
            </span>
            <span style={{ fontSize: 'clamp(0.65rem, 1.1cqw, 0.9rem)', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>°{tempUnit}</span>
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

            {/* Lights — swatch cards (live color + brightness) */}
            {area.lights.length > 0 && (
              <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
                {area.lights.map(light => {
                  const optBrightness = getOptimistic(light.entityId);
                  const displayBrightness = optBrightness ?? light.brightness;
                  return (
                    <LightSwatchCard key={light.entityId}
                      name={light.name}
                      isOn={light.isOn}
                      rgb={light.isOn ? lutronLightRgb(light) : null}
                      brightness={displayBrightness}
                      onToggle={() => handleToggleLight(light)}
                    />
                  );
                })}
              </div>
            )}

            {/* Covers / shades — window glyph at real position */}
            {hasCovers && (
              <div className="flex flex-col mt-2" style={{ gap: 'var(--space-1)' }}>
                {area.covers.map(cover => (
                  <ShadeGlyphCard key={cover.entityId}
                    name={cover.name}
                    position={cover.currentPosition}
                    onOpen={() => handleCover(cover, 'open')}
                    onStop={() => handleCover(cover, 'stop')}
                    onClose={() => handleCover(cover, 'close')}
                  />
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
// QUICK-ACTIONS / ROUTINES BAR
// =============================================================================
//
// A prominent one-tap routines band between the hero and the control deck.
// Each action is wired to REAL HA service calls via the live surfaces.
//
// SAFETY: a `floor` action commands AKVO motion, so it is rendered as a GUARDED
// press-and-hold (AkvoHoldButton) gated by the live AKVO gate (ready / no
// fault / requests-enabled) — never a bare tap. It calls the same
// requestConfiguration() path as the console (which re-evaluates the gate
// server-side too). All other actions are low-hazard one-tap.

interface QuickActionsBarProps {
  actions: QuickAction[];
  surface: ReturnType<typeof usePoolSurface>['surface'];
  lutronAreaFilter: string[];
  toggleBody: (entityId: string, on: boolean) => void;
  toggleLight: (entityId: string, on: boolean) => void;
  toggleWaterFeature: (entityId: string, on: boolean) => void;
  setWaterHeaterMode: (heaterId: string, mode: string) => void;
  setWaterHeaterTemp: (heaterId: string, temp: number) => void;
}

const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
  actions, surface, lutronAreaFilter,
  toggleBody, toggleLight, toggleWaterFeature, setWaterHeaterMode, setWaterHeaterTemp,
}) => {
  // Self-contained live feeds (same pattern as the section components).
  const { state: lutronState } = useLutronSurface();
  const { state: akvoState, gate, requestingPreset, requestConfiguration } = useAkvoFloor();

  // Resolve a body by name fragment (pool/spa), falling back to the first body.
  const findBody = useCallback((match?: string): BodyState | undefined => {
    if (!match) return surface.bodies[0];
    const m = match.toLowerCase();
    return surface.bodies.find(b => b.name.toLowerCase().includes(m)) ?? undefined;
  }, [surface.bodies]);

  // The pool-area Lutron lights (area-filtered), for the lights routine.
  const areaLights = useMemo(() => {
    if (!lutronState.present) return [] as LutronLightState[];
    return lutronState.areas
      .filter(area => lutronAreaFilter.length === 0 || lutronAreaFilter.some(s => area.name.toLowerCase().includes(s.toLowerCase())))
      .flatMap(area => area.lights);
  }, [lutronState, lutronAreaFilter]);

  // One-tap dispatch for low-hazard actions. Returns false if not actionable.
  const runOneTap = useCallback((a: QuickAction): boolean => {
    switch (a.kind) {
      case 'heat': {
        const b = findBody(a.body);
        if (!b?.heaterId) return false;
        if (a.turnOn !== false) setWaterHeaterMode(b.heaterId, 'on');
        setWaterHeaterTemp(b.heaterId, a.temp);
        return true;
      }
      case 'heatOff': {
        const b = findBody(a.body);
        if (!b?.heaterId) return false;
        setWaterHeaterMode(b.heaterId, 'off');
        return true;
      }
      case 'body': {
        const b = findBody(a.body);
        if (!b) return false;
        toggleBody(b.entityId, a.on);
        return true;
      }
      case 'feature': {
        const m = a.match.toLowerCase();
        const feats = surface.waterFeatures.filter(f => f.name.toLowerCase().includes(m));
        if (feats.length === 0) return false;
        feats.forEach(f => toggleWaterFeature(f.entityId, a.on));
        return true;
      }
      case 'lights': {
        // IntelliCenter pool lights + area-filtered Lutron lights together.
        let acted = false;
        surface.lights.forEach(l => { toggleLight(l.entityId, a.on); acted = true; });
        areaLights.forEach(l => { void lutronToggleLight(l.entityId, a.on); acted = true; });
        return acted;
      }
      default:
        return false;
    }
  }, [findBody, surface.waterFeatures, surface.lights, areaLights, toggleBody, toggleLight, toggleWaterFeature, setWaterHeaterMode, setWaterHeaterTemp]);

  if (!actions || actions.length === 0) return null;

  // Does a floor preset exist as a real AKVO option? (only enable if so)
  const floorOptions = akvoState.requestSelect?.options ?? [];

  return (
    <div
      className="relative z-10 flex-shrink-0 flex items-center"
      style={{
        gap: 'clamp(0.35rem, 1.2cqw, 0.6rem)',
        padding: 'clamp(0.4rem, 1.4cqw, 0.7rem) clamp(0.45rem, 1.6cqw, 0.8rem)',
        overflowX: 'auto',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'var(--glass-l2-backdrop)', WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: 'color-mix(in srgb, var(--accent-water) 6%, var(--glass-l2-bg))',
        backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
        scrollbarWidth: 'none',
      }}
    >
      <span className="flex-shrink-0" style={{
        fontSize: 'var(--type-2xs)', fontWeight: 700, letterSpacing: 'var(--tracking-caps)',
        textTransform: 'uppercase' as const, color: 'rgba(var(--text) / 0.45)',
        marginRight: 'clamp(0.15rem, 0.6cqw, 0.35rem)',
      }}>
        Routines
      </span>

      {actions.map((a, i) => {
        if (a.kind === 'floor') {
          // GUARDED floor-motion routine: press-and-hold, gated by AKVO state.
          const presetExists = floorOptions.includes(a.preset);
          const isActiveCfg = akvoState.activeConfiguration === a.preset;
          const isReq = requestingPreset === a.preset;
          const disabled = !gate.enabled || !presetExists || isActiveCfg;
          return (
            <div key={i} className="flex-shrink-0" style={{ minWidth: 'clamp(7rem, 16cqw, 9rem)' }}>
              <QuickHoldChip
                label={a.label ?? `Floor → ${a.preset}`}
                disabled={disabled}
                requesting={isReq}
                reason={isActiveCfg ? 'current' : !presetExists ? 'unavailable' : !gate.enabled ? gate.reason : ''}
                onComplete={() => { void requestConfiguration(a.preset); }}
              />
            </div>
          );
        }

        // One-tap low-hazard routine.
        const { label, icon, accent } = describeAction(a);
        return (
          <QuickTapChip key={i} label={label} icon={icon} accent={accent}
            onClick={() => runOneTap(a)} />
        );
      })}
    </div>
  );
};

// Label/icon/accent for a one-tap action.
function describeAction(a: QuickAction): { label: string; icon: React.ReactNode; accent: string } {
  switch (a.kind) {
    case 'heat':
      return { label: a.label ?? `Heat ${a.temp}°`, icon: <IconFlame style={{ width: 13, height: 13 }} />, accent: WARN };
    case 'heatOff':
      return { label: a.label ?? 'Heat Off', icon: <IconFlame style={{ width: 13, height: 13 }} />, accent: 'rgba(var(--text) / 0.5)' };
    case 'body':
      return { label: a.label ?? `${a.body} ${a.on ? 'On' : 'Off'}`, icon: <IconWaves style={{ width: 13, height: 13 }} />, accent: WATER };
    case 'feature':
      return { label: a.label ?? a.match, icon: <IconDroplets style={{ width: 13, height: 13 }} />, accent: WATER };
    case 'lights':
      return { label: a.label ?? `Lights ${a.on ? 'On' : 'Off'}`, icon: <IconLightbulb style={{ width: 13, height: 13 }} />, accent: WARN };
    default:
      return { label: 'Action', icon: <IconActivity style={{ width: 13, height: 13 }} />, accent: WATER };
  }
}

// One-tap quick-action chip (low hazard).
const QuickTapChip: React.FC<{ label: string; icon: React.ReactNode; accent: string; onClick: () => void }> = ({
  label, icon, accent, onClick,
}) => (
  <button
    onClick={onClick}
    className="flex-shrink-0 flex items-center"
    style={{
      gap: 6, whiteSpace: 'nowrap',
      padding: 'clamp(0.32rem, 1.1cqw, 0.5rem) clamp(0.5rem, 1.8cqw, 0.85rem)',
      borderRadius: 'var(--radius-pill)', cursor: 'pointer',
      backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      backgroundColor: `color-mix(in srgb, ${accent} 16%, var(--glass-l3-bg))`,
      backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
      border: `1px solid color-mix(in srgb, ${accent} 40%, var(--glass-l3-border))`,
      boxShadow: `var(--rim), 0 0 10px -4px color-mix(in srgb, ${accent} 34%, transparent)`,
      color: accent,
      transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
    }}
    onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
    onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
  >
    {icon}
    <span style={{ fontSize: 'var(--type-xs)', fontWeight: 700 }}>{label}</span>
  </button>
);

// Guarded press-and-hold quick-action for AKVO floor MOTION. Reuses the same
// HOLD_MS + RAF + requestConfiguration safety pattern as AkvoHoldButton, in a
// compact chip form factor.
const QuickHoldChip: React.FC<{
  label: string; disabled: boolean; requesting: boolean; reason: string; onComplete: () => void;
}> = ({ label, disabled, requesting, reason, onComplete }) => {
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
      className="relative w-full flex flex-col items-center justify-center select-none touch-none overflow-hidden"
      style={{
        gap: 1, borderRadius: 'var(--radius-pill)',
        padding: 'clamp(0.28rem, 1cqw, 0.45rem) clamp(0.5rem, 1.6cqw, 0.8rem)',
        backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: !disabled ? `color-mix(in srgb, ${WARN} 16%, var(--glass-l3-bg))` : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: `1px solid ${!disabled ? `color-mix(in srgb, ${WARN} 44%, var(--glass-l3-border))` : 'var(--glass-l3-border)'}`,
        boxShadow: !disabled ? `var(--rim), 0 0 10px -4px color-mix(in srgb, ${WARN} 36%, transparent)` : 'var(--rim)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !requesting ? 0.5 : 1,
        transition: 'all var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
      }}
      title={disabled ? (reason || 'AKVO not ready') : `Hold to request ${label}`}
    >
      <div className="absolute inset-0 origin-left pointer-events-none" style={{
        transform: `scaleX(${progress})`,
        background: `color-mix(in srgb, ${WARN} 34%, transparent)`,
        transition: progress === 0 ? 'transform 120ms ease-out' : 'none',
        borderRadius: 'inherit',
      }} />
      <span className="relative z-10 flex items-center" style={{ gap: 5, whiteSpace: 'nowrap' }}>
        {requesting ? <IconLoader2 className="w-3 h-3 animate-spin" /> : <IconHand style={{ width: 12, height: 12 }} />}
        <span style={{ fontSize: 'var(--type-xs)', fontWeight: 700, color: !disabled ? WARN : 'rgba(var(--text) / 0.55)' }}>{label}</span>
      </span>
      <span className="relative z-10" style={{ fontSize: '0.5rem', fontWeight: 600, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const, color: 'rgba(var(--text) / 0.45)' }}>
        {requesting ? 'requesting…' : reason ? reason : progress > 0 ? 'keep holding…' : 'hold to set'}
      </span>
    </button>
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
  const hasPumps = config.showPool && (surface.pumps.length > 0 || surface.probeTemps.length > 0 || surface.speedSetpoints.length > 0);
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

        {/* ── Quick-actions / routines bar (one-tap; floor presets guarded) ── */}
        {config.showQuickActions && config.quickActions.length > 0 && (
          <QuickActionsBar
            actions={config.quickActions}
            surface={surface}
            lutronAreaFilter={config.lutronAreaFilter}
            toggleBody={toggleBody}
            toggleLight={poolToggleLight}
            toggleWaterFeature={toggleWaterFeature}
            setWaterHeaterMode={setWaterHeaterMode}
            setWaterHeaterTemp={setWaterHeaterTemp}
          />
        )}

        {/* ── Scrollable control deck (full-width balanced grid) ──────────── */}
        <div
          className="relative z-10 flex-1 overflow-y-auto min-h-0"
          style={{
            padding: 'clamp(0.45rem, 1.6cqw, 0.8rem)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(0.4rem, 1.4cqw, 0.7rem)',
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
                  reduced={reduced}
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
