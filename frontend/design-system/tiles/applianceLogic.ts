import type {
  ApplianceState,
  FridgeApplianceState,
  OvenApplianceState,
  DishwasherApplianceState,
  FridgeZoneState,
  OvenCavityState,
} from '../../types';

// ---------------------------------------------------------------------------
// applianceLogic — PURE projection/math for the liquid-glass Sub-Zero / Wolf /
// Cove appliance tiles. No React, no DOM: every value the tiles paint is derived
// here so it can be unit-tested in isolation (zone/cavity/cycle mapping, status
// pills, temperature formatting, the dishwasher progress-ring fraction, and the
// HARD no-oven-write guard). Mirrors the subzero_wolf integration's entity model
// (sensor.py / binary_sensor.py / light.py).
//
// SAFETY: the Wolf oven set-temp / probe / light WRITES are equipment-gated in
// the integration (default-off + inert + safety-ack). The b-panels oven tile is
// READ-ONLY: `ovenControlGate()` is the single source of truth and ALWAYS
// returns { allowed: false }. There is intentionally NO serviceCall builder for
// any oven write — a write path cannot be reached from this module.
// ---------------------------------------------------------------------------

export interface ApplianceStatusInfo {
  /** Hex for the status dot/glow (status colors, not theme accents). */
  color: string;
  label: string;
  /** Maps onto the GlassCard accent family for the card glow. */
  accent: 'positive' | 'climate' | 'warning' | 'critical' | 'heat';
  /** True for active/working states (drives the live animation). */
  active: boolean;
}

const COLOR = {
  cool: '#38bdf8',
  cold: '#22d3ee',
  ok: '#34d399',
  warm: '#fbbf24',
  hot: '#f87171',
  dim: '#9ca3af',
};

// Round/format an optional °F reading honestly (em-dash when absent).
export function tempLabel(f: number | null | undefined): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return '—';
  return `${Math.round(f)}°`;
}

// Title-case a free-text/enum value; em-dash when empty/unknown.
export function pretty(s: string | null | undefined): string {
  if (!s) return '—';
  const v = String(s).replace(/_/g, ' ').trim();
  if (!v || ['unknown', 'unavailable', 'none', 'off'].includes(v.toLowerCase())) {
    return v && v.toLowerCase() === 'off' ? 'Off' : '—';
  }
  return v.charAt(0).toUpperCase() + v.slice(1);
}

// ── Fridge ──────────────────────────────────────────────────────────────────

// A zone "cool" tone for the fill/glow: colder set-points read deeper blue.
export function zoneTone(name: string, setpointF: number | null): string {
  const n = name.toLowerCase();
  if (/freez/.test(n)) return COLOR.cold;
  if (/wine|beverage/.test(n)) return COLOR.cool;
  if (setpointF !== null && setpointF <= 10) return COLOR.cold;
  return COLOR.cool;
}

// Honest 0–100 filter percent (null passes through as null, not 0, so the tile
// can hide the readout rather than show a misleading 0%).
export function clampFilterPct(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)));
}

export interface FridgeProjection {
  online: boolean;
  zones: Array<FridgeZoneState & { tone: string; tempStr: string; setStr: string }>;
  anyDoorAjar: boolean;
  waterFilterPct: number | null;
  airFilterPct: number | null;
  filterLow: boolean;
  serviceRequired: boolean;
  iceMakerOn?: boolean;
  status: ApplianceStatusInfo;
}

export function projectFridge(state: FridgeApplianceState | null | undefined): FridgeProjection | null {
  if (!state || state.kind !== 'fridge') return null;
  const online = state.isOnline !== false;
  const zones = (state.zones || []).map((z) => ({
    ...z,
    tone: zoneTone(z.name, z.setpointF),
    tempStr: tempLabel(z.measuredF),
    setStr: tempLabel(z.setpointF),
  }));
  const water = clampFilterPct(state.waterFilterPct);
  const air = clampFilterPct(state.airFilterPct);
  const filterLow = (water !== null && water <= 10) || (air !== null && air <= 10);
  const anyDoorAjar = !!state.anyDoorAjar || zones.some((z) => z.doorAjar);
  const service = !!state.serviceRequired;
  let status: ApplianceStatusInfo;
  if (!online) status = { color: COLOR.dim, label: 'Offline', accent: 'warning', active: false };
  else if (service) status = { color: COLOR.hot, label: 'Service', accent: 'critical', active: false };
  else if (anyDoorAjar) status = { color: COLOR.warm, label: 'Door Open', accent: 'warning', active: true };
  else if (filterLow) status = { color: COLOR.warm, label: 'Filter Low', accent: 'warning', active: false };
  else status = { color: COLOR.ok, label: 'Cooling', accent: 'climate', active: true };
  return {
    online, zones, anyDoorAjar, waterFilterPct: water, airFilterPct: air,
    filterLow, serviceRequired: service, iceMakerOn: state.iceMakerOn, status,
  };
}

// ── Oven ──────────────────────────────────────────────────────────────────

// Preheat progress 0..1 from measured/setpoint (room-temp baseline). Pure so
// the heating ring can be tested. Returns null when either value is absent.
export function preheatFraction(
  measuredF: number | null,
  setpointF: number | null,
  baselineF = 70,
): number | null {
  if (measuredF === null || setpointF === null) return null;
  if (!Number.isFinite(measuredF) || !Number.isFinite(setpointF)) return null;
  if (setpointF <= baselineF) return measuredF >= setpointF ? 1 : 0;
  const frac = (measuredF - baselineF) / (setpointF - baselineF);
  return Math.max(0, Math.min(1, frac));
}

export interface OvenCavityProjection extends OvenCavityState {
  tempStr: string;
  setStr: string;
  probeStr: string;
  modeStr: string;
  preheat: number | null;
  heating: boolean;
  hasProbe: boolean;
}

export interface OvenProjection {
  online: boolean;
  cavities: OvenCavityProjection[];
  anyOn: boolean;
  anyDoorAjar: boolean;
  serviceRequired: boolean;
  /** ALWAYS true — the oven write path is equipment-gated; the tile is read-only. */
  writesGated: true;
  status: ApplianceStatusInfo;
}

export function projectOven(state: OvenApplianceState | null | undefined): OvenProjection | null {
  if (!state || state.kind !== 'oven') return null;
  const online = state.isOnline !== false;
  const cavities: OvenCavityProjection[] = (state.cavities || []).map((c) => {
    const on = !!c.ovenOn || (c.cookMode !== null && c.cookMode !== undefined && c.cookMode !== 'off');
    const preheat = on ? preheatFraction(c.measuredF, c.setpointF) : null;
    const heating = on && !c.preheatComplete && preheat !== null && preheat < 0.985;
    return {
      ...c,
      tempStr: tempLabel(c.measuredF),
      setStr: tempLabel(c.setpointF),
      probeStr: tempLabel(c.probeF),
      modeStr: on ? pretty(c.cookMode) : 'Off',
      preheat,
      heating,
      hasProbe: c.probeF !== null && c.probeF !== undefined,
    };
  });
  const anyOn = cavities.some((c) => !!c.ovenOn || (c.cookMode && c.cookMode !== 'off'));
  const anyDoorAjar = cavities.some((c) => c.doorAjar);
  const service = !!state.serviceRequired;
  let status: ApplianceStatusInfo;
  if (!online) status = { color: COLOR.dim, label: 'Offline', accent: 'warning', active: false };
  else if (service) status = { color: COLOR.hot, label: 'Service', accent: 'critical', active: false };
  else if (anyOn && cavities.some((c) => c.heating)) status = { color: COLOR.warm, label: 'Preheating', accent: 'heat', active: true };
  else if (anyOn) status = { color: COLOR.hot, label: 'On', accent: 'heat', active: true };
  else if (anyDoorAjar) status = { color: COLOR.warm, label: 'Door Open', accent: 'warning', active: false };
  else status = { color: COLOR.ok, label: 'Off', accent: 'positive', active: false };
  return { online, cavities, anyOn, anyDoorAjar, serviceRequired: service, writesGated: true, status };
}

// ── Dishwasher ──────────────────────────────────────────────────────────────

// Normalize a free-text wash status into a coarse run state for the ring color
// and label. Pure mapping over the appliance's reported status/cycle/running.
export type DishRunState = 'idle' | 'running' | 'drying' | 'clean' | 'offline' | 'door';

export function dishRunState(state: DishwasherApplianceState): DishRunState {
  if (state.isOnline === false) return 'offline';
  const s = `${state.washStatus || ''} ${state.washCycle || ''}`.toLowerCase();
  if (state.doorAjar) return 'door';
  if (state.running || /run|wash|active|cycle.?on/.test(s)) {
    if (/dry/.test(s)) return 'drying';
    return 'running';
  }
  if (/clean|complete|finished|done/.test(s)) return 'clean';
  return 'idle';
}

// Progress fraction 0..1. Prefer time-remaining against a nominal cycle length
// when running; a finished/clean cycle reads full; idle reads 0. Pure given the
// nominal length so it is deterministic in tests.
export function washFraction(
  state: DishwasherApplianceState,
  run: DishRunState,
  nominalMin = 90,
): number {
  if (run === 'clean') return 1;
  if (run !== 'running' && run !== 'drying') return 0;
  const rem = state.timeRemainingMin;
  if (rem === null || rem === undefined || !Number.isFinite(rem) || nominalMin <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - rem / nominalMin));
}

export function timeRemainingLabel(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min) || min <= 0) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export interface DishProjection {
  online: boolean;
  run: DishRunState;
  fraction: number;
  statusStr: string;
  cycleStr: string;
  timeStr: string;
  doorAjar: boolean;
  rinseAidLow: boolean;
  status: ApplianceStatusInfo;
}

const DISH_STATUS: Record<DishRunState, ApplianceStatusInfo> = {
  idle: { color: COLOR.ok, label: 'Ready', accent: 'positive', active: false },
  running: { color: COLOR.cool, label: 'Washing', accent: 'climate', active: true },
  drying: { color: COLOR.warm, label: 'Drying', accent: 'heat', active: true },
  clean: { color: COLOR.ok, label: 'Clean', accent: 'positive', active: false },
  door: { color: COLOR.warm, label: 'Door Open', accent: 'warning', active: false },
  offline: { color: COLOR.dim, label: 'Offline', accent: 'warning', active: false },
};

export function projectDishwasher(state: DishwasherApplianceState | null | undefined): DishProjection | null {
  if (!state || state.kind !== 'dishwasher') return null;
  const online = state.isOnline !== false;
  const run = dishRunState(state);
  const fraction = washFraction(state, run);
  return {
    online,
    run,
    fraction,
    statusStr: pretty(state.washStatus),
    cycleStr: pretty(state.washCycle),
    timeStr: timeRemainingLabel(state.timeRemainingMin),
    doorAjar: !!state.doorAjar,
    rinseAidLow: !!state.rinseAidLow,
    status: DISH_STATUS[run],
  };
}

// ── HARD oven-write guard ────────────────────────────────────────────────────
// The single source of truth for the oven control surface: it ALWAYS denies.
// The Wolf oven set-temp / probe / light writes are equipment-gated in the
// integration (default-off + inert + safety-ack) and require Brent + on-hardware
// verification to ever enable. b-panels must not even ATTEMPT a write: this gate
// is unconditional, and there is deliberately NO oven serviceCall builder in this
// module, so no code path can reach a `callService` for an oven write.

export interface OvenControlGateDecision {
  /** Always false — oven writes are equipment-gated; the tile is display-only. */
  allowed: false;
  reason: 'equipment-gated';
  /** Human note rendered on the disabled control. */
  note: string;
}

export const OVEN_GATE_NOTE =
  'Equipment-gated — enable in integration options + hardware-verified';

export function ovenControlGate(): OvenControlGateDecision {
  return { allowed: false, reason: 'equipment-gated', note: OVEN_GATE_NOTE };
}

// Whole-appliance projection switch (for callers that hold an untyped state).
export function projectAppliance(state: ApplianceState | null | undefined) {
  if (!state) return null;
  switch (state.kind) {
    case 'fridge': return { kind: 'fridge' as const, fridge: projectFridge(state) };
    case 'oven': return { kind: 'oven' as const, oven: projectOven(state) };
    case 'dishwasher': return { kind: 'dishwasher' as const, dishwasher: projectDishwasher(state) };
    default: return null;
  }
}
