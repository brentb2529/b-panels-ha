/**
 * ClimateCompilationTile — Flagship multi-integration Climate Area dashboard.
 *
 * Composes three HVAC integration surfaces into one immersive, cohesive view:
 *
 *   (A) Airzone per-room climate — reuses useClimateZones() and RoomClimateTile's
 *       ZoneTile sub-components. Zones grouped by master/slave topology.
 *
 *   (B) Mitsubishi AE-200E City Multi — reuses Ae200State from the device payload
 *       mapped through useDashboard. Per-group glass instrument cards with
 *       AnimatedFan / LivingModeIcon / BuildBar.
 *
 *   (C) CoolMaster VRF units — reuses CoolMasterUnitState from the device payload
 *       mapped through useDashboard. Per-unit glass instrument cards with the same
 *       design tokens.
 *
 * AESTHETIC: sophisticated, high-definition, dark-immersive with precise heating
 * (amber) / cooling (cyan) / neutral (slate) gradient cues. NOT a copy of the
 * Pool compilation's water theme — the climate panel uses a deep charcoal/slate
 * atmosphere with directional thermal air-flow mesh backgrounds. Glass material
 * language identical to AirControlSurface / CoolMasterTile / Ae200Tile.
 *
 * HERO: a whole-home climate overview — outdoor temp (from AE-200E sensors or
 * Airzone), zone count by mode (heating / cooling / idle), tinted summary bar,
 * subtle air-flow animated gradient (slow, barely perceptible, not gimmicky).
 *
 * QUICK-ACTIONS BAR: one-tap routines across all three integrations:
 *   "All → 72°"  — setTargetTemperature on every discovered climate entity
 *   "Comfort"    — set 74° cooling / 70° heating target across all
 *   "Eco / Setback" — set 78° cooling / 66° heating across all
 *   "All Off"    — hvac_mode=off across all three integrations
 * Each action fans out multi-call across Airzone (setTargetTemperature /
 * setHvacMode from climate.ts service), Ae200 (updateDeviceState payload),
 * and CoolMaster (callService direct). Low-hazard (no equipment, no safety gate).
 *
 * LAYOUT:
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │  HERO — outdoor temp, zone mode summary, tinted air-flow backdrop        │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │  QUICK-ACTIONS BAR                                                       │
 *   ├──────────────────┬───────────────────────────┬──────────────────────────┤
 *   │  AIRZONE         │   AE-200E                  │   COOLMASTER             │
 *   │  per-room zones  │   per-group cards          │   per-unit cards         │
 *   │  (cluster groups)│   (controller sections)    │   (line groups)          │
 *   └──────────────────┴───────────────────────────┴──────────────────────────┘
 *
 * RESPONSIVE: container-query driven. Narrow → single column stacked.
 *
 * LIGHT-MODE FIX: pinned dark glass context inside .climate-comp-root, matching
 * the Pool compilation light-mode fix pattern exactly.
 *
 * CONFIGURABLE: via device.state JSON (ClimateAreaConfig). All source sections
 * are individually gated; zone/area filters per source.
 *
 * SAFETY: no AKVO, no equipment-gated actuation. Climate HVAC is low-hazard;
 * all writes go through the standard climate service calls.
 */

import React, {
  useState, useCallback, useMemo, useEffect, useRef,
} from 'react';
import type { TileProps } from '../tileRegistry';

// ── Airzone / Air Control hooks + services ─────────────────────────────────
import { useClimateZones } from '../../hooks/useClimateZones';
import {
  resolveModeTarget,
  zoneRole,
  setTargetTemperature as svcAirzoneSetTemp,
  setHvacMode as svcAirzoneSetMode,
  type ClimateZone,
  type ClimateGroup,
} from '../../services/climate';

// ── Ae200 types ────────────────────────────────────────────────────────────
import type { Ae200State, Ae200Group, Ae200Controller, Ae200HvacMode, Ae200FanMode } from '../../types';
import { DeviceType } from '../../types';

// ── CoolMaster types ───────────────────────────────────────────────────────
import type { CoolMasterUnitState } from '../../hooks/useCoolMasterSurface';

// ── HA client (for CoolMaster direct service calls) ────────────────────────
import * as haClient from '../../services/haClient';

// ── useDashboard (for updateDeviceState — AE-200 writes) ──────────────────
import { useDashboard, useDashboardActions } from '../../hooks/useDashboard';

// ── Design system ──────────────────────────────────────────────────────────
import {
  AnimatedFan, BuildBar, LivingModeIcon,
  glassMaterial, glassMaterialActive,
  useReducedMotion,
} from '../../design-system';

// ── Tile scale helpers ─────────────────────────────────────────────────────
import { fluidTextXs, fluidTextSm, fluidTextLg } from './tileScale';

// ── Icons ──────────────────────────────────────────────────────────────────
import {
  IconThermometer, IconFlame, IconSnowflake, IconWind,
  IconFan, IconDroplets, IconActivity, IconPower,
  IconAlertTriangle, IconWifiOff, IconLoader2,
  IconSun, IconChevronDown, IconMinus, IconPlus,
  IconX,
} from '../icons';

// ── RoomClimateTile (Airzone zone card — imported for ZoneTile reuse) ──────
import RoomClimateTile from './RoomClimateTile';

// =============================================================================
// Accent constants (CSS token shorthand)
// =============================================================================

const HEAT   = 'var(--accent-warn)';
const COOL   = 'var(--accent-water)';
const AUTO   = 'var(--accent-plug)';
const DRY    = 'var(--accent-light)';
const ALERT  = 'var(--accent-alert)';
const NEUTRAL = 'rgba(var(--text) / 0.35)';

// =============================================================================
// ClimateAreaConfig — device.state JSON shape
// =============================================================================

export interface ClimateAreaConfig {
  /** Show Airzone per-room section (default: true) */
  showAirzone?: boolean;
  /** Show AE-200E City Multi section (default: true) */
  showAe200?: boolean;
  /** Show CoolMaster VRF section (default: true) */
  showCoolMaster?: boolean;
  /**
   * Airzone zone name filter — partial match, case-insensitive.
   * Default: [] (show all)
   */
  airzoneFilter?: string[];
  /**
   * AE-200E controller id filter (partial match on controllerId).
   * Default: [] (show all)
   */
  ae200Filter?: string[];
  /**
   * CoolMaster line filter — e.g. ['L1', 'L2'].
   * Default: [] (show all)
   */
  coolMasterFilter?: string[];
  /** Panel area display name. Default: 'Climate' */
  areaName?: string;
  /** Show the quick-actions bar. Default: true */
  showQuickActions?: boolean;
  /**
   * Custom quick-action list. Each is a ClimateQuickAction.
   * Omit for the built-in default set.
   */
  quickActions?: ClimateQuickAction[];
}

export type ClimateQuickAction =
  | { kind: 'setTemp'; label?: string; temp: number; unit?: '°F' | '°C' }
  | { kind: 'allOff'; label?: string }
  | { kind: 'preset'; label?: string; coolTemp: number; heatTemp: number }
  | { kind: 'mode'; label?: string; hvacMode: string };

const DEFAULT_QUICK_ACTIONS: ClimateQuickAction[] = [
  { kind: 'setTemp',  temp: 72,   label: 'All → 72°' },
  { kind: 'preset',   coolTemp: 74, heatTemp: 70, label: 'Comfort' },
  { kind: 'preset',   coolTemp: 78, heatTemp: 66, label: 'Eco / Setback' },
  { kind: 'allOff',   label: 'All Off' },
];

const DEFAULTS: Required<ClimateAreaConfig> = {
  showAirzone:      true,
  showAe200:        true,
  showCoolMaster:   true,
  airzoneFilter:    [],
  ae200Filter:      [],
  coolMasterFilter: [],
  areaName:         'Climate',
  showQuickActions: true,
  quickActions:     DEFAULT_QUICK_ACTIONS,
};

function parseConfig(raw: unknown): Required<ClimateAreaConfig> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      showAirzone:      typeof r.showAirzone === 'boolean'      ? r.showAirzone      : DEFAULTS.showAirzone,
      showAe200:        typeof r.showAe200 === 'boolean'        ? r.showAe200        : DEFAULTS.showAe200,
      showCoolMaster:   typeof r.showCoolMaster === 'boolean'   ? r.showCoolMaster   : DEFAULTS.showCoolMaster,
      airzoneFilter:    Array.isArray(r.airzoneFilter)    ? (r.airzoneFilter as string[]).map(String)    : DEFAULTS.airzoneFilter,
      ae200Filter:      Array.isArray(r.ae200Filter)      ? (r.ae200Filter as string[]).map(String)      : DEFAULTS.ae200Filter,
      coolMasterFilter: Array.isArray(r.coolMasterFilter) ? (r.coolMasterFilter as string[]).map(String) : DEFAULTS.coolMasterFilter,
      areaName:         typeof r.areaName === 'string'          ? r.areaName          : DEFAULTS.areaName,
      showQuickActions: typeof r.showQuickActions === 'boolean' ? r.showQuickActions  : DEFAULTS.showQuickActions,
      quickActions:     Array.isArray(r.quickActions)
        ? (r.quickActions as ClimateQuickAction[])
        : DEFAULTS.quickActions,
    };
  }
  return { ...DEFAULTS };
}

// =============================================================================
// CSS keyframes (injected once)
// =============================================================================

let _animsInjected = false;
function ensureAnims() {
  if (_animsInjected || typeof document === 'undefined') return;
  _animsInjected = true;
  const s = document.createElement('style');
  s.textContent = `
/* ── Climate Compilation Tile keyframes ──────────────────────────────────────
   SOPHISTICATED / RESTRAINED: slow, purposeful air-flow motion only.
   No spinning rings, no particle effects, no toy animations. */

/* Very slow thermal air-flow gradient drift. */
@keyframes climate-comp-airflow-drift {
  0%   { transform: translate3d(0, 0, 0)        scale(1);     }
  40%  { transform: translate3d(-1.5%, 1%, 0)   scale(1.025); }
  100% { transform: translate3d(0, 0, 0)        scale(1);     }
}
/* Gentle luminance breathing — barely perceptible. */
@keyframes climate-comp-thermal-breathe {
  0%,100% { opacity: 0.52; }
  50%     { opacity: 0.74; }
}
/* Slow specular band travel across the hero. */
@keyframes climate-comp-specular-travel {
  0%   { transform: translateX(-14%); opacity: 0.0; }
  30%  { opacity: 0.48; }
  70%  { opacity: 0.48; }
  100% { transform: translateX(14%);  opacity: 0.0; }
}
/* Section entrance stagger. */
@keyframes climate-comp-section-in {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0);   }
}
/* Status dot pulse (live indicator). */
@keyframes climate-comp-live-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.5); }
  50%     { box-shadow: 0 0 0 5px rgba(52,211,153,0); }
}
/* Fault/stale badge breathe. */
@keyframes climate-comp-badge-breathe {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.5; }
}

/* ── Climate compilation grid ────────────────────────────────────────────────
   3-column full-width deck (iPad landscape). Sections stretch to fill row. */
.climate-comp-deck {
  display: grid;
  grid-template-columns: 1fr;
  gap: clamp(0.4rem, 1.4cqw, 0.7rem);
  align-items: stretch;
  width: 100%;
}
@container (min-width: 38rem) {
  .climate-comp-deck { grid-template-columns: 1fr 1fr; }
  .climate-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
}
@container (min-width: 60rem) {
  .climate-comp-deck { grid-template-columns: 1fr 1fr 1fr; }
  .climate-comp-deck[data-cols="1"] { grid-template-columns: 1fr; }
  .climate-comp-deck[data-cols="2"] { grid-template-columns: 1fr 1fr; }
}

/* ── LIGHT-MODE PIN ───────────────────────────────────────────────────────────
   The climate compilation uses a dark charcoal base in ALL themes.
   Pin the dark glass context so text and glass tokens stay legible in light mode. */
body.light-mode .climate-comp-root {
  --text: 228 238 250;
  --glass-l1-bg: rgba(20, 24, 36, 0.62);
  --glass-l1-border: rgba(255, 255, 255, 0.13);
  --glass-l1-tint: rgba(255, 255, 255, 0.045);
  --glass-l1-brightness: 1.07;
  --glass-l1-backdrop: blur(var(--glass-l1-blur)) saturate(var(--glass-l1-saturate)) brightness(1.07);
  --glass-l2-bg: rgba(28, 33, 48, 0.52);
  --glass-l2-border: rgba(255, 255, 255, 0.16);
  --glass-l2-tint: rgba(255, 255, 255, 0.06);
  --glass-l2-brightness: 1.09;
  --glass-l2-backdrop: blur(var(--glass-l2-blur)) saturate(var(--glass-l2-saturate)) brightness(1.09);
  --glass-l3-bg: rgba(38, 44, 62, 0.50);
  --glass-l3-border: rgba(255, 255, 255, 0.15);
  --glass-l3-tint: rgba(255, 255, 255, 0.055);
  --glass-l3-brightness: 1.11;
  --glass-l3-backdrop: blur(var(--glass-l3-blur)) saturate(var(--glass-l3-saturate)) brightness(1.11);
  --glass-l4-bg: rgba(14, 17, 28, 0.46);
  --glass-l4-border: rgba(255, 255, 255, 0.09);
  --glass-l4-tint: rgba(255, 255, 255, 0.030);
  --glass-l4-backdrop: blur(var(--glass-l4-blur)) saturate(var(--glass-l4-saturate)) brightness(1.04);
  --rim: inset 0 1px 0 0 rgba(255,255,255,0.09), inset 0 -1px 0 0 rgba(0,0,0,0.22);
}
`;
  document.head.appendChild(s);
}

// =============================================================================
// Helpers
// =============================================================================

function modeAccent(mode: string): string {
  switch (mode) {
    case 'heat':                return HEAT;
    case 'cool':                return COOL;
    case 'heat_cool': case 'auto': return AUTO;
    case 'dry':                 return DRY;
    default:                    return NEUTRAL;
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'heat_cool': return 'Auto';
    case 'fan_only':  return 'Fan';
    default: return mode.charAt(0).toUpperCase() + mode.slice(1);
  }
}

function ModeIcon({ mode, style }: { mode: string; style?: React.CSSProperties }) {
  switch (mode) {
    case 'heat':     return <IconFlame     style={style} />;
    case 'cool':     return <IconSnowflake style={style} />;
    case 'dry':      return <IconDroplets  style={style} />;
    case 'fan_only': return <IconFan       style={style} />;
    case 'heat_cool':
    case 'auto':     return <IconActivity  style={style} />;
    default:         return <IconPower     style={style} />;
  }
}

// Normalize fan_mode → 0..1 AnimatedFan rpmLevel
function fanLevel(fanMode: string | null, fanModes: string[]): number {
  if (!fanMode) return 0.55;
  const m = fanMode.toLowerCase();
  if (['vlow', 'low', 'min', 'quiet', 'silent'].some(k => m.includes(k))) return 0.20;
  if (['mid', 'medium'].some(k => m.includes(k)) || m === 'auto') return 0.55;
  if (['high', 'max', 'top', 'turbo', 'strong'].some(k => m.includes(k))) return 0.95;
  const idx = fanModes.indexOf(fanMode);
  if (idx >= 0 && fanModes.length > 1) return 0.25 + (idx / (fanModes.length - 1)) * 0.75;
  return 0.55;
}

// Ae200 fan level map
const AE200_FAN_RPM: Record<Ae200FanMode, number> = {
  AUTO: 0.55, LOW: 0.20, MID2: 0.40, MID1: 0.65, HIGH: 0.90,
};

// =============================================================================
// SHARED MICRO-COMPONENTS
// =============================================================================

const SectionLabel: React.FC<{
  children: React.ReactNode;
  icon?: React.ReactNode;
  accent?: string;
}> = ({ children, icon, accent = COOL }) => (
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
        ? `color-mix(in srgb, ${accent} 13%, var(--glass-l2-bg))`
        : 'var(--glass-l2-bg)',
      backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
      border: `1px solid ${active && accent
        ? `color-mix(in srgb, ${accent} 36%, var(--glass-l2-border))`
        : 'var(--glass-l2-border)'}`,
      boxShadow: active && accent
        ? `var(--rim), inset 0 0 22px -6px color-mix(in srgb, ${accent} 20%, transparent), var(--elev-2)`
        : 'var(--rim), var(--elev-1)',
      padding: 'clamp(0.5rem, 1.6cqw, 0.85rem)',
      transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle), border-color var(--dur-medium, 260ms) var(--spring-gentle)`,
      animation: 'climate-comp-section-in 360ms var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
      ...style,
    }}
  >
    {children}
  </div>
);

/** Collapsible section wrapper */
const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count?: number;
}> = ({ title, icon, accent = COOL, defaultOpen = true, children, count }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <SectionCard accent={accent} active={open}>
      <button
        className="w-full flex items-center text-left"
        style={{ gap: 'var(--space-2)', marginBottom: open ? 'var(--space-3)' : 0, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
        onClick={() => setOpen(o => !o)}
      >
        {icon && (
          <span style={{ color: accent, display: 'flex', alignItems: 'center', width: 16, height: 16 }}>
            {icon}
          </span>
        )}
        <span className="flex-1 font-bold uppercase tracking-widest" style={{ fontSize: 'var(--type-xs)', color: `color-mix(in srgb, ${accent} 75%, rgb(var(--text)))` }}>
          {title}
        </span>
        {count !== undefined && (
          <span style={{
            fontSize: 'var(--type-2xs)', fontWeight: 700,
            color: `color-mix(in srgb, ${accent} 75%, rgba(var(--text) / 0.5))`,
            padding: '1px 6px', borderRadius: 'var(--radius-pill)',
            backgroundColor: `color-mix(in srgb, ${accent} 12%, var(--glass-l3-bg))`,
            border: `1px solid color-mix(in srgb, ${accent} 24%, var(--glass-l3-border))`,
          }}>
            {count}
          </span>
        )}
        <IconChevronDown style={{
          width: 14, height: 14, color: `color-mix(in srgb, ${accent} 55%, rgba(var(--text) / 0.4))`,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform var(--dur-fast, 160ms) ease',
          flexShrink: 0,
        }} />
      </button>
      {open && children}
    </SectionCard>
  );
};

/** HeroTag pill */
const HeroTag: React.FC<{ label: string; color: string; count?: number }> = ({ label, color, count }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '2px 8px', borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--type-2xs)', fontWeight: 700, color,
    letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const,
    backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
    backgroundColor: `color-mix(in srgb, ${color} 14%, var(--glass-l3-bg))`,
    border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
    boxShadow: 'var(--rim)',
  }}>
    <span style={{ width: 5, height: 5, borderRadius: 999, background: color, boxShadow: `0 0 5px ${color}`, flexShrink: 0 }} />
    {count !== undefined ? `${count} ${label}` : label}
  </span>
);

/** Setpoint stepper — glass-bead +/− buttons around a tabular-nums readout */
const SetpointStepper: React.FC<{
  value: number | null;
  unit: string;
  min: number;
  max: number;
  step: number;
  accent: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ value, unit, min, max, step, accent, disabled, onChange }) => {
  const v = value ?? 0;
  const Bead = ({ symbol, onClick }: { symbol: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22, height: 22, borderRadius: 999, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
        color: 'rgb(var(--text))', fontSize: '0.85rem', fontWeight: 300, lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
      }}
      onPointerDown={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.84)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >{symbol}</button>
  );
  return (
    <div className="flex items-center" style={{ gap: 5 }}>
      <Bead symbol="−" onClick={() => onChange(Math.max(min, v - step))} />
      <span className="font-bold tabular-nums" style={{
        fontSize: 'clamp(0.9rem, 5cqmin, 1.2rem)', color: accent,
        minWidth: 'clamp(28px, 7cqmin, 42px)', textAlign: 'center',
      }}>
        {value !== null ? Math.round(v) : '--'}
        <span style={{ fontSize: '0.62em', fontWeight: 500, color: 'rgba(var(--text) / 0.5)', marginLeft: 1 }}>{unit}</span>
      </span>
      <Bead symbol="+" onClick={() => onChange(Math.min(max, v + step))} />
    </div>
  );
};

// Mode cycle button — compact glass pill
const ModeCycleButton: React.FC<{
  mode: string;
  modes: string[];
  accent: string;
  disabled?: boolean;
  onCycle: (next: string) => void;
}> = ({ mode, modes, accent, disabled, onCycle }) => {
  const handleCycle = useCallback(() => {
    if (disabled || modes.length < 2) return;
    const idx = modes.indexOf(mode);
    const next = modes[(idx + 1) % modes.length];
    onCycle(next);
  }, [mode, modes, disabled, onCycle]);

  return (
    <button
      onClick={handleCycle}
      disabled={disabled}
      className="flex items-center"
      style={{
        gap: 4, borderRadius: 'var(--radius-pill)',
        padding: '2px 8px',
        backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: `color-mix(in srgb, ${accent} 18%, var(--glass-l3-bg))`,
        backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: `1px solid color-mix(in srgb, ${accent} 42%, var(--glass-l3-border))`,
        boxShadow: `var(--rim), 0 0 8px -2px color-mix(in srgb, ${accent} 28%, transparent)`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'all var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
      }}
      onPointerDown={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.93)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >
      <ModeIcon mode={mode} style={{ width: 11, height: 11, color: accent, flexShrink: 0 }} />
      <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: accent, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
        {modeLabel(mode)}
      </span>
    </button>
  );
};

// Fan cycle button
const FanCycleButton: React.FC<{
  fanMode: string | null;
  fanModes: string[];
  accent: string;
  disabled?: boolean;
  onCycle: (next: string) => void;
}> = ({ fanMode, fanModes, accent, disabled, onCycle }) => {
  const handleCycle = useCallback(() => {
    if (disabled || !fanMode || fanModes.length < 2) return;
    const idx = fanModes.indexOf(fanMode);
    onCycle(fanModes[(idx + 1) % fanModes.length]);
  }, [fanMode, fanModes, disabled, onCycle]);

  if (!fanMode || fanModes.length === 0) return null;
  return (
    <button
      onClick={handleCycle}
      disabled={disabled}
      className="flex items-center"
      style={{
        gap: 3, borderRadius: 'var(--radius-pill)',
        padding: '2px 6px',
        backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
      }}
      onPointerDown={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.93)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >
      <IconFan style={{ width: 10, height: 10, color: 'rgba(var(--text) / 0.6)', flexShrink: 0 }} />
      <span style={{ fontSize: '0.52rem', fontWeight: 700, color: 'rgba(var(--text) / 0.6)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
        {fanMode.toLowerCase()}
      </span>
    </button>
  );
};

// =============================================================================
// AIRZONE SECTION
// =============================================================================

interface AirzoneZoneTileProps {
  zone: ClimateZone;
  group: ClimateGroup;
  nested?: boolean;
  onSetTemperature: (id: string, t: number) => void;
  onSetHvacMode: (zone: ClimateZone, group: ClimateGroup, mode: string) => void;
  onSetFanMode: (id: string, fan: string) => void;
}

const AirzoneZoneTile: React.FC<AirzoneZoneTileProps> = ({
  zone, group, nested, onSetTemperature, onSetHvacMode, onSetFanMode,
}) => {
  const role   = zoneRole(zone);
  const target = resolveModeTarget(zone, group);
  return (
    <RoomClimateTile
      zone={zone}
      role={role}
      masterName={role === 'slave' ? target.masterName ?? group.master.name : undefined}
      modeRouted={target.routed}
      nested={nested}
      onSetTemperature={onSetTemperature}
      onCycleHvacMode={(next) => onSetHvacMode(zone, group, next)}
      onSetFanMode={onSetFanMode}
    />
  );
};

// Cluster: master card + slave cards in a level-4 recessed well
const AirzoneCluster: React.FC<{
  group: ClimateGroup;
  onSetTemperature: (id: string, t: number) => void;
  onSetHvacMode: (zone: ClimateZone, group: ClimateGroup, mode: string) => void;
  onSetFanMode: (id: string, fan: string) => void;
}> = ({ group, onSetTemperature, onSetHvacMode, onSetFanMode }) => {
  const isSingle = group.slaves.length === 0;
  if (isSingle) {
    return (
      <AirzoneZoneTile
        zone={group.master}
        group={group}
        onSetTemperature={onSetTemperature}
        onSetHvacMode={onSetHvacMode}
        onSetFanMode={onSetFanMode}
      />
    );
  }

  const masterMode = group.master.hvacMode;
  const accent = modeAccent(masterMode);

  return (
    <section style={{
      borderRadius: 'var(--radius-surface)',
      padding: 'var(--space-2)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
      backdropFilter: 'var(--glass-l4-backdrop)', WebkitBackdropFilter: 'var(--glass-l4-backdrop)',
      backgroundColor: 'var(--glass-l4-bg)',
      backgroundImage: 'var(--glass-l4-tint)',
      border: `1px solid color-mix(in srgb, ${accent} 22%, var(--glass-l4-border))`,
      boxShadow: 'var(--rim)',
    }}>
      {/* Cluster header */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)', paddingLeft: 2 }}>
        <ModeIcon mode={masterMode} style={{ width: 10, height: 10, color: accent, flexShrink: 0 }} />
        <span className="font-bold uppercase tracking-widest truncate" style={{
          fontSize: '0.5rem', color: `color-mix(in srgb, ${accent} 65%, rgba(var(--text) / 0.45))`,
        }}>
          {group.master.name} System
        </span>
        <span style={{
          fontSize: '0.5rem', fontWeight: 600, color: 'rgba(var(--text) / 0.38)',
          marginLeft: 'auto',
        }}>
          {group.slaves.length + 1} zones
        </span>
      </div>
      {/* Cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(12rem, 35cqw, 18rem), 1fr))',
        gap: 'var(--space-2)',
      }}>
        <AirzoneZoneTile zone={group.master} group={group}
          onSetTemperature={onSetTemperature} onSetHvacMode={onSetHvacMode} onSetFanMode={onSetFanMode} />
        {group.slaves.map(slave => (
          <AirzoneZoneTile key={slave.entityId} zone={slave} group={group} nested
            onSetTemperature={onSetTemperature} onSetHvacMode={onSetHvacMode} onSetFanMode={onSetFanMode} />
        ))}
      </div>
    </section>
  );
};

const AirzoneSectionContent: React.FC<{
  groups: ClimateGroup[];
  status: 'connecting' | 'live' | 'stale';
  nameFilter: string[];
  onSetTemperature: (id: string, t: number) => void;
  onSetHvacMode: (zone: ClimateZone, group: ClimateGroup, mode: string) => void;
  onSetFanMode: (id: string, fan: string) => void;
}> = ({ groups, status, nameFilter, onSetTemperature, onSetHvacMode, onSetFanMode }) => {
  const filtered = useMemo(() => {
    if (nameFilter.length === 0) return groups;
    return groups.filter(g =>
      nameFilter.some(f =>
        g.master.name.toLowerCase().includes(f.toLowerCase()) ||
        g.slaves.some(s => s.name.toLowerCase().includes(f.toLowerCase()))
      )
    );
  }, [groups, nameFilter]);

  if (status === 'connecting' && filtered.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: 'rgba(var(--text) / 0.4)', fontSize: 'var(--type-xs)' }}>
        <IconLoader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
        Connecting to climate zones…
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: 'rgba(var(--text) / 0.35)', fontSize: 'var(--type-xs)' }}>
        <IconWind style={{ width: 14, height: 14 }} />
        {status === 'stale' ? 'Airzone data stale — reconnecting' : 'No Airzone zones detected'}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
      {filtered.map(group => (
        <AirzoneCluster
          key={group.master.entityId}
          group={group}
          onSetTemperature={onSetTemperature}
          onSetHvacMode={onSetHvacMode}
          onSetFanMode={onSetFanMode}
        />
      ))}
      {status === 'stale' && (
        <div className="flex items-center gap-1.5" style={{ color: 'rgba(var(--text) / 0.45)', fontSize: 'var(--type-2xs)' }}>
          <IconWifiOff style={{ width: 11, height: 11 }} /> Airzone data may be stale
        </div>
      )}
    </div>
  );
};

// =============================================================================
// AE-200 SECTION
// =============================================================================

/** Single AE-200 group card */
const Ae200GroupCard: React.FC<{
  group: Ae200Group;
  reduced: boolean;
  onSetMode: (entityId: string, mode: Ae200HvacMode) => void;
  onSetFan: (entityId: string, fan: Ae200FanMode) => void;
  onSetTemp: (entityId: string, temp: number) => void;
}> = ({ group, reduced, onSetMode, onSetFan, onSetTemp }) => {
  const accent = modeAccent(group.mode);
  const isOn   = group.isOn;
  const rpm    = isOn ? (AE200_FAN_RPM[group.fanMode] ?? 0.55) : 0;

  const AE200_HVAC_CYCLE: Ae200HvacMode[] = ['off', 'cool', 'heat', 'dry', 'fan_only', 'auto'];
  const AE200_FAN_CYCLE:  Ae200FanMode[]  = ['AUTO', 'LOW', 'MID2', 'MID1', 'HIGH'];

  const handleCycleMode = useCallback(() => {
    const idx  = AE200_HVAC_CYCLE.indexOf(group.mode);
    const next = AE200_HVAC_CYCLE[(idx + 1) % AE200_HVAC_CYCLE.length];
    onSetMode(group.entityId, next);
  }, [group.mode, group.entityId, onSetMode]);

  const handleCycleFan = useCallback(() => {
    const idx  = AE200_FAN_CYCLE.indexOf(group.fanMode);
    const next = AE200_FAN_CYCLE[(idx + 1) % AE200_FAN_CYCLE.length];
    onSetFan(group.entityId, next);
  }, [group.fanMode, group.entityId, onSetFan]);

  return (
    <div
      style={{
        borderRadius: 'var(--radius-card)',
        padding: 'clamp(0.45rem, 4cqmin, 0.75rem)',
        containerType: 'inline-size',
        backdropFilter: 'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: isOn
          ? `color-mix(in srgb, ${accent} 14%, var(--glass-l3-bg))`
          : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: `1px solid ${isOn
          ? `color-mix(in srgb, ${accent} 38%, var(--glass-l3-border))`
          : 'var(--glass-l3-border)'}`,
        boxShadow: isOn
          ? `var(--rim), inset 0 0 20px -5px color-mix(in srgb, ${accent} 20%, transparent), 0 0 12px -4px color-mix(in srgb, ${accent} 30%, transparent)`
          : 'var(--rim), var(--elev-1)',
        transition: `all var(--dur-medium, 260ms) var(--spring-gentle)`,
      }}
    >
      {/* Top row: fan + name + mode pill */}
      <div className="flex items-center" style={{ gap: 'clamp(0.4rem, 3.5cqmin, 0.7rem)', marginBottom: 'clamp(0.3rem, 2.5cqmin, 0.5rem)' }}>
        <AnimatedFan
          active={isOn}
          rpmLevel={rpm}
          colorVar={accent}
          size={isOn ? 22 : 18}
        />
        <div className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
          <span className="truncate font-semibold" style={{ ...fluidTextSm, color: 'rgba(var(--text) / 0.9)' }}>
            {group.name}
          </span>
          <div className="flex items-center flex-wrap" style={{ gap: 4 }}>
            {group.hasError && (
              <span style={{
                fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const,
                color: ALERT, padding: '1px 5px', borderRadius: 'var(--radius-pill)',
                backgroundColor: `color-mix(in srgb, ${ALERT} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${ALERT} 34%, transparent)`,
                animation: 'climate-comp-badge-breathe 1.6s ease-in-out infinite',
              }}>
                Error
              </span>
            )}
            {group.filterDirty && (
              <span style={{
                fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const,
                color: HEAT, padding: '1px 5px', borderRadius: 'var(--radius-pill)',
                backgroundColor: `color-mix(in srgb, ${HEAT} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${HEAT} 34%, transparent)`,
              }}>
                Filter
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end flex-shrink-0" style={{ gap: 3 }}>
          <ModeCycleButton
            mode={group.mode}
            modes={AE200_HVAC_CYCLE}
            accent={accent}
            disabled={!group.isOnline}
            onCycle={(next) => onSetMode(group.entityId, next as Ae200HvacMode)}
          />
          <FanCycleButton
            fanMode={group.fanMode}
            fanModes={AE200_FAN_CYCLE}
            accent={accent}
            disabled={!group.isOnline}
            onCycle={(next) => onSetFan(group.entityId, next as Ae200FanMode)}
          />
        </div>
      </div>

      {/* Temp bars row */}
      <div className="flex items-center" style={{ gap: 'clamp(0.3rem, 2.5cqmin, 0.55rem)' }}>
        {/* Current vs setpoint build bar */}
        {group.currentTemp !== null && group.setpoint !== null && (() => {
          const minT = group.minTemp ?? 60;
          const maxT = group.maxTemp ?? 90;
          const pct = Math.max(0, Math.min(100, ((group.currentTemp - minT) / (maxT - minT)) * 100));
          return (
            <div className="flex-1 min-w-0">
              <BuildBar
                value={pct}
                min={0}
                max={100}
                colorVar={accent}
                active={isOn}
                height={5}
              />
            </div>
          );
        })()}

        {/* Setpoint stepper */}
        <SetpointStepper
          value={group.setpoint}
          unit={group.tempUnit}
          min={group.minTemp ?? 60}
          max={group.maxTemp ?? 90}
          step={1}
          accent={accent}
          disabled={!group.isOnline || !isOn}
          onChange={(v) => onSetTemp(group.entityId, v)}
        />
      </div>

      {/* Current temp chip */}
      {group.currentTemp !== null && (
        <div className="flex items-center justify-between" style={{ marginTop: 'clamp(0.2rem, 1.8cqmin, 0.35rem)' }}>
          <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.5)' }}>
            Current
          </span>
          <span className="tabular-nums font-semibold" style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.8)' }}>
            {Math.round(group.currentTemp)}{group.tempUnit}
          </span>
        </div>
      )}
    </div>
  );
};

/** AE-200 controller section — one collapsible well per controller */
const Ae200ControllerSection: React.FC<{
  controller: Ae200Controller;
  controllerFilter: string[];
  reduced: boolean;
  onSetMode: (entityId: string, mode: Ae200HvacMode) => void;
  onSetFan: (entityId: string, fan: Ae200FanMode) => void;
  onSetTemp: (entityId: string, temp: number) => void;
}> = ({ controller, controllerFilter, reduced, onSetMode, onSetFan, onSetTemp }) => {
  const accent = COOL;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
      {/* Controller header */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
        <span className="font-bold truncate" style={{ ...fluidTextSm, color: 'rgb(var(--text))' }}>
          {controller.name}
        </span>
        {controller.outdoorTemp !== null && (
          <span className="flex items-center flex-shrink-0" style={{ gap: 3, fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.55)' }}>
            <IconSun style={{ width: 11, height: 11, color: 'rgba(var(--text) / 0.4)' }} />
            {Math.round(controller.outdoorTemp)}°
          </span>
        )}
        {!controller.isOnline && (
          <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: ALERT, marginLeft: 'auto' }}>OFFLINE</span>
        )}
      </div>
      {/* Groups grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(11rem, 30cqw, 17rem), 1fr))',
        gap: 'var(--space-2)',
      }}>
        {controller.groups.map(group => (
          <Ae200GroupCard
            key={group.entityId}
            group={group}
            reduced={reduced}
            onSetMode={onSetMode}
            onSetFan={onSetFan}
            onSetTemp={onSetTemp}
          />
        ))}
      </div>
    </div>
  );
};

const Ae200SectionContent: React.FC<{
  ae200State: Ae200State | null;
  controllerFilter: string[];
  reduced: boolean;
  onSetMode: (entityId: string, mode: Ae200HvacMode) => void;
  onSetFan: (entityId: string, fan: Ae200FanMode) => void;
  onSetTemp: (entityId: string, temp: number) => void;
}> = ({ ae200State, controllerFilter, reduced, onSetMode, onSetFan, onSetTemp }) => {
  if (!ae200State || ae200State.controllers.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: 'rgba(var(--text) / 0.35)', fontSize: 'var(--type-xs)' }}>
        <IconActivity style={{ width: 14, height: 14 }} />
        No AE-200E controllers detected
      </div>
    );
  }

  const controllers = controllerFilter.length === 0
    ? ae200State.controllers
    : ae200State.controllers.filter(c =>
        controllerFilter.some(f => c.controllerId.toLowerCase().includes(f.toLowerCase()) || c.name.toLowerCase().includes(f.toLowerCase()))
      );

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {controllers.map(ctrl => (
        <Ae200ControllerSection
          key={ctrl.controllerId}
          controller={ctrl}
          controllerFilter={controllerFilter}
          reduced={reduced}
          onSetMode={onSetMode}
          onSetFan={onSetFan}
          onSetTemp={onSetTemp}
        />
      ))}
    </div>
  );
};

// =============================================================================
// COOLMASTER SECTION
// =============================================================================

/** Single CoolMaster unit card */
const CoolMasterUnitCard: React.FC<{
  unit: CoolMasterUnitState;
  reduced: boolean;
  onSetMode: (entityId: string, mode: string) => void;
  onSetFan: (entityId: string, fan: string) => void;
  onSetTemp: (entityId: string, temp: number) => void;
}> = ({ unit, reduced, onSetMode, onSetFan, onSetTemp }) => {
  const accent = modeAccent(unit.hvacMode);
  const rpm    = unit.isOn ? fanLevel(unit.fanMode, unit.fanModes) : 0;

  return (
    <div
      style={{
        borderRadius: 'var(--radius-card)',
        padding: 'clamp(0.45rem, 4cqmin, 0.75rem)',
        containerType: 'inline-size',
        backdropFilter: 'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: unit.isOn
          ? `color-mix(in srgb, ${accent} 14%, var(--glass-l3-bg))`
          : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: `1px solid ${unit.isOn
          ? `color-mix(in srgb, ${accent} 38%, var(--glass-l3-border))`
          : 'var(--glass-l3-border)'}`,
        boxShadow: unit.isOn
          ? `var(--rim), inset 0 0 18px -5px color-mix(in srgb, ${accent} 18%, transparent), 0 0 10px -3px color-mix(in srgb, ${accent} 26%, transparent)`
          : 'var(--rim), var(--elev-1)',
        transition: `all var(--dur-medium, 260ms) var(--spring-gentle)`,
        opacity: unit.isOnline ? 1 : 0.55,
      }}
    >
      {/* Top row: fan + name + mode controls */}
      <div className="flex items-center" style={{ gap: 'clamp(0.35rem, 3cqmin, 0.65rem)', marginBottom: 'clamp(0.3rem, 2.5cqmin, 0.5rem)' }}>
        <AnimatedFan
          active={unit.isOn}
          rpmLevel={rpm}
          colorVar={accent}
          size={unit.isOn ? 22 : 18}
        />
        <div className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
          <span className="truncate font-semibold" style={{ ...fluidTextSm, color: 'rgba(var(--text) / 0.9)' }}>
            {unit.name}
          </span>
          <span style={{ fontSize: '0.52rem', fontWeight: 600, color: 'rgba(var(--text) / 0.4)', letterSpacing: '0.04em' }}>
            {unit.rawUnitId}
          </span>
        </div>
        <div className="flex flex-col items-end flex-shrink-0" style={{ gap: 3 }}>
          {unit.errorCode && (
            <span style={{
              fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const,
              color: ALERT, padding: '1px 5px', borderRadius: 'var(--radius-pill)',
              backgroundColor: `color-mix(in srgb, ${ALERT} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${ALERT} 34%, transparent)`,
              animation: 'climate-comp-badge-breathe 1.5s ease-in-out infinite',
            }}>
              {unit.errorCode}
            </span>
          )}
          {unit.filterDirty && (
            <span style={{
              fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const,
              color: HEAT, padding: '1px 5px', borderRadius: 'var(--radius-pill)',
              backgroundColor: `color-mix(in srgb, ${HEAT} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${HEAT} 34%, transparent)`,
            }}>
              Filter
            </span>
          )}
          <ModeCycleButton
            mode={unit.hvacMode}
            modes={unit.hvacModes}
            accent={accent}
            disabled={!unit.isOnline}
            onCycle={(next) => onSetMode(unit.climateEntityId, next)}
          />
          {unit.fanMode !== null && unit.fanModes.length > 0 && (
            <FanCycleButton
              fanMode={unit.fanMode}
              fanModes={unit.fanModes}
              accent={accent}
              disabled={!unit.isOnline}
              onCycle={(next) => onSetFan(unit.climateEntityId, next)}
            />
          )}
        </div>
      </div>

      {/* Temp row */}
      <div className="flex items-center" style={{ gap: 'clamp(0.3rem, 2.5cqmin, 0.55rem)' }}>
        {unit.currentTemp !== null && unit.targetTemp !== null && (() => {
          const pct = Math.max(0, Math.min(100, ((unit.currentTemp - 60) / (90 - 60)) * 100));
          return (
            <div className="flex-1 min-w-0">
              <BuildBar
                value={pct}
                min={0}
                max={100}
                colorVar={accent}
                active={unit.isOn}
                height={5}
              />
            </div>
          );
        })()}
        <SetpointStepper
          value={unit.targetTemp}
          unit={unit.tempUnit === 'F' ? '°F' : '°C'}
          min={60}
          max={90}
          step={1}
          accent={accent}
          disabled={!unit.isOnline || !unit.isOn}
          onChange={(v) => onSetTemp(unit.climateEntityId, v)}
        />
      </div>

      {unit.currentTemp !== null && (
        <div className="flex items-center justify-between" style={{ marginTop: 'clamp(0.2rem, 1.8cqmin, 0.35rem)' }}>
          <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.5)' }}>Current</span>
          <span className="tabular-nums font-semibold" style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.8)' }}>
            {Math.round(unit.currentTemp)}{unit.tempUnit === 'F' ? '°F' : '°C'}
          </span>
        </div>
      )}
    </div>
  );
};

const CoolMasterSectionContent: React.FC<{
  units: CoolMasterUnitState[];
  lineFilter: string[];
  reduced: boolean;
  onSetMode: (entityId: string, mode: string) => void;
  onSetFan: (entityId: string, fan: string) => void;
  onSetTemp: (entityId: string, temp: number) => void;
}> = ({ units, lineFilter, reduced, onSetMode, onSetFan, onSetTemp }) => {
  const filtered = useMemo(() => {
    if (lineFilter.length === 0) return units;
    return units.filter(u => lineFilter.some(f => u.lineId.toLowerCase().includes(f.toLowerCase())));
  }, [units, lineFilter]);

  if (filtered.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: 'rgba(var(--text) / 0.35)', fontSize: 'var(--type-xs)' }}>
        <IconFan style={{ width: 14, height: 14 }} />
        No CoolMaster units detected
      </div>
    );
  }

  // Group by line
  const byLine = new Map<string, CoolMasterUnitState[]>();
  for (const u of filtered) {
    if (!byLine.has(u.lineId)) byLine.set(u.lineId, []);
    byLine.get(u.lineId)!.push(u);
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
      {[...byLine.entries()].map(([lineId, lineUnits]) => (
        <div key={lineId} className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          {byLine.size > 1 && (
            <SectionLabel icon={<IconFan />} accent={COOL}>{lineId}</SectionLabel>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(11rem, 30cqw, 17rem), 1fr))',
            gap: 'var(--space-2)',
          }}>
            {lineUnits.map(unit => (
              <CoolMasterUnitCard
                key={unit.climateEntityId}
                unit={unit}
                reduced={reduced}
                onSetMode={onSetMode}
                onSetFan={onSetFan}
                onSetTemp={onSetTemp}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// HERO — Whole-home climate overview
// =============================================================================

interface ClimateHeroStats {
  heatingCount: number;
  coolingCount: number;
  idleCount: number;
  offCount: number;
  totalZones: number;
  /** Best available outdoor temp (AE-200E first, then Airzone) */
  outdoorTemp: number | null;
  outdoorUnit: string;
  /** Tint direction derived from dominant mode */
  dominant: 'heating' | 'cooling' | 'idle' | 'none';
}

function deriveHeroStats(
  airzoneGroups: ClimateGroup[],
  ae200State: Ae200State | null,
  coolMasterUnits: CoolMasterUnitState[],
): ClimateHeroStats {
  let heating = 0, cooling = 0, idle = 0, off = 0;

  // Airzone
  for (const g of airzoneGroups) {
    const zones = [g.master, ...g.slaves];
    for (const z of zones) {
      if (z.hvacMode === 'off') off++;
      else if (z.hvacAction === 'heating' || z.hvacMode === 'heat') heating++;
      else if (z.hvacAction === 'cooling' || z.hvacMode === 'cool') cooling++;
      else idle++;
    }
  }

  // AE-200E
  if (ae200State) {
    for (const ctrl of ae200State.controllers) {
      for (const g of ctrl.groups) {
        if (!g.isOn) off++;
        else if (g.mode === 'heat') heating++;
        else if (g.mode === 'cool') cooling++;
        else idle++;
      }
    }
  }

  // CoolMaster
  for (const u of coolMasterUnits) {
    if (u.hvacMode === 'off') off++;
    else if (u.hvacMode === 'heat') heating++;
    else if (u.hvacMode === 'cool') cooling++;
    else idle++;
  }

  const total = heating + cooling + idle + off;

  // Outdoor temp: prefer AE-200E (it's the actual outdoor unit sensor)
  let outdoorTemp: number | null = null;
  let outdoorUnit = '°F';
  if (ae200State && ae200State.controllers.length > 0) {
    const temps = ae200State.controllers.map(c => c.outdoorTemp).filter((t): t is number => t !== null);
    if (temps.length > 0) {
      outdoorTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
      outdoorUnit = '°F';
    }
  }

  const dominant: ClimateHeroStats['dominant'] =
    heating > cooling && heating > idle ? 'heating'
    : cooling > heating && cooling > idle ? 'cooling'
    : idle > 0 ? 'idle'
    : 'none';

  return { heatingCount: heating, coolingCount: cooling, idleCount: idle, offCount: off, totalZones: total, outdoorTemp, outdoorUnit, dominant };
}

const ClimateHeroBackdrop: React.FC<{
  dominant: 'heating' | 'cooling' | 'idle' | 'none';
  reduced: boolean;
}> = ({ dominant, reduced }) => {
  // Thermal air-flow mesh — very slow drift, barely perceptible
  const heatTint = 'rgba(255,130,50,0.16)';
  const coolTint = 'rgba(56,189,248,0.16)';
  const tint = dominant === 'heating' ? heatTint : dominant === 'cooling' ? coolTint : 'rgba(100,120,160,0.10)';
  const tintFar = dominant === 'heating' ? 'rgba(200,80,30,0.08)' : dominant === 'cooling' ? 'rgba(20,150,230,0.08)' : 'rgba(70,90,130,0.06)';

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" style={{ borderRadius: 'var(--radius-surface)' }}>
      {/* Deep charcoal base — consistent across all thermal states */}
      <div className="absolute inset-0" style={{
        background: `linear-gradient(172deg,
          rgba(18, 22, 36, 0.60) 0%,
          rgba(12, 16, 28, 0.82) 50%,
          rgba(8,  12, 22, 0.94) 100%)`,
      }} />

      {/* Thermal mesh: directional radial washes, tinted by mode */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: '-6%',
          background: `
            radial-gradient(44% 50% at 20% 22%, ${tint}, transparent 70%),
            radial-gradient(52% 58% at 80% 36%, ${tint}, transparent 72%),
            radial-gradient(38% 44% at 60% 80%, ${tintFar}, transparent 70%)
          `,
          filter: 'blur(3px)',
          animation: reduced ? 'none' : 'climate-comp-airflow-drift 20s ease-in-out infinite',
        }}
      />

      {/* Fine direction lines — horizontal air-flow suggestion */}
      <div className="absolute inset-0 pointer-events-none" style={{
        opacity: reduced ? 0.07 : 0.11,
        mixBlendMode: 'screen',
        backgroundImage: `
          repeating-linear-gradient(0deg, rgba(160,200,255,0.08) 0 1px, transparent 1px 32px),
          repeating-linear-gradient(90deg, rgba(160,200,255,0.05) 0 1px, transparent 1px 60px)
        `,
        maskImage: 'radial-gradient(110% 80% at 50% 10%, #000 40%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(110% 80% at 50% 10%, #000 40%, transparent 80%)',
        animation: reduced ? 'none' : 'climate-comp-thermal-breathe 10s ease-in-out infinite',
      }} />

      {/* Slow specular band */}
      {!reduced && (
        <div className="absolute pointer-events-none" style={{
          top: 0, left: 0, right: 0, height: '44%',
          background: 'linear-gradient(96deg, transparent 28%, rgba(180,220,255,0.12) 50%, transparent 72%)',
          animation: 'climate-comp-specular-travel 18s ease-in-out infinite',
        }} />
      )}

      {/* Bottom depth vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `radial-gradient(140% 100% at 50% 130%, rgba(5,8,16,0.70), transparent 60%)`,
      }} />
    </div>
  );
};

const ClimateHeroScene: React.FC<{
  areaName: string;
  stats: ClimateHeroStats;
  reduced: boolean;
  airzoneStatus: 'connecting' | 'live' | 'stale';
}> = ({ areaName, stats, reduced, airzoneStatus }) => {
  const dominantColor =
    stats.dominant === 'heating' ? HEAT :
    stats.dominant === 'cooling' ? COOL :
    'rgba(var(--text) / 0.55)';

  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden"
      style={{
        height: 'clamp(9.5rem, 23cqw, 15rem)',
        borderTopLeftRadius: 'var(--radius-surface)',
        borderTopRightRadius: 'var(--radius-surface)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <ClimateHeroBackdrop dominant={stats.dominant} reduced={reduced} />

      {/* HUD overlay */}
      <div
        className="absolute inset-0 flex flex-col justify-between pointer-events-none"
        style={{ padding: 'clamp(0.5rem, 2.2cqw, 0.95rem)' }}
      >
        {/* Top row: title + live indicator */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center pointer-events-auto" style={{ gap: 'clamp(0.35rem, 1.8cqw, 0.7rem)' }}>
            {/* Icon bead */}
            <div style={{
              width: 'clamp(30px, 4.2cqw, 44px)', height: 'clamp(30px, 4.2cqw, 44px)',
              borderRadius: 'var(--radius-control)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: `color-mix(in srgb, ${dominantColor} 28%, var(--glass-l3-bg))`,
              backgroundImage: 'var(--specular-strong)',
              border: `1px solid color-mix(in srgb, ${dominantColor} 52%, var(--glass-l3-border))`,
              boxShadow: `var(--rim-light), inset 0 0 16px -4px color-mix(in srgb, ${dominantColor} 42%, transparent), 0 0 20px -4px color-mix(in srgb, ${dominantColor} 56%, transparent)`,
            }}>
              <IconWind style={{
                width: 'clamp(16px, 2.4cqw, 22px)', height: 'clamp(16px, 2.4cqw, 22px)',
                color: dominantColor,
              }} />
            </div>
            {/* Title + status tags */}
            <div className="flex flex-col" style={{ gap: 2 }}>
              <h2 style={{
                margin: 0, fontFamily: 'var(--font-display)',
                fontSize: 'clamp(1.05rem, 2.8cqw, 1.75rem)', fontWeight: 700, lineHeight: 1.1,
                color: 'rgb(235 242 252)', letterSpacing: 'var(--tracking-tight)',
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
              }}>
                {areaName}
              </h2>
              <div className="flex items-center flex-wrap" style={{ gap: 'var(--space-2)' }}>
                {stats.heatingCount > 0 && (
                  <HeroTag label="heating" color={HEAT} count={stats.heatingCount} />
                )}
                {stats.coolingCount > 0 && (
                  <HeroTag label="cooling" color={COOL} count={stats.coolingCount} />
                )}
                {stats.idleCount > 0 && (
                  <HeroTag label="idle" color="rgba(var(--text) / 0.5)" count={stats.idleCount} />
                )}
              </div>
            </div>
          </div>

          {/* Right: connection status */}
          <div className="flex-shrink-0" style={{
            padding: 'clamp(0.2rem, 1cqw, 0.35rem) clamp(0.4rem, 1.6cqw, 0.65rem)',
            borderRadius: 'var(--radius-control)',
            backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--glass-l3-tint)',
            border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
          }}>
            {airzoneStatus === 'live' ? (
              <span className="flex items-center gap-1.5" style={{ fontSize: 'var(--type-xs)', fontWeight: 700, color: 'rgb(52 211 153)' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 999, background: 'rgb(52 211 153)',
                  display: 'inline-block',
                  animation: reduced ? 'none' : 'climate-comp-live-pulse 2s ease-in-out infinite',
                }} />
                Live
              </span>
            ) : airzoneStatus === 'stale' ? (
              <span className="flex items-center gap-1" style={{ fontSize: 'var(--type-xs)', fontWeight: 700, color: HEAT }}>
                <IconWifiOff style={{ width: 11, height: 11 }} /> Stale
              </span>
            ) : (
              <span className="flex items-center gap-1" style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: 'rgba(var(--text) / 0.45)' }}>
                <IconLoader2 style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Connecting
              </span>
            )}
          </div>
        </div>

        {/* Bottom row: zone count summary + outdoor temp */}
        <div className="flex items-end justify-between gap-3">
          {/* Zone summary chip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'clamp(0.6rem, 2cqw, 1rem)',
            padding: 'clamp(0.25rem, 1.1cqw, 0.45rem) clamp(0.45rem, 1.8cqw, 0.75rem)',
            borderRadius: 'var(--radius-control)',
            backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: `color-mix(in srgb, ${dominantColor} 12%, var(--glass-l3-bg))`,
            backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
            border: `1px solid color-mix(in srgb, ${dominantColor} 28%, var(--glass-l3-border))`,
            boxShadow: `var(--rim), 0 0 12px -3px color-mix(in srgb, ${dominantColor} 22%, transparent)`,
          }}>
            <ZoneSummarySlot label="Total" value={stats.totalZones} color="rgba(var(--text) / 0.6)" />
            {stats.heatingCount > 0 && <ZoneSummarySlot label="Heating" value={stats.heatingCount} color={HEAT} />}
            {stats.coolingCount > 0 && <ZoneSummarySlot label="Cooling" value={stats.coolingCount} color={COOL} />}
            {stats.idleCount > 0   && <ZoneSummarySlot label="Idle"    value={stats.idleCount}    color="rgba(var(--text) / 0.4)" />}
          </div>

          {/* Outdoor temp chip */}
          {stats.outdoorTemp !== null && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
              padding: 'clamp(0.22rem, 1cqw, 0.4rem) clamp(0.4rem, 1.5cqw, 0.65rem)',
              borderRadius: 'var(--radius-control)',
              backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: 'var(--glass-l3-bg)', backgroundImage: 'var(--glass-l3-tint)',
              border: '1px solid var(--glass-l3-border)', boxShadow: 'var(--rim)',
            }}>
              <span style={{ fontSize: 'var(--type-2xs)', fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' as const }}>
                Outdoor
              </span>
              <span className="tabular-nums" style={{ fontSize: 'clamp(0.78rem, 1.7cqw, 1rem)', fontWeight: 700, color: 'rgb(225 235 250)', lineHeight: 1.1 }}>
                {Math.round(stats.outdoorTemp)}{stats.outdoorUnit}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Small zone count slot inside the summary chip
const ZoneSummarySlot: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="flex flex-col items-center" style={{ minWidth: 'clamp(24px, 4cqw, 36px)' }}>
    <span className="font-bold tabular-nums" style={{ fontSize: 'clamp(0.85rem, 2.2cqw, 1.1rem)', color, lineHeight: 1 }}>
      {value}
    </span>
    <span className="uppercase font-bold" style={{ fontSize: '0.46rem', color: 'rgba(var(--text) / 0.45)', letterSpacing: '0.06em' }}>
      {label}
    </span>
  </div>
);

// =============================================================================
// QUICK-ACTIONS BAR
// =============================================================================

/**
 * Fans a ClimateQuickAction out to all three integration service layers:
 *   - Airzone: climate.ts setTargetTemperature / setHvacMode
 *   - AE-200E: updateDeviceState with payload (routed through HA service via Ae200Tile pattern)
 *   - CoolMaster: haClient.callService direct
 */
async function executeClimateAction(
  action: ClimateQuickAction,
  airzoneGroups: ClimateGroup[],
  ae200State: Ae200State | null,
  coolMasterUnits: CoolMasterUnitState[],
  updateDeviceState: (deviceId: string, state: any) => void,
  ae200DeviceIds: string[],
): Promise<void> {
  const allAirzoneZones = airzoneGroups.flatMap(g => [g.master, ...g.slaves]);

  switch (action.kind) {
    case 'setTemp': {
      const temp = action.temp;
      // Airzone
      await Promise.allSettled(allAirzoneZones.filter(z => z.available && z.hvacMode !== 'off').map(z =>
        svcAirzoneSetTemp(z.entityId, temp)
      ));
      // AE-200E via updateDeviceState
      if (ae200State) {
        for (const ctrl of ae200State.controllers) {
          for (const g of ctrl.groups) {
            if (g.isOn && g.isOnline) {
              await haClient.callService('climate', 'set_temperature', { temperature: temp }, { entity_id: g.entityId }).catch(() => {});
            }
          }
        }
      }
      // CoolMaster
      await Promise.allSettled(coolMasterUnits.filter(u => u.isOn && u.isOnline).map(u =>
        haClient.callService('climate', 'set_temperature', { temperature: temp }, { entity_id: u.climateEntityId })
      ));
      break;
    }
    case 'preset': {
      const { coolTemp, heatTemp } = action;
      // Airzone
      await Promise.allSettled(allAirzoneZones.filter(z => z.available && z.hvacMode !== 'off').map(z =>
        svcAirzoneSetTemp(z.entityId, z.hvacMode === 'cool' ? coolTemp : heatTemp)
      ));
      // AE-200E
      if (ae200State) {
        for (const ctrl of ae200State.controllers) {
          for (const g of ctrl.groups) {
            if (g.isOn && g.isOnline) {
              const t = g.mode === 'cool' ? coolTemp : heatTemp;
              await haClient.callService('climate', 'set_temperature', { temperature: t }, { entity_id: g.entityId }).catch(() => {});
            }
          }
        }
      }
      // CoolMaster
      await Promise.allSettled(coolMasterUnits.filter(u => u.isOn && u.isOnline).map(u => {
        const t = u.hvacMode === 'cool' ? coolTemp : heatTemp;
        return haClient.callService('climate', 'set_temperature', { temperature: t }, { entity_id: u.climateEntityId });
      }));
      break;
    }
    case 'allOff': {
      // Airzone — route through resolveModeTarget for each group
      await Promise.allSettled(airzoneGroups.map(group => {
        const target = resolveModeTarget(group.master, group);
        if (target.blocked || !target.entityId) return Promise.resolve();
        return svcAirzoneSetMode(target.entityId, 'off');
      }));
      // AE-200E
      if (ae200State) {
        await Promise.allSettled(ae200State.controllers.flatMap(ctrl =>
          ctrl.groups.filter(g => g.isOnline).map(g =>
            haClient.callService('climate', 'set_hvac_mode', { hvac_mode: 'off' }, { entity_id: g.entityId })
          )
        ));
      }
      // CoolMaster
      await Promise.allSettled(coolMasterUnits.filter(u => u.isOnline).map(u =>
        haClient.callService('climate', 'set_hvac_mode', { hvac_mode: 'off' }, { entity_id: u.climateEntityId })
      ));
      break;
    }
    case 'mode': {
      const { hvacMode } = action;
      // Airzone
      await Promise.allSettled(airzoneGroups.map(group => {
        const target = resolveModeTarget(group.master, group);
        if (target.blocked || !target.entityId) return Promise.resolve();
        return svcAirzoneSetMode(target.entityId, hvacMode);
      }));
      // AE-200E
      if (ae200State) {
        await Promise.allSettled(ae200State.controllers.flatMap(ctrl =>
          ctrl.groups.filter(g => g.isOnline).map(g =>
            haClient.callService('climate', 'set_hvac_mode', { hvac_mode: hvacMode }, { entity_id: g.entityId })
          )
        ));
      }
      // CoolMaster
      await Promise.allSettled(coolMasterUnits.filter(u => u.isOnline).map(u =>
        haClient.callService('climate', 'set_hvac_mode', { hvac_mode: hvacMode }, { entity_id: u.climateEntityId })
      ));
      break;
    }
  }
}

const QuickActionButton: React.FC<{
  action: ClimateQuickAction;
  onExecute: (action: ClimateQuickAction) => void;
  busy: boolean;
}> = ({ action, onExecute, busy }) => {
  const label = action.label ?? (
    action.kind === 'setTemp'  ? `All → ${action.temp}°`
    : action.kind === 'preset' ? `Comfort ${action.coolTemp}/${action.heatTemp}°`
    : action.kind === 'allOff' ? 'All Off'
    : `Mode: ${(action as any).hvacMode ?? ''}`
  );

  const isDestructive = action.kind === 'allOff';
  const accent = isDestructive ? ALERT : COOL;

  return (
    <button
      onClick={() => !busy && onExecute(action)}
      disabled={busy}
      className="flex items-center"
      style={{
        gap: 6, flexShrink: 0,
        padding: 'clamp(0.28rem, 1.1cqw, 0.48rem) clamp(0.55rem, 2cqw, 0.85rem)',
        borderRadius: 'var(--radius-pill)',
        backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: `color-mix(in srgb, ${accent} 14%, var(--glass-l3-bg))`,
        backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: `1px solid color-mix(in srgb, ${accent} 38%, var(--glass-l3-border))`,
        boxShadow: `var(--rim), 0 0 10px -3px color-mix(in srgb, ${accent} 24%, transparent)`,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.55 : 1,
        transition: 'all var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
      }}
      onPointerDown={(e) => { if (!busy) (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >
      {busy ? (
        <IconLoader2 style={{ width: 13, height: 13, color: accent, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
      ) : (
        <IconWind style={{ width: 13, height: 13, color: accent, flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 'var(--type-xs)', fontWeight: 700, color: accent, whiteSpace: 'nowrap' as const }}>
        {label}
      </span>
    </button>
  );
};

const QuickActionsBar: React.FC<{
  actions: ClimateQuickAction[];
  airzoneGroups: ClimateGroup[];
  ae200State: Ae200State | null;
  coolMasterUnits: CoolMasterUnitState[];
  ae200DeviceIds: string[];
  updateDeviceState: (id: string, s: any) => void;
}> = ({ actions, airzoneGroups, ae200State, coolMasterUnits, ae200DeviceIds, updateDeviceState }) => {
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  const handleExecute = useCallback(async (action: ClimateQuickAction, idx: number) => {
    if (busyIdx !== null) return;
    setBusyIdx(idx);
    try {
      await executeClimateAction(action, airzoneGroups, ae200State, coolMasterUnits, updateDeviceState, ae200DeviceIds);
    } finally {
      setBusyIdx(null);
    }
  }, [busyIdx, airzoneGroups, ae200State, coolMasterUnits, updateDeviceState, ae200DeviceIds]);

  return (
    <div
      className="flex-shrink-0 flex items-center overflow-x-auto"
      style={{
        gap: 'clamp(0.35rem, 1.3cqw, 0.6rem)',
        padding: 'clamp(0.3rem, 1.1cqw, 0.5rem) clamp(0.45rem, 1.6cqw, 0.8rem)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        scrollbarWidth: 'none',
      }}
    >
      {actions.map((action, idx) => (
        <QuickActionButton
          key={idx}
          action={action}
          busy={busyIdx === idx}
          onExecute={(a) => { void handleExecute(a, idx); }}
        />
      ))}
    </div>
  );
};

// =============================================================================
// MAIN: ClimateCompilationTile
// =============================================================================

const ClimateCompilationTile: React.FC<TileProps> = ({ tile, device }) => {
  useMemo(() => ensureAnims(), []);

  // Parse config from device.state
  const config = useMemo(() => parseConfig(device.state), [device.state]);

  // ── Airzone hook ───────────────────────────────────────────────────────────
  const { zones, groups, status: airzoneStatus, setTargetTemperature, setHvacMode, setFanMode } = useClimateZones();

  // ── AE-200E and CoolMaster state from device list + updateDeviceState ──────
  const { devices } = useDashboard();
  const { updateDeviceState } = useDashboardActions();

  // Find all AE-200 devices (DeviceType.AE200)
  const ae200Devices = useMemo(() =>
    devices.filter(d => d.type === DeviceType.AE200 && d.state && typeof d.state === 'object' && 'controllers' in (d.state as object)),
    [devices]
  );
  // Merge all AE-200 state into a single Ae200State with all controllers
  const ae200State = useMemo((): Ae200State | null => {
    if (ae200Devices.length === 0) return null;
    const allControllers = ae200Devices.flatMap(d => {
      const s = d.state as Ae200State;
      return s.controllers ?? [];
    });
    const lastUpdated = ae200Devices
      .map(d => (d.state as Ae200State).lastUpdatedMs)
      .filter((t): t is number => t !== null)
      .reduce((a, b) => Math.max(a, b), 0);
    return { controllers: allControllers, lastUpdatedMs: lastUpdated || null };
  }, [ae200Devices]);

  const ae200DeviceIds = useMemo(() => ae200Devices.map(d => d.id), [ae200Devices]);

  // Find all CoolMaster devices (DeviceType.CoolMaster)
  const coolMasterUnits = useMemo((): CoolMasterUnitState[] =>
    devices
      .filter(d => d.type === DeviceType.CoolMaster && d.state && typeof d.state === 'object' && 'climateEntityId' in (d.state as object))
      .map(d => d.state as CoolMasterUnitState),
    [devices]
  );

  // ── Reduced motion ─────────────────────────────────────────────────────────
  const reduced = useReducedMotion();

  // ── Hero stats ─────────────────────────────────────────────────────────────
  const heroStats = useMemo(() =>
    deriveHeroStats(groups, ae200State, coolMasterUnits),
    [groups, ae200State, coolMasterUnits]
  );

  // ── AE-200E control callbacks (via callService direct — same pattern as Ae200Tile) ──
  const ae200SetMode = useCallback(async (entityId: string, mode: Ae200HvacMode) => {
    await haClient.callService('climate', 'set_hvac_mode', { hvac_mode: mode }, { entity_id: entityId }).catch(() => {});
  }, []);

  const ae200SetFan = useCallback(async (entityId: string, fan: Ae200FanMode) => {
    await haClient.callService('climate', 'set_fan_mode', { fan_mode: fan }, { entity_id: entityId }).catch(() => {});
  }, []);

  const ae200SetTemp = useCallback(async (entityId: string, temp: number) => {
    await haClient.callService('climate', 'set_temperature', { temperature: temp }, { entity_id: entityId }).catch(() => {});
  }, []);

  // ── CoolMaster control callbacks ───────────────────────────────────────────
  const cmSetMode = useCallback(async (entityId: string, mode: string) => {
    await haClient.callService('climate', 'set_hvac_mode', { hvac_mode: mode }, { entity_id: entityId }).catch(() => {});
  }, []);

  const cmSetFan = useCallback(async (entityId: string, fan: string) => {
    await haClient.callService('climate', 'set_fan_mode', { fan_mode: fan }, { entity_id: entityId }).catch(() => {});
  }, []);

  const cmSetTemp = useCallback(async (entityId: string, temp: number) => {
    await haClient.callService('climate', 'set_temperature', { temperature: temp }, { entity_id: entityId }).catch(() => {});
  }, []);

  // Active section count → balanced grid columns
  const activeSectionCount =
    (config.showAirzone ? 1 : 0) +
    (config.showAe200 ? 1 : 0) +
    (config.showCoolMaster ? 1 : 0);

  // Is any zone actively conditioning? (for outer glow tint)
  const anyActive =
    heroStats.heatingCount > 0 || heroStats.coolingCount > 0;
  const dominantAccent = heroStats.dominant === 'heating' ? HEAT : heroStats.dominant === 'cooling' ? COOL : NEUTRAL;

  return (
    <div
      className="climate-comp-root relative flex flex-col h-full overflow-hidden"
      style={{
        borderRadius: 'var(--radius-surface)',
        containerType: 'inline-size',
        backdropFilter: 'var(--glass-l1-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
        backgroundColor: anyActive
          ? `color-mix(in srgb, ${dominantAccent} 7%, rgba(12, 15, 26, 0.96))`
          : 'rgba(10, 13, 22, 0.97)',
        border: `1px solid ${anyActive
          ? `color-mix(in srgb, ${dominantAccent} 22%, rgba(255,255,255,0.07))`
          : 'rgba(255,255,255,0.06)'}`,
        boxShadow: anyActive
          ? `var(--rim), inset 0 0 55px -14px color-mix(in srgb, ${dominantAccent} 14%, transparent), var(--elev-5)`
          : 'var(--rim), var(--elev-4)',
        animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
        transition: `background-color var(--dur-slow, 420ms) var(--spring-gentle), border-color var(--dur-slow, 420ms) ease, box-shadow var(--dur-slow, 420ms) ease`,
      }}
    >
      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <ClimateHeroScene
        areaName={tile.label || config.areaName}
        stats={heroStats}
        reduced={reduced}
        airzoneStatus={airzoneStatus}
      />

      {/* ── QUICK-ACTIONS BAR ───────────────────────────────────────────────── */}
      {config.showQuickActions && config.quickActions.length > 0 && (
        <QuickActionsBar
          actions={config.quickActions}
          airzoneGroups={groups}
          ae200State={ae200State}
          coolMasterUnits={coolMasterUnits}
          ae200DeviceIds={ae200DeviceIds}
          updateDeviceState={updateDeviceState}
        />
      )}

      {/* ── SCROLLABLE DECK ─────────────────────────────────────────────────── */}
      <div
        className="relative z-10 flex-1 overflow-y-auto min-h-0"
        style={{
          padding: 'clamp(0.45rem, 1.6cqw, 0.8rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(0.4rem, 1.4cqw, 0.7rem)',
        }}
      >
        <div className="climate-comp-deck" data-cols={activeSectionCount}>

          {/* ── Airzone section ─────────────────────────────────────────────── */}
          {config.showAirzone && (
            <CollapsibleSection
              title="Airzone"
              icon={<IconWind style={{ width: 16, height: 16 }} />}
              accent={COOL}
              defaultOpen={true}
              count={groups.flatMap(g => [g.master, ...g.slaves]).filter(z => z.hvacMode !== 'off').length || undefined}
            >
              <AirzoneSectionContent
                groups={groups}
                status={airzoneStatus}
                nameFilter={config.airzoneFilter}
                onSetTemperature={setTargetTemperature}
                onSetHvacMode={setHvacMode}
                onSetFanMode={setFanMode}
              />
            </CollapsibleSection>
          )}

          {/* ── AE-200E section ─────────────────────────────────────────────── */}
          {config.showAe200 && (
            <CollapsibleSection
              title="AE-200E City Multi"
              icon={<IconActivity style={{ width: 16, height: 16 }} />}
              accent={heroStats.dominant === 'heating' ? HEAT : COOL}
              defaultOpen={true}
              count={ae200State
                ? ae200State.controllers.reduce((n, c) => n + c.groups.filter(g => g.isOn).length, 0) || undefined
                : undefined}
            >
              <Ae200SectionContent
                ae200State={ae200State}
                controllerFilter={config.ae200Filter}
                reduced={reduced}
                onSetMode={ae200SetMode}
                onSetFan={ae200SetFan}
                onSetTemp={ae200SetTemp}
              />
            </CollapsibleSection>
          )}

          {/* ── CoolMaster section ──────────────────────────────────────────── */}
          {config.showCoolMaster && (
            <CollapsibleSection
              title="CoolMaster VRF"
              icon={<IconFan style={{ width: 16, height: 16 }} />}
              accent={COOL}
              defaultOpen={true}
              count={coolMasterUnits.filter(u => u.isOn).length || undefined}
            >
              <CoolMasterSectionContent
                units={coolMasterUnits}
                lineFilter={config.coolMasterFilter}
                reduced={reduced}
                onSetMode={cmSetMode}
                onSetFan={cmSetFan}
                onSetTemp={cmSetTemp}
              />
            </CollapsibleSection>
          )}
        </div>

        {/* Stale indicator */}
        {airzoneStatus === 'stale' && (
          <div className="flex items-center justify-center" style={{ gap: 'var(--space-2)', padding: 'var(--space-2)' }}>
            <IconAlertTriangle style={{ width: 12, height: 12, color: HEAT }} />
            <span style={{ fontSize: 'var(--type-2xs)', color: HEAT, fontWeight: 600 }}>
              Airzone data may be stale — reconnecting
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClimateCompilationTile;
