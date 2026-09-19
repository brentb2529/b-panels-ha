// Build the Irrigation tile's per-zone document from Home Assistant entities.
//
// Mirrors the energytrakEntities.ts pattern: the publisher (a GeoDrops poller
// running in AppDaemon) stamps every entity with two attributes, and this
// module reassembles them into the shape the tile renders. Friendly names and
// entity ids both move when a device is renamed or reassigned to an area, so
// neither is safe to key on.
//
//   bp_irrigation_zone    stable zone id, e.g. "front_yard"
//   bp_irrigation_field   stable field key, e.g. "moisture"
//
// Soil fields come from GeoDrops' public BigQuery dataset; derived fields
// (ET0, rain, deficit, drying rate, days-since-run, inferred skips) are
// computed by the poller from Tempest statistics + captured Rachio runs.
//
// Two properties of the upstream data drive the shape here:
//   * A zone can be ONLINE BUT UNCALIBRATED. GeoDrops publishes health
//     telemetry for days before it publishes a usable moisture reading
//     (nextAction "ATT_SS_NEW"). `calibrated` gates the moisture block; the
//     tile must render health without it rather than showing a fake 0.
//   * `quality` (GeoDrops qcn) >= 1 is exactly equivalent to "moisture is
//     usable" across the whole upstream table, with zero exceptions.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

const ZONE_ATTR = 'bp_irrigation_zone';
const FIELD_ATTR = 'bp_irrigation_field';

// bp_irrigation_field -> the key the tile reads. Numeric unless listed in
// STRING_FIELDS or BINARY_FIELD_TO_KEY below.
const FIELD_TO_KEY: Record<string, string> = {
    // soil profile
    moisture: 'moisture',
    moisture_index: 'moistureIndex',
    moisture_raw: 'moistureRaw',
    depth1: 'depth1',
    depth2: 'depth2',
    depth3: 'depth3',
    temp_surface: 'tempSurface',
    temp_depth1: 'tempDepth1',
    temp_depth2: 'tempDepth2',
    temp_depth3: 'tempDepth3',
    quality: 'quality',
    avg7d: 'avg7d',
    avg30d: 'avg30d',
    // device health
    battery: 'battery',
    rssi: 'rssi',
    sync_delay: 'syncDelayHours',
    reading_age: 'readingAgeMinutes',
    // derived analysis
    drying_rate: 'dryingRatePerDay',
    et0_7d: 'et07d',
    rain_7d: 'rain7d',
    deficit: 'deficitIn',
    days_since_run: 'daysSinceRun',
    skips_7d: 'skips7d',
};

const STRING_FIELDS: Record<string, string> = {
    next_action: 'nextAction',
    last_run: 'lastRunAt',
    schedule: 'scheduleName',
    schedule_type: 'scheduleType',
};

const BINARY_FIELD_TO_KEY: Record<string, string> = {
    calibrated: 'calibrated',
    raining: 'isRaining',
    battery_poor: 'batteryPoor',
};

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

export interface IrrigationZoneState {
    zoneId: string;
    name: string;
    state: Record<string, any>;
}

const isUsable = (e: HassEntity): boolean =>
    !!e && typeof e.state === 'string' && !UNAVAILABLE.has(e.state.toLowerCase());

/**
 * Group every bp_irrigation_* entity by zone and flatten to the tile document.
 * Zones with no usable entity at all are reported `online: false` rather than
 * omitted, so a probe that drops off the network stays visible on the tile
 * instead of silently vanishing — the exact failure mode that hid a dead soil
 * probe for months.
 */
export function buildIrrigationZones(entities: HassEntities): IrrigationZoneState[] {
    const byZone = new Map<string, HassEntity[]>();
    for (const e of Object.values(entities ?? {})) {
        const zone = e?.attributes?.[ZONE_ATTR];
        if (typeof zone !== 'string' || !zone) continue;
        if (typeof e.attributes?.[FIELD_ATTR] !== 'string') continue;
        const list = byZone.get(zone);
        if (list) list.push(e);
        else byZone.set(zone, [e]);
    }

    const out: IrrigationZoneState[] = [];
    for (const [zoneId, list] of byZone) {
        const state: Record<string, any> = {};
        let name = zoneId;
        let anyUsable = false;

        for (const e of list) {
            const field = e.attributes[FIELD_ATTR] as string;
            const usable = isUsable(e);
            if (usable) anyUsable = true;

            // Control targets ride as attributes on whichever entity carries
            // them, so the tile can call the right Rachio service without a
            // second lookup.
            if (e.attributes.bp_irrigation_schedule_entity) {
                state.scheduleEntityId = e.attributes.bp_irrigation_schedule_entity;
            }
            if (Array.isArray(e.attributes.bp_irrigation_zone_entities)) {
                state.zoneEntityIds = e.attributes.bp_irrigation_zone_entities;
            }
            if (typeof e.attributes.bp_irrigation_label === 'string') {
                name = e.attributes.bp_irrigation_label;
            }

            // Keep the moisture entity_id: the sparkline reads long-term
            // statistics, which are addressed by entity_id, not by the
            // zone/field attributes everything else here groups on. Recorded
            // even when the entity is currently unusable - history outlives a
            // momentary dropout, and a stale probe should still draw its trend.
            if (field === 'moisture') state.moistureEntityId = e.entity_id;

            if (!usable) continue;

            const binKey = BINARY_FIELD_TO_KEY[field];
            if (binKey) {
                state[binKey] = e.state.toLowerCase() === 'on';
                continue;
            }
            const strKey = STRING_FIELDS[field];
            if (strKey) {
                state[strKey] = e.state;
                continue;
            }
            const numKey = FIELD_TO_KEY[field];
            if (!numKey) continue;
            const n = Number(e.state);
            if (Number.isFinite(n)) state[numKey] = n;
        }

        // `calibrated` may be published explicitly; otherwise derive it from
        // quality, which upstream guarantees is equivalent.
        if (state.calibrated === undefined) {
            state.calibrated = typeof state.quality === 'number' && state.quality >= 1;
        }
        // Never surface a moisture number the upstream considers unusable.
        if (!state.calibrated) {
            delete state.moisture;
            delete state.moistureIndex;
            delete state.depth1;
            delete state.depth2;
            delete state.depth3;
        }
        state.online = anyUsable;
        out.push({ zoneId, name, state });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

/** Zone ids present in the current entity snapshot, for config/editor pickers. */
export function irrigationZoneIds(entities: HassEntities): string[] {
    return buildIrrigationZones(entities).map((z) => z.zoneId);
}

/** Single zone lookup; undefined when that zone publishes nothing. */
export function buildIrrigationZone(
    entities: HassEntities,
    zoneId: string,
): IrrigationZoneState | undefined {
    return buildIrrigationZones(entities).find((z) => z.zoneId === zoneId);
}
