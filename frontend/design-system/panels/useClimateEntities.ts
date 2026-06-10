// Live entity feed for the whole-home Climate compilation panel (Increment 5).
//
// Owns ONE subscribeEntities subscription (no polling) and projects the raw HA
// climate/sensor states into the shape ClimatePanel renders. Every value is REAL
// live state — a readout shows an em-dash / "unavailable" when its entity is
// missing or offline.
//
// SAFETY POSTURE (ENTITY_CONTRACT Surface 2 — Airzone):
//   • HVAC setpoint (climate.set_temperature) and the MASTER-zone mode
//     (climate.set_hvac_mode) are LIVE, LOW-HAZARD comfort controls — NOT
//     equipment-gated. Masters get full Cool/Heat/Auto/Off; every zone gets a
//     live setpoint stepper.
//   • SLAVE zones get a live setpoint but mode is READ-BACK only ("Set on
//     master · <name>", disabled mode buttons) — per Surface 2, mode is settable
//     on master zones only. Slave mode-routing is a separate equipment-gated
//     change, deliberately out of scope.
//   • Master/slave TOPOLOGY is derived ONLY from the climate entity's STATE
//     ATTRIBUTES (no admin device-registry read) so least-privilege kiosks work.
//     Supports the real Airzone attrs (is_master / master_zone / slave_zones /
//     zone_id) AND the dev-demo `bp_*` convention; degrades gracefully when both
//     are absent (every zone renders flat, mode controls enabled as a master).
//
// The arming bar is NOT here — it reads the REAL alarm_control_panel.house via
// useDashboard()'s alarmState/armingState (display-only).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';

// ── Bound zone descriptors ───────────────────────────────────────────────────
// Dev demo entities mirror the Airzone contract shape (Surface 2). Reuses the
// climate.* zones provisioned by the kitchen/home demos plus the new
// climate_demo.yaml package (which adds the master zones, an independent zone,
// a slave-only example, and an offline zone). In a real install b-panels
// resolves these by selection; here the dev packages provision stable ids.
//
// `tempSensor` / `humiditySensor` are the Surface 2 LOCKED companion sensors;
// when absent the panel falls back to the climate entity's own
// current_temperature / current_humidity attributes.
export interface ZoneSpec {
  /** climate.<zone> entity id */
  id: string;
  /** Friendly display name (falls back to the entity's friendly_name). */
  name: string;
  /** sensor.<zone>_temperature companion (optional). */
  tempSensor?: string;
  /** sensor.<zone>_humidity companion (optional). */
  humiditySensor?: string;
}

export const CLIMATE_ZONES: readonly ZoneSpec[] = [
  // GROUP — Main Floor system (master = Family Room / Living Zone)
  { id: 'climate.living_zone', name: 'Family Room', tempSensor: 'sensor.hd_living_temperature' },
  { id: 'climate.kitchen_zone', name: 'Kitchen', tempSensor: 'sensor.kd_zone_temperature', humiditySensor: 'sensor.kd_zone_humidity' },
  { id: 'climate.dining_zone', name: 'Dining', tempSensor: 'sensor.cd_dining_temperature' },
  // GROUP — Upstairs system (master = Primary Suite)
  { id: 'climate.primary_zone', name: 'Primary Suite', tempSensor: 'sensor.hd_primary_temperature' },
  { id: 'climate.office_zone', name: 'Office', tempSensor: 'sensor.cd_office_temperature' },
  { id: 'climate.guest_zone', name: 'Guest Room', tempSensor: 'sensor.cd_guest_temperature' },
  // OTHER — an independent zone, a slave example, and an offline zone
  { id: 'climate.patio_heater', name: 'Patio Heater' },
  { id: 'climate.garage_zone', name: 'Garage', tempSensor: 'sensor.cd_garage_temperature' },
  { id: 'climate.wine_room', name: 'Wine Room', tempSensor: 'sensor.cd_wine_room_temperature' },
] as const;

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);
const isAvail = (e?: HassEntity) => !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// HA hvac_mode strings → our compact mode union. Anything cooling/heating/auto
// is mapped; everything else (off / fan_only / dry) reads as 'off' for the pill
// highlight (the chip still shows the true action).
export type ClimateMode = 'cool' | 'heat' | 'auto' | 'off';
const toMode = (s: string | undefined): ClimateMode => {
  switch (String(s ?? '').toLowerCase()) {
    case 'cool': return 'cool';
    case 'heat': return 'heat';
    case 'heat_cool':
    case 'auto': return 'auto';
    default: return 'off';
  }
};

// hvac_action → coarse calling state. Used for the panel-side dominant-mode and
// the "N calling cool / N calling heat / N idle" counts.
export type CallingState = 'cool' | 'heat' | 'idle' | 'off';
const toCalling = (action: string | undefined, mode: ClimateMode): CallingState => {
  switch (String(action ?? '').toLowerCase()) {
    case 'cooling': return 'cool';
    case 'heating': return 'heat';
    case 'idle': return 'idle';
    case 'off': return 'off';
    default:
      // No hvac_action attr — infer from the mode so the chip still reads.
      return mode === 'off' ? 'off' : 'idle';
  }
};

export interface ZoneView {
  id: string;
  name: string;
  available: boolean;
  current: number | null;     // current temperature (°F)
  setpoint: number | null;    // target temperature (°F)
  humidity: number | null;    // RH %
  unit: string;
  mode: ClimateMode;          // hvac_mode mapped
  rawMode: string | null;     // raw hvac_mode (for service round-trip / off detect)
  calling: CallingState;      // from hvac_action
  // topology (state-attribute derived, never a registry read)
  isMaster: boolean;
  masterZone: string | null;  // display name of the controlling master (slaves)
  hasTopology: boolean;       // whether any topology attr was present
  minTemp: number;
  maxTemp: number;
  step: number;
}

// Pull the topology + comfort fields off a single climate entity's attributes.
// Supports BOTH the real Airzone attrs and the dev-demo bp_* convention.
const readTopology = (attrs: Record<string, any> | undefined) => {
  if (!attrs) return { isMaster: true, masterZone: null as string | null, hasTopology: false };
  const hasReal = 'is_master' in attrs || 'master_zone' in attrs || 'slave_zones' in attrs;
  const hasDemo = 'bp_is_master' in attrs || 'bp_master_zone' in attrs;
  const hasTopology = hasReal || hasDemo;
  // is_master: explicit when present; otherwise a zone with NO master_zone is a
  // master by default (so a flat install renders every zone as controllable).
  const masterFlag = attrs.is_master ?? attrs.bp_is_master;
  const masterZone = attrs.master_zone ?? attrs.bp_master_zone ?? null;
  const isMaster = masterFlag !== undefined
    ? masterFlag === true || masterFlag === 'true'
    : masterZone == null;
  return { isMaster, masterZone: masterZone != null ? String(masterZone) : null, hasTopology };
};

const projectZone = (ents: HassEntities, spec: ZoneSpec): ZoneView => {
  const c = ents[spec.id];
  const attrs = c?.attributes as Record<string, any> | undefined;
  const tempE = spec.tempSensor ? ents[spec.tempSensor] : undefined;
  const humE = spec.humiditySensor ? ents[spec.humiditySensor] : undefined;

  // current temp: prefer the companion sensor (Surface 2 LOCKED), else the
  // climate entity's current_temperature attr.
  const current = isAvail(tempE) ? num(tempE!.state) : num(attrs?.current_temperature);
  // humidity: companion sensor, else attr, else the demo bp_humidity.
  const humidity = isAvail(humE)
    ? num(humE!.state)
    : num(attrs?.current_humidity ?? attrs?.bp_humidity);

  const rawMode = c && isAvail(c) ? String(c.state) : null;
  const mode = toMode(rawMode ?? undefined);
  const calling = toCalling(attrs?.hvac_action, mode);
  const topo = readTopology(attrs);

  return {
    id: spec.id,
    name: spec.name || (attrs?.friendly_name ? String(attrs.friendly_name) : spec.id),
    available: isAvail(c),
    current,
    setpoint: num(attrs?.temperature),
    humidity,
    unit: attrs?.temperature_unit ? String(attrs.temperature_unit) : '°F',
    mode,
    rawMode,
    calling,
    isMaster: topo.isMaster,
    masterZone: topo.masterZone,
    hasTopology: topo.hasTopology,
    minTemp: num(attrs?.min_temp) ?? 50,
    maxTemp: num(attrs?.max_temp) ?? 90,
    step: num(attrs?.target_temp_step) ?? 1,
  };
};

// A master zone with its slaves nested under it (the left-column topology).
export interface ZoneGroup {
  master: ZoneView;
  slaves: ZoneView[];
}

export interface HouseSummary {
  avgTemp: number | null;   // average current temp across available zones
  avgRh: number | null;     // average RH across available zones reporting it
  zoneCount: number;        // total available zones
  callingCool: number;
  callingHeat: number;
  idle: number;
  dominant: 'cool' | 'heat' | 'idle' | 'off';  // panel-side dominant mode
}

export interface ClimateView {
  status: 'connecting' | 'live' | 'stale';
  zones: ZoneView[];
  // Topology projection: master groups (left core) + independent + slave-of-
  // missing-master + offline zones (right "Other" card).
  groups: ZoneGroup[];
  independents: ZoneView[];   // masters with no slaves and no topology peers
  others: ZoneView[];         // the "Other Zones / Systems" list (independent + orphan slaves + offline)
  summary: HouseSummary;
}

const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

// Pure projection of raw HA states into the panel view model. Exported for unit
// testing. No side effects.
export const projectClimate = (ents: HassEntities): Omit<ClimateView, 'status'> => {
  const zones = CLIMATE_ZONES.map((z) => projectZone(ents, z));
  const byName = new Map(zones.map((z) => [z.name.toLowerCase(), z]));

  // ── House summary (panel-side, excludes offline zones) ──
  const live = zones.filter((z) => z.available);
  // House AVERAGE temp/RH reflects CONDITIONED zones only: exclude zones whose
  // mode is off (e.g. the Patio Heater independent), so a powered-down outdoor
  // zone reading ambient air doesn't skew the whole-home average.
  const conditioned = live.filter((z) => z.calling !== 'off' && z.mode !== 'off');
  const temps = conditioned.map((z) => z.current).filter((t): t is number => t !== null);
  const rhs = conditioned.map((z) => z.humidity).filter((h): h is number => h !== null);
  let callingCool = 0, callingHeat = 0, idle = 0;
  for (const z of live) {
    if (z.calling === 'cool') callingCool++;
    else if (z.calling === 'heat') callingHeat++;
    else if (z.calling === 'idle') idle++;
    // 'off' counts toward neither calling nor idle.
  }
  const dominant: HouseSummary['dominant'] =
    callingCool > callingHeat && callingCool > 0 ? 'cool'
      : callingHeat > callingCool && callingHeat > 0 ? 'heat'
        : idle > 0 ? 'idle' : 'off';

  const summary: HouseSummary = {
    avgTemp: avg(temps),
    avgRh: rhs.length ? avg(rhs) : null,
    zoneCount: live.length,
    callingCool,
    callingHeat,
    idle,
    dominant,
  };

  // ── Topology projection ──
  // Masters are: explicit isMaster && available. Each master collects the
  // available slaves whose masterZone names it.
  const masters = zones.filter((z) => z.available && z.isMaster && z.hasTopology);
  const claimedSlaveIds = new Set<string>();
  const groups: ZoneGroup[] = masters.map((m) => {
    const slaves = zones.filter(
      (z) => z.available && !z.isMaster && z.masterZone && z.masterZone.toLowerCase() === m.name.toLowerCase(),
    );
    slaves.forEach((s) => claimedSlaveIds.add(s.id));
    return { master: m, slaves };
  });

  // Independents: available, no topology info at all (or a master with no slaves
  // and not part of a group above is still its own group — but for the LEFT core
  // we only show masters that DO carry topology). Flat zones with no topology go
  // to the "Other" list as independent systems unless they were promoted to a
  // group. We treat a topology-bearing master as the core; everything else lands
  // in "others".
  const groupZoneIds = new Set<string>();
  groups.forEach((g) => { groupZoneIds.add(g.master.id); g.slaves.forEach((s) => groupZoneIds.add(s.id)); });

  const independents = zones.filter(
    (z) => z.available && !groupZoneIds.has(z.id) && (!z.hasTopology || (z.isMaster && !z.masterZone)),
  );

  // "Other" card: independent systems + orphan slaves (master offline/missing) +
  // offline zones (em-dash treatment).
  const offline = zones.filter((z) => !z.available);
  const orphanSlaves = zones.filter(
    (z) => z.available && !z.isMaster && z.masterZone && !claimedSlaveIds.has(z.id),
  );
  const others = [...independents, ...orphanSlaves, ...offline];

  return { zones, groups, independents, others, summary };
};

export interface ClimateActions {
  // LOW-HAZARD live comfort controls.
  setTemperature: (id: string, temp: number) => void;
  setHvacMode: (id: string, mode: 'cool' | 'heat' | 'auto' | 'off') => void;
}

export function useClimateEntities(): ClimateView & { actions: ClimateActions } {
  const [view, setView] = useState<Omit<ClimateView, 'status'>>(() => projectClimate({}));
  const [status, setStatus] = useState<ClimateView['status']>('connecting');
  const entsRef = useRef<HassEntities>({});

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => setStatus('stale'), 45000);
    };
    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          setStatus('live');
          armStale();
          setView(projectClimate(ents));
        });
      } catch {
        if (!cancelled) setStatus('stale');
      }
    })();
    return () => {
      cancelled = true;
      if (staleTimer) clearTimeout(staleTimer);
      if (unsub) unsub();
    };
  }, []);

  const setTemperature = useCallback((id: string, temp: number) => {
    callService('climate', 'set_temperature', { entity_id: id, temperature: temp });
  }, []);
  const setHvacMode = useCallback((id: string, mode: 'cool' | 'heat' | 'auto' | 'off') => {
    // HA's auto maps to either 'auto' or 'heat_cool'; the demo thermostats use
    // 'auto'/'off'/'cool'/'heat'. Send the canonical mode string.
    callService('climate', 'set_hvac_mode', { entity_id: id, hvac_mode: mode });
  }, []);

  return {
    status,
    ...view,
    actions: { setTemperature, setHvacMode },
  };
}
