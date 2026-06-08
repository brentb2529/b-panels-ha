// Climate domain model + command wiring for the per-room Air Control surface.
//
// This module is the ONLY place that translates a raw Home Assistant
// `climate.*` entity into the composite shape the Air Control tiles render, and
// the ONLY place that maps a UI intent (set setpoint / mode / fan) back to a HA
// service call. All transport goes through `services/haClient.ts`
// (`subscribeEntities` for reads, `callService` for writes) — there is no
// backend, DB, or business logic anywhere else.
//
// Multi-master note: every climate entity is modeled and controlled
// INDEPENDENTLY. We never derive one zone's mode/state from a "master" entity
// or from a sibling zone. The Airzone master↔zone attribute is still PROPOSED
// in the entity contract, so this surface deliberately does not read it.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import * as haClient from './haClient';

// HA climate `supported_features` bitmask (climate.ClimateEntityFeature).
// Used to decide which controls a given zone actually supports, so we never
// render (or fire) a control the entity can't handle.
export const CLIMATE_FEATURE = {
    TARGET_TEMPERATURE: 1,
    TARGET_TEMPERATURE_RANGE: 2,
    TARGET_HUMIDITY: 4,
    FAN_MODE: 8,
    PRESET_MODE: 16,
    SWING_MODE: 32,
    AUX_HEAT: 64,
    TURN_OFF: 128,
    TURN_ON: 256,
} as const;

// hvac_action — what the equipment is actually doing right now (vs hvac_mode,
// which is the requested mode). HA's canonical set; we render the common ones.
export type HvacAction =
    | 'off'
    | 'idle'
    | 'heating'
    | 'cooling'
    | 'drying'
    | 'fan'
    | 'preheating'
    | 'defrosting';

export interface ClimateZone {
    entityId: string;
    name: string;

    // Availability — `unavailable`/`unknown`/missing → not online. The tile
    // degrades gracefully (renders last-known shell, controls disabled).
    available: boolean;

    // Requested mode (climate.hvac_mode): off | heat | cool | heat_cool | auto |
    // dry | fan_only. Driven by `hvac_modes` (the supported list).
    hvacMode: string;
    hvacModes: string[];

    // What the system is doing right now (climate.hvac_action). May be absent.
    hvacAction: HvacAction | null;

    // Current readings. `currentHumidity` is paired from a sibling
    // sensor.<zone>_humidity when the climate entity lacks `current_humidity`.
    currentTemperature: number | null;
    currentHumidity: number | null;

    // Target setpoint. For range-mode entities we surface the single
    // `temperature` if present; range (low/high) zones fall back to the midpoint
    // for display and disable single-setpoint stepping.
    targetTemperature: number | null;
    targetTempLow: number | null;
    targetTempHigh: number | null;
    minTemp: number;
    maxTemp: number;
    tempStep: number;
    temperatureUnit: string; // '°C' | '°F' (from HA attributes, else inferred)

    // Fan control (optional).
    fanMode: string | null;
    fanModes: string[];

    // Capability flags derived from supported_features.
    supportsTargetTemp: boolean;
    supportsFanMode: boolean;
    supportsTargetRange: boolean;

    // --- Airzone master/slave topology (LOCKED contract row, ENTITY_CONTRACT
    // v0.2). Read-only; all optional so older firmware / pre-merge instances
    // (no attrs) degrade to standalone zones. The "system:zone" ids are
    // correlated to entity_ids at grouping time via the zone-id map.
    isMaster: boolean | null;                 // is_master attr; null when absent
    masterZoneId: string | null;              // master_zone "system:zone" (slaves only)
    slaveZoneIds: string[];                    // slave_zones "system:zone"[] (masters only)
}

// climate.* ids we never surface on the AIR surface: pool/spa heaters belong to
// the pool surface, and commanding them here would be a category error. Matched
// loosely so `climate.pool_heat`, `climate.spa_heater`, `climate.pool` etc. are
// all excluded.
const EXCLUDE_ID_RE = /^climate\..*(pool|spa)/i;

function isClimateEntity(id: string): boolean {
    return id.startsWith('climate.');
}

function num(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

// Prettify an entity_id slug into a room label when HA gives us no
// friendly_name (e.g. climate.primary_suite → "Primary Suite").
function humanizeSlug(entityId: string): string {
    return entityId
        .replace(/^climate\./, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Find a sibling humidity (or temperature) sensor by naming convention, used
// only when the climate entity itself doesn't expose the reading. We match the
// climate slug against `sensor.<slug>_humidity` / `sensor.<slug>_temperature`,
// tolerating the common `_climate`/`_thermostat` suffix on the climate slug.
function pairedSensorValue(
    entities: HassEntities,
    climateId: string,
    kind: 'humidity' | 'temperature'
): number | null {
    const slug = climateId
        .replace(/^climate\./, '')
        .replace(/_(climate|thermostat|hvac|zone)$/i, '');
    const candidates = [
        `sensor.${slug}_${kind}`,
        `sensor.${slug}_${kind === 'humidity' ? 'rh' : 'temp'}`,
    ];
    for (const cand of candidates) {
        const ent = entities[cand];
        const v = ent ? num(ent.state) : null;
        if (v !== null) return v;
    }
    return null;
}

function hasFeature(features: number, flag: number): boolean {
    return (features & flag) === flag;
}

// Build the composite ClimateZone from one HA climate entity (+ the full
// entities map, so we can pair sibling sensors). Pure; never throws.
export function toClimateZone(entity: HassEntity, entities: HassEntities): ClimateZone {
    const a = entity.attributes || {};
    const features = typeof a.supported_features === 'number' ? a.supported_features : 0;
    const state = entity.state;
    const available = state !== 'unavailable' && state !== 'unknown' && state != null;

    const hvacModes: string[] = Array.isArray(a.hvac_modes) ? a.hvac_modes : [];
    const fanModes: string[] = Array.isArray(a.fan_modes) ? a.fan_modes : [];

    const supportsFanMode = hasFeature(features, CLIMATE_FEATURE.FAN_MODE) || fanModes.length > 0;
    const supportsTargetRange = hasFeature(features, CLIMATE_FEATURE.TARGET_TEMPERATURE_RANGE);
    const supportsTargetTemp =
        hasFeature(features, CLIMATE_FEATURE.TARGET_TEMPERATURE) || a.temperature != null;

    const currentHumidity =
        num(a.current_humidity) ?? pairedSensorValue(entities, entity.entity_id, 'humidity');
    const currentTemperature =
        num(a.current_temperature) ?? pairedSensorValue(entities, entity.entity_id, 'temperature');

    // Airzone master/slave topology attrs (LOCKED contract). All optional —
    // absent on older firmware / non-Airzone climates, in which case the zone
    // renders standalone.
    const isMaster = typeof a.is_master === 'boolean' ? a.is_master : null;
    const masterZoneId = typeof a.master_zone === 'string' ? a.master_zone : null;
    const slaveZoneIds: string[] = Array.isArray(a.slave_zones)
        ? a.slave_zones.filter((z: unknown): z is string => typeof z === 'string')
        : [];

    return {
        entityId: entity.entity_id,
        name: (a.friendly_name as string) || humanizeSlug(entity.entity_id),
        available,
        hvacMode: typeof state === 'string' ? state : 'off',
        hvacModes,
        hvacAction: (a.hvac_action as HvacAction) ?? null,
        currentTemperature,
        currentHumidity,
        targetTemperature: num(a.temperature),
        targetTempLow: num(a.target_temp_low),
        targetTempHigh: num(a.target_temp_high),
        minTemp: num(a.min_temp) ?? 7,
        maxTemp: num(a.max_temp) ?? 35,
        tempStep: num(a.target_temp_step) ?? 0.5,
        temperatureUnit: (a.temperature_unit as string) || '°C',
        fanMode: (a.fan_mode as string) ?? null,
        fanModes,
        supportsTargetTemp,
        supportsFanMode,
        supportsTargetRange,
        isMaster,
        masterZoneId,
        slaveZoneIds,
    };
}

// Discover all controllable air-zone climate entities from a HassEntities map.
// - keeps only `climate.*`
// - drops pool/spa heaters (handled by the pool surface)
// - sorts by display name for a stable marquee order
export function discoverClimateZones(entities: HassEntities): ClimateZone[] {
    const zones: ClimateZone[] = [];
    for (const id of Object.keys(entities)) {
        if (!isClimateEntity(id)) continue;
        if (EXCLUDE_ID_RE.test(id)) continue;
        zones.push(toClimateZone(entities[id], entities));
    }
    zones.sort((x, y) => x.name.localeCompare(y.name));
    return zones;
}

// --- Master/slave grouping ----------------------------------------------------
// A rendered cluster: a master zone with its (resolved) slave zones nested
// beneath, or a standalone zone (no topology / unresolved). The surface renders
// one of these per group.
export interface ClimateGroup {
    // Stable key for React (the master/standalone zone's entity_id).
    key: string;
    master: ClimateZone;
    slaves: ClimateZone[];
    // True only when `master` is a real Airzone master WITH resolved slaves.
    // Standalone zones (no topology attrs, or attrs present but no slaves
    // resolved) render exactly like the pre-topology surface.
    isCluster: boolean;
    // For each slave entity_id, the master entity_id its mode command must be
    // routed to (see resolveModeTarget). Empty for standalone groups.
    modeTargetByEntity: Record<string, string>;
}

// The role we display on a tile, independent of whether grouping succeeded.
export type ZoneRole = 'master' | 'slave' | 'standalone';

export function zoneRole(zone: ClimateZone): ZoneRole {
    if (zone.isMaster === true && zone.slaveZoneIds.length > 0) return 'master';
    if (zone.masterZoneId) return 'slave';
    return 'standalone';
}

// Group zones into master clusters + standalone zones.
//
// `zoneIdByEntity` maps entity_id → "system:zone" (from
// haClient.getClimateZoneIdMap). When it's empty/missing (non-admin, or older
// firmware with no topology), EVERY zone falls through to standalone — the
// surface looks exactly as it did before this change (graceful degradation).
//
// A slave whose master cannot be resolved to a concrete entity_id is emitted as
// a standalone group (we never drop a zone), but still carries masterZoneId so
// its tile can show "mode follows master".
export function groupClimateZones(
    zones: ClimateZone[],
    zoneIdByEntity: Record<string, string>
): ClimateGroup[] {
    const entityByZoneId: Record<string, string> = {};
    for (const [eid, zid] of Object.entries(zoneIdByEntity)) entityByZoneId[zid] = eid;

    const byEntity: Record<string, ClimateZone> = {};
    for (const z of zones) byEntity[z.entityId] = z;

    // entity_ids that end up nested under a master, so we don't also emit them
    // as their own top-level group.
    const claimedSlaves = new Set<string>();
    const groups: ClimateGroup[] = [];

    // First pass: build master clusters.
    for (const z of zones) {
        if (z.isMaster !== true || z.slaveZoneIds.length === 0) continue;
        const slaves: ClimateZone[] = [];
        const modeTargetByEntity: Record<string, string> = {};
        for (const slaveZoneId of z.slaveZoneIds) {
            const slaveEntity = entityByZoneId[slaveZoneId];
            if (!slaveEntity || !byEntity[slaveEntity]) continue; // unresolved → skip nesting
            if (slaveEntity === z.entityId) continue;
            slaves.push(byEntity[slaveEntity]);
            claimedSlaves.add(slaveEntity);
            modeTargetByEntity[slaveEntity] = z.entityId;
        }
        slaves.sort((a, b) => a.name.localeCompare(b.name));
        groups.push({
            key: z.entityId,
            master: z,
            slaves,
            isCluster: slaves.length > 0,
            modeTargetByEntity,
        });
    }

    // Second pass: everything not nested under a master becomes a standalone
    // group (preserving discovery sort order).
    for (const z of zones) {
        if (claimedSlaves.has(z.entityId)) continue;
        if (z.isMaster === true && z.slaveZoneIds.length > 0) continue; // already a cluster master
        groups.push({
            key: z.entityId,
            master: z,
            slaves: [],
            isCluster: false,
            modeTargetByEntity: {},
        });
    }

    // Masters first, then standalone, each alphabetical.
    groups.sort((a, b) => {
        if (a.isCluster !== b.isCluster) return a.isCluster ? -1 : 1;
        return a.master.name.localeCompare(b.master.name);
    });
    return groups;
}

// Resolve which entity_id a mode (set_hvac_mode) command must target for a given
// zone. SLAVE zones hard-fail set_hvac_mode on the integration today, so we
// route the call to the owning MASTER's entity_id when we can resolve it.
// Returns:
//   { entityId, routed: false }                  — command targets the zone itself
//   { entityId: <master>, routed: true, masterName } — routed to the master
//   { entityId: null, routed: false, blocked: true } — slave whose master is
//        unresolved: do NOT call set_hvac_mode (it would fail); disable the control.
export interface ModeTarget {
    entityId: string | null;
    routed: boolean;
    blocked: boolean;
    masterName?: string;
}

export function resolveModeTarget(zone: ClimateZone, group: ClimateGroup): ModeTarget {
    const role = zoneRole(zone);
    if (role !== 'slave') {
        return { entityId: zone.entityId, routed: false, blocked: false };
    }
    // Slave: find its master entity within this group (it was nested under it).
    const masterEntity = group.modeTargetByEntity[zone.entityId];
    if (masterEntity) {
        return { entityId: masterEntity, routed: true, blocked: false, masterName: group.master.name };
    }
    // Slave whose master could not be resolved to an entity_id. Calling
    // set_hvac_mode on the slave fails, so block the control rather than try.
    return { entityId: null, routed: false, blocked: true };
}

// --- Commands (optimistic; the caller reconciles against subscribeEntities) ---
// Each command targets exactly one entity_id — independent per-zone control.

export async function setTargetTemperature(entityId: string, temperature: number): Promise<void> {
    await haClient.callService('climate', 'set_temperature', { temperature }, { entity_id: entityId });
}

export async function setHvacMode(entityId: string, hvacMode: string): Promise<void> {
    await haClient.callService('climate', 'set_hvac_mode', { hvac_mode: hvacMode }, { entity_id: entityId });
}

export async function setFanMode(entityId: string, fanMode: string): Promise<void> {
    await haClient.callService('climate', 'set_fan_mode', { fan_mode: fanMode }, { entity_id: entityId });
}
