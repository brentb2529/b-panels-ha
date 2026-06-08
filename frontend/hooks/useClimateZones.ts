// Live climate-zone feed for the Air Control surface.
//
// Owns a single `subscribeEntities` subscription (NO polling) and derives the
// list of controllable climate zones from it. Tracks connection health so the
// surface can show a "stale / reconnecting" indicator when the websocket drops,
// and layers OPTIMISTIC control overrides on top of real state so a tap feels
// instant; each override auto-clears once the real entity catches up (or after
// a timeout, so a dropped command can't pin a stale value forever).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities, getClimateZoneIdMap } from '../services/haClient';
import {
    discoverClimateZones,
    groupClimateZones,
    resolveModeTarget,
    setFanMode as svcSetFanMode,
    setHvacMode as svcSetHvacMode,
    setTargetTemperature as svcSetTargetTemperature,
    type ClimateGroup,
    type ClimateZone,
} from '../services/climate';

// How long an optimistic value sticks before we give up and fall back to real
// state (covers a command that failed or never echoed back).
const OPTIMISTIC_TTL_MS = 8000;

type ConnStatus = 'connecting' | 'live' | 'stale';

interface OptimisticPatch {
    hvacMode?: string;
    fanMode?: string;
    targetTemperature?: number;
    at: number;
}

export interface UseClimateZones {
    zones: ClimateZone[];
    /** Zones grouped into master/slave clusters + standalone zones. */
    groups: ClimateGroup[];
    status: ConnStatus;
    /** Optimistically set a zone's setpoint and fire the HA service. */
    setTargetTemperature: (entityId: string, temperature: number) => void;
    /**
     * Set a zone's hvac_mode, routing SLAVE zones to their owning master's
     * entity_id (calling set_hvac_mode on a slave hard-fails today). Pass the
     * zone + its group so routing can be resolved. A no-op for slaves whose
     * master can't be resolved (the UI disables the control in that case).
     */
    setHvacMode: (zone: ClimateZone, group: ClimateGroup, hvacMode: string) => void;
    /** Optimistically set a zone's fan_mode and fire the HA service. */
    setFanMode: (entityId: string, fanMode: string) => void;
}

// Merge an optimistic patch onto a real zone, dropping fields the real state
// has already caught up to (so the override doesn't linger once HA agrees).
function applyPatch(zone: ClimateZone, patch: OptimisticPatch | undefined): ClimateZone {
    if (!patch) return zone;
    if (Date.now() - patch.at > OPTIMISTIC_TTL_MS) return zone;
    const next = { ...zone };
    if (patch.hvacMode !== undefined && patch.hvacMode !== zone.hvacMode) next.hvacMode = patch.hvacMode;
    if (patch.fanMode !== undefined && patch.fanMode !== zone.fanMode) next.fanMode = patch.fanMode;
    if (patch.targetTemperature !== undefined && patch.targetTemperature !== zone.targetTemperature) {
        next.targetTemperature = patch.targetTemperature;
    }
    return next;
}

export function useClimateZones(): UseClimateZones {
    const [zones, setZones] = useState<ClimateZone[]>([]);
    const [groups, setGroups] = useState<ClimateGroup[]>([]);
    const [status, setStatus] = useState<ConnStatus>('connecting');
    // Optimistic overrides, keyed by entity_id. Held in a ref so firing a
    // command doesn't depend on the latest render, plus mirrored into a state
    // bump to trigger re-render.
    const patchesRef = useRef<Record<string, OptimisticPatch>>({});
    const lastEntitiesRef = useRef<HassEntities>({});
    // entity_id → "system:zone" map for Airzone master/slave correlation. Empty
    // until resolved (admin-gated device registry); empty → flat/standalone
    // grouping (graceful degradation).
    const zoneIdMapRef = useRef<Record<string, string>>({});
    const [, forceRender] = useState(0);

    // Recompute zones from the latest entities + current optimistic patches,
    // pruning patches that real state has caught up to. Then group them by
    // master/slave topology using the resolved zone-id map.
    const recompute = useCallback(() => {
        const base = discoverClimateZones(lastEntitiesRef.current);
        const patches = patchesRef.current;
        let pruned = false;
        const merged = base.map((z) => {
            const patch = patches[z.entityId];
            if (!patch) return z;
            const realMatches =
                (patch.hvacMode === undefined || patch.hvacMode === z.hvacMode) &&
                (patch.fanMode === undefined || patch.fanMode === z.fanMode) &&
                (patch.targetTemperature === undefined || patch.targetTemperature === z.targetTemperature);
            if (realMatches || Date.now() - patch.at > OPTIMISTIC_TTL_MS) {
                delete patches[z.entityId];
                pruned = true;
                return z;
            }
            return applyPatch(z, patch);
        });
        setZones(merged);
        setGroups(groupClimateZones(merged, zoneIdMapRef.current));
        if (pruned) forceRender((n) => n + 1);
    }, []);

    useEffect(() => {
        let unsub: (() => void) | null = null;
        let cancelled = false;
        // Watchdog: if no entity push arrives for a while, flag the feed stale so
        // the surface can warn the user the data may be out of date.
        let staleTimer: ReturnType<typeof setTimeout> | null = null;
        const armStaleTimer = () => {
            if (staleTimer) clearTimeout(staleTimer);
            staleTimer = setTimeout(() => setStatus('stale'), 30000);
        };

        // Resolve the Airzone "system:zone" → entity_id correlation map once.
        // It's static topology, so a single fetch is enough; failure (non-admin
        // / no topology) leaves the map empty and grouping degrades to flat.
        let mapLoaded = false;
        const loadZoneIdMap = () => {
            if (mapLoaded) return;
            mapLoaded = true;
            getClimateZoneIdMap()
                .then((m) => {
                    if (cancelled) return;
                    zoneIdMapRef.current = m;
                    recompute();
                })
                .catch(() => { /* keep empty map → standalone grouping */ });
        };

        const start = async () => {
            try {
                unsub = await subscribeEntities((entities) => {
                    if (cancelled) return;
                    lastEntitiesRef.current = entities;
                    setStatus('live');
                    armStaleTimer();
                    recompute();
                    loadZoneIdMap();
                });
            } catch {
                if (!cancelled) setStatus('stale');
            }
        };
        start();

        return () => {
            cancelled = true;
            if (staleTimer) clearTimeout(staleTimer);
            if (unsub) unsub();
        };
    }, [recompute]);

    // Periodically expire timed-out optimistic patches even if no entity push
    // arrives, so a failed command can't pin a stale value indefinitely.
    useEffect(() => {
        const id = setInterval(() => {
            const patches = patchesRef.current;
            const now = Date.now();
            let changed = false;
            for (const key of Object.keys(patches)) {
                if (now - patches[key].at > OPTIMISTIC_TTL_MS) {
                    delete patches[key];
                    changed = true;
                }
            }
            if (changed) recompute();
        }, 2000);
        return () => clearInterval(id);
    }, [recompute]);

    const patch = useCallback(
        (entityId: string, p: Partial<OptimisticPatch>) => {
            const prev = patchesRef.current[entityId];
            patchesRef.current[entityId] = { ...prev, ...p, at: Date.now() };
            recompute();
        },
        [recompute]
    );

    const setTargetTemperature = useCallback(
        (entityId: string, temperature: number) => {
            patch(entityId, { targetTemperature: temperature });
            svcSetTargetTemperature(entityId, temperature).catch(() => recompute());
        },
        [patch, recompute]
    );

    const setHvacMode = useCallback(
        (zone: ClimateZone, group: ClimateGroup, hvacMode: string) => {
            const target = resolveModeTarget(zone, group);
            // Slave whose master is unresolved: do NOT call set_hvac_mode (it
            // hard-fails on the slave). The tile disables the control already;
            // this is a defensive no-op.
            if (target.blocked || !target.entityId) return;
            // Patch the TARGET entity (the master, when routed) — its real
            // hvac_mode is what changes; slaves follow it via real state.
            patch(target.entityId, { hvacMode });
            svcSetHvacMode(target.entityId, hvacMode).catch(() => recompute());
        },
        [patch, recompute]
    );

    const setFanMode = useCallback(
        (entityId: string, fanMode: string) => {
            patch(entityId, { fanMode });
            svcSetFanMode(entityId, fanMode).catch(() => recompute());
        },
        [patch, recompute]
    );

    return { zones, groups, status, setTargetTemperature, setHvacMode, setFanMode };
}
