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
import { subscribeEntities } from '../services/haClient';
import {
    discoverClimateZones,
    setFanMode as svcSetFanMode,
    setHvacMode as svcSetHvacMode,
    setTargetTemperature as svcSetTargetTemperature,
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
    status: ConnStatus;
    /** Optimistically set a zone's setpoint and fire the HA service. */
    setTargetTemperature: (entityId: string, temperature: number) => void;
    /** Optimistically set a zone's hvac_mode and fire the HA service. */
    setHvacMode: (entityId: string, hvacMode: string) => void;
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
    const [status, setStatus] = useState<ConnStatus>('connecting');
    // Optimistic overrides, keyed by entity_id. Held in a ref so firing a
    // command doesn't depend on the latest render, plus mirrored into a state
    // bump to trigger re-render.
    const patchesRef = useRef<Record<string, OptimisticPatch>>({});
    const lastEntitiesRef = useRef<HassEntities>({});
    const [, forceRender] = useState(0);

    // Recompute zones from the latest entities + current optimistic patches,
    // pruning patches that real state has caught up to.
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

        const start = async () => {
            try {
                unsub = await subscribeEntities((entities) => {
                    if (cancelled) return;
                    lastEntitiesRef.current = entities;
                    setStatus('live');
                    armStaleTimer();
                    recompute();
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
        (entityId: string, hvacMode: string) => {
            patch(entityId, { hvacMode });
            svcSetHvacMode(entityId, hvacMode).catch(() => recompute());
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

    return { zones, status, setTargetTemperature, setHvacMode, setFanMode };
}
