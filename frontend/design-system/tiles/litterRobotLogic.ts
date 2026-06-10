import type { LitterRobotState, LitterRobotStatus } from '../../types';

// ---------------------------------------------------------------------------
// litterRobotLogic — PURE projection/math for the liquid-glass Litter-Robot
// (Whisker) tile. No React, no DOM: every value the tile paints is derived
// here so it can be unit-tested in isolation (level/drawer math, status/fault
// pill mapping, the control confirm-gate decision). Mirrors the Whisker
// integration's entity shapes (waste_drawer_level %, litter_level %,
// litter_level_state enum, scoops_saved_count, hopper_status, status_code,
// night_light/panel_lock switches, start_cycle button).
// ---------------------------------------------------------------------------

export interface StatusInfo {
  /** Token-friendly hex for the status dot/glow (kept hard-coded — these are
   *  brand status colors, not theme accents). */
  color: string;
  label: string;
  /** Maps onto the GlassCard accent family for the card glow. */
  accent: 'positive' | 'climate' | 'warning' | 'critical';
  /** True for the active/working states (drives the pulsing animation). */
  active: boolean;
}

// Status pill: color + human label + card accent. Mirrors the Whisker app
// (Ready = blue, Cat Detected = violet, faults/full = red).
export const STATUS_INFO: Record<LitterRobotStatus, StatusInfo> = {
  READY: { color: '#34d399', label: 'Ready', accent: 'positive', active: false },
  CYCLING: { color: '#38bdf8', label: 'Cycling', accent: 'climate', active: true },
  EMPTYING: { color: '#38bdf8', label: 'Emptying', accent: 'climate', active: true },
  CAT_DETECTED: { color: '#a78bfa', label: 'Cat Detected', accent: 'climate', active: true },
  PAUSED: { color: '#fbbf24', label: 'Paused', accent: 'warning', active: false },
  DRAWER_FULL: { color: '#f87171', label: 'Drawer Full', accent: 'critical', active: false },
  BONNET_REMOVED: { color: '#f87171', label: 'Bonnet Off', accent: 'critical', active: false },
  FAULT: { color: '#f87171', label: 'Fault', accent: 'critical', active: false },
  OFFLINE: { color: '#9ca3af', label: 'Offline', accent: 'warning', active: false },
};

export function statusInfo(status: LitterRobotStatus | undefined): StatusInfo {
  return (status && STATUS_INFO[status]) || STATUS_INFO.OFFLINE;
}

// Clamp + round any source number to an honest 0–100 integer percentage.
export function clampPct(n: number | null | undefined): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)));
}

// Waste-drawer fill color: red when full/critical, amber when getting there,
// green otherwise. `isFull` (DFI triggered) forces red regardless of %.
export function wasteColor(pct: number, isFull: boolean): string {
  if (isFull || pct >= 90) return '#f87171';
  if (pct >= 70) return '#fbbf24';
  return '#34d399';
}

// Litter-level fill color: low litter is the actionable (red/amber) state.
export function litterColor(pct: number): string {
  if (pct < 20) return '#f87171';
  if (pct < 40) return '#fbbf24';
  return '#22d3ee';
}

// Litter word: prefer the integration's `litter_level_state` ENUM when present
// (authoritative), else derive from the percentage.
export function litterWord(pct: number, levelState?: string): string {
  if (levelState) {
    const s = levelState.replace(/_/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (pct >= 40) return 'Optimal';
  if (pct >= 20) return 'Low';
  return 'Refill';
}

// Hopper word for the chip (normalize the enum; "—" when unknown/absent).
export function hopperWord(state: LitterRobotState): string {
  if (state.isHopperRemoved) return 'Removed';
  if (!state.hopperStatus) return '—';
  const s = state.hopperStatus.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Human relative "last cycle" label from an ISO timestamp. Pure given `now`.
export function lastCycleLabel(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// A whole-tile projection: everything the tile needs to paint, derived once.
export interface LitterRobotProjection {
  status: LitterRobotStatus;
  info: StatusInfo;
  wastePct: number;
  wasteFull: boolean;
  wasteColor: string;
  wasteCritical: boolean;
  hasLitter: boolean;
  litterPct: number;
  litterColor: string;
  litterWord: string;
  litterLow: boolean;
  scoopsSaved?: number;
  hopperWord: string;
  hopperRemoved: boolean;
  nightLightOn?: boolean;
  panelLocked?: boolean;
  isOnline: boolean;
  /** Card-level: any actionable problem (full/low/fault/offline/bonnet). */
  critical: boolean;
}

export function projectLitterRobot(state: LitterRobotState | null | undefined): LitterRobotProjection | null {
  if (!state || typeof state !== 'object') return null;
  const status = state.normalizedStatus;
  const info = statusInfo(status);
  const wastePct = clampPct(state.wasteLevel);
  const wasteFull = status === 'DRAWER_FULL' || !!state.isDFITriggered;
  const wasteCritical = wastePct >= 90 || wasteFull;
  const hasLitter = state.litterLevel !== null && state.litterLevel !== undefined;
  const litterPct = hasLitter ? clampPct(state.litterLevel) : 0;
  const litterLow = hasLitter && litterPct < 20;
  const isError = status === 'FAULT' || status === 'OFFLINE' || status === 'BONNET_REMOVED';
  return {
    status,
    info,
    wastePct,
    wasteFull,
    wasteColor: wasteColor(wastePct, wasteFull),
    wasteCritical,
    hasLitter,
    litterPct,
    litterColor: litterColor(litterPct),
    litterWord: litterWord(litterPct, state.litterLevelState),
    litterLow,
    scoopsSaved: state.scoopsSaved,
    hopperWord: hopperWord(state),
    hopperRemoved: !!state.isHopperRemoved,
    nightLightOn: state.isNightLightModeEnabled,
    panelLocked: state.isPanelLockEnabled,
    isOnline: state.isOnline !== false,
    critical: wasteCritical || litterLow || isError,
  };
}

// ── Control confirm-gate (low-hazard appliance actions) ─────────────────────
// Litter-Robot controls (Start Cycle / Panel Lock / Night-light) are LOW-HAZARD
// appliance actions, NOT pool/HVAC/AKVO/security equipment. They are guarded by
// a lightweight confirm/press-hold — never the hard equipment-gate. This helper
// is the single source of truth for whether an action may fire and how it must
// be confirmed, so the gate logic is testable without the DOM.

export type LitterRobotControl = 'cycle' | 'nightlight' | 'panellock';

export interface ControlGateContext {
  isEditor?: boolean;
  isLocked?: boolean;
  isOnline?: boolean;
  /** The entity_id backing this control (absent => cannot actuate). */
  entityId?: string;
}

export interface ControlGateDecision {
  /** May this control be invoked at all (entity present, not editor/locked, online)? */
  allowed: boolean;
  /** Low-hazard appliance actions ALWAYS require an explicit confirm/hold. */
  requiresConfirm: boolean;
  reason?: 'editor' | 'locked' | 'offline' | 'no-entity';
}

export function controlGate(ctx: ControlGateContext): ControlGateDecision {
  if (ctx.isEditor) return { allowed: false, requiresConfirm: true, reason: 'editor' };
  if (ctx.isLocked) return { allowed: false, requiresConfirm: true, reason: 'locked' };
  if (!ctx.entityId) return { allowed: false, requiresConfirm: true, reason: 'no-entity' };
  if (ctx.isOnline === false) return { allowed: false, requiresConfirm: true, reason: 'offline' };
  // Allowed — but the action is NEVER fire-on-tap: it must pass confirm/hold.
  return { allowed: true, requiresConfirm: true };
}

// The HA service call descriptor for a confirmed control. Pure mapping; the
// tile passes the result to the live `callService` plumbing. `null` when the
// control has no backing entity (the gate would already have blocked it).
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

export function controlServiceCall(
  control: LitterRobotControl,
  state: LitterRobotState,
): ServiceCall | null {
  const e = state.haEntities || {};
  switch (control) {
    case 'cycle': {
      // Prefer the Whisker dedicated start-cycle button; fall back to vacuum.start.
      if (e.startCycle) return { domain: 'button', service: 'press', data: { entity_id: e.startCycle } };
      if (e.vacuum) return { domain: 'vacuum', service: 'start', data: { entity_id: e.vacuum } };
      return null;
    }
    case 'nightlight': {
      if (!e.nightLight) return null;
      const turnOn = !state.isNightLightModeEnabled;
      // LR4 night light can be a select (off/on/auto); else a switch.
      if (e.nightLight.startsWith('select.')) {
        return { domain: 'select', service: 'select_option', data: { entity_id: e.nightLight, option: turnOn ? 'on' : 'off' } };
      }
      return { domain: 'switch', service: turnOn ? 'turn_on' : 'turn_off', data: { entity_id: e.nightLight } };
    }
    case 'panellock': {
      if (!e.panelLock) return null;
      const lock = !state.isPanelLockEnabled;
      return { domain: 'switch', service: lock ? 'turn_on' : 'turn_off', data: { entity_id: e.panelLock } };
    }
    default:
      return null;
  }
}
