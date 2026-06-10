// Freeze + Storm protection — pure projection (feat/freeze-storm).
//
// PROTECTIVE · LOWER-TIER · DISPLAY + NOTIFY/LOG ONLY · NO EQUIPMENT ACTUATION.
//
// This module is the brain of the weather-safety surface: a calm, proactive
// announcement tier that sits BELOW the life-safety takeover (Increment 10).
// It is a PURE, side-effect-free projection (exported for unit testing) that
// turns the raw HA entity feed into a `WeatherSafetyView`. It NEVER calls a
// service — there is no callService import here, by construction. Every action
// the surface later renders (extra circulation, retract shades) is a
// RECOMMENDED / confirm-gated affordance that wires ZERO actuation.
//
// ── Tiering vs life-safety (CRITICAL) ──
//   The life-safety takeover (fire / CO / gas / intrusion via
//   alarm_control_panel.house == 'triggered') ALWAYS outranks this. When the
//   panel is triggered, this projection reports `suppressedByLifeSafety = true`
//   and `active = false` — the storm/freeze banner yields and the life-safety
//   overlay owns the screen. We read the SAME alarm entity the takeover does so
//   the precedence is computed from one source of truth, not a UI race.
//
// ── Freeze source (IntelliCenter, LOCKED — ENTITY_CONTRACT Surface 1) ──
//   "freeze protection | binary_sensor | OBJTYPE=CIRCUIT/FRZ | device_class=cold".
//   We bind GENERICALLY: any binary_sensor with device_class 'cold' that is 'on'
//   is freeze-protection-active, OR an explicitly configured entity id. No
//   site-specific entity id is hardcoded — the contract's device_class is the
//   stable interface, and dev provisions a demo binary_sensor of that class.
//
// ── Severe-weather source (by ZIP/location — generic) ──
//   US homes: HA's `nws` integration exposes alert entities. We bind GENERICALLY
//   to any entity (sensor.* or binary_sensor.*) that looks like a weather-alert
//   feed: it is 'active'/'on'/a positive count AND carries severe-weather attrs
//   (event / headline / severity / expires / end), OR an explicitly configured
//   id. The ZIP/location is CONFIG (weatherZipCode in useDashboard) — never
//   hardcoded here. Dev provisions a demo alert entity of this shape.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

// The alarm panel the life-safety takeover keys off (shared source of truth for
// precedence). Matches lifeSafety.ALARM_ENTITY_ID.
export const ALARM_ENTITY_ID = 'alarm_control_panel.house';

const UNAVAILABLE = new Set(['unavailable', 'unknown', '', 'none', '—']);
const isAvail = (e?: HassEntity) =>
  !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

// ── Config the projection accepts (all optional; ZIP/location lives upstream) ──
export interface WeatherSafetyConfig {
  /** Explicit freeze binary_sensor id (else auto-detect by device_class:cold). */
  freezeEntityId?: string;
  /** Explicit severe-weather alert entity id (else auto-detect NWS-shape). */
  alertEntityId?: string;
}

// ── Freeze view ──────────────────────────────────────────────────────────────
export interface FreezeView {
  /** A freeze-protection source exists in the feed (configured or detected). */
  present: boolean;
  /** Freeze protection is ACTIVE (the binary_sensor is 'on'). */
  active: boolean;
  entityId: string | null;
  name: string;
  sinceIso: string | null;
}

// ── Storm view (parsed from a severe-weather alert entity) ───────────────────
export type StormSeverity = 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';

export interface StormView {
  present: boolean;     // an alert source exists
  active: boolean;      // an alert is currently in effect
  entityId: string | null;
  event: string;        // "Winter Storm Warning"
  headline: string;     // full NWS headline
  severity: StormSeverity;
  expiresIso: string | null;
  count: number;        // number of concurrent alerts (NWS reports a count)
}

export type WeatherSafetyKind = 'storm' | 'freeze' | 'storm+freeze';

export interface WeatherSafetyView {
  /** The banner/card should show (an active freeze and/or active storm), AND we
   *  are not being suppressed by a life-safety takeover. */
  active: boolean;
  /** True iff the life-safety takeover owns the screen right now — the
   *  weather-safety tier YIELDS (active forced to false). */
  suppressedByLifeSafety: boolean;
  /** What is active (only meaningful when active === true). */
  kind: WeatherSafetyKind | null;
  freeze: FreezeView;
  storm: StormView;
}

const humanize = (entityId: string, friendly?: string): string => {
  if (friendly && friendly !== entityId) return friendly;
  return (entityId.split('.').pop() || entityId)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const normSeverity = (raw: unknown): StormSeverity => {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('extreme')) return 'extreme';
  if (s.includes('severe')) return 'severe';
  if (s.includes('moderate')) return 'moderate';
  if (s.includes('minor')) return 'minor';
  return 'unknown';
};

// ── Life-safety precedence: is the alarm panel TRIGGERED right now? ──
// We read only the configured panel (falling back to the first
// alarm_control_panel.*), exactly as the life-safety takeover does, so the
// yield decision is computed from the same truth — never a UI timing race.
export const isLifeSafetyActive = (ents: HassEntities): boolean => {
  const e = ents[ALARM_ENTITY_ID]
    ?? ents[Object.keys(ents).find((k) => k.startsWith('alarm_control_panel.')) ?? ''];
  if (!e) return false;
  return String(e.state).toLowerCase() === 'triggered';
};

// ── Freeze detection (device_class:cold is the LOCKED contract interface) ──
export const projectFreeze = (
  ents: HassEntities,
  cfg: WeatherSafetyConfig = {},
): FreezeView => {
  let e: HassEntity | undefined;
  if (cfg.freezeEntityId && ents[cfg.freezeEntityId]) {
    e = ents[cfg.freezeEntityId];
  } else {
    // Auto-detect: a binary_sensor with device_class 'cold' (the freeze-protection
    // contract). Prefer one that is currently 'on'.
    const colds = Object.values(ents).filter(
      (x) => x.entity_id.startsWith('binary_sensor.') &&
        String(x.attributes?.device_class ?? '').toLowerCase() === 'cold',
    );
    e = colds.find((x) => String(x.state).toLowerCase() === 'on') ?? colds[0];
  }
  if (!e) {
    return { present: false, active: false, entityId: null, name: 'Freeze protection', sinceIso: null };
  }
  const active = isAvail(e) && String(e.state).toLowerCase() === 'on';
  return {
    present: true,
    active,
    entityId: e.entity_id,
    name: humanize(e.entity_id, e.attributes?.friendly_name as string | undefined),
    sinceIso: e.last_changed ?? e.last_updated ?? null,
  };
};

// Does this entity look like a severe-weather alert feed? (NWS-shape, generic.)
const looksLikeAlert = (e: HassEntity): boolean => {
  const a = (e.attributes ?? {}) as Record<string, any>;
  return (
    'event' in a || 'headline' in a || 'expires' in a || 'severity' in a ||
    /alert/i.test(e.entity_id) || /alert/i.test(String(a.friendly_name ?? ''))
  );
};

// Is an alert entity currently in effect? NWS `sensor.*_alerts` reports a COUNT
// (state is a number > 0 when active); a binary_sensor reports 'on'.
const alertActive = (e: HassEntity): boolean => {
  if (!isAvail(e)) return false;
  const s = String(e.state).toLowerCase();
  if (s === 'on') return true;
  const n = Number(e.state);
  if (Number.isFinite(n)) return n > 0;
  // Some feeds put the event in state ("Winter Storm Warning") with no count.
  return s !== 'off' && s !== 'no alerts' && s !== '0';
};

// ── Storm detection + parse ──
export const projectStorm = (
  ents: HassEntities,
  cfg: WeatherSafetyConfig = {},
): StormView => {
  let e: HassEntity | undefined;
  if (cfg.alertEntityId && ents[cfg.alertEntityId]) {
    e = ents[cfg.alertEntityId];
  } else {
    const candidates = Object.values(ents).filter(
      (x) => (x.entity_id.startsWith('sensor.') || x.entity_id.startsWith('binary_sensor.')) &&
        looksLikeAlert(x),
    );
    // Prefer an active alert; else the first candidate (so "present, no alert").
    e = candidates.find((x) => alertActive(x)) ?? candidates[0];
  }
  if (!e) {
    return { present: false, active: false, entityId: null, event: '', headline: '', severity: 'unknown', expiresIso: null, count: 0 };
  }
  const a = (e.attributes ?? {}) as Record<string, any>;
  const active = alertActive(e);
  const n = Number(e.state);
  const count = Number.isFinite(n) && n > 0 ? n : active ? 1 : 0;
  // NWS exposes event / headline / severity / expires (or end). Be liberal.
  const event = String(a.event ?? (Number.isFinite(n) ? '' : e.state) ?? '').trim();
  return {
    present: true,
    active,
    entityId: e.entity_id,
    event: event && event.toLowerCase() !== 'unknown' ? event : 'Severe weather alert',
    headline: String(a.headline ?? a.title ?? a.description ?? '').trim(),
    severity: normSeverity(a.severity),
    expiresIso: (a.expires ?? a.end ?? a.ends ?? null) ? String(a.expires ?? a.end ?? a.ends) : null,
    count,
  };
};

// ── Top-level projection ──
export const projectWeatherSafety = (
  ents: HassEntities,
  cfg: WeatherSafetyConfig = {},
): WeatherSafetyView => {
  const freeze = projectFreeze(ents, cfg);
  const storm = projectStorm(ents, cfg);
  const suppressedByLifeSafety = isLifeSafetyActive(ents);

  const anyActive = freeze.active || storm.active;
  // YIELD: a life-safety takeover always outranks the weather-safety tier.
  const active = anyActive && !suppressedByLifeSafety;

  let kind: WeatherSafetyKind | null = null;
  if (freeze.active && storm.active) kind = 'storm+freeze';
  else if (storm.active) kind = 'storm';
  else if (freeze.active) kind = 'freeze';

  return { active, suppressedByLifeSafety, kind, freeze, storm };
};

// ── Display copy / formatting helpers ──
export const SEVERITY_LABEL: Record<StormSeverity, string> = {
  extreme: 'Extreme', severe: 'Severe', moderate: 'Moderate', minor: 'Minor', unknown: 'Advisory',
};

// "Until 7:42 PM" — relative-friendly expiry. '' when missing/invalid.
export const fmtExpires = (iso: string | null, nowMs: number): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const clock = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  const mins = Math.round((t - nowMs) / 60000);
  if (mins <= 0) return `Until ${clock}`;
  if (mins < 60) return `Until ${clock} · ~${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `Until ${clock} · ~${hrs}h ${mins % 60}m`;
};

// "since 7:42 PM" for the freeze line.
export const fmtSince = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};
