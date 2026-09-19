// Soil-moisture history for the irrigation sparklines.
//
// Reads Home Assistant LONG-TERM STATISTICS rather than recorder history: the
// recorder purges at ~10 days, statistics do not, so the 7-day window survives
// and will still be there when we eventually want 30. The moisture sensors
// carry `state_class: measurement`, which is what makes statistics exist at all.
//
// ONE query serves every tile. Four zone tiles mounting four subscriptions
// would be four round trips every refresh, on panels whose WebView is already
// memory-fragile, so the fetch is hoisted to a module-level singleton and
// shared. Tiles subscribe to the cache; the cache refreshes on the GeoDrops
// 30-minute publish grid, because asking more often cannot produce a new point.

import { useEffect, useState } from 'react';
import { haSendMessage } from '../services/haClient';

export interface MoisturePoint {
    /** epoch ms of the hour bucket */
    t: number;
    mean: number;
    min: number;
    max: number;
}

export type MoistureHistory = Record<string, MoisturePoint[]>;

/** GeoDrops publishes every 30 min; hourly buckets are the honest resolution. */
const PERIOD = 'hour';
const WINDOW_DAYS = 7;
const REFRESH_MS = 30 * 60 * 1000;

let cache: MoistureHistory = {};
let cacheAt = 0;
let inflight: Promise<MoistureHistory> | null = null;
const listeners = new Set<(h: MoistureHistory) => void>();

async function fetchHistory(entityIds: string[]): Promise<MoistureHistory> {
    if (!entityIds.length) return {};
    const start = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

    const res = await haSendMessage({
        type: 'recorder/statistics_during_period',
        start_time: start,
        statistic_ids: entityIds,
        period: PERIOD,
        types: ['mean', 'min', 'max'],
    });

    const out: MoistureHistory = {};
    for (const [eid, rows] of Object.entries((res ?? {}) as Record<string, any[]>)) {
        const pts: MoisturePoint[] = [];
        for (const r of rows ?? []) {
            const mean = typeof r?.mean === 'number' ? r.mean : null;
            if (mean === null) continue;   // gaps stay gaps; do not interpolate
            pts.push({
                t: typeof r.start === 'number' ? r.start : Date.parse(r.start),
                mean,
                min: typeof r.min === 'number' ? r.min : mean,
                max: typeof r.max === 'number' ? r.max : mean,
            });
        }
        out[eid] = pts;
    }
    return out;
}

function load(entityIds: string[], force = false): void {
    if (inflight) return;
    if (!force && Date.now() - cacheAt < REFRESH_MS && Object.keys(cache).length) return;

    inflight = fetchHistory(entityIds)
        .then((h) => {
            cache = h;
            cacheAt = Date.now();
            for (const fn of listeners) fn(cache);
            return h;
        })
        .catch(() => cache)          // keep the last good history on a failure
        .finally(() => {
            inflight = null;
        });
}

/**
 * Shared moisture history keyed by entity_id.
 *
 * Returns `{}` until the first query lands, so a tile renders its reading
 * immediately and gains the sparkline a moment later rather than blocking on it.
 */
export function useIrrigationHistory(entityIds: string[]): MoistureHistory {
    const [history, setHistory] = useState<MoistureHistory>(cache);
    const key = entityIds.slice().sort().join(',');

    useEffect(() => {
        if (!key) return;
        const ids = key.split(',');

        listeners.add(setHistory);
        load(ids);
        const timer = window.setInterval(() => load(ids, true), REFRESH_MS);

        return () => {
            listeners.delete(setHistory);
            window.clearInterval(timer);
        };
    }, [key]);

    return history;
}
