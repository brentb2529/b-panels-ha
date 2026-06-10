// ---------------------------------------------------------------------------
// rachioLogic — PURE projection for the liquid-glass Rachio irrigation surface.
//
// No React, no DOM, no live-store coupling: every value the surface paints is
// derived here from a plain map of HA entity states (`{ [entity_id]: { state,
// attributes } }`), so the whole projection — zone discovery, zone→location
// grouping, running/idle + remaining-time, soil-moisture, scene listing,
// rain-delay/standby + rain-sensor/forecast, and the actuation confirm-gate —
// is unit-testable in isolation.
//
// MAPS THE `rachio_pro` ENTITY MODEL (FINDINGS.md §5):
//   • zone switch        — `switch.*`, attr `location` (homeowner label) +
//                          `zone_number`; `is_on` = running (scheduleId/running).
//   • soil moisture      — `sensor.*`, device_class=moisture, % (per-zone).
//   • last watered       — `sensor.*`, device_class=timestamp (per-zone).
//   • standby switch     — controller `switch.*` (entity_category config).
//   • rain-delay switch  — controller `switch.*` (entity_category config).
//   • rain sensor        — `binary_sensor.*`, device_class=moisture.
//   • online             — `binary_sensor.*`, device_class=connectivity.
//   • forecast           — rain-probability / temperature / humidity sensors.
//   • sprinkler scenes   — NOT entities; run via the `rachio_pro.run_scene`
//                          service by NAME. Discovered from tile config / a
//                          demo `scene.*`/`script.*` carrying an irrigation tag.
//
// SAFETY (FINDINGS.md §7): every zone-run / scene-run / rain-delay / standby
// actuates a real valve = water. The integration does NOT gate; confirm-gating
// lives HERE in b-panels. `actuationGate()` is the single source of truth that
// no actuating control may EVER fire on a bare tap — it must pass a confirm /
// press-and-hold. This is the low-hazard appliance confirm (like Whisker), NOT
// the hard pool/HVAC/AKVO equipment-gate.
// ---------------------------------------------------------------------------

// A minimal HA entity shape (only the fields the projection reads). Matches the
// `HassEntity` from home-assistant-js-websocket structurally but is declared
// locally so the pure module has no live-store dependency.
export interface RawEntity {
  entity_id?: string;
  state: string;
  attributes?: Record<string, any>;
}

export type EntityMap = Record<string, RawEntity>;

const UNAVAILABLE = new Set(['unavailable', 'unknown', 'none', '']);
export const isAvail = (e?: RawEntity): boolean =>
  !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

export const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const clampPct = (n: number | null | undefined): number | null => {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)));
};

const domainOf = (id: string): string => (id.split('.')[0] || '').toLowerCase();
const titleCase = (s: string): string =>
  s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

// ── Identifying Rachio entities WITHOUT site hardcoding ─────────────────────
// The surface discovers its members from the live store. A zone switch is a
// `switch.*` that carries a `zone_number` attribute (the rachio_pro zone marker)
// — this is integration-shape, not a site id. Callers may also pass an explicit
// `entityPrefix` (e.g. the anchor zone's id stem) to scope discovery to one
// controller when several Rachio installs coexist; absent => all zones.

export const isZoneSwitch = (id: string, e: RawEntity): boolean => {
  if (domainOf(id) !== 'switch') return false;
  const a = e.attributes || {};
  // The rachio_pro zone switch always exposes `zone_number`; `location` is
  // optional (only when the homeowner labeled it). Either marker qualifies it
  // as a zone (vs the controller standby/rain-delay switches, which carry
  // neither). We exclude the controller config switches by their absence of
  // `zone_number`.
  return a.zone_number !== undefined && a.zone_number !== null;
};

export interface ZoneView {
  entityId: string;
  name: string;
  location: string | null; // homeowner label; null => grouped under "Unzoned"
  zoneNumber: number | null;
  available: boolean;
  running: boolean;
  /** Remaining seconds while running, when the integration reports it. */
  remainingSec: number | null;
  /** Soil-moisture % from the paired moisture sensor, when present. */
  moisturePct: number | null;
  /** ISO timestamp of the last watering, when present. */
  lastWatered: string | null;
}

// Pair a zone switch to its sibling moisture / last-watered sensors. The
// rachio_pro unique-id scheme is `<zoneId>-zone` for the switch and
// `<zoneId>-moisture` / `<zoneId>-last_watered` for the sensors, which surface
// as entity ids sharing the zone's slug stem. We match a sensor to a zone by
// its entity-id stem (the switch id minus the `switch.` domain), then by
// device_class as the disambiguator.
const stemOf = (entityId: string): string => entityId.replace(/^[a-z_]+\./, '');

const findSensorForZone = (
  ents: EntityMap,
  zoneStem: string,
  deviceClass: string,
): RawEntity | undefined => {
  for (const [id, e] of Object.entries(ents)) {
    if (domainOf(id) !== 'sensor') continue;
    if ((e.attributes?.device_class || '') !== deviceClass) continue;
    const s = stemOf(id);
    if (s === zoneStem || s.startsWith(zoneStem + '_') || s.startsWith(zoneStem + '-')) return e;
  }
  return undefined;
};

export const projectZone = (ents: EntityMap, id: string, e: RawEntity): ZoneView => {
  const a = e.attributes || {};
  const stem = stemOf(id);
  const moistureE = findSensorForZone(ents, stem, 'moisture');
  const lastE = findSensorForZone(ents, stem, 'timestamp');
  const available = isAvail(e);
  const running = available && String(e.state).toLowerCase() === 'on';
  // Remaining time: rachio exposes seconds remaining on the running zone via a
  // `remaining_seconds` / `duration` attr in some firmwares; read defensively.
  const remaining =
    num(a.remaining_seconds) ?? num(a.remaining) ?? num(a.duration_remaining);
  const loc = a.location;
  return {
    entityId: id,
    name: (a.friendly_name && String(a.friendly_name)) || titleCase(stem),
    location: loc !== undefined && loc !== null && String(loc).trim() !== '' ? String(loc) : null,
    zoneNumber: num(a.zone_number),
    available,
    running,
    remainingSec: running ? remaining : null,
    moisturePct: moistureE && isAvail(moistureE) ? clampPct(num(moistureE.state)) : null,
    lastWatered: lastE && isAvail(lastE) ? String(lastE.state) : null,
  };
};

export interface LocationGroup {
  /** Display label for the group (homeowner location, or "Unzoned"). */
  location: string;
  /** True when no homeowner location was assigned to these zones. */
  unzoned: boolean;
  zones: ZoneView[];
}

// Group zones by their homeowner `location` label. Zones without a label fall
// into a single trailing "Unzoned" group. Locations are alpha-sorted; zones
// within a location are sorted by zone number then name. Pure + deterministic.
export const UNZONED_LABEL = 'Other zones';

export const groupZonesByLocation = (zones: ZoneView[]): LocationGroup[] => {
  const byLoc = new Map<string, ZoneView[]>();
  for (const z of zones) {
    const key = z.location ?? UNZONED_LABEL;
    if (!byLoc.has(key)) byLoc.set(key, []);
    byLoc.get(key)!.push(z);
  }
  const sortZones = (a: ZoneView, b: ZoneView) => {
    const an = a.zoneNumber ?? 9999;
    const bn = b.zoneNumber ?? 9999;
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name);
  };
  const named = [...byLoc.keys()].filter((k) => k !== UNZONED_LABEL).sort((a, b) => a.localeCompare(b));
  const order = byLoc.has(UNZONED_LABEL) ? [...named, UNZONED_LABEL] : named;
  return order.map((loc) => ({
    location: loc,
    unzoned: loc === UNZONED_LABEL,
    zones: byLoc.get(loc)!.slice().sort(sortZones),
  }));
};

// ── Controller-level reads (standby, rain-delay, rain sensor, forecast) ─────

export interface ControllerView {
  online: boolean | null; // null => no connectivity sensor present
  standby: boolean; // standby (sleep) active — NOT watering
  standbyEntity: string | null;
  rainDelay: boolean; // a rain delay is active
  rainDelayEntity: string | null;
  rainDelayUntil: string | null; // expiry ISO, when exposed
  rainSensorWet: boolean | null; // rain sensor tripped; null => no sensor
  rainProbability: number | null; // %
  forecastTemp: number | null;
  forecastTempUnit: string;
  forecastHumidity: number | null;
  weatherSkip: boolean; // rain sensor wet OR high rain probability → likely skip
}

// Controller switches are the `switch.*` entities that DON'T carry zone_number.
// We disambiguate standby vs rain-delay by entity-id stem keyword (the
// rachio_pro translation keys `standby` / `rain_delay` produce stable slugs).
const findControllerSwitch = (ents: EntityMap, keyword: RegExp): RawEntity & { __id: string } | null => {
  for (const [id, e] of Object.entries(ents)) {
    if (domainOf(id) !== 'switch') continue;
    if (isZoneSwitch(id, e)) continue;
    if (keyword.test(stemOf(id))) return { ...e, __id: id };
  }
  return null;
};

const findBinary = (ents: EntityMap, deviceClass: string): RawEntity | undefined => {
  for (const [id, e] of Object.entries(ents)) {
    if (domainOf(id) !== 'binary_sensor') continue;
    if ((e.attributes?.device_class || '') === deviceClass) return e;
  }
  return undefined;
};

const findForecastSensor = (ents: EntityMap, stemKeyword: RegExp, deviceClass?: string): RawEntity | undefined => {
  for (const [id, e] of Object.entries(ents)) {
    if (domainOf(id) !== 'sensor') continue;
    const dcOk = deviceClass ? (e.attributes?.device_class || '') === deviceClass : true;
    if (dcOk && stemKeyword.test(stemOf(id))) return e;
  }
  return undefined;
};

export const RAIN_SKIP_PROBABILITY = 60; // % — at/above this we flag a likely weather skip

export const projectController = (ents: EntityMap): ControllerView => {
  const onlineE = findBinary(ents, 'connectivity');
  const rainE = findBinary(ents, 'moisture');
  const standbySw = findControllerSwitch(ents, /standby|sleep/);
  const rainSw = findControllerSwitch(ents, /rain[_-]?delay|raindelay/);
  const probE = findForecastSensor(ents, /rain[_-]?prob/);
  const tempE = findForecastSensor(ents, /forecast/, 'temperature');
  const humE = findForecastSensor(ents, /forecast/, 'humidity');

  const rainSensorWet = rainE ? (isAvail(rainE) ? String(rainE.state).toLowerCase() === 'on' : null) : null;
  const rainProbability = probE && isAvail(probE) ? clampPct(num(probE.state)) : null;

  return {
    online: onlineE ? (isAvail(onlineE) ? String(onlineE.state).toLowerCase() === 'on' : null) : null,
    standby: standbySw ? String(standbySw.state).toLowerCase() === 'on' : false,
    standbyEntity: standbySw ? standbySw.__id : null,
    rainDelay: rainSw ? String(rainSw.state).toLowerCase() === 'on' : false,
    rainDelayEntity: rainSw ? rainSw.__id : null,
    rainDelayUntil: rainSw?.attributes?.rainDelayExpirationDate
      ? String(rainSw.attributes.rainDelayExpirationDate)
      : (rainSw?.attributes?.until ? String(rainSw.attributes.until) : null),
    rainSensorWet,
    rainProbability,
    forecastTemp: tempE && isAvail(tempE) ? num(tempE.state) : null,
    forecastTempUnit: tempE?.attributes?.unit_of_measurement ? String(tempE.attributes.unit_of_measurement) : '°F',
    forecastHumidity: humE && isAvail(humE) ? clampPct(num(humE.state)) : null,
    weatherSkip: rainSensorWet === true || (rainProbability !== null && rainProbability >= RAIN_SKIP_PROBABILITY),
  };
};

// ── Scenes ──────────────────────────────────────────────────────────────────
// Sprinkler scenes are NOT HA entities — they run via `rachio_pro.run_scene`
// with `{ scene: <name> }`. The surface gets its scene list two ways, in order:
//   1. an explicit list of scene names from tile options (real install: the
//      homeowner-defined scene names; the run path fires `rachio_pro.run_scene`).
//   2. discovered `scene.*` / `script.*` entities tagged for irrigation via an
//      `irrigation_scene: true` attribute (the DEV-DEMO path: the run path fires
//      the demo scene/script directly so it renders live with no account).
// No site names are hardcoded — both sources are data.

export interface SceneView {
  /** Display name (the scene name passed to run_scene, or the entity friendly name). */
  name: string;
  /** When set, run via this entity (demo); else run via rachio_pro.run_scene by name. */
  entityId?: string;
  available: boolean;
}

export const discoverScenes = (ents: EntityMap, configuredNames?: string[]): SceneView[] => {
  // 1. demo-tagged scene/script entities
  const tagged: SceneView[] = [];
  for (const [id, e] of Object.entries(ents)) {
    const d = domainOf(id);
    if (d !== 'scene' && d !== 'script') continue;
    if (e.attributes?.irrigation_scene !== true) continue;
    tagged.push({
      name: (e.attributes?.friendly_name && String(e.attributes.friendly_name)) || titleCase(stemOf(id)),
      entityId: id,
      available: isAvail(e) || d === 'scene', // scene.* state is a timestamp; treat as available if present
    });
  }
  if (tagged.length) return tagged.sort((a, b) => a.name.localeCompare(b.name));

  // 2. configured scene names (real install) — run via rachio_pro.run_scene
  if (configuredNames && configuredNames.length) {
    return configuredNames
      .map((n) => String(n).trim())
      .filter(Boolean)
      .map((name) => ({ name, available: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return [];
};

// ── Whole-surface projection ────────────────────────────────────────────────

export interface IrrigationProjection {
  groups: LocationGroup[];
  zoneCount: number;
  runningZones: ZoneView[];
  anyRunning: boolean;
  controller: ControllerView;
  scenes: SceneView[];
  /** True when the surface found at least one Rachio zone to render. */
  hasZones: boolean;
}

export const projectIrrigation = (ents: EntityMap, configuredScenes?: string[]): IrrigationProjection => {
  const zones: ZoneView[] = [];
  for (const [id, e] of Object.entries(ents)) {
    if (isZoneSwitch(id, e)) zones.push(projectZone(ents, id, e));
  }
  const groups = groupZonesByLocation(zones);
  const runningZones = zones.filter((z) => z.running);
  return {
    groups,
    zoneCount: zones.length,
    runningZones,
    anyRunning: runningZones.length > 0,
    controller: projectController(ents),
    scenes: discoverScenes(ents, configuredScenes),
    hasZones: zones.length > 0,
  };
};

// ── Display helpers (pure) ───────────────────────────────────────────────────

// Remaining time as "m:ss" while running, else null.
export const remainingLabel = (sec: number | null): string | null => {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Relative "last watered" label from an ISO timestamp. Pure given `now`.
export const lastWateredLabel = (iso: string | null, now: number = Date.now()): string => {
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
};

// Soil-moisture color: dry (red/amber) is the actionable state.
export const moistureColor = (pct: number | null): string => {
  if (pct === null) return 'var(--bp-text-dim)';
  if (pct < 20) return '#f87171';
  if (pct < 40) return '#fbbf24';
  return '#38bdf8';
};

// ── Actuation confirm-gate (water = low-to-moderate hazard) ──────────────────
// EVERY actuating control on this surface — zone run, scene run, rain-delay,
// standby — drives a valve. None may EVER fire on a bare tap. This is the single
// source of truth for whether an action may proceed and that it ALWAYS requires
// a confirm/press-and-hold. NOT the hard pool/HVAC/AKVO equipment-gate; a real,
// deliberate confirm (mirrors the Whisker low-hazard pattern).

export type IrrigationAction = 'zone-run' | 'scene-run' | 'rain-delay' | 'standby';

export interface ActuationContext {
  isEditor?: boolean;
  isLocked?: boolean;
  /** False => the target entity is offline / unavailable. */
  available?: boolean;
  /** The backing entity_id (zone switch, rain-delay/standby switch, demo scene). */
  entityId?: string;
  /** For scene-run via rachio_pro.run_scene: the scene name (no entity needed). */
  sceneName?: string;
}

export interface ActuationDecision {
  allowed: boolean;
  /** ALWAYS true — water actuation is never fire-on-tap. */
  requiresConfirm: boolean;
  reason?: 'editor' | 'locked' | 'offline' | 'no-target';
}

export const actuationGate = (
  action: IrrigationAction,
  ctx: ActuationContext,
): ActuationDecision => {
  if (ctx.isEditor) return { allowed: false, requiresConfirm: true, reason: 'editor' };
  if (ctx.isLocked) return { allowed: false, requiresConfirm: true, reason: 'locked' };
  // A scene-run may have no entity (it fires rachio_pro.run_scene by name);
  // every other action needs a backing entity.
  const hasTarget = action === 'scene-run' ? !!(ctx.entityId || ctx.sceneName) : !!ctx.entityId;
  if (!hasTarget) return { allowed: false, requiresConfirm: true, reason: 'no-target' };
  if (ctx.available === false) return { allowed: false, requiresConfirm: true, reason: 'offline' };
  return { allowed: true, requiresConfirm: true };
};

// The HA service-call descriptor for a confirmed action. Pure mapping; the tile
// hands the result to the live `callService` plumbing. `null` when there is no
// valid target (the gate would already have blocked it).
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

export interface ZoneRunArgs {
  entityId: string;
  durationMin: number;
}

export const clampDuration = (min: number): number =>
  Math.max(1, Math.min(180, Math.round(Number.isFinite(min) ? min : 1)));

// Start a zone. We fire a PLAIN `switch.turn_on` — HA core's switch.turn_on
// schema is strict and rejects extra fields, and rachio_pro does NOT extend it
// with a `duration` param, so the run length is the integration's configured
// default (CONF_MANUAL_RUN_MINS). The picked `durationMin` is carried in
// `runDurationHint` so a caller (or a future integration service that DOES
// accept a duration) can use it without breaking the universal turn_on path.
export const zoneRunCall = (args: ZoneRunArgs): ServiceCall | null => {
  if (!args.entityId) return null;
  return {
    domain: 'switch',
    service: 'turn_on',
    data: { entity_id: args.entityId },
  };
};

// The duration the homeowner picked, clamped — surfaced for display + for any
// integration path that accepts an explicit run length. Kept separate from the
// universal turn_on call so the call never 400s on a strict switch schema.
export const runDurationHint = (durationMin: number): number => clampDuration(durationMin);

export const zoneStopCall = (entityId: string): ServiceCall | null => {
  if (!entityId) return null;
  return { domain: 'switch', service: 'turn_off', data: { entity_id: entityId } };
};

// Run a sprinkler scene. Demo path: a tagged scene/script entity → activate it
// directly. Real path: `rachio_pro.run_scene` with the scene name.
export const sceneRunCall = (scene: SceneView): ServiceCall | null => {
  if (scene.entityId) {
    const d = domainOf(scene.entityId);
    if (d === 'scene') return { domain: 'scene', service: 'turn_on', data: { entity_id: scene.entityId } };
    if (d === 'script') return { domain: 'script', service: 'turn_on', data: { entity_id: scene.entityId } };
  }
  if (scene.name) return { domain: 'rachio_pro', service: 'run_scene', data: { scene: scene.name } };
  return null;
};

// Toggle rain-delay or standby (controller config switches).
export const controllerToggleCall = (
  action: 'rain-delay' | 'standby',
  entityId: string,
  currentlyOn: boolean,
): ServiceCall | null => {
  if (!entityId) return null;
  return { domain: 'switch', service: currentlyOn ? 'turn_off' : 'turn_on', data: { entity_id: entityId } };
};
