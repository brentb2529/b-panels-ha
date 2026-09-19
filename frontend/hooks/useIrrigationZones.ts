// Live irrigation zones from the b_panels GeoDrops poller.
//
// Owns one subscribeEntities subscription (NO polling), mirroring
// useEnergyTrakGenerator. Returns an empty list when the subsystem is not
// configured, so the tile can say so rather than rendering an empty shell.
//
// Deliberately NOT using that hook's 30s stale timer. GeoDrops publishes on a
// 30-MINUTE grid, so "no push in 30s" is the normal case, and a wall-clock
// timer would sit permanently in `stale`. Freshness is a property of the DATA
// (`reading_age`, which the coordinator derives from the reading's own
// timestamp), not of how recently Home Assistant pushed us an update.

import { useEffect, useMemo, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../services/haClient';
import { buildIrrigationZones, type IrrigationZoneState } from '../services/irrigationEntities';

// GeoDrops readings land in batches; the newest of a batch is ~23 min old and
// the oldest ~3h. Past this the feed itself has a problem, not just latency.
export const READING_STALE_MINUTES = 240;

export interface UseIrrigationZones {
    zones: IrrigationZoneState[];
    /** connecting until the first push; configured=false when nothing publishes. */
    status: 'connecting' | 'live' | 'unconfigured';
}

export function useIrrigationZones(): UseIrrigationZones {
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

    const zones = useMemo(
        () => (entities ? buildIrrigationZones(entities) : []),
        [entities],
    );

    const status: UseIrrigationZones['status'] =
        entities === null ? 'connecting' : zones.length === 0 ? 'unconfigured' : 'live';

    return { zones, status };
}

/** True when a zone's newest reading is old enough to distrust. */
export function isReadingStale(zone: IrrigationZoneState): boolean {
    const age = zone.state.readingAgeMinutes;
    return typeof age === 'number' && age > READING_STALE_MINUTES;
}
