import {
  Device,
  DeviceType,
  DeviceService,
  ApplianceState,
  FridgeApplianceState,
  OvenApplianceState,
  DishwasherApplianceState,
  FridgeZoneState,
  OvenCavityState,
} from '../types';

// ---------------------------------------------------------------------------
// applianceComposites — PURE assembly of Sub-Zero / Wolf / Cove appliance
// composite Devices from the live, mapped HA entities (subzero_wolf
// integration). Each appliance's per-zone / per-cavity / cycle entities are
// folded into ONE composite Device whose `state` is an `ApplianceState`, so
// b-panels renders a single rich tile instead of a dozen scattered sensors.
//
// No React, no DOM, no registry read on the render path: this is a pure
// function over the device list + the entity→device map, so it is unit-tested
// in isolation (kind classification, zone/cavity/cycle folding) and carries NO
// site hardcoding — grouping is by HA registry device_id (when present) else by
// the appliance entity-id stem, both generic.
//
// SAFETY: appliances are DISPLAY-ONLY here. The composite carries no write
// affordances; the Wolf oven write path stays equipment-gated in the
// integration and is never represented as actionable.
// ---------------------------------------------------------------------------

const num = (d?: Device): number | null => {
  if (!d) return null;
  const n = Number(d.state);
  return Number.isFinite(n) ? n : null;
};
const txt = (d?: Device): string | null => {
  if (!d) return null;
  const s = String(d.state ?? '').trim();
  if (!s || ['unknown', 'unavailable'].includes(s.toLowerCase())) return null;
  return s;
};
const bool = (d?: Device): boolean | undefined => {
  if (!d) return undefined;
  const s = d.state;
  if (typeof s === 'boolean') return s;
  if (typeof s === 'number') return s !== 0;
  return ['on', 'true', 'open', 'detected', 'yes', 'ajar', 'running'].includes(String(s).toLowerCase());
};
const isOff = (d?: Device): boolean => {
  if (!d) return true;
  return ['unavailable', 'unknown'].includes(String(d.state ?? '').toLowerCase());
};

// The entity-id local part after the domain (e.g. "kitchen_fridge_freezer_temp").
const localId = (id: string): string => (id.split('.')[1] || '').toLowerCase();

// Strip a trailing known suffix to recover the appliance stem so siblings group.
// e.g. sensor.demo_fridge_refrigerator_temperature -> "demo_fridge".
// We anchor on the strong, family-defining suffixes.

export type ApplianceKindGuess = 'fridge' | 'oven' | 'dishwasher' | null;

// Classify a group of member devices into an appliance family from the entity
// suffixes the integration emits. Pure + exported for unit tests.
export function classifyAppliance(members: Device[]): ApplianceKindGuess {
  const ids = members.map((d) => localId(d.id));
  const has = (re: RegExp) => ids.some((id) => re.test(id));
  // Dishwasher: wash status/cycle + time-remaining (Cove).
  if (has(/wash_status|wash_cycle/) || (has(/time_remaining/) && has(/wash|dishwasher/))) return 'dishwasher';
  // Oven/range: cavity temp + cook mode / oven-on / preheat (Wolf).
  if (has(/cook_mode|oven_on|preheat|cavity/) || (has(/_temp(erature)?$/) && has(/oven|range|upper|lower/))) return 'oven';
  // Fridge: zone set-points + door + filters (Sub-Zero).
  if (has(/setpoint|set_temperature/) && has(/door/) && has(/refrigerator|freezer|fridge|wine|beverage|filter/)) return 'fridge';
  if (has(/water_filter|air_filter/) || has(/ice_maker|sabbath/)) return 'fridge';
  return null;
}

// Recover an appliance stem from a member id, used for the composite id + name
// when there is no registry device grouping (dev demos / helper-based entities).
function applianceStem(members: Device[]): string {
  // Longest common id prefix across members, trimmed to a word boundary.
  const locals = members.map((d) => localId(d.id)).filter(Boolean);
  if (locals.length === 0) return 'appliance';
  let prefix = locals[0];
  for (const l of locals.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < l.length && prefix[i] === l[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.replace(/[_\s]+$/, '') || locals[0];
}

// Title-case a stem into a friendly default name (e.g. "demo_fridge" -> "Demo Fridge").
function titleize(stem: string): string {
  return stem.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Appliance';
}

// Find a member by an id-suffix regex (matched against the local id).
const find = (members: Device[], re: RegExp): Device | undefined =>
  members.find((d) => re.test(localId(d.id)));

const anyOnline = (members: Device[]): boolean => members.some((d) => !isOff(d) && d.isOnline !== false);

// ── Fridge folding ──────────────────────────────────────────────────────────
function buildFridge(stem: string, members: Device[]): FridgeApplianceState {
  const online = anyOnline(members);
  // Zone temps/setpoints: group by the zone token preceding _temp/_setpoint.
  // Zone tokens are the COOLING-ZONE words only (never the appliance-name
  // prefix like "fridge"), so `demo_fridge_freezer_*` resolves to the Freezer
  // zone rather than collapsing onto the prefix.
  const zoneTokens = new Set<string>();
  for (const d of members) {
    const m = localId(d.id).match(/(refrigerator|freezer|wine|beverage|cooler)/);
    if (m) zoneTokens.add(m[1]);
  }
  if (zoneTokens.size === 0) zoneTokens.add('refrigerator');
  const ZONE_LABEL: Record<string, string> = {
    refrigerator: 'Refrigerator', freezer: 'Freezer',
    wine: 'Wine', beverage: 'Beverage', cooler: 'Cooler',
  };
  const zones: FridgeZoneState[] = Array.from(zoneTokens).map((tok) => {
    const tempD = find(members, new RegExp(`${tok}.*temp(erature)?$`)) || find(members, new RegExp(`${tok}.*_temp$`));
    const setD = find(members, new RegExp(`${tok}.*(setpoint|set_temperature)`));
    const doorD = find(members, new RegExp(`${tok}.*door`));
    return {
      name: ZONE_LABEL[tok] || titleize(tok),
      setpointF: num(setD),
      measuredF: num(tempD),
      doorAjar: doorD ? bool(doorD) : undefined,
    };
  });
  // Sort so Refrigerator leads, Freezer next.
  const order = ['Refrigerator', 'Freezer', 'Wine', 'Beverage', 'Cooler'];
  zones.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const doorD = find(members, /(^|_)door(_ajar)?$/) || find(members, /door/);
  const waterD = find(members, /water_filter/);
  const airD = find(members, /air_filter/);
  const serviceD = find(members, /service/);
  const iceD = find(members, /ice_maker/);
  const sabbathD = find(members, /sabbath/);
  return {
    kind: 'fridge', id: `appliance:${stem}`, serial: stem, name: titleize(stem),
    isOnline: online, zones,
    anyDoorAjar: zones.some((z) => z.doorAjar) || (doorD ? bool(doorD) : undefined) || undefined,
    waterFilterPct: num(waterD), airFilterPct: num(airD),
    iceMakerOn: iceD ? bool(iceD) : undefined,
    sabbathMode: sabbathD ? bool(sabbathD) : undefined,
    serviceRequired: serviceD ? bool(serviceD) : undefined,
  };
}

// ── Oven folding ──────────────────────────────────────────────────────────
function buildOven(stem: string, members: Device[]): OvenApplianceState {
  const online = anyOnline(members);
  // Cavity tokens: upper/lower/oven; default single "Oven".
  const tokens = new Set<string>();
  for (const d of members) {
    const m = localId(d.id).match(/(upper|lower|oven|cavity|main)/);
    if (m) tokens.add(m[1] === 'cavity' || m[1] === 'main' ? 'oven' : m[1]);
  }
  if (tokens.size === 0) tokens.add('oven');
  // If only "oven" plus upper/lower exist, prefer the named ones.
  const named = Array.from(tokens).filter((t) => t === 'upper' || t === 'lower');
  const useTokens = named.length ? named : Array.from(tokens);
  const LABEL: Record<string, string> = { oven: 'Oven', upper: 'Upper', lower: 'Lower' };
  const cavities: OvenCavityState[] = useTokens.map((tok) => {
    const re = (suffix: string) => new RegExp(`${tok}.*${suffix}`);
    const tempD = find(members, re('(measured.*temp|_temp(erature)?$|cavity_temp)')) || find(members, new RegExp(`${tok}.*temp`));
    const setD = find(members, re('(setpoint|set_temperature)'));
    const modeD = find(members, re('(cook_)?mode'));
    const probeD = find(members, re('probe'));
    const onD = find(members, re('(oven_)?on|running'));
    const doorD = find(members, re('door'));
    const preheatD = find(members, re('preheat'));
    const lightD = find(members, re('light'));
    return {
      name: LABEL[tok] || titleize(tok),
      measuredF: num(tempD),
      setpointF: num(setD),
      cookMode: txt(modeD),
      probeF: num(probeD),
      ovenOn: onD ? bool(onD) : undefined,
      doorAjar: doorD ? bool(doorD) : undefined,
      preheatComplete: preheatD ? bool(preheatD) : undefined,
      lightOn: lightD ? (bool(lightD) ?? null) : null,
    };
  });
  const order = ['Upper', 'Oven', 'Lower'];
  cavities.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const serviceD = find(members, /service/);
  return {
    kind: 'oven', id: `appliance:${stem}`, serial: stem, name: titleize(stem),
    isOnline: online, cavities,
    serviceRequired: serviceD ? bool(serviceD) : undefined,
    ovenWritesGated: true,
  };
}

// ── Dishwasher folding ──────────────────────────────────────────────────────
function buildDishwasher(stem: string, members: Device[]): DishwasherApplianceState {
  const online = anyOnline(members);
  const statusD = find(members, /wash_status/) || find(members, /(^|_)status$/);
  const cycleD = find(members, /wash_cycle/) || find(members, /(^|_)cycle$/);
  const timeD = find(members, /time_remaining/);
  const runD = find(members, /wash_running|running|washing/);
  const doorD = find(members, /door/);
  const rinseD = find(members, /rinse_aid/);
  const saniD = find(members, /sani/);
  const dryD = find(members, /heated_dry|dry/);
  return {
    kind: 'dishwasher', id: `appliance:${stem}`, serial: stem, name: titleize(stem),
    isOnline: online,
    washStatus: txt(statusD),
    washCycle: txt(cycleD),
    timeRemainingMin: num(timeD),
    running: runD ? bool(runD) : undefined,
    doorAjar: doorD ? bool(doorD) : undefined,
    rinseAidLow: rinseD ? bool(rinseD) : undefined,
    saniRinse: saniD ? bool(saniD) : undefined,
    heatedDry: dryD ? bool(dryD) : undefined,
  };
}

export interface ApplianceCompositeResult {
  composites: Device[];
  memberIds: Set<string>;
}

// Build appliance composites from the mapped service devices. Groups by registry
// device_id first (production), then by entity-id stem (dev demos / no registry).
export function buildApplianceComposites(
  serviceDevices: Device[],
  entityDeviceMap: Record<string, string>,
): ApplianceCompositeResult {
  const composites: Device[] = [];
  const memberIds = new Set<string>();

  // 1) Registry-device groups.
  const byDevice = new Map<string, Device[]>();
  for (const d of serviceDevices) {
    const did = entityDeviceMap[d.id];
    if (!did) continue;
    const arr = byDevice.get(did);
    if (arr) arr.push(d); else byDevice.set(did, [d]);
  }

  const consumed = new Set<string>();
  const emit = (groupKey: string, members: Device[]) => {
    const kind = classifyAppliance(members);
    if (!kind) return;
    const stem = applianceStem(members);
    let state: ApplianceState;
    if (kind === 'fridge') state = buildFridge(stem, members);
    else if (kind === 'oven') state = buildOven(stem, members);
    else state = buildDishwasher(stem, members);
    composites.push({
      id: state.id,
      name: state.name,
      type: kind === 'fridge' ? DeviceType.Fridge : kind === 'oven' ? DeviceType.Oven : DeviceType.Dishwasher,
      service: DeviceService.SubZeroWolf,
      state: state as any,
      isOnline: state.isOnline,
    });
    members.forEach((m) => { memberIds.add(m.id); consumed.add(m.id); });
  };

  byDevice.forEach((members, did) => {
    if (members.length < 2) return; // a real appliance has several entities
    if (classifyAppliance(members)) emit(`dev:${did}`, members);
  });

  // 2) Stem grouping for entities NOT already consumed (no usable registry group).
  // Group by the leading appliance token of the local id (first 2 words), then
  // classify; this folds demo/helper entities that share a `<stem>_*` prefix.
  const remaining = serviceDevices.filter((d) => !consumed.has(d.id));
  const byStem = new Map<string, Device[]>();
  for (const d of remaining) {
    const local = localId(d.id);
    if (!local) continue;
    // Use the first two underscore tokens as the stem key (e.g. "demo_fridge").
    const parts = local.split('_');
    const key = parts.slice(0, 2).join('_');
    const arr = byStem.get(key);
    if (arr) arr.push(d); else byStem.set(key, [d]);
  }
  byStem.forEach((members, key) => {
    if (members.length < 2) return;
    if (classifyAppliance(members)) emit(`stem:${key}`, members);
  });

  return { composites, memberIds };
}
