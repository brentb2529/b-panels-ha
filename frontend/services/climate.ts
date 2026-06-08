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
