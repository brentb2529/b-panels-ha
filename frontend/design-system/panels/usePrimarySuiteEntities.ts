// Live entity feed for the Primary Suite room compilation panel (Increment 6).
//
// A sibling of the Kitchen room view (useKitchenEntities), restful/private-
// weighted. Owns ONE subscribeEntities subscription (no polling) and projects
// the raw HA states into the shape PrimarySuitePanel renders. Controls are
// issued via callService through the same haClient. Every value is REAL live
// state — nothing is faked; a tile shows an em-dash / "off" when its entity is
// missing or unavailable.
//
// The bound entities (all LOCKED display/control, none equipment-gated):
//   bedside/cove lights: light.bedside_left / light.bedside_right /
//                        light.cove_ceiling
//   light group:         light.all_suite_lights
//   scenes:              scene.suite_wake / _read / _relax / _goodnight
//   climate:             climate.primary_zone (a MASTER per Climate topology →
//                        FULL Cool/Heat/Auto/Off mode control + live setpoint)
//   blackout shade:      cover.blackout_shade (set_position — bedroom priority)
//   media:               media_player.primary_suite_sonos (display fixture in dev)
// The arming bar is NOT here — it reads the REAL alarm_control_panel.house via
// useDashboard()'s alarmState/armingState (display-only).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';

export const SUITE_ENTITIES = {
  // Bedside + cove/ceiling dimmers (Lutron-style). Order matters for display.
  lights: [
    { id: 'light.bedside_left', name: 'Bedside L', kind: 'Lamp' },
    { id: 'light.bedside_right', name: 'Bedside R', kind: 'Lamp' },
    { id: 'light.cove_ceiling', name: 'Cove / Ceiling', kind: 'Cove' },
  ] as const,
  group: 'light.all_suite_lights',
  scenes: [
    { id: 'scene.suite_wake', name: 'Wake', meta: 'Gradual cool' },
    { id: 'scene.suite_read', name: 'Read', meta: 'Bedside focus' },
    { id: 'scene.suite_relax', name: 'Relax', meta: 'Dim cool' },
    { id: 'scene.suite_goodnight', name: 'Goodnight', meta: 'All off · shades down' },
  ] as const,
  climate: 'climate.primary_zone',
  shade: 'cover.blackout_shade',
  media: 'media_player.primary_suite_sonos',
} as const;

export interface LightView {
  id: string;
  name: string;
  kind: string;
  available: boolean;
  on: boolean;
  level: number; // 0..100
}

export type ClimateMode = 'cool' | 'heat' | 'auto' | 'off';

export interface ClimateView {
  available: boolean;
  current: number | null;
  setpoint: number | null;
  mode: ClimateMode; // mapped hvac mode
  rawMode: string | null; // raw hvac_mode for off detection
  action: string | null; // hvac_action (idle/cooling/heating)
  humidity: number | null;
  // Airzone master/slave gating (state-attribute derived; absent => treat as a
  // controllable master). The Primary Suite zone is a MASTER → full mode.
  isMaster: boolean;
  masterZone: string | null;
  hasGatingInfo: boolean;
  minTemp: number;
  maxTemp: number;
  unit: string;
}

export interface ShadeView {
  available: boolean;
  position: number; // 0..100 (100 = open)
}

export interface MediaView {
  available: boolean;
  playing: boolean;
  title: string;
  artist: string;
  source: string;
  albumArt: string | null;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0..100
}

export interface SuiteView {
  status: 'connecting' | 'live' | 'stale';
  lights: LightView[];
  groupOn: boolean;
  groupAvailable: boolean;
  lightsOnCount: number;
  lightsTotal: number;
  roomBrightness: number; // 0..100 average of the ON fixtures
  scenes: { id: string; name: string; meta: string; available: boolean }[];
  climate: ClimateView;
  shade: ShadeView;
  media: MediaView;
}

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

const toMode = (s: string | undefined): ClimateMode => {
  switch (String(s ?? '').toLowerCase()) {
    case 'cool': return 'cool';
    case 'heat': return 'heat';
    case 'heat_cool':
    case 'auto': return 'auto';
    default: return 'off';
  }
};

// Pull the topology (master/slave) off the climate entity's attributes. Supports
// the real Airzone attrs and the dev-demo bp_* convention; degrades to "master"
// (full mode control) when no topology info is present.
const readTopology = (attrs: Record<string, any> | undefined) => {
  if (!attrs) return { isMaster: true, masterZone: null as string | null, hasGatingInfo: false };
  const hasReal = 'is_master' in attrs || 'master_zone' in attrs || 'slave_zones' in attrs;
  const hasDemo = 'bp_is_master' in attrs || 'bp_master_zone' in attrs;
  const hasGatingInfo = hasReal || hasDemo;
  const masterFlag = attrs.is_master ?? attrs.bp_is_master;
  const masterZone = attrs.master_zone ?? attrs.bp_master_zone ?? null;
  const isMaster = masterFlag !== undefined
    ? masterFlag === true || masterFlag === 'true'
    : masterZone == null;
  return { isMaster, masterZone: masterZone != null ? String(masterZone) : null, hasGatingInfo };
};

// Pure projection of raw HA states into the panel view model. Exported for unit
// testing. No side effects; safe on the render hot path.
export const projectSuite = (ents: HassEntities): Omit<SuiteView, 'status'> => {
  const lights: LightView[] = SUITE_ENTITIES.lights.map((l) => {
    const e = ents[l.id];
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      available: isAvail(e),
      on: e?.state === 'on',
      level: lightLevel(e),
    };
  });

  const onLights = lights.filter((l) => l.on);
  const roomBrightness =
    onLights.length === 0
      ? 0
      : Math.round(onLights.reduce((s, l) => s + l.level, 0) / onLights.length);

  const groupE = ents[SUITE_ENTITIES.group];

  const climateE = ents[SUITE_ENTITIES.climate];
  const attrs = climateE?.attributes as Record<string, any> | undefined;
  const humidityE = ents['sensor.hd_primary_humidity'];
  const topo = readTopology(attrs);
  const rawMode = climateE && isAvail(climateE) ? String(climateE.state) : null;
  const climate: ClimateView = {
    available: isAvail(climateE),
    current: num(attrs?.current_temperature),
    setpoint: num(attrs?.temperature),
    mode: toMode(rawMode ?? undefined),
    rawMode,
    action: attrs?.hvac_action ? String(attrs.hvac_action) : null,
    humidity: num(humidityE?.state) ?? num(attrs?.current_humidity ?? attrs?.bp_humidity) ?? null,
    isMaster: topo.isMaster,
    masterZone: topo.masterZone,
    hasGatingInfo: topo.hasGatingInfo,
    minTemp: num(attrs?.min_temp) ?? 60,
    maxTemp: num(attrs?.max_temp) ?? 85,
    unit: attrs?.temperature_unit ? String(attrs.temperature_unit) : '°F',
  };

  const shadeE = ents[SUITE_ENTITIES.shade];
  const shadePos = num(shadeE?.attributes?.current_position);
  const shade: ShadeView = {
    available: isAvail(shadeE),
    position: shadePos === null ? (shadeE?.state === 'open' ? 100 : 0) : Math.round(shadePos),
  };

  const mediaE = ents[SUITE_ENTITIES.media];
  const media: MediaView = {
    available: isAvail(mediaE),
    playing: mediaE?.state === 'playing',
    title: String(mediaE?.attributes?.media_title ?? '—'),
    artist: String(mediaE?.attributes?.media_artist ?? ''),
    source: String(mediaE?.attributes?.friendly_name ?? 'Sonos'),
    albumArt: mediaE?.attributes?.entity_picture ? String(mediaE.attributes.entity_picture) : null,
    position: num(mediaE?.attributes?.media_position) ?? 0,
    duration: num(mediaE?.attributes?.media_duration) ?? 0,
    volume: Math.round((num(mediaE?.attributes?.volume_level) ?? 0) * 100),
  };

  return {
    lights,
    groupOn: groupE?.state === 'on',
    groupAvailable: isAvail(groupE),
    lightsOnCount: onLights.length,
    lightsTotal: lights.length,
    roomBrightness,
    scenes: SUITE_ENTITIES.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      meta: s.meta,
      available: !!ents[s.id],
    })),
    climate,
    shade,
    media,
  };
};

export interface SuiteActions {
  setLight: (id: string, level: number) => void;
  toggleLight: (id: string, on: boolean) => void;
  toggleGroup: (on: boolean) => void;
  setGroupBrightness: (level: number) => void;
  activateScene: (id: string) => void;
  setSetpoint: (temp: number) => void;
  setHvacMode: (mode: ClimateMode) => void;
  setShade: (position: number) => void;
  mediaPlayPause: () => void;
  mediaNext: () => void;
  mediaPrev: () => void;
  setVolume: (volume: number) => void;
}

export function usePrimarySuiteEntities(): SuiteView & { actions: SuiteActions } {
  const [view, setView] = useState<Omit<SuiteView, 'status'>>(() => projectSuite({}));
  const [status, setStatus] = useState<SuiteView['status']>('connecting');
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
          setView(projectSuite(ents));
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
  const toggleGroup = useCallback((on: boolean) => {
    callService('light', on ? 'turn_on' : 'turn_off', { entity_id: SUITE_ENTITIES.group });
  }, []);
  const setGroupBrightness = useCallback((level: number) => {
    if (level <= 0) callService('light', 'turn_off', { entity_id: SUITE_ENTITIES.group });
    else callService('light', 'turn_on', { entity_id: SUITE_ENTITIES.group, brightness_pct: level });
  }, []);
  const activateScene = useCallback((id: string) => {
    callService('scene', 'turn_on', { entity_id: id });
  }, []);
  const setSetpoint = useCallback((temp: number) => {
    callService('climate', 'set_temperature', { entity_id: SUITE_ENTITIES.climate, temperature: temp });
  }, []);
  const setHvacMode = useCallback((mode: ClimateMode) => {
    callService('climate', 'set_hvac_mode', { entity_id: SUITE_ENTITIES.climate, hvac_mode: mode });
  }, []);
  const setShade = useCallback((position: number) => {
    callService('cover', 'set_cover_position', { entity_id: SUITE_ENTITIES.shade, position });
  }, []);
  const mediaPlayPause = useCallback(() => {
    callService('media_player', 'media_play_pause', { entity_id: SUITE_ENTITIES.media });
  }, []);
  const mediaNext = useCallback(() => {
    callService('media_player', 'media_next_track', { entity_id: SUITE_ENTITIES.media });
  }, []);
  const mediaPrev = useCallback(() => {
    callService('media_player', 'media_previous_track', { entity_id: SUITE_ENTITIES.media });
  }, []);
  const setVolume = useCallback((volume: number) => {
    callService('media_player', 'volume_set', { entity_id: SUITE_ENTITIES.media, volume_level: volume / 100 });
  }, []);

  return {
    status,
    ...view,
    actions: {
      setLight,
      toggleLight,
      toggleGroup,
      setGroupBrightness,
      activateScene,
      setSetpoint,
      setHvacMode,
      setShade,
      mediaPlayPause,
      mediaNext,
      mediaPrev,
      setVolume,
    },
  };
}
