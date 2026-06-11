// Life-Safety Takeover — pure projection + type-branch logic (Increment 10).
//
// SAFETY-CRITICAL · GATED · DISPLAY + ANNUNCIATION ONLY.
//
// This module is the brain of the global, scope-overriding alarm takeover. It is
// a PURE, side-effect-free projection (exported for unit testing) that turns the
// raw HA entity feed into a `TakeoverView`. It NEVER calls a service — there is
// no callService import here, by construction. Every "control" the takeover later
// renders (disarm, silence, cancel) wires ZERO actuation.
//
// ── Wiring (CONFIRMED in HA_WIRING_REVIEW.md / FIRE_LIFE_SAFETY_REVIEW.md) ──
//   • The takeover triggers off `alarm_control_panel.house` state == 'triggered'.
//   • The triggering sensor(s) come from the panel's `open_sensors` STATE
//     ATTRIBUTE (entity_id → state). There is NO `alarmo_triggered` bus event —
//     we read the attribute live via subscribe_entities.
//   • Branch type from each triggering sensor's `device_class`:
//        smoke / heat                 → FIRE
//        carbon_monoxide / co         → CO
//        gas                          → GAS
//        door / window / opening /
//        motion / garage_door /
//        moving / presence            → INTRUSION
//        (device_class absent)        → EVACUATE fallback (treat as life-safety;
//                                       never silently downgrade an unknown trip)
//   • Tier 1 (fire/CO/gas/evacuate) outranks Tier 2 (intrusion): if ANY active
//     sensor is life-safety, the whole takeover is life-safety (a fire during an
//     intrusion is still a fire).
//
// ── Signal-lost / three-state freshness (FIRE_LIFE_SAFETY_REVIEW §0.3) ──
//   A frozen/disconnected panel must NEVER read "all clear". The hook reports
//   freshness ∈ { 'known-good' | 'stale' | 'signal-lost' } from the WS
//   connection liveness + the alarm entity's availability/age. 'signal-lost'
//   raises a status-UNKNOWN banner/takeover; it is explicitly NOT "all clear".

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

// The configured alarm panel id (matches the rest of the app — see
// useSecurityEntities.SECURITY_ENTITIES.alarm). If a differently-named panel is
// present we fall back to the first alarm_control_panel.* entity.
export const ALARM_ENTITY_ID = 'alarm_control_panel.house';

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

// ── Branch types ────────────────────────────────────────────────────────────
export type TakeoverType = 'fire' | 'co' | 'gas' | 'evacuate' | 'intrusion';
export type TakeoverTier = 1 | 2; // 1 = life-safety, 2 = security/intrusion
// Freshness states:
//   known-good   — connected + a fresh, available alarm state.
//   stale        — connected but no fresh push within the window.
//   signal-lost  — the alarm entity is KNOWN to this deployment (seen at least
//                  once, or expected per config) but we cannot currently trust it:
//                  WS disconnected, entity dropped from the feed, or unavailable.
//                  THIS IS THE REAL SAFETY CASE — it must keep firing.
//   no-alarm     — no alarm entity exists in this deployment at all (never seen,
//                  not expected per config). NOT a safety case: a bare demo/admin
//                  panel with no alarm wiring. Renders quiet (no takeover banner).
export type Freshness = 'known-good' | 'stale' | 'signal-lost' | 'no-alarm';

// device_class → branch. Anything life-safety is Tier 1; door/window/motion is
// Tier 2 intrusion; unknown is the EVACUATE fallback (still Tier 1 — we never
// downgrade an unexplained trip to a calm intrusion screen).
const FIRE_CLASSES = new Set(['smoke', 'heat']);
const CO_CLASSES = new Set(['carbon_monoxide', 'co']);
const GAS_CLASSES = new Set(['gas']);
const INTRUSION_CLASSES = new Set([
  'door', 'window', 'opening', 'garage_door', 'motion', 'moving', 'presence', 'occupancy', 'tamper',
]);

export const branchFromDeviceClass = (deviceClass: string | null | undefined): TakeoverType => {
  const dc = String(deviceClass ?? '').toLowerCase();
  if (FIRE_CLASSES.has(dc)) return 'fire';
  if (CO_CLASSES.has(dc)) return 'co';
  if (GAS_CLASSES.has(dc)) return 'gas';
  if (INTRUSION_CLASSES.has(dc)) return 'intrusion';
  // device_class absent / unrecognized → evacuate fallback (Tier 1). Per the
  // review: a triggered panel with no type info must NOT read as a calm
  // intrusion; treat as life-safety and tell the homeowner to get out.
  return 'evacuate';
};

const TYPE_RANK: Record<TakeoverType, number> = {
  // higher = wins. Life-safety always outranks intrusion.
  gas: 5, co: 4, fire: 3, evacuate: 2, intrusion: 1,
};

export const tierOf = (t: TakeoverType): TakeoverTier => (t === 'intrusion' ? 2 : 1);

// ── A single triggering sensor, enriched with its device_class branch ────────
export interface TriggerSensor {
  entityId: string;
  name: string;           // human label
  type: TakeoverType;     // branch from this sensor's device_class
  deviceClass: string | null;
}

// Humanize an entity_id → "Front Door" when no friendly_name is available.
const humanize = (entityId: string, friendly?: string): string => {
  if (friendly && friendly !== entityId) return friendly;
  return (entityId.split('.').pop() || entityId)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

export interface TakeoverView {
  // Is the global takeover ACTIVE (panel triggered + we trust the feed)?
  active: boolean;
  // The resolved, highest-tier type to render.
  type: TakeoverType;
  tier: TakeoverTier;
  // All triggering sensors (multiplicity — "2 — Garage, Kitchen · SPREADING").
  sensors: TriggerSensor[];
  // Sensors that match the winning type (for the "zones active" multiplicity).
  matchingSensors: TriggerSensor[];
  initiatingZone: string | null;   // first matching sensor's name
  source: string;                  // provenance ("Alarmo", etc.)
  triggeredAtIso: string | null;   // entity last_changed (when it went triggered)
  armModeAtTrip: string | null;    // for intrusion: armed mode when it tripped
  entryDelayTotal: number | null;  // intrusion entry-delay seconds (countdown)
  entryDelayStartedIso: string | null;
  // Three-state freshness.
  freshness: Freshness;
  lastKnownIso: string | null;     // last time we had a confident state
  lastKnownLabel: string | null;   // e.g. "Disarmed · Ready"
}

const STILL_BLANK: TakeoverView = {
  active: false,
  type: 'evacuate',
  tier: 1,
  sensors: [],
  matchingSensors: [],
  initiatingZone: null,
  source: 'Alarmo',
  triggeredAtIso: null,
  armModeAtTrip: null,
  entryDelayTotal: null,
  entryDelayStartedIso: null,
  freshness: 'known-good',
  lastKnownIso: null,
  lastKnownLabel: null,
};

// Resolve the alarm panel entity from the feed (configured id, else first one).
export const findAlarmEntity = (ents: HassEntities): HassEntity | undefined => {
  if (ents[ALARM_ENTITY_ID]) return ents[ALARM_ENTITY_ID];
  const id = Object.keys(ents).find((k) => k.startsWith('alarm_control_panel.'));
  return id ? ents[id] : undefined;
};

const labelForArmState = (state: string): string => {
  switch (state) {
    case 'disarmed': return 'Disarmed';
    case 'armed_home': return 'Armed · Home';
    case 'armed_away': return 'Armed · Away';
    case 'armed_night': return 'Armed · Night';
    case 'armed_vacation': return 'Armed · Vacation';
    case 'arming': return 'Arming';
    case 'pending': return 'Entry delay';
    case 'triggered': return 'Triggered';
    default: return state;
  }
};

/**
 * PURE projection. Given the live entity feed + connection liveness, compute the
 * takeover view. No service calls, no side effects — exported for unit testing.
 *
 * @param ents          the HA entity map (from subscribe_entities)
 * @param connected     is the WS connection live right now?
 * @param lastSeenMs    epoch ms of the last fresh entity push (for staleness)
 * @param nowMs         current epoch ms (injectable for deterministic tests)
 * @param staleAfterMs  age beyond which a still-connected feed reads 'stale'
 * @param alarmExpected has an alarm entity EVER been seen in this deployment (or
 *                      is one declared/expected per config)? This is the pivot
 *                      that separates the REAL safety case (a known alarm whose
 *                      feed dropped → signal-lost) from a bare panel that simply
 *                      has no alarm wiring at all (never seen → no-alarm, quiet).
 *                      CRITICAL: "absent" and "dropped" must NOT collapse — an
 *                      alarm that was present and then disappears stays signal-lost.
 */
export const projectTakeover = (
  ents: HassEntities,
  connected: boolean,
  lastSeenMs: number | null,
  nowMs: number,
  staleAfterMs = 45000,
  alarmExpected = false,
): TakeoverView => {
  const e = findAlarmEntity(ents);

  // ── Freshness: signal-lost > no-alarm > stale > known-good ──
  // We split the "no fresh, available alarm state" condition into two distinct
  // outcomes so a bare demo/admin panel (no alarm at all) does NOT raise the
  // life-safety "don't trust this panel" takeover, while a KNOWN alarm whose feed
  // dropped STILL does (the real safety case — never weaken it).
  let freshness: Freshness = 'known-good';
  const entAvailable = !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());
  // "Is there an alarm in this deployment at all?" — true if one is in the feed
  // now (even unavailable: its presence proves wiring) OR was seen/declared before.
  const alarmKnown = !!e || alarmExpected;

  if (alarmKnown) {
    // A KNOWN alarm. This is the safety domain — any loss of trust is signal-lost,
    // never quiet. (a) socket down, (b) entity dropped out of the feed, or (c)
    // present but unavailable/unknown all read signal-lost. Only a fresh, available
    // state is known-good (and a connected-but-old feed is stale). Absent != quiet
    // here: an alarm that WAS present and then disappears stays signal-lost.
    if (!connected || !e || !entAvailable) {
      freshness = 'signal-lost';
    } else if (lastSeenMs != null && nowMs - lastSeenMs > staleAfterMs) {
      freshness = 'stale';
    }
  } else {
    // NO alarm in this deployment — never seen, not expected. This is NOT a
    // safety case (bare demo/admin panel). Stay quiet regardless of connection;
    // there is no alarm signal to have "lost".
    freshness = 'no-alarm';
  }

  const lastKnownIso = e?.last_changed ?? e?.last_updated ?? null;
  const lastKnownLabel = e && entAvailable ? labelForArmState(String(e.state).toLowerCase()) : null;

  // no-alarm: there is no alarm in this deployment — quiet, no takeover, no
  // banner. The consumer renders nothing (or a subtle "no alarm configured" note).
  if (freshness === 'no-alarm') {
    return { ...STILL_BLANK, freshness, lastKnownIso: null, lastKnownLabel: null };
  }

  // Signal-lost: a takeover-tier UNKNOWN state — NOT "all clear". active stays
  // false (no triggered panel we can trust), but the consumer raises the
  // signal-lost banner from `freshness`. THIS IS THE REAL SAFETY CASE.
  if (freshness === 'signal-lost') {
    return { ...STILL_BLANK, freshness, lastKnownIso, lastKnownLabel };
  }

  const state = String(e!.state).toLowerCase();
  const attrs = (e!.attributes ?? {}) as Record<string, any>;

  // Only a TRIGGERED panel raises the takeover. (arming/pending/disarmed do not.)
  if (state !== 'triggered') {
    return { ...STILL_BLANK, freshness, lastKnownIso, lastKnownLabel };
  }

  // ── Triggering sensors from the open_sensors ATTRIBUTE (entity_id → state) ──
  const openSensors: Record<string, unknown> =
    attrs.open_sensors && typeof attrs.open_sensors === 'object' ? attrs.open_sensors : {};
  const ids = Object.keys(openSensors);

  const sensors: TriggerSensor[] = ids.map((eid) => {
    const se = ents[eid];
    const dc = (se?.attributes?.device_class as string | undefined) ?? null;
    const friendly = se?.attributes?.friendly_name as string | undefined;
    return {
      entityId: eid,
      name: humanize(eid, friendly),
      type: branchFromDeviceClass(dc),
      deviceClass: dc,
    };
  });

  // Resolve the WINNING type: highest-ranked across all triggering sensors. If
  // there are no listed sensors at all, fall back to EVACUATE (a triggered panel
  // with no zone info is treated as life-safety, never silently "intrusion").
  let type: TakeoverType = 'evacuate';
  if (sensors.length > 0) {
    type = sensors.reduce<TakeoverType>((best, s) =>
      TYPE_RANK[s.type] > TYPE_RANK[best] ? s.type : best, 'intrusion');
  }
  const tier = tierOf(type);

  const matchingSensors = sensors.filter((s) => s.type === type);
  const initiatingZone = (matchingSensors[0] ?? sensors[0])?.name ?? null;

  // Intrusion context: armed mode at trip + entry-delay (correct countdown here).
  const armModeAtTrip = attrs.arm_mode ? labelForArmState(String(attrs.arm_mode).toLowerCase()) : null;
  const entryDelayTotal = typeof attrs.delay === 'number' ? attrs.delay : null;

  return {
    active: true,
    type,
    tier,
    sensors,
    matchingSensors,
    initiatingZone,
    source: 'Alarmo',
    triggeredAtIso: e!.last_changed ?? null,
    armModeAtTrip,
    entryDelayTotal,
    entryDelayStartedIso: e!.last_changed ?? null,
    freshness,
    lastKnownIso,
    lastKnownLabel,
  };
};

// ── Display copy per type (faithful to the v1.2.1 exemplars) ─────────────────
export interface TypeCopy {
  word: string;            // big Cormorant headline ("Fire / Smoke")
  kicker: string;          // "Alarm Triggered · Life-Safety · Tier 1"
  instructionMain: string; // "EVACUATE NOW · CALL 911"
  instructionSub: string;
  reassureSub: string;     // dispatch reassurance body (life-safety only)
  dispatchLine: string;    // "Noonlight notified · Fire"
  confirmAffirm: string;   // "I confirm there is NO fire."
}

export const COPY: Record<TakeoverType, TypeCopy> = {
  fire: {
    word: 'Fire / Smoke',
    kicker: 'Alarm Triggered · Life-Safety · Tier 1',
    instructionMain: 'EVACUATE NOW · CALL 911',
    instructionSub:
      'Get everyone out. Do not stop to silence alarms or collect belongings. Call 911 from outside.',
    reassureSub:
      'Leave now. Fire services have been requested — they are coming. You do not need to do anything else here.',
    dispatchLine: 'Noonlight notified · Fire',
    confirmAffirm: 'I confirm there is NO fire.',
  },
  co: {
    word: 'Carbon Monoxide',
    kicker: 'Alarm Triggered · Life-Safety · Tier 1',
    instructionMain: 'GET TO FRESH AIR · CALL 911',
    instructionSub:
      'Get everyone outside to fresh air now. Account for everyone. CO is invisible and odorless — do not stop to silence the alarm.',
    reassureSub:
      'Get to fresh air now. Emergency services have been requested — they are coming. You do not need to do anything else here.',
    dispatchLine: 'Noonlight notified · Fire/Medical',
    confirmAffirm: 'I confirm there is NO CO.',
  },
  gas: {
    word: 'Gas Detected',
    kicker: 'Alarm Triggered · Life-Safety · Tier 1',
    instructionMain: 'LEAVE NOW · CALL 911 FROM OUTSIDE',
    instructionSub:
      'Do not use switches, phones, or any control inside (ignition risk). Leave the building and call 911 from outside.',
    reassureSub:
      'Leave now. Emergency services have been requested — they are coming. Do not operate anything in the house.',
    dispatchLine: 'Noonlight notified · Fire',
    confirmAffirm: 'I confirm there is NO gas leak.',
  },
  evacuate: {
    word: 'Alarm Triggered',
    kicker: 'Alarm Triggered · Life-Safety · Tier 1',
    instructionMain: 'EVACUATE NOW · CALL 911',
    instructionSub:
      'The alarm is triggered and the cause is not classified. Treat as life-safety — get everyone out and call 911 from outside.',
    reassureSub:
      'Leave now. Emergency services have been requested — they are coming. You do not need to do anything else here.',
    dispatchLine: 'Noonlight notified',
    confirmAffirm: 'I confirm there is NO emergency.',
  },
  intrusion: {
    word: 'Intrusion',
    kicker: 'Alarm Triggered · Security · Tier 2',
    instructionMain: 'Assess — disarm if this is you, otherwise treat as a break-in.',
    instructionSub:
      'Entry delay running. Enter your PIN to disarm, or stay clear and let monitoring proceed.',
    reassureSub: '',
    dispatchLine: 'Noonlight notified · Police',
    confirmAffirm: 'I confirm this is a false alarm.',
  },
};

// Format an ISO timestamp → "7:42 PM". Returns '' if missing/invalid.
export const fmtClock = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};

// Relative age → "40s ago" / "3m 12s ago". Returns '' if missing/invalid.
export const fmtRelative = (iso: string | null, nowMs: number): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, Math.round((nowMs - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s ago`;
};
