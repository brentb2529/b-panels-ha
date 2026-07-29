// Live generator telemetry from the `energytrak` HACS integration.
//
// Owns one subscribeEntities subscription (NO polling), mirroring
// useAkvoFloor. Returns null while the integration is absent or has published
// nothing, which lets the Generator tile fall back to its configured HTTP
// endpoint — so a panel pointed at the old Raspberry Pi poller keeps working
// until the integration is installed.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../services/haClient';
import { buildGeneratorState, type GeneratorEntityState } from '../services/energytrakEntities';

// Matches useAkvoFloor: if no entity push arrives in this long, say so rather
// than presenting a frozen document as live.
const STALE_AFTER_MS = 30000;

export interface UseEnergyTrakGenerator {
    /** Null when the integration is not publishing for this site. */
    data: GeneratorEntityState | null;
    status: 'connecting' | 'live' | 'stale';
}

export function useEnergyTrakGenerator(siteId?: string | null): UseEnergyTrakGenerator {
    const [data, setData] = useState<GeneratorEntityState | null>(null);
    const [status, setStatus] = useState<'connecting' | 'live' | 'stale'>('connecting');
    const entitiesRef = useRef<HassEntities>({});

    useEffect(() => {
        let unsub: (() => void) | null = null;
        let cancelled = false;
        let staleTimer: ReturnType<typeof setTimeout> | null = null;

        const armStaleTimer = () => {
            if (staleTimer) clearTimeout(staleTimer);
            staleTimer = setTimeout(() => setStatus('stale'), STALE_AFTER_MS);
        };

        const start = async () => {
            try {
                unsub = await subscribeEntities((entities) => {
                    if (cancelled) return;
                    entitiesRef.current = entities;
                    setStatus('live');
                    armStaleTimer();
                    setData(buildGeneratorState(entities, siteId));
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
    }, [siteId]);

    return { data, status };
}
