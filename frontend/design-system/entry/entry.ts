// Doorbell + Garage entry experience — pure projection + tiering logic
// (feat/doorbell-garage · ECOSYSTEM §E1/E2 · Top-10 #4/#5).
//
// ENTRY EXPERIENCE · DISPLAY + NOTIFY/LOG ONLY · NO EQUIPMENT ACTUATION.
//
// This module is the brain of the homeowner entry pillar. It is a PURE,
// side-effect-free projection (exported for unit testing) that turns the raw HA
// entity feed into two views — the GARAGE roll-up (status + proactive alerts)
// and the DOORBELL RING tier. It NEVER calls a service: there is no callService
// import here, by construction. Every action the surfaces later render — close
// the garage, release the gate/door — is confirm + equipment + security GATED
// and wires ZERO actuation.
//
// ── Tiering (CRITICAL — three-tier precedence) ──
//   life-safety takeover  >  weather-safety  >  DOORBELL RING
//
//   The doorbell ring overlay is a NEW, even-lower tier. It MUST yield to BOTH
//   the life-safety takeover (alarm_control_panel.house == 'triggered') AND the
//   weather-safety tier (an active freeze and/or severe-weather alert). We read
//   the SAME source entities those tiers read — the alarm panel, the freeze
//   binary_sensor[device_class=cold], and the NWS-shape alert sensor — so the
//   yield is computed from one source of truth, never a UI timing race. (The
//   overlay component ALSO subscribes to the global takeover-active signal as a
//   belt-and-suspenders yield; precedence is enforced twice.)
//
// ── Garage source (ratgdo / Matter cover, device_class:garage — Surface 5a) ──
//   Bind GENERICALLY: any `cover.*` with device_class 'garage' (the stable
//   interface ratgdo + Matter garage controllers expose), OR an explicitly
//   configured id. No site-specific entity id is hardcoded — dev provisions a
//   demo cover of that class. Close is confirm-to-close gated (never auto-close,
//   never on a person); the projection only computes the alert/status, the UI
//   owns the confirm flow and fires NOTHING.
//
// ── Doorbell source (UniFi Protect doorbell / Aiphone — Surface 5) ──
//   Bind GENERICALLY: a `binary_sensor`/`event` doorbell entity. A ring is a
//   transient pulse — `binary_sensor` goes 'on', or an `event` entity stamps a
//   fresh `last_changed` with an `event_type` like 'ring'/'press'. We treat a
//   ring as active for a short window after the entity's last_changed so the
//   overlay is transient even though HA holds the last event state.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

// Shared source-of-truth entity ids (match the higher tiers + the security hub).
export const ALARM_ENTITY_ID = 'alarm_control_panel.house';

const UNAVAILABLE = new Set(['unavailable', 'unknown', '', 'none', '—']);
const isAvail = (e?: HassEntity) =>
  !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const humanize = (entityId: string, friendly?: string): string => {
  if (friendly && friendly !== entityId) return friendly;
  return (entityId.split('.').pop() || entityId)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// ── Config (all optional; nothing site-specific is hardcoded) ────────────────
export interface EntryConfig {
  /** Explicit garage cover id(s) (else auto-detect by device_class:garage). */
  garageEntityIds?: string[];
  /** Explicit doorbell entity id (else auto-detect a doorbell binary_sensor/event). */
  doorbellEntityId?: string;
  /** Hour (0–23) after which an open garage is "left open at night". Default 22. */
  nightHour?: number;
  /** How long (ms) a doorbell ring stays "active" after its last_changed. Default 40s. */
  ringWindowMs?: number;
  /** Injected for deterministic testing; defaults to Date.now(). */
  nowMs?: number;
}

const DEFAULT_NIGHT_HOUR = 22;
const DEFAULT_RING_WINDOW_MS = 40_000;

// =============================================================================
// PRECEDENCE — does a higher tier own the screen right now?
// =============================================================================

/** Life-safety: the alarm panel is TRIGGERED (same read as the takeover). */
export const isLifeSafetyActive = (ents: HassEntities): boolean => {
  const e = ents[ALARM_ENTITY_ID]
    ?? ents[Object.keys(ents).find((k) => k.startsWith('alarm_control_panel.')) ?? ''];
  if (!e) return false;
  return String(e.state).toLowerCase() === 'triggered';
};

// Weather-safety precedence — mirror the weather-safety projection's detection
// (a freeze binary_sensor[device_class=cold] 'on', OR an active NWS-shape alert)
// WITHOUT importing that module, so this tier yields from the same truth.
const freezeActive = (ents: HassEntities): boolean =>
  Object.values(ents).some(
    (x) =>
      x.entity_id.startsWith('binary_sensor.') &&
      String(x.attributes?.device_class ?? '').toLowerCase() === 'cold' &&
      String(x.state).toLowerCase() === 'on',
  );

const looksLikeAlert = (e: HassEntity): boolean => {
  const a = (e.attributes ?? {}) as Record<string, unknown>;
  return (
    'event' in a || 'headline' in a || 'expires' in a || 'severity' in a ||
    /alert/i.test(e.entity_id) || /alert/i.test(String(a.friendly_name ?? ''))
  );
};
const alertActive = (e: HassEntity): boolean => {
  if (!isAvail(e)) return false;
  const s = String(e.state).toLowerCase();
  if (s === 'on') return true;
  const n = Number(e.state);
  if (Number.isFinite(n)) return n > 0;
  return s !== 'off' && s !== 'no alerts' && s !== '0';
};
const stormActive = (ents: HassEntities): boolean =>
  Object.values(ents).some(
    (x) =>
      (x.entity_id.startsWith('sensor.') || x.entity_id.startsWith('binary_sensor.')) &&
      looksLikeAlert(x) &&
      alertActive(x),
  );

/** Weather-safety active (freeze and/or storm) — the middle tier. */
export const isWeatherSafetyActive = (ents: HassEntities): boolean =>
  freezeActive(ents) || stormActive(ents);

// =============================================================================
// GARAGE — status + proactive alerts (display + notify/log only)
// =============================================================================

export type GarageDoorState = 'open' | 'closed' | 'opening' | 'closing' | 'unavailable';

export interface GarageDoorView {
  id: string;
  name: string;
  available: boolean;
  state: GarageDoorState;
  stateLabel: string;      // 'Open' | 'Closed' | 'Opening…' | 'Closing…' | 'Unavailable'
  open: boolean;           // open OR moving-from-closed → attention tint
  sinceIso: string | null; // last_changed — drives "open for ~Nm"
}

export type GarageAlertKind = 'open-at-night' | 'open-armed-away';

export interface GarageAlert {
  kind: GarageAlertKind;
  doorId: string;
  doorName: string;
  /** calm, homeowner-readable line */
  text: string;
}

export interface GarageView {
  present: boolean;          // a garage cover exists in the feed
  doors: GarageDoorView[];
  openCount: number;
  /** any door open OR moving */
  anyOpen: boolean;
  /** the arm state (display-only context for the armed-away alert) */
  armState: string;
  alerts: GarageAlert[];
  /** one-line summary for the Home glance */
  summary: string;
}

const garageStateLabel = (s: GarageDoorState): string =>
  s === 'open' ? 'Open'
  : s === 'closed' ? 'Closed'
  : s === 'opening' ? 'Opening…'
  : s === 'closing' ? 'Closing…'
  : 'Unavailable';

const normGarageState = (raw: string): GarageDoorState => {
  const s = raw.toLowerCase();
  if (s === 'open') return 'open';
  if (s === 'closed') return 'closed';
  if (s === 'opening') return 'opening';
  if (s === 'closing') return 'closing';
  return 'unavailable';
};

// "~12m" / "~2h 5m" since an ISO timestamp.
export const fmtOpenFor = (iso: string | null, nowMs: number): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `~${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `~${hrs}h ${mins % 60}m`;
};

export const projectGarage = (ents: HassEntities, cfg: EntryConfig = {}): GarageView => {
  const nowMs = cfg.nowMs ?? Date.now();
  const nightHour = cfg.nightHour ?? DEFAULT_NIGHT_HOUR;

  // Resolve the garage cover(s): explicit ids, else any cover[device_class=garage].
  let covers: HassEntity[];
  if (cfg.garageEntityIds && cfg.garageEntityIds.length) {
    covers = cfg.garageEntityIds.map((id) => ents[id]).filter(Boolean) as HassEntity[];
  } else {
    covers = Object.values(ents).filter(
      (x) =>
        x.entity_id.startsWith('cover.') &&
        String(x.attributes?.device_class ?? '').toLowerCase() === 'garage',
    );
  }

  const doors: GarageDoorView[] = covers.map((e) => {
    const available = isAvail(e);
    const state = available ? normGarageState(String(e.state)) : 'unavailable';
    const open = state === 'open' || state === 'opening' || state === 'closing';
    return {
      id: e.entity_id,
      name: humanize(e.entity_id, e.attributes?.friendly_name as string | undefined),
      available,
      state,
      stateLabel: garageStateLabel(state),
      open,
      sinceIso: e.last_changed ?? e.last_updated ?? null,
    };
  });

  // Arm state context (for the armed-away alert) — same real Alarmo panel.
  const alarmE = ents[ALARM_ENTITY_ID];
  const armState = alarmE ? String(alarmE.state).toLowerCase() : 'unavailable';

  // ── Proactive alert logic ──────────────────────────────────────────────────
  // Calm, prioritized, NOTIFY/LOG only. NEVER auto-closes.
  //  • open-at-night  : a door is OPEN and local time is at/after the night hour.
  //  • open-armed-away: a door is OPEN while the alarm is armed_away.
  const isNight = new Date(nowMs).getHours() >= nightHour;
  const alerts: GarageAlert[] = [];
  for (const d of doors) {
    if (d.state !== 'open') continue; // alert only on fully OPEN (not transient move)
    if (armState === 'armed_away') {
      alerts.push({
        kind: 'open-armed-away',
        doorId: d.id,
        doorName: d.name,
        text: `${d.name} is open while Armed Away`,
      });
    } else if (isNight) {
      alerts.push({
        kind: 'open-at-night',
        doorId: d.id,
        doorName: d.name,
        text: `${d.name} left open after ${nightHour % 12 || 12}${nightHour >= 12 ? 'pm' : 'am'}`,
      });
    }
  }

  const openCount = doors.filter((d) => d.state === 'open').length;
  const anyOpen = doors.some((d) => d.open);
  const present = doors.length > 0;

  const summary = !present
    ? 'No garage door connected'
    : openCount > 0
      ? `${openCount} open${alerts.length ? ' · alert' : ''}`
      : anyOpen
        ? 'Moving…'
        : doors.length === 1
          ? 'Closed'
          : 'All closed';

  return { present, doors, openCount, anyOpen, armState, alerts, summary };
};

// =============================================================================
// DOORBELL RING — the lowest tier (yields to life-safety AND weather-safety)
// =============================================================================

export interface DoorbellRingView {
  /** A doorbell source exists in the feed (configured or detected). */
  present: boolean;
  /** The doorbell is ringing AND no higher tier owns the screen → show overlay. */
  active: boolean;
  /** The raw ring is happening (independent of precedence) — for tests/debug. */
  ringing: boolean;
  /** True iff a life-safety takeover is on screen — ring YIELDS. */
  suppressedByLifeSafety: boolean;
  /** True iff the weather-safety tier is active — ring YIELDS. */
  suppressedByWeatherSafety: boolean;
  doorbellId: string | null;
  doorbellName: string;
  /** The camera entity associated with the doorbell (poster/honest-absent). */
  cameraId: string | null;
  /** A stream is genuinely available (UniFi not in dev → false → honest poster). */
  cameraHasStream: boolean;
  ringIso: string | null;  // last_changed of the ring
}

// Does this entity look like a doorbell? (UniFi Protect / Aiphone shape, generic.)
const looksLikeDoorbell = (e: HassEntity): boolean => {
  const isBs = e.entity_id.startsWith('binary_sensor.');
  const isEvent = e.entity_id.startsWith('event.');
  if (!isBs && !isEvent) return false;
  const dc = String(e.attributes?.device_class ?? '').toLowerCase();
  return (
    /doorbell/i.test(e.entity_id) ||
    /doorbell/i.test(String(e.attributes?.friendly_name ?? '')) ||
    dc === 'doorbell'
  );
};

// Is the doorbell ringing within the transient window? A binary_sensor reads
// 'on'; an `event` entity stamps last_changed each press (with event_type). In
// both cases we keep the overlay up only for `ringWindowMs` after last_changed,
// so it is genuinely transient even though HA holds the last state.
const ringIsFresh = (e: HassEntity, nowMs: number, windowMs: number): boolean => {
  const iso = e.last_changed ?? e.last_updated ?? null;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t <= windowMs && nowMs - t >= 0;
};

export const projectDoorbellRing = (
  ents: HassEntities,
  cfg: EntryConfig = {},
): DoorbellRingView => {
  const nowMs = cfg.nowMs ?? Date.now();
  const windowMs = cfg.ringWindowMs ?? DEFAULT_RING_WINDOW_MS;

  let e: HassEntity | undefined;
  if (cfg.doorbellEntityId && ents[cfg.doorbellEntityId]) {
    e = ents[cfg.doorbellEntityId];
  } else {
    e = Object.values(ents).find(looksLikeDoorbell);
  }

  const suppressedByLifeSafety = isLifeSafetyActive(ents);
  const suppressedByWeatherSafety = isWeatherSafetyActive(ents);

  if (!e) {
    return {
      present: false, active: false, ringing: false,
      suppressedByLifeSafety, suppressedByWeatherSafety,
      doorbellId: null, doorbellName: 'Front Door', cameraId: null,
      cameraHasStream: false, ringIso: null,
    };
  }

  const isBs = e.entity_id.startsWith('binary_sensor.');
  const isEvent = e.entity_id.startsWith('event.');
  const ringIso = e.last_changed ?? e.last_updated ?? null;

  // A binary_sensor rings while 'on' AND fresh; an event rings when its
  // last_changed is fresh (any non-unknown state, since the press stamps it).
  let ringing = false;
  if (isBs) {
    ringing = String(e.state).toLowerCase() === 'on' && ringIsFresh(e, nowMs, windowMs);
  } else if (isEvent) {
    ringing = isAvail(e) && ringIsFresh(e, nowMs, windowMs);
  }

  // Associated camera: explicit config aside, infer a sibling camera.* by name.
  const cameraId =
    Object.keys(ents).find((k) => k.startsWith('camera.') && /front|door|bell|entry/i.test(k))
    ?? null;
  const cameraHasStream = cameraId ? isAvail(ents[cameraId]) : false;

  const active = ringing && !suppressedByLifeSafety && !suppressedByWeatherSafety;

  return {
    present: true,
    active,
    ringing,
    suppressedByLifeSafety,
    suppressedByWeatherSafety,
    doorbellId: e.entity_id,
    doorbellName: humanize(e.entity_id, e.attributes?.friendly_name as string | undefined)
      .replace(/\s*Doorbell\s*/i, '').trim() || 'Front Door',
    cameraId,
    cameraHasStream,
    ringIso,
  };
};

// "7:42 PM" clock for the ring timestamp.
export const fmtRingClock = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};

// Re-export num for any consumer that needs it (kept internal otherwise).
export const __num = num;
