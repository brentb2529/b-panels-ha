// Live entity feed for the whole-home Lighting compilation panel (Increment 8).
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-lighting-v14cool(-light).html
// (the near-achromatic "platinum" Lights identity) into a real in-app panel.
//
// SAFETY / HAZARD POSTURE — lighting is LIVE but LOW-HAZARD:
//   • Whole-home SCENES  → scene.turn_on               (LIVE)
//   • By-area group dim  → light.turn_on/turn_off + brightness_pct on a curated
//                          per-area set of light.* entities                (LIVE)
//   • Shades & covers    → cover.set_cover_position                       (LIVE)
//   • Persistent arming  → REAL alarm_control_panel.house — DISPLAY-ONLY (read
//                          via useDashboard in the panel, never written here)
//   • Keypad LED state   → binary_sensor.<keypad>_<button>_led — DISPLAY-ONLY
//                          DIAGNOSTIC. LED *control* is deferred / equipment-
//                          gated, so we render LED state only and expose NO
//                          toggle / write path for it.
//
// AREA GROUPING is a CURATED area→entities map declared right here in config —
// it is NOT a runtime area-registry read (matching every prior panel). "N of M
// on" is panel-side aggregation that EXCLUDES unavailable fixtures. Reads come
// through subscribeEntities; controls through callService — the same haClient
// the rest of the app uses.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';

// ── Curated config — NO runtime area-registry read ──────────────────────────
// Whole-home scenes (front-and-center, primary). Real scene.* entities in dev.
export const LIGHTING_SCENES = [
  { id: 'scene.home_morning', name: 'Morning', icon: 'sun' },
  { id: 'scene.home_away', name: 'Away', icon: 'house' },
  { id: 'scene.home_evening', name: 'Evening', icon: 'moon' },
  { id: 'scene.home_night', name: 'Night', icon: 'crescent' },
  // "All Off" is a synthetic scene → turns every curated area light off.
  { id: '__all_off__', name: 'All Off', icon: 'power' },
] as const;

// Curated areas. Each lists the light.* entities that belong to it. The area
// toggle / master-dim acts on these as a set; "N of M on" counts the available,
// on fixtures. Built from the dev demo light.* set (see useKitchenEntities etc).
export const LIGHTING_AREAS: { name: string; lights: string[] }[] = [
  { name: 'Kitchen', lights: ['light.island_pendants', 'light.under_cabinet', 'light.recessed_cans', 'light.breakfast_nook', 'light.kitchen_house_lights'] },
  { name: 'Family Room', lights: ['light.great_room_lights', 'light.cove_ceiling', 'light.foyer_lights', 'light.family_lamp', 'light.family_accent'] },
  { name: 'Primary Suite', lights: ['light.master_lights', 'light.bedside_left', 'light.bedside_right'] },
  { name: 'Dining', lights: ['light.dining_chandelier', 'light.dining_buffet', 'light.dining_sconces'] },
  { name: 'Patio', lights: ['light.patio_lights', 'light.patio_overhead', 'light.patio_path'] },
  { name: 'Office', lights: ['light.office_lights', 'light.office_desk', 'light.office_accent'] },
];

// All curated area lights flattened — used by the synthetic "All Off" scene and
// the whole-home "N of M on" hero summary. (Excludes pool/cabana/gym/theater so
// "whole home" here means the curated living areas, like the exemplar's 6.)
const ALL_AREA_LIGHTS = LIGHTING_AREAS.flatMap((a) => a.lights);

// Shades & covers (right satellite). Real cover.* entities in dev.
export const LIGHTING_SHADES = [
  { id: 'cover.window_shade_n', name: 'Great Room S' },
  { id: 'cover.patio_shade_e', name: 'Patio Shade E' },
  { id: 'cover.blackout_shade', name: 'Suite Blackout' },
] as const;

// Lutron keypads — DISPLAY-ONLY LED state (diagnostic). LED control is deferred
// / equipment-gated → we read binary_sensor.<keypad>_<button>_led and render
// state only. NO write path exists for these.
export const LIGHTING_KEYPADS: { name: string; tag: string; buttons: { id: string; label: string }[] }[] = [
  {
    name: 'Great Room · Entry 5-button',
    tag: 'Diagnostic',
    buttons: [
      { id: 'binary_sensor.great_room_entry_evening_led', label: 'Evening' },
      { id: 'binary_sensor.great_room_entry_entertain_led', label: 'Entertain' },
      { id: 'binary_sensor.great_room_entry_dim_led', label: 'Dim' },
      { id: 'binary_sensor.great_room_entry_all_off_led', label: 'All Off' },
    ],
  },
  {
    name: 'Primary Suite · 4-button',
    tag: 'Diagnostic',
    buttons: [
      { id: 'binary_sensor.suite_keypad_relax_led', label: 'Relax' },
      { id: 'binary_sensor.suite_keypad_read_led', label: 'Read' },
      { id: 'binary_sensor.suite_keypad_goodnight_led', label: 'Goodnight' },
    ],
  },
];

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);
const isAvail = (e?: HassEntity) => !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// brightness (0..255) → 0..100, 100 default when on with no brightness attr.
const lightLevel = (e?: HassEntity): number => {
  if (!e || e.state !== 'on') return 0;
  const b = num(e.attributes?.brightness);
  return b === null ? 100 : Math.round((b / 255) * 100);
};

// cover position (0..100, 100 = open). Falls back to open/closed binary state.
const coverPosition = (e?: HassEntity): number => {
  const p = num(e?.attributes?.current_position);
  if (p !== null) return Math.max(0, Math.min(100, Math.round(p)));
  if (e?.state === 'open') return 100;
  return 0;
};

// ── Projected views (pure, exported for unit testing) ───────────────────────
export interface AreaView {
  name: string;
  lights: string[];      // entity ids in this area
  total: number;         // available fixtures (M)
  onCount: number;       // available + on fixtures (N)
  anyOn: boolean;        // group toggle state (N > 0)
  available: boolean;    // at least one fixture present/available
  brightness: number;    // 0..100 average of the ON fixtures (master dim)
}

export interface SceneView {
  id: string;
  name: string;
  icon: string;
  available: boolean;
  lastActivated: string | null; // display clock of real last activation, else null
  ts: number;                    // epoch ms (0 if never / synthetic)
}

export interface ShadeView {
  id: string;
  name: string;
  available: boolean;
  position: number; // 0..100 (100 = open)
}

export interface KeypadButtonView {
  id: string;
  label: string;
  available: boolean;
  on: boolean; // LED lit
}

export interface KeypadView {
  name: string;
  tag: string;
  buttons: KeypadButtonView[];
}

export interface LightingView {
  status: 'connecting' | 'live' | 'stale';
  scenes: SceneView[];
  lastScene: { name: string; clock: string } | null;
  areas: AreaView[];
  shades: ShadeView[];
  keypads: KeypadView[];
  // whole-home summary (curated area lights only)
  onTotal: number;   // N on across all curated areas
  fixtureTotal: number; // M available across all curated areas
  scenesCount: number;
  shadesCount: number;
}

const fmtClock = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${ampm}`;
};

export const projectLighting = (ents: HassEntities): Omit<LightingView, 'status'> => {
  // ── areas: aggregate "N of M on" + average brightness (exclude unavailable) ──
  const areas: AreaView[] = LIGHTING_AREAS.map((a) => {
    const present = a.lights.map((id) => ents[id]).filter((e) => isAvail(e)) as HassEntity[];
    const onFix = present.filter((e) => e.state === 'on');
    const total = present.length;
    const onCount = onFix.length;
    const levels = onFix.map((e) => lightLevel(e));
    const brightness = levels.length ? Math.round(levels.reduce((s, n) => s + n, 0) / levels.length) : 0;
    return {
      name: a.name,
      lights: a.lights,
      total,
      onCount,
      anyOn: onCount > 0,
      available: total > 0,
      brightness,
    };
  });

  // ── scenes: real last-activated from scene entity state (an ISO timestamp) ──
  const scenes: SceneView[] = LIGHTING_SCENES.map((s) => {
    if (s.id === '__all_off__') {
      return { id: s.id, name: s.name, icon: s.icon, available: true, lastActivated: null, ts: 0 };
    }
    const e = ents[s.id];
    const available = !!e;
    // A scene's state IS the ISO timestamp of its last activation (HA convention).
    const iso = e?.state && !UNAVAILABLE.has(String(e.state).toLowerCase()) ? String(e.state) : null;
    const d = iso ? new Date(iso) : null;
    const valid = d && !Number.isNaN(d.getTime());
    return {
      id: s.id,
      name: s.name,
      icon: s.icon,
      available,
      lastActivated: valid ? fmtClock(iso) : null,
      ts: valid ? d!.getTime() : 0,
    };
  });

  // last activated scene (most recent real ts) → drives hero "Last scene: …".
  // NOTE: we do NOT mark a scene "active" — a scene has no persistent active
  // state; we only surface which one most recently fired (faithful to exemplar
  // intent: "no fake active").
  const fired = scenes.filter((s) => s.ts > 0).sort((a, b) => b.ts - a.ts);
  const lastScene = fired.length ? { name: fired[0].name, clock: fired[0].lastActivated! } : null;

  const shades: ShadeView[] = LIGHTING_SHADES.map((sh) => {
    const e = ents[sh.id];
    return { id: sh.id, name: sh.name, available: isAvail(e), position: coverPosition(e) };
  });

  const keypads: KeypadView[] = LIGHTING_KEYPADS.map((kp) => ({
    name: kp.name,
    tag: kp.tag,
    buttons: kp.buttons.map((b) => {
      const e = ents[b.id];
      return { id: b.id, label: b.label, available: isAvail(e), on: e?.state === 'on' };
    }),
  }));

  const onTotal = areas.reduce((s, a) => s + a.onCount, 0);
  const fixtureTotal = ALL_AREA_LIGHTS.map((id) => ents[id]).filter((e) => isAvail(e)).length;

  return {
    scenes,
    lastScene,
    areas,
    shades,
    keypads,
    onTotal,
    fixtureTotal,
    scenesCount: LIGHTING_SCENES.filter((s) => s.id !== '__all_off__').length,
    shadesCount: LIGHTING_SHADES.length,
  };
};

export interface LightingActions {
  activateScene: (id: string) => void;          // scene.turn_on (or synthetic All Off)
  toggleArea: (name: string, on: boolean) => void; // light.turn_on/off on the area set
  setAreaBrightness: (name: string, level: number) => void; // brightness_pct on the area set
  setShade: (id: string, position: number) => void; // cover.set_cover_position
}

export function useLightingEntities(): LightingView & { actions: LightingActions } {
  const [view, setView] = useState<Omit<LightingView, 'status'>>(() => projectLighting({}));
  const [status, setStatus] = useState<LightingView['status']>('connecting');
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
          setView(projectLighting(ents));
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

  // Resolve the AVAILABLE light entity ids for a curated area (exclude missing).
  const areaLightIds = useCallback((name: string): string[] => {
    const a = LIGHTING_AREAS.find((x) => x.name === name);
    if (!a) return [];
    return a.lights.filter((id) => isAvail(entsRef.current[id]));
  }, []);

  const activateScene = useCallback((id: string) => {
    if (id === '__all_off__') {
      // synthetic "All Off" → turn every available curated area light off.
      const ids = ALL_AREA_LIGHTS.filter((x) => isAvail(entsRef.current[x]));
      if (ids.length) callService('light', 'turn_off', { entity_id: ids });
      return;
    }
    callService('scene', 'turn_on', { entity_id: id });
  }, []);

  const toggleArea = useCallback((name: string, on: boolean) => {
    const ids = areaLightIds(name);
    if (ids.length) callService('light', on ? 'turn_on' : 'turn_off', { entity_id: ids });
  }, [areaLightIds]);

  const setAreaBrightness = useCallback((name: string, level: number) => {
    const ids = areaLightIds(name);
    if (!ids.length) return;
    if (level <= 0) callService('light', 'turn_off', { entity_id: ids });
    else callService('light', 'turn_on', { entity_id: ids, brightness_pct: level });
  }, [areaLightIds]);

  const setShade = useCallback((id: string, position: number) => {
    callService('cover', 'set_cover_position', { entity_id: id, position });
  }, []);

  // NOTE: NO keypad-LED action is returned. Keypad LED control is deferred /
  // equipment-gated → display-only. There is intentionally no write path for it.
  return {
    status,
    ...view,
    actions: { activateScene, toggleArea, setAreaBrightness, setShade },
  };
}
