// Live entity feed for the Kitchen compilation panel (Increment 2).
//
// Owns ONE subscribeEntities subscription (no polling) and projects the raw HA
// states into the shape the KitchenPanel renders. Controls are issued via
// callService through the same haClient the rest of the app uses. Every value
// here is REAL live state — nothing is faked; a tile shows an em-dash / "off"
// when its entity is missing or unavailable.
//
// The bound entities (all LOCKED display/control, none equipment-gated):
//   lights (dimmer): light.island_pendants / light.under_cabinet /
//                    light.recessed_cans / light.breakfast_nook
//   light group:     light.all_kitchen_lights
//   scenes:          scene.kitchen_morning / _cook / _dine / _clean_up
//   climate:         climate.kitchen_zone (slave-zone gating from bp_* attrs)
//   shade:           cover.window_shade_n
//   media:           media_player.kitchen_sonos (display fixture in dev)
// The arming bar is NOT here — it reads the REAL alarm_control_panel.house via
// useDashboard()'s alarmState/armingState.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';

export const KITCHEN_ENTITIES = {
  lights: [
    { id: 'light.island_pendants', name: 'Island Pendants', kind: 'Pendant' },
    { id: 'light.under_cabinet', name: 'Under Cabinet', kind: 'Strip' },
    { id: 'light.recessed_cans', name: 'Recessed Cans', kind: 'Downlight' },
    { id: 'light.breakfast_nook', name: 'Breakfast Nook', kind: 'Pendant' },
  ] as const,
  group: 'light.all_kitchen_lights',
  scenes: [
    { id: 'scene.kitchen_morning', name: 'Morning', meta: 'Soft daylight' },
    { id: 'scene.kitchen_cook', name: 'Cook', meta: 'Full bright · task' },
    { id: 'scene.kitchen_dine', name: 'Dine', meta: 'Pendant low' },
    { id: 'scene.kitchen_clean_up', name: 'Clean Up', meta: 'Bright cool' },
  ] as const,
  climate: 'climate.kitchen_zone',
  shade: 'cover.window_shade_n',
  media: 'media_player.kitchen_sonos',
} as const;

export interface LightView {
  id: string;
  name: string;
  kind: string;
  available: boolean;
  on: boolean;
  level: number; // 0..100
}

export interface ClimateView {
  available: boolean;
  current: number | null;
  setpoint: number | null;
  mode: string; // hvac mode (off/cool/heat/heat_cool/auto)
  action: string | null; // hvac_action (idle/cooling/heating)
  humidity: number | null;
  // Airzone-style master/slave gating (read from bp_* attrs; absent => not a slave).
  isMaster: boolean;
  masterZone: string | null;
  hasGatingInfo: boolean;
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

export interface KitchenView {
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

// Exported for unit testing — pure projection of raw HA states into the panel
// view model. No side effects; safe on the render hot path.
export const projectKitchen = (ents: HassEntities): Omit<KitchenView, 'status'> => {
  const lights: LightView[] = KITCHEN_ENTITIES.lights.map((l) => {
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

  const groupE = ents[KITCHEN_ENTITIES.group];

  const climateE = ents[KITCHEN_ENTITIES.climate];
  const humidityE = ents['sensor.kd_zone_humidity'];
  const climate: ClimateView = {
    available: isAvail(climateE),
    current: num(climateE?.attributes?.current_temperature),
    setpoint: num(climateE?.attributes?.temperature),
    mode: climateE ? String(climateE.state) : 'off',
    action: climateE?.attributes?.hvac_action ? String(climateE.attributes.hvac_action) : null,
    humidity:
      num(climateE?.attributes?.bp_humidity) ?? num(humidityE?.state) ?? null,
    isMaster: climateE?.attributes?.bp_is_master === true,
    masterZone: climateE?.attributes?.bp_master_zone
      ? String(climateE.attributes.bp_master_zone)
      : null,
    hasGatingInfo: climateE ? 'bp_is_master' in (climateE.attributes || {}) : false,
    unit: '°F',
  };

  const shadeE = ents[KITCHEN_ENTITIES.shade];
  const shadePos = num(shadeE?.attributes?.current_position);
  const shade: ShadeView = {
    available: isAvail(shadeE),
    position: shadePos === null ? (shadeE?.state === 'open' ? 100 : 0) : Math.round(shadePos),
  };

  const mediaE = ents[KITCHEN_ENTITIES.media];
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
    scenes: KITCHEN_ENTITIES.scenes.map((s) => ({
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

export interface KitchenActions {
  setLight: (id: string, level: number) => void;
  toggleLight: (id: string, on: boolean) => void;
  toggleGroup: (on: boolean) => void;
  setGroupBrightness: (level: number) => void;
  activateScene: (id: string) => void;
  setSetpoint: (temp: number) => void;
  setShade: (position: number) => void;
  mediaPlayPause: () => void;
  mediaNext: () => void;
  mediaPrev: () => void;
  setVolume: (volume: number) => void;
}

export function useKitchenEntities(): KitchenView & { actions: KitchenActions } {
  const [view, setView] = useState<Omit<KitchenView, 'status'>>(() => projectKitchen({}));
  const [status, setStatus] = useState<KitchenView['status']>('connecting');
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
          setView(projectKitchen(ents));
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
    callService('light', on ? 'turn_on' : 'turn_off', { entity_id: KITCHEN_ENTITIES.group });
  }, []);
  const setGroupBrightness = useCallback((level: number) => {
    if (level <= 0) callService('light', 'turn_off', { entity_id: KITCHEN_ENTITIES.group });
    else callService('light', 'turn_on', { entity_id: KITCHEN_ENTITIES.group, brightness_pct: level });
  }, []);
  const activateScene = useCallback((id: string) => {
    callService('scene', 'turn_on', { entity_id: id });
  }, []);
  const setSetpoint = useCallback((temp: number) => {
    callService('climate', 'set_temperature', { entity_id: KITCHEN_ENTITIES.climate, temperature: temp });
  }, []);
  const setShade = useCallback((position: number) => {
    callService('cover', 'set_cover_position', { entity_id: KITCHEN_ENTITIES.shade, position });
  }, []);
  const mediaPlayPause = useCallback(() => {
    callService('media_player', 'media_play_pause', { entity_id: KITCHEN_ENTITIES.media });
  }, []);
  const mediaNext = useCallback(() => {
    callService('media_player', 'media_next_track', { entity_id: KITCHEN_ENTITIES.media });
  }, []);
  const mediaPrev = useCallback(() => {
    callService('media_player', 'media_previous_track', { entity_id: KITCHEN_ENTITIES.media });
  }, []);
  const setVolume = useCallback((volume: number) => {
    callService('media_player', 'volume_set', { entity_id: KITCHEN_ENTITIES.media, volume_level: volume / 100 });
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
      setShade,
      mediaPlayPause,
      mediaNext,
      mediaPrev,
      setVolume,
    },
  };
}
