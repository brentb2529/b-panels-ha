// Live entity feed for the Pool & Spa compilation panel (Increment 4).
//
// Owns ONE subscribeEntities subscription (no polling) and projects the raw HA
// states into the shape PoolPanel renders. Every value here is REAL live state —
// a readout shows an em-dash / "off" when its entity is missing or unavailable.
//
// SAFETY POSTURE (mirrors ENTITY_CONTRACT Surface 1 + Surface 3 + the AKVO/
// equipment safety boundary):
//   • Pool/Spa bodies, Waterfall, heater setpoints, Main Pump  →  EQUIPMENT-GATED.
//     The panel renders their LIVE status (temp / setpoint / run state / pump
//     telemetry) faithfully, but offers NO actuation service call. There is no
//     switch.turn_on / water_heater.set_temperature wired for these — they are
//     display + a gated-confirm look only. Enabling real actuation is a human
//     escalation, deliberately out of scope.
//   • AKVO Movable Floor  →  display-only PREVIEW. Bound to the REAL akvo custom
//     component's read entities (sensor.akvo_movable_floor_*); never actuated.
//   • Pool-area lighting + the patio shade  →  LOW-HAZARD, LIVE-bound (these are
//     ordinary lights/Lutron + a cover, the same class as the Kitchen fixtures).
//
// The arming bar is NOT here — it reads the REAL alarm_control_panel.house via
// useDashboard()'s alarmState/armingState (display-only).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';

// ── Bound entity ids ────────────────────────────────────────────────────────
// Dev demo entities mirror the IntelliCenter contract shape (Surface 1). In a
// real install b-panels resolves these by selection (OBJTYPE/device_class); here
// the dev `pool_demo.yaml` package provisions stable ids with the `pp_`/pool_
// nominal names so the panel binds live without a registry read.
export const POOL_ENTITIES = {
  // GATED display — IntelliCenter bodies + features (status only, never actuated)
  poolBodySwitch: 'switch.pool_body',
  spaBodySwitch: 'switch.spa_body',
  waterfallSwitch: 'switch.pool_waterfall',
  // Heater setpoint source. ENTITY_CONTRACT Surface 1 LOCKS heating-only bodies
  // as `water_heater` (preferred); cooling-capable bodies are `climate`. We read
  // the FIRST present of [water_heater.*, climate.*] so the panel binds whichever
  // the IntelliCenter integration exposes. (Dev demo provisions the climate form.)
  poolHeater: ['water_heater.pool_heater', 'climate.pool_heater'],
  spaHeater: ['water_heater.spa_heater', 'climate.spa_heater'],
  // Display sensors
  poolTemp: 'sensor.pool_water_temp',
  spaTemp: 'sensor.spa_water_temp',
  ph: 'sensor.pool_ph',
  orp: 'sensor.pool_orp',
  salt: 'sensor.pool_salt',
  swg: 'sensor.pool_swg_output',
  pumpRpm: 'sensor.pool_pump_rpm',
  pumpGpm: 'sensor.pool_pump_gpm',
  pumpKw: 'sensor.pool_pump_power',
  // LOW-HAZARD live controls — pool/Lutron lights + a cover shade
  poolLight: 'light.pool_light',
  fixtures: [
    { id: 'light.pool_light', name: 'Pool Light', kind: 'Pool' },
    { id: 'light.patio_overhead', name: 'Patio Overhead', kind: 'Overhead' },
    { id: 'light.patio_path', name: 'Patio Path E·W', kind: 'Path' },
    { id: 'light.pool_cabana', name: 'Pool Cabana', kind: 'Cabana' },
  ] as const,
  shade: 'cover.patio_shade_e',
  // Scenes (lighting)
  scenes: [
    { id: 'scene.pool_lights_on', name: 'Lights On' },
    { id: 'scene.pool_party', name: 'Party Mode' },
    { id: 'scene.pool_lights_off', name: 'Lights Off' },
  ] as const,
  // AKVO — REAL custom component, display-only
  akvo: {
    mainPos: 'sensor.akvo_movable_floor_main_floor_position',
    bajaPos: 'sensor.akvo_movable_floor_baja_position',
    mainCur: 'sensor.akvo_movable_floor_main_floor_motor_current',
    bajaCur: 'sensor.akvo_movable_floor_baja_motor_current',
    activeConfig: 'sensor.akvo_movable_floor_active_configuration',
    moving: 'binary_sensor.akvo_movable_floor_floors_moving',
    ready: 'binary_sensor.akvo_movable_floor_ready_for_external_commands',
    fault: 'binary_sensor.akvo_movable_floor_system_fault',
  },
} as const;

// AKVO-defined validated presets (display labels only — NEVER actuated here).
export const AKVO_PRESETS = [
  { label: 'Deck', depth: '0.00 m' },
  { label: 'Swim', depth: '1.35 m' },
  { label: 'Dive', depth: '1.97 m' },
  { label: 'Play', depth: '0.75 m' },
] as const;

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);
const isAvail = (e?: HassEntity) => !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const lightLevel = (e?: HassEntity): number => {
  if (!e || e.state !== 'on') return 0;
  const b = num(e.attributes?.brightness);
  return b === null ? 100 : Math.round((b / 255) * 100);
};

export interface FixtureView {
  id: string;
  name: string;
  kind: string;
  available: boolean;
  on: boolean;
  level: number; // 0..100
}

export interface BodyView {
  available: boolean;
  on: boolean; // run state (display only)
  temp: number | null; // current water temp
  setpoint: number | null; // heater setpoint
  heating: boolean;
  unit: string;
}

export interface ChemView {
  ph: number | null;
  orp: number | null;
  salt: number | null;
  swg: number | null;
}

export interface PumpView {
  available: boolean;
  rpm: number | null;
  gpm: number | null;
  kw: number | null;
}

export interface AkvoView {
  available: boolean; // any akvo read entity present
  mainDepth: number | null; // meters
  bajaDepth: number | null;
  mainCurrent: number | null; // amps
  bajaCurrent: number | null;
  activeConfig: string | null;
  moving: boolean;
}

export interface PoolView {
  status: 'connecting' | 'live' | 'stale';
  pool: BodyView;
  spa: BodyView;
  waterfall: { available: boolean; on: boolean };
  chem: ChemView;
  pump: PumpView;
  poolActive: boolean;
  fixtures: FixtureView[];
  lightsOnCount: number;
  poolLightEffect: string | null;
  poolLightEffects: string[];
  shade: { available: boolean; position: number };
  scenes: { id: string; name: string; available: boolean }[];
  akvo: AkvoView;
}

const tempUnit = (e?: HassEntity): string =>
  e?.attributes?.unit_of_measurement ? String(e.attributes.unit_of_measurement) : '°F';

const projectBody = (
  ents: HassEntities,
  switchId: string,
  tempId: string,
  heaterIds: readonly string[],
): BodyView => {
  const sw = ents[switchId];
  const tempE = ents[tempId];
  const heaterE = heaterIds.map((id) => ents[id]).find((e) => !!e);
  return {
    available: isAvail(sw) || isAvail(tempE),
    on: sw?.state === 'on',
    temp: num(tempE?.state),
    setpoint: num(heaterE?.attributes?.temperature),
    heating: heaterE?.state === 'on' || heaterE?.attributes?.hvac_action === 'heating',
    unit: tempUnit(tempE),
  };
};

// Exported for unit testing — pure projection of raw HA states into the panel
// view model. No side effects.
export const projectPool = (ents: HassEntities): Omit<PoolView, 'status'> => {
  const pool = projectBody(ents, POOL_ENTITIES.poolBodySwitch, POOL_ENTITIES.poolTemp, POOL_ENTITIES.poolHeater);
  const spa = projectBody(ents, POOL_ENTITIES.spaBodySwitch, POOL_ENTITIES.spaTemp, POOL_ENTITIES.spaHeater);

  const waterfallE = ents[POOL_ENTITIES.waterfallSwitch];
  const waterfall = { available: isAvail(waterfallE), on: waterfallE?.state === 'on' };

  const chem: ChemView = {
    ph: num(ents[POOL_ENTITIES.ph]?.state),
    orp: num(ents[POOL_ENTITIES.orp]?.state),
    salt: num(ents[POOL_ENTITIES.salt]?.state),
    swg: num(ents[POOL_ENTITIES.swg]?.state),
  };

  const pumpRpmE = ents[POOL_ENTITIES.pumpRpm];
  const pump: PumpView = {
    available: isAvail(pumpRpmE),
    rpm: num(pumpRpmE?.state),
    gpm: num(ents[POOL_ENTITIES.pumpGpm]?.state),
    kw: num(ents[POOL_ENTITIES.pumpKw]?.state),
  };

  const fixtures: FixtureView[] = POOL_ENTITIES.fixtures.map((f) => {
    const e = ents[f.id];
    return {
      id: f.id,
      name: f.name,
      kind: f.kind,
      available: isAvail(e),
      on: e?.state === 'on',
      level: lightLevel(e),
    };
  });

  const poolLightE = ents[POOL_ENTITIES.poolLight];
  const poolLightEffect = poolLightE?.attributes?.effect ? String(poolLightE.attributes.effect) : null;
  const poolLightEffects: string[] = Array.isArray(poolLightE?.attributes?.effect_list)
    ? (poolLightE!.attributes!.effect_list as string[])
    : [];

  const shadeE = ents[POOL_ENTITIES.shade];
  const shadePos = num(shadeE?.attributes?.current_position);
  const shade = {
    available: isAvail(shadeE),
    position: shadePos === null ? (shadeE?.state === 'open' ? 100 : 0) : Math.round(shadePos),
  };

  const a = POOL_ENTITIES.akvo;
  const akvoEnts = [a.mainPos, a.bajaPos, a.mainCur, a.bajaCur, a.activeConfig].map((id) => ents[id]);
  const akvo: AkvoView = {
    available: akvoEnts.some((e) => isAvail(e)),
    mainDepth: num(ents[a.mainPos]?.state),
    bajaDepth: num(ents[a.bajaPos]?.state),
    mainCurrent: num(ents[a.mainCur]?.state),
    bajaCurrent: num(ents[a.bajaCur]?.state),
    activeConfig: ents[a.activeConfig] && isAvail(ents[a.activeConfig]) ? String(ents[a.activeConfig]!.state) : null,
    moving: ents[a.moving]?.state === 'on',
  };

  return {
    pool,
    spa,
    waterfall,
    chem,
    pump,
    poolActive: pool.on || pump.rpm !== null && (pump.rpm ?? 0) > 0,
    fixtures,
    lightsOnCount: fixtures.filter((f) => f.on).length,
    poolLightEffect,
    poolLightEffects,
    shade,
    scenes: POOL_ENTITIES.scenes.map((s) => ({ id: s.id, name: s.name, available: !!ents[s.id] })),
    akvo,
  };
};

export interface PoolActions {
  // LOW-HAZARD live controls only — lights + shade + scenes.
  setLight: (id: string, level: number) => void;
  toggleLight: (id: string, on: boolean) => void;
  setPoolLightEffect: (effect: string) => void;
  setShade: (position: number) => void;
  activateScene: (id: string) => void;
}

export function usePoolEntities(): PoolView & { actions: PoolActions } {
  const [view, setView] = useState<Omit<PoolView, 'status'>>(() => projectPool({}));
  const [status, setStatus] = useState<PoolView['status']>('connecting');
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
          setView(projectPool(ents));
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

  const setLight = useCallback((id: string, level: number) => {
    if (level <= 0) callService('light', 'turn_off', { entity_id: id });
    else callService('light', 'turn_on', { entity_id: id, brightness_pct: level });
  }, []);
  const toggleLight = useCallback((id: string, on: boolean) => {
    callService('light', on ? 'turn_on' : 'turn_off', { entity_id: id });
  }, []);
  const setPoolLightEffect = useCallback((effect: string) => {
    callService('light', 'turn_on', { entity_id: POOL_ENTITIES.poolLight, effect });
  }, []);
  const setShade = useCallback((position: number) => {
    callService('cover', 'set_cover_position', { entity_id: POOL_ENTITIES.shade, position });
  }, []);
  const activateScene = useCallback((id: string) => {
    callService('scene', 'turn_on', { entity_id: id });
  }, []);

  return {
    status,
    ...view,
    actions: { setLight, toggleLight, setPoolLightEffect, setShade, activateScene },
  };
}
