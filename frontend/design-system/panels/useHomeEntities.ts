// Live entity feed for the HOME OVERVIEW compilation panel (Increment 3).
//
// Owns ONE subscribeEntities subscription (no polling) and projects raw HA
// states into the area roll-up + scene + hero shape the HomePanel renders.
// Controls are issued via callService through the same haClient the rest of the
// app uses. Every value is REAL live state — nothing faked; a card shows an
// em-dash / "unavailable" when its entity is missing.
//
// Bound entities (dev). Real dev integrations where they exist, else demo
// fixtures provisioned in dev-ha/config/packages/home_demo.yaml + scenes.yaml:
//   pool (DEMO):     sensor.hd_pool_water_temperature / _ph / _salt + switch.pool_body
//   climate (MIX):   climate.kitchen_zone (real demo) + climate.living_zone +
//                    climate.primary_zone (avg roll-up)
//   lighting (DEMO): light.{great_room,master,kitchen_house,foyer,office,patio,
//                    gym,theater}_lights + group light.all_house_lights
//   generator (—):   sensor.hd_generator_status (intentionally absent → honest
//                    "awaiting creds" unconnected card)
//   AKVO (REAL):     akvo_movable_floor.* custom component — display-only/gated
//   weather (REAL):  weather.forecast_home + sun.sun
//   scenes (DEMO):   scene.home_{morning,away,evening,night,guest,movie}
// The arming bar binds to the REAL alarm_control_panel.house via useDashboard
// (display-only) — it is NOT projected here. Security card readout below reads
// the same alarm entity + demo door/motion sensors for its glance line.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';

export const HOME_ENTITIES = {
  pool: {
    water: 'sensor.hd_pool_water_temperature',
    ph: 'sensor.hd_pool_ph',
    salt: 'sensor.hd_pool_salt',
    body: 'switch.pool_body',
  },
  climateZones: ['climate.kitchen_zone', 'climate.living_zone', 'climate.primary_zone'],
  lights: [
    { id: 'light.great_room_lights', name: 'Great Room' },
    { id: 'light.master_lights', name: 'Master' },
    { id: 'light.kitchen_house_lights', name: 'Kitchen' },
    { id: 'light.foyer_lights', name: 'Foyer' },
    { id: 'light.office_lights', name: 'Office' },
    { id: 'light.patio_lights', name: 'Patio' },
    { id: 'light.gym_lights', name: 'Gym' },
    { id: 'light.theater_lights', name: 'Theater' },
  ] as const,
  generator: 'sensor.hd_generator_status', // intentionally absent in dev
  akvo: {
    systemReady: 'binary_sensor.akvo_movable_floor_system_ready',
    extReady: 'binary_sensor.akvo_movable_floor_ready_for_external_commands',
    fault: 'binary_sensor.akvo_movable_floor_system_fault',
    position: 'sensor.akvo_movable_floor_main_floor_position',
    activeConfig: 'sensor.akvo_movable_floor_active_configuration',
  },
  security: {
    alarm: 'alarm_control_panel.house',
    contacts: ['binary_sensor.front_door', 'binary_sensor.patio_slider'],
    motion: ['binary_sensor.great_room_motion'],
  },
  weather: 'weather.forecast_home',
  sun: 'sun.sun',
  scenes: [
    { id: 'scene.home_morning', name: 'Morning' },
    { id: 'scene.home_away', name: 'Away' },
    { id: 'scene.home_evening', name: 'Evening' },
    { id: 'scene.home_night', name: 'Night' },
    { id: 'scene.home_guest', name: 'Guest' },
    { id: 'scene.home_movie', name: 'Movie' },
  ] as const,
} as const;

const UNAVAILABLE = new Set(['unavailable', 'unknown', '', '—']);
const isAvail = (e?: HassEntity) => !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());
const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface PoolView {
  available: boolean;
  water: number | null;
  ph: number | null;
  salt: number | null;
  on: boolean;
  bodyAvailable: boolean;
  summary: string;
}
export interface ClimateRollup {
  available: boolean;
  zoneCount: number;
  avg: number | null;
  mode: string; // dominant mode across zones
  action: string | null; // cooling/heating if any zone is
  summary: string;
}
export interface LightsRollup {
  available: boolean;
  total: number;
  onCount: number;
  groupOn: boolean;
  groupAvailable: boolean;
  onNames: string[];
  summary: string;
}
export interface GeneratorView {
  available: boolean; // false in dev (no cloud creds)
  state: string | null;
  summary: string;
}
export interface AkvoView {
  present: boolean;
  systemReady: boolean;
  extReady: boolean;
  fault: boolean;
  position: number | null;
  activeConfig: string | null;
  summary: string;
}
export interface SecurityView {
  available: boolean;
  armState: string; // disarmed/armed_away/armed_home/...
  openContacts: number;
  motionActive: boolean;
  summary: string;
}
export interface WeatherView {
  available: boolean;
  temp: number | null;
  condition: string;
  isDaytime: boolean | null;
}
export interface HomeView {
  status: 'connecting' | 'live' | 'stale';
  pool: PoolView;
  climate: ClimateRollup;
  lights: LightsRollup;
  generator: GeneratorView;
  akvo: AkvoView;
  security: SecurityView;
  weather: WeatherView;
  scenes: { id: string; name: string; available: boolean }[];
  // last-activated scene id (real, from scene.* last_changed), or null
  activeScene: string | null;
}

const titleCase = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;

// Pure projection of raw HA states into the Home view model. No side effects;
// exported for unit testing on the render hot path.
export const projectHome = (ents: HassEntities): Omit<HomeView, 'status'> => {
  // ── pool ──
  const waterE = ents[HOME_ENTITIES.pool.water];
  const phE = ents[HOME_ENTITIES.pool.ph];
  const saltE = ents[HOME_ENTITIES.pool.salt];
  const bodyE = ents[HOME_ENTITIES.pool.body];
  const water = num(waterE?.state);
  const ph = num(phE?.state);
  const salt = num(saltE?.state);
  const poolParts: string[] = [];
  if (water !== null) poolParts.push(`Water ${Math.round(water)}°F`);
  if (ph !== null) poolParts.push(`pH ${ph.toFixed(1)}`);
  if (salt !== null) poolParts.push(`Salt ${(salt / 1000).toFixed(1)}k ppm`);
  const pool: PoolView = {
    available: isAvail(waterE) || isAvail(bodyE),
    water,
    ph,
    salt,
    on: bodyE?.state === 'on',
    bodyAvailable: isAvail(bodyE),
    summary: poolParts.length ? poolParts.join(' · ') : 'Pool data unavailable',
  };

  // ── climate roll-up across zones ──
  const zoneEnts = HOME_ENTITIES.climateZones.map((id) => ents[id]).filter(Boolean) as HassEntity[];
  const availZones = zoneEnts.filter((e) => isAvail(e));
  const temps = availZones
    .map((e) => num(e.attributes?.current_temperature))
    .filter((t): t is number => t !== null);
  const avg = temps.length ? Math.round(temps.reduce((s, t) => s + t, 0) / temps.length) : null;
  const actions = availZones
    .map((e) => (e.attributes?.hvac_action ? String(e.attributes.hvac_action) : null))
    .filter(Boolean) as string[];
  const action = actions.includes('cooling') ? 'cooling' : actions.includes('heating') ? 'heating' : null;
  // dominant mode = most common non-off mode, else off
  const modeCounts: Record<string, number> = {};
  for (const e of availZones) {
    const m = String(e.state || 'off');
    modeCounts[m] = (modeCounts[m] || 0) + 1;
  }
  const mode =
    Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'off';
  const climate: ClimateRollup = {
    available: availZones.length > 0,
    zoneCount: availZones.length,
    avg,
    mode,
    action,
    summary:
      avg !== null
        ? `Avg ${avg}°F · ${availZones.length} zones · ${
            action === 'cooling' ? 'Cooling' : action === 'heating' ? 'Heating' : titleCase(mode)
          }`
        : 'Climate unavailable',
  };

  // ── lighting roll-up ──
  const lightViews = HOME_ENTITIES.lights.map((l) => ({
    name: l.name,
    on: ents[l.id]?.state === 'on',
    available: isAvail(ents[l.id]),
  }));
  const onLights = lightViews.filter((l) => l.on);
  const availLights = lightViews.filter((l) => l.available);
  const groupE = ents['light.all_house_lights'];
  const lights: LightsRollup = {
    available: availLights.length > 0,
    total: lightViews.length,
    onCount: onLights.length,
    groupOn: groupE?.state === 'on',
    groupAvailable: isAvail(groupE),
    onNames: onLights.map((l) => l.name),
    summary:
      availLights.length > 0
        ? `${onLights.length} of ${lightViews.length} on`
        : 'Lighting unavailable',
  };

  // ── generator (honest unconnected state in dev) ──
  const genE = ents[HOME_ENTITIES.generator];
  const generator: GeneratorView = {
    available: isAvail(genE),
    state: genE ? String(genE.state) : null,
    summary: isAvail(genE)
      ? `${titleCase(String(genE!.state))}`
      : 'Cloud account not connected',
  };

  // ── AKVO (display-only, gated look) ──
  const akvoSys = ents[HOME_ENTITIES.akvo.systemReady];
  const akvoExt = ents[HOME_ENTITIES.akvo.extReady];
  const akvoFault = ents[HOME_ENTITIES.akvo.fault];
  const akvoPosE = ents[HOME_ENTITIES.akvo.position];
  const akvoCfgE = ents[HOME_ENTITIES.akvo.activeConfig];
  const akvoPresent = !!(akvoSys || akvoExt || akvoPosE);
  const akvo: AkvoView = {
    present: akvoPresent,
    systemReady: akvoSys?.state === 'on',
    extReady: akvoExt?.state === 'on',
    fault: akvoFault?.state === 'on',
    position: num(akvoPosE?.state),
    activeConfig: akvoCfgE && isAvail(akvoCfgE) ? String(akvoCfgE.state) : null,
    summary: !akvoPresent
      ? 'Preview · Hardware commissioning pending'
      : akvoFault?.state === 'on'
      ? 'Fault reported · PLC authority'
      : `PLC-mediated · ${akvoExt?.state === 'on' ? 'ready' : 'standby'} · display only`,
  };

  // ── security roll-up (reads same real alarm + demo sensors) ──
  const alarmE = ents[HOME_ENTITIES.security.alarm];
  const openContacts = HOME_ENTITIES.security.contacts.filter((id) => ents[id]?.state === 'on').length;
  const motionActive = HOME_ENTITIES.security.motion.some((id) => ents[id]?.state === 'on');
  const armState = alarmE ? String(alarmE.state) : 'unavailable';
  const security: SecurityView = {
    available: isAvail(alarmE),
    armState,
    openContacts,
    motionActive,
    summary: !isAvail(alarmE)
      ? 'Alarm panel unavailable'
      : openContacts > 0
      ? `${openContacts} open · ${motionActive ? 'motion' : 'no motion'}`
      : motionActive
      ? 'All closed · motion'
      : 'All clear · no motion',
  };

  // ── weather ──
  const weatherE = ents[HOME_ENTITIES.weather];
  const sunE = ents[HOME_ENTITIES.sun];
  const weather: WeatherView = {
    available: isAvail(weatherE),
    temp: num(weatherE?.attributes?.temperature),
    condition: weatherE ? String(weatherE.state) : 'unknown',
    isDaytime: sunE ? sunE.state === 'above_horizon' : null,
  };

  // ── scenes + real last-activated ──
  const sceneStates = HOME_ENTITIES.scenes.map((s) => ({
    id: s.id,
    name: s.name,
    available: !!ents[s.id],
    changed: ents[s.id]?.last_changed ? Date.parse(ents[s.id].last_changed) : 0,
  }));
  // Active = the scene with the most recent last_changed (a scene.* state stamps
  // last_changed each time it is activated). Only if at least one has a real
  // (non-epoch) timestamp; otherwise null (no fake active).
  const activated = sceneStates.filter((s) => s.available && s.changed > 0).sort((a, b) => b.changed - a.changed);
  const activeScene = activated.length ? activated[0].id : null;

  return {
    pool,
    climate,
    lights,
    generator,
    akvo,
    security,
    weather,
    scenes: sceneStates.map(({ id, name, available }) => ({ id, name, available })),
    activeScene,
  };
};

export interface HomeActions {
  activateScene: (id: string) => void;
  togglePoolBody: (on: boolean) => void;
}

export function useHomeEntities(): HomeView & { actions: HomeActions } {
  const [view, setView] = useState<Omit<HomeView, 'status'>>(() => projectHome({}));
  const [status, setStatus] = useState<HomeView['status']>('connecting');

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
          setStatus('live');
          armStale();
          setView(projectHome(ents));
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

  const activateScene = useCallback((id: string) => {
    callService('scene', 'turn_on', { entity_id: id });
  }, []);
  const togglePoolBody = useCallback((on: boolean) => {
    callService('switch', on ? 'turn_on' : 'turn_off', { entity_id: HOME_ENTITIES.pool.body });
  }, []);

  return { status, ...view, actions: { activateScene, togglePoolBody } };
}
