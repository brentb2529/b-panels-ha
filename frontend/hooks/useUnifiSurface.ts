/**
 * useUnifiSurface — discovers and subscribes to UniFi Protect entities from HA.
 *
 * All data is read-only. No writes, no RTSP creds, no plate text (PII), no
 * floodlight control (equipment-gated). Binds to Surface 5 of ENTITY_CONTRACT.md.
 *
 * Discovery is dynamic: the hook scans subscribeEntities for:
 *   camera.*             → one UnifiCamera per camera entity
 *   binary_sensor.*_motion / _doorbell / _person / _vehicle / _animal
 *                        / _package / _license_plate_detected
 *   event.*_doorbell / _vehicle / _nfc / _fingerprint
 *   light.*              → floodlights (display-only, no control)
 *
 * Sibling entities are correlated by device_id (from the HA entity registry).
 * When the registry is unavailable we fall back to name-prefix matching.
 *
 * Each UnifiCamera emits:
 *   entityId              camera.* entity id
 *   name                  friendly_name
 *   entityPicture         HA-proxied snapshot URL (no RTSP)
 *   motionActive          binary_sensor.*_motion state
 *   doorbellActive        binary_sensor.*_doorbell state
 *   detections            smart-detect flags (person/vehicle/animal/package)
 *   licensePlateDetected  boolean — plate TEXT is NEVER surfaced (PII)
 *   lastEvent             most recent event entity data
 *   recentEvents          last N event records
 *   floodlightOn          boolean (state only — control is deferred)
 *   floodlightEntityId    for state display only
 *   isStale               true when >MAX_STALE_MS has passed since last update
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as haClient from '../services/haClient';
import type { HassEntities } from 'home-assistant-js-websocket';

// Surface 5 PROPOSED detection suffixes (binary_sensor)
const DETECTION_SUFFIXES = ['_motion', '_doorbell', '_person', '_vehicle', '_animal', '_package', '_license_plate_detected'] as const;
type DetectionSuffix = typeof DETECTION_SUFFIXES[number];

// Smart-detect classes (subset of suffixes, excluding motion/doorbell/lp)
export type SmartDetectClass = 'person' | 'vehicle' | 'animal' | 'package';

export interface UnifiDetections {
  person: boolean;
  vehicle: boolean;
  animal: boolean;
  package: boolean;
}

export interface UnifiEvent {
  entityId: string;
  kind: 'doorbell' | 'vehicle' | 'nfc' | 'fingerprint' | 'unknown';
  lastChanged: string;
  lastUpdated: string;
  /** Raw HA event entity state (e.g. the event_type attr) — text-safe */
  eventType: string | null;
}

export interface UnifiCamera {
  entityId: string;
  name: string;
  entityPicture: string | null;
  /** Motion binary_sensor active */
  motionActive: boolean;
  /** Doorbell ring binary_sensor active */
  doorbellActive: boolean;
  detections: UnifiDetections;
  /**
   * License plate DETECTED (boolean only).
   * SECURITY: plate text is NEVER surfaced — it is PII. We only show
   * whether a plate was seen, not what plate it was.
   */
  licensePlateDetected: boolean;
  recentEvents: UnifiEvent[];
  /** Associated floodlight entity (display-only, no control) */
  floodlightEntityId: string | null;
  floodlightOn: boolean;
  isStale: boolean;
  lastActivityAt: number;
}

export interface UnifiSurfaceState {
  cameras: UnifiCamera[];
  floodlights: { entityId: string; name: string; isOn: boolean }[];
  isLoading: boolean;
  hasAnyActivity: boolean;
  /** True when the surface has zero cameras */
  isEmpty: boolean;
}

const MAX_STALE_MS = 120_000; // 2 min without any HA update = stale
const MAX_RECENT_EVENTS = 5;
// Floodlights: only `light.*` entities whose id or name contains 'flood'
const FLOODLIGHT_RE = /flood/i;
// Camera entity prefix pattern: entity_id starts with 'camera.'
// Sibling sensors follow the form binary_sensor.<cam_prefix>_<suffix>
// where <cam_prefix> is the camera entity name after 'camera.'

function eventKind(entityId: string): UnifiEvent['kind'] {
  if (entityId.includes('_doorbell')) return 'doorbell';
  if (entityId.includes('_vehicle')) return 'vehicle';
  if (entityId.includes('_nfc')) return 'nfc';
  if (entityId.includes('_fingerprint')) return 'fingerprint';
  return 'unknown';
}

/**
 * Build a map of camPrefix → entity_ids[] for sibling matching.
 * We attempt two strategies in order:
 *   1. device_id map (most reliable — correlates via HA device registry)
 *   2. name prefix matching (fallback)
 */
function buildSiblingMap(
  entities: HassEntities,
  deviceMap: Record<string, string>
): Map<string, string[]> {
  // device_id → entity_ids
  const byDevice = new Map<string, string[]>();
  for (const [eid, e] of Object.entries(entities)) {
    const did = deviceMap[eid];
    if (did) {
      if (!byDevice.has(did)) byDevice.set(did, []);
      byDevice.get(did)!.push(eid);
    }
  }
  // camEntityId → all sibling entity_ids (including itself)
  const result = new Map<string, string[]>();
  for (const [eid, e] of Object.entries(entities)) {
    if (!eid.startsWith('camera.')) continue;
    const did = deviceMap[eid];
    if (did && byDevice.has(did)) {
      result.set(eid, byDevice.get(did)!);
    } else {
      // Fallback: prefix match. camera.front_door → binary_sensor.front_door_*
      const prefix = eid.replace(/^camera\./, '');
      const siblings = Object.keys(entities).filter(
        id => id !== eid && (
          id.startsWith(`binary_sensor.${prefix}`) ||
          id.startsWith(`event.${prefix}`) ||
          id.startsWith(`light.${prefix}`) ||
          FLOODLIGHT_RE.test(id)
        )
      );
      result.set(eid, [eid, ...siblings]);
    }
  }
  return result;
}

function buildCamera(
  camEntityId: string,
  entities: HassEntities,
  siblings: string[],
  now: number
): UnifiCamera {
  const camEntity = entities[camEntityId];
  const name = camEntity?.attributes?.friendly_name || camEntityId;
  const entityPicture = camEntity?.attributes?.entity_picture ?? null;

  const detections: UnifiDetections = { person: false, vehicle: false, animal: false, package: false };
  let motionActive = false;
  let doorbellActive = false;
  let licensePlateDetected = false;
  let floodlightEntityId: string | null = null;
  let floodlightOn = false;
  const recentEvents: UnifiEvent[] = [];
  let lastActivityAt = 0;

  for (const sid of siblings) {
    if (sid === camEntityId) continue;
    const se = entities[sid];
    if (!se) continue;

    const isOn = se.state === 'on';

    if (sid.startsWith('binary_sensor.')) {
      if (sid.endsWith('_motion') || se.attributes?.device_class === 'motion') {
        motionActive = isOn;
      } else if (sid.endsWith('_doorbell') || se.attributes?.device_class === 'occupancy') {
        doorbellActive = isOn;
      } else if (sid.endsWith('_person')) {
        detections.person = isOn;
      } else if (sid.endsWith('_vehicle')) {
        detections.vehicle = isOn;
      } else if (sid.endsWith('_animal')) {
        detections.animal = isOn;
      } else if (sid.endsWith('_package')) {
        detections.package = isOn;
      } else if (sid.endsWith('_license_plate_detected')) {
        // SECURITY: boolean only — plate text is NEVER read or surfaced.
        licensePlateDetected = isOn;
      }
      if (isOn && se.last_changed) {
        const t = new Date(se.last_changed).getTime();
        if (t > lastActivityAt) lastActivityAt = t;
      }
    } else if (sid.startsWith('event.')) {
      const eventType: string | null = se.attributes?.event_type ?? se.attributes?.event_types?.[0] ?? null;
      recentEvents.push({
        entityId: sid,
        kind: eventKind(sid),
        lastChanged: se.last_changed ?? '',
        lastUpdated: se.last_updated ?? '',
        eventType,
      });
    } else if (sid.startsWith('light.') && FLOODLIGHT_RE.test(sid)) {
      // display only — no control wired
      floodlightEntityId = sid;
      floodlightOn = se.state === 'on';
    }
  }

  // Sort events newest first, cap at MAX_RECENT_EVENTS
  recentEvents.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
  const cappedEvents = recentEvents.slice(0, MAX_RECENT_EVENTS);

  const lastUpdateMs = camEntity?.last_updated ? new Date(camEntity.last_updated).getTime() : 0;
  const isStale = now - Math.max(lastUpdateMs, lastActivityAt) > MAX_STALE_MS;

  return {
    entityId: camEntityId,
    name,
    entityPicture,
    motionActive,
    doorbellActive,
    detections,
    licensePlateDetected,
    recentEvents: cappedEvents,
    floodlightEntityId,
    floodlightOn,
    isStale,
    lastActivityAt: Math.max(lastUpdateMs, lastActivityAt),
  };
}

export function useUnifiSurface(): UnifiSurfaceState {
  const [state, setState] = useState<UnifiSurfaceState>({
    cameras: [],
    floodlights: [],
    isLoading: true,
    hasAnyActivity: false,
    isEmpty: false,
  });

  // Device map cached — only fetched once, doesn't need refresh (stable)
  const deviceMapRef = useRef<Record<string, string>>({});
  const unsubRef = useRef<(() => void) | null>(null);

  const buildState = useCallback((entities: HassEntities, deviceMap: Record<string, string>) => {
    const now = Date.now();
    const siblingMap = buildSiblingMap(entities, deviceMap);

    const cameras: UnifiCamera[] = [];
    for (const [camId, siblings] of siblingMap.entries()) {
      cameras.push(buildCamera(camId, entities, siblings, now));
    }

    // Sort cameras: most recent activity first, then alphabetically
    cameras.sort((a, b) => {
      if (b.lastActivityAt !== a.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
      return a.name.localeCompare(b.name);
    });

    // Standalone floodlights (not sibling to any camera)
    const siblingFloodlights = new Set(cameras.flatMap(c => c.floodlightEntityId ? [c.floodlightEntityId] : []));
    const floodlights = Object.entries(entities)
      .filter(([eid, e]) => eid.startsWith('light.') && FLOODLIGHT_RE.test(eid) && !siblingFloodlights.has(eid))
      .map(([eid, e]) => ({
        entityId: eid,
        name: e.attributes?.friendly_name || eid,
        isOn: e.state === 'on',
      }));

    const hasAnyActivity = cameras.some(
      c => c.motionActive || c.doorbellActive || Object.values(c.detections).some(Boolean) || c.licensePlateDetected
    );

    setState({
      cameras,
      floodlights,
      isLoading: false,
      hasAnyActivity,
      isEmpty: cameras.length === 0,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Fetch entity→device map once
      const deviceMap = await haClient.getEntityDeviceMap();
      if (cancelled) return;
      deviceMapRef.current = deviceMap;

      // Subscribe to live entity updates
      const unsub = await haClient.subscribeEntities((entities: HassEntities) => {
        if (cancelled) return;
        buildState(entities, deviceMapRef.current);
      });

      if (cancelled) {
        unsub();
        return;
      }
      unsubRef.current = unsub;
    };

    init().catch(err => {
      console.warn('[UnifiSurface] init error:', err);
      if (!cancelled) {
        setState(s => ({ ...s, isLoading: false }));
      }
    });

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [buildState]);

  return state;
}
