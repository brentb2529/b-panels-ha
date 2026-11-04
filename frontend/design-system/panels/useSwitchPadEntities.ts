// Live entity feed for the compact "Switch Pad" compilation panel.
//
// Built for small portrait wall panels (Portworld YC-SM55P, 5.5" 720×1280),
// where the full iPad compilation panels don't fit. Shows 4–6 big switch
// cards in the same liquid-glass identity as the other compilation panels.
//
// UNLIKE the other compilation panels, the entity set is NOT hard-coded here:
// it comes from the panel's own `tiles[]` (the normal admin tile editor), so
// each small panel in the house can carry a different 4 or 6 switches with no
// code change. The first MAX_SWITCHES tiles are used, in tile order.
//
// HAZARD POSTURE:
//   • light / switch / fan / input_boolean → toggle (homeassistant.turn_on/off
//     per domain). scene / script → momentary "run".
//   • Any other domain renders DISPLAY-ONLY (state shown, no write path).
//   • A tile flagged `isLocked` (view-only) is DISPLAY-ONLY here — no
//     actuation path at all, matching the grid tiles.
//   • A tile flagged requirePin asks for the PIN (via the dashboard's PIN pad)
//     before actuating — the panel component handles that prompt.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, callService } from '../../services/haClient';
import type { TileConfig } from '../../types';

export const MAX_SWITCHES = 6;

const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean']);
const MOMENTARY_DOMAINS = new Set(['scene', 'script']);
const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

export type SwitchKind = 'toggle' | 'momentary' | 'display';
export type SwitchIcon = 'light' | 'lamp' | 'fan' | 'outlet' | 'scene' | 'script' | 'power';

export interface SwitchView {
  key: string;            // tile id (stable React key)
  entityId: string;
  name: string;
  domain: string;
  kind: SwitchKind;
  icon: SwitchIcon;
  available: boolean;
  on: boolean;            // toggle state (false for momentary/display-off)
  brightness: number | null; // 0..100 for dimmable lights that are on, else null
  detail: string;         // short state line ("On · 80%", "Off", "Tap to run")
  gated: boolean;         // locked (view-only) → no actuation
  requirePin: boolean;
}

export interface SwitchPadView {
  status: 'connecting' | 'live' | 'stale';
  switches: SwitchView[];
  onCount: number;        // toggles currently on
  toggleCount: number;    // available toggles
  extraTiles: number;     // tiles beyond MAX_SWITCHES (ignored, surfaced in admin hint)
}

// HA-sourced tiles carry the entity_id as their deviceId.
export const resolveEntityId = (t: TileConfig): string => t.deviceId || '';

const iconFor = (domain: string, name: string): SwitchIcon => {
  const n = name.toLowerCase();
  if (domain === 'fan' || /\bfan\b/.test(n)) return 'fan';
  if (domain === 'scene') return 'scene';
  if (domain === 'script') return 'script';
  if (/lamp|sconce|pendant|chandelier/.test(n)) return 'lamp';
  if (domain === 'light' || /light/.test(n)) return 'light';
  if (/outlet|plug|socket/.test(n)) return 'outlet';
  return 'power';
};

const lightPct = (e: HassEntity): number | null => {
  if (e.state !== 'on') return null;
  const b = Number(e.attributes?.brightness);
  return Number.isFinite(b) ? Math.max(1, Math.round((b / 255) * 100)) : null;
};

export const projectSwitchPad = (
  ents: HassEntities,
  tiles: TileConfig[],
): Omit<SwitchPadView, 'status'> => {
  const used = tiles.filter((t) => resolveEntityId(t)).slice(0, MAX_SWITCHES);
  const switches: SwitchView[] = used.map((t) => {
    const entityId = resolveEntityId(t);
    const domain = entityId.split('.')[0] || '';
    const e = ents[entityId];
    const available = !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());
    const name = (t.label && t.label.trim()) || String(e?.attributes?.friendly_name || entityId);
    const gated = !!t.isLocked;
    const requirePin = !!t.requirePin;
    const kind: SwitchKind = gated
      ? 'display'
      : TOGGLE_DOMAINS.has(domain) ? 'toggle'
      : MOMENTARY_DOMAINS.has(domain) ? 'momentary'
      : 'display';
    const on = available && (TOGGLE_DOMAINS.has(domain) || kind === 'display') && e!.state === 'on';
    const brightness = available && domain === 'light' ? lightPct(e!) : null;

    let detail: string;
    if (!e) detail = 'Not found';
    else if (!available) detail = 'Unavailable';
    else if (kind === 'momentary') detail = domain === 'scene' ? 'Tap to set' : 'Tap to run';
    else if (on) detail = brightness !== null ? `On · ${brightness}%` : 'On';
    else if (e.state === 'off') detail = 'Off';
    else { const st = String(e.state).replace(/_/g, ' '); detail = st.charAt(0).toUpperCase() + st.slice(1); }

    return {
      key: t.id, entityId, name, domain, kind,
      icon: iconFor(domain, name),
      available, on, brightness, detail, gated, requirePin,
    };
  });
  const toggles = switches.filter((s) => s.kind === 'toggle' && s.available);
  return {
    switches,
    onCount: toggles.filter((s) => s.on).length,
    toggleCount: toggles.length,
    extraTiles: Math.max(0, tiles.filter((t) => resolveEntityId(t)).length - MAX_SWITCHES),
  };
};

export interface SwitchPadActions {
  /** Toggle / run one switch. No-op for display-only or gated switches. */
  activate: (s: SwitchView) => void;
  /** Turn every available, non-gated toggle off. */
  allOff: () => void;
}

export function useSwitchPadEntities(tiles: TileConfig[]): SwitchPadView & { actions: SwitchPadActions } {
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const entsRef = useRef<HassEntities>({});
  const [view, setView] = useState(() => projectSwitchPad({}, tiles));
  const [status, setStatus] = useState<SwitchPadView['status']>('connecting');

  // Re-project when the panel's tile list changes (admin edit / config push).
  useEffect(() => { setView(projectSwitchPad(entsRef.current, tiles)); }, [tiles]);

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
          setView(projectSwitchPad(ents, tilesRef.current));
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

  const activate = useCallback((s: SwitchView) => {
    if (s.gated || !s.available) return;
    if (s.kind === 'toggle') {
      callService(s.domain, s.on ? 'turn_off' : 'turn_on', { entity_id: s.entityId });
    } else if (s.kind === 'momentary') {
      callService(s.domain, 'turn_on', { entity_id: s.entityId });
    }
  }, []);

  const allOff = useCallback(() => {
    const current = projectSwitchPad(entsRef.current, tilesRef.current).switches;
    const byDomain = new Map<string, string[]>();
    current
      .filter((s) => s.kind === 'toggle' && s.available && s.on && !s.requirePin)
      .forEach((s) => byDomain.set(s.domain, [...(byDomain.get(s.domain) || []), s.entityId]));
    byDomain.forEach((ids, domain) => callService(domain, 'turn_off', { entity_id: ids }));
  }, []);

  return { status, ...view, actions: { activate, allOff } };
}
