// Live ScenXus diffuser state from the Prolitec ScenXus HA integration.
// One subscribeEntities subscription, no polling (mirrors useIrrigationZones).
// The integration itself polls the cloud every 30s, so HA pushes are slow by
// nature; there is deliberately no wall-clock stale timer here.

import { useEffect, useMemo, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../services/haClient';
import { buildScenxusDevices, type ScenxusDevice } from '../services/scenxusEntities';

export interface UseScenxus {
    devices: ScenxusDevice[];
    status: 'connecting' | 'live' | 'unconfigured';
}

export function useScenxus(): UseScenxus {
    const [entities, setEntities] = useState<HassEntities | null>(null);

    useEffect(() => {
        let unsub: (() => void) | null = null;
        let cancelled = false;
        (async () => {
            try {
                unsub = await subscribeEntities((next) => {
                    if (!cancelled) setEntities(next);
                });
            } catch {
                if (!cancelled) setEntities({});
            }
        })();
        return () => {
            cancelled = true;
            if (unsub) unsub();
        };
    }, []);

    const devices = useMemo(() => (entities ? buildScenxusDevices(entities) : []), [entities]);
    const status: UseScenxus['status'] =
        entities === null ? 'connecting' : devices.length === 0 ? 'unconfigured' : 'live';
    return { devices, status };
}
