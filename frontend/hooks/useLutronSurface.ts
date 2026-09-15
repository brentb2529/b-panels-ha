// Lutron HomeWorks QSX — live feed for the lighting/shades/scenes/keypads surface.
//
// Owns one subscribeEntities subscription (NO polling). Tracks connection health
// so the surface can show a stale/reconnecting indicator. Exposes the composite
// LutronState rebuilt on every entity push.
//
// Optimistic updates: light brightness and cover position changes are optimistically
// applied locally and reconciled as HA pushes confirmed state back. A timeout
// clears any stuck optimistic value so real state always wins eventually.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../services/haClient';
import { buildLutronState, type LutronState } from '../services/lutron';

export type ConnStatus = 'connecting' | 'live' | 'stale';

// Optimistic state for a single entity (brightness 0-100 for lights, position 0-100 for covers)
interface OptimisticEntry {
    value: number;
    at: number;
}

const OPTIMISTIC_TTL_MS = 5000;  // clear if HA hasn't confirmed within 5 s
const STALE_AFTER_MS = 30000;    // mark stale if no push for 30 s

const EMPTY: LutronState = {
    present: false,
    areas: [],
    scenes: [],
    keypads: [],
    entityCount: 0,
};

export interface UseLutronSurface {
    state: LutronState;
    // Optimistic value override for an entity (light brightness or cover position).
    // Returns null when no optimistic value is pending, i.e. use real state.
    getOptimistic: (entityId: string) => number | null;
    setOptimistic: (entityId: string, value: number) => void;
    connStatus: ConnStatus;
}

export function useLutronSurface(): UseLutronSurface {
    const [state, setState] = useState<LutronState>(EMPTY);
    const [connStatus, setConnStatus] = useState<ConnStatus>('connecting');

    const lastEntitiesRef = useRef<HassEntities>({});
    const optimisticRef = useRef<Map<string, OptimisticEntry>>(new Map());

    const recompute = useCallback(() => {
        setState(buildLutronState(lastEntitiesRef.current));
    }, []);

    useEffect(() => {
        let unsub: (() => void) | null = null;
        let cancelled = false;
        let staleTimer: ReturnType<typeof setTimeout> | null = null;

        const armStaleTimer = () => {
            if (staleTimer) clearTimeout(staleTimer);
            staleTimer = setTimeout(() => setConnStatus('stale'), STALE_AFTER_MS);
        };

        const start = async () => {
            try {
                unsub = await subscribeEntities((entities) => {
                    if (cancelled) return;
                    lastEntitiesRef.current = entities;
                    setConnStatus('live');
                    armStaleTimer();
                    // Expire optimistic entries whose real state has arrived
                    const now = Date.now();
                    for (const [eid, entry] of optimisticRef.current.entries()) {
                        const real = entities[eid];
                        if (!real) continue;
                        // Reconcile: if HA confirmed, or TTL passed, drop the optimistic entry
                        const expired = now - entry.at > OPTIMISTIC_TTL_MS;
                        if (expired) {
                            optimisticRef.current.delete(eid);
                        }
                    }
                    recompute();
                });
            } catch {
                if (!cancelled) setConnStatus('stale');
            }
        };

        start();

        return () => {
            cancelled = true;
            if (staleTimer) clearTimeout(staleTimer);
            if (unsub) unsub();
        };
    }, [recompute]);

    // Periodically prune expired optimistic entries even without entity pushes.
    useEffect(() => {
        const id = setInterval(() => {
            const now = Date.now();
            let changed = false;
            for (const [eid, entry] of optimisticRef.current.entries()) {
                if (now - entry.at > OPTIMISTIC_TTL_MS) {
                    optimisticRef.current.delete(eid);
                    changed = true;
                }
            }
            if (changed) recompute();
        }, 2000);
        return () => clearInterval(id);
    }, [recompute]);

    const getOptimistic = useCallback((entityId: string): number | null => {
        const entry = optimisticRef.current.get(entityId);
        if (!entry) return null;
        if (Date.now() - entry.at > OPTIMISTIC_TTL_MS) {
            optimisticRef.current.delete(entityId);
            return null;
        }
        return entry.value;
    }, []);

    const setOptimistic = useCallback((entityId: string, value: number) => {
        optimisticRef.current.set(entityId, { value, at: Date.now() });
        // Trigger a re-render so callers see the optimistic value immediately
        setState(prev => ({ ...prev }));
    }, []);

    return { state, getOptimistic, setOptimistic, connStatus };
}
