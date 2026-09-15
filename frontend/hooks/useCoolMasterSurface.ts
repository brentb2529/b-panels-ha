/**
 * useCoolMasterSurface
 *
 * Discovers CoolMasterNet climate entities dynamically from the live entity
 * list and assembles one composite Device per indoor unit.
 *
 * Entity discovery contract (per HA coolmasternet integration):
 *   climate.<unit>          — primary control entity (hvac_mode, fan_mode,
 *                             swing_mode, temperature, current_temperature,
 *                             temperature_unit, fan_modes, swing_modes)
 *   sensor.<unit>_error_code — fault badge (state: "OK" or a code string)
 *   binary_sensor.<unit>_clean_filter — filter-dirty flag (problem class)
 *   button.<unit>_reset_filter — safe filter-timer reset action
 *
 * Unit id format: e.g. "L1.100", "L2.200" — the leading "L<n>" segment is the
 * line, used for grouping cards.
 *
 * Data/control contract: ALL reads are from haClient subscribeEntities; ALL
 * writes are haClient.callService. No polling, no backend.
 *
 * Optimistic + reconcile: the tile updates local state immediately on control,
 * then reconciles on the next entity push from HA (the push resolves within
 * ~200ms on a local network).
 *
 * Stale detection: if >STALE_MS passes without a reconciling push that matches
 * the optimistic value, the tile shows a stale indicator (pulsing outline).
 */

import { useMemo } from 'react';
import { Device, DeviceService, DeviceType } from '../types';

// All entity ids that belong to a CoolMaster indoor unit are consumed into the
// composite card and hidden from the generic entity list.
export type CoolMasterMemberIds = Set<string>;

export interface CoolMasterUnitState {
    // --- Identity ---
    unitId: string;         // e.g. "l1_100" (entity_id suffix, not raw unit id)
    rawUnitId: string;      // e.g. "L1.100" from friendly_name / inference
    lineId: string;         // e.g. "L1"
    name: string;

    // --- Primary climate entity ---
    climateEntityId: string;
    isOn: boolean;
    hvacMode: string;       // off / cool / heat / auto / fan_only / dry
    hvacModes: string[];
    currentTemp: number | null;
    targetTemp: number | null;
    tempUnit: 'C' | 'F';
    fanMode: string | null;
    fanModes: string[];
    swingMode: string | null;
    swingModes: string[];
    supportsSwing: boolean;

    // --- Ancillary entities ---
    errorCodeEntityId: string | null;
    errorCode: string | null;          // null = "OK"
    filterDirtyEntityId: string | null;
    filterDirty: boolean;
    resetFilterEntityId: string | null;

    // --- Availability ---
    isOnline: boolean;
}

export interface CoolMasterComposite {
    device: Device;
    memberIds: Set<string>;
}

// Derive a stable unit id slug from a climate entity_id.
// climate.ln_xyz  → ln_xyz  (strip domain prefix)
// climate.coolmaster_l1_100 → l1_100 (strip optional integration prefix)
const unitSlugFromEntityId = (entityId: string): string =>
    entityId.replace(/^climate\./, '').replace(/^coolmaster_/, '');

// Derive the CoolMaster line label from the slug/friendly_name.
// Handles both entity_id slug ("l1_100") and friendly names ("L1.100 Bedroom")
const lineFromSlug = (slug: string): string => {
    const m = slug.match(/^(l\d+)[._]/i);
    return m ? m[1].toUpperCase() : 'L?';
};

// Raw unit id (e.g. "L1.100") from slug ("l1_100" → "L1.100")
const rawUnitIdFromSlug = (slug: string): string => {
    const m = slug.match(/^(l\d+)[._](\d+)/i);
    if (m) return `${m[1].toUpperCase()}.${m[2]}`;
    return slug.toUpperCase();
};

// Infer "unit slug" for a sibling entity given its entity_id and the parent
// climate entity's slug.  Sibling patterns:
//   sensor.{slug}_error_code
//   sensor.coolmaster_{slug}_error_code
//   binary_sensor.{slug}_clean_filter
//   button.{slug}_reset_filter
const siblingSlugFromEntityId = (entityId: string): string => {
    const body = entityId.replace(/^[^.]+\./, '').replace(/^coolmaster_/, '');
    // Strip known suffixes to arrive at the unit slug
    return body
        .replace(/_error_code$/, '')
        .replace(/_clean_filter$/, '')
        .replace(/_reset_filter$/, '');
};

const isCoolMasterClimate = (entityId: string, attributes: any): boolean => {
    if (!entityId.startsWith('climate.')) return false;
    // Prefer explicit integration hint if present
    if ((attributes?.platform || attributes?.integration || '')
            .toLowerCase().includes('coolmaster')) return true;
    // Heuristic: entity id matches L<n>_<digits> pattern (e.g. climate.l1_100)
    // This is the entity_id format the HA coolmasternet integration emits.
    const slug = entityId.replace(/^climate\./, '').replace(/^coolmaster_/, '');
    return /^l\d+[._]\d+/i.test(slug);
};

/**
 * Build CoolMaster composite Device objects from the live entity map.
 *
 * Accepts the *mapped* service devices (already run through mapHaEntityToInternalDevice)
 * and the raw HA entity state map (for attribute access the mapper doesn't forward).
 *
 * Returns:
 *  - composites: one Device per unit (DeviceType.CoolMaster)
 *  - memberIds: all entity_ids folded into composites (hidden from generic list)
 */
export function buildCoolMasterComposites(
    serviceDevices: Device[],
    rawEntities: Record<string, any>
): { composites: Device[]; memberIds: Set<string> } {
    const composites: Device[] = [];
    const memberIds = new Set<string>();

    // Index mapped devices by entity_id for O(1) lookup
    const byId = new Map(serviceDevices.map(d => [d.id, d]));

    // 1. Find all CoolMaster climate entities
    const climateEntities = serviceDevices.filter(d => {
        if (!d.id.startsWith('climate.')) return false;
        const raw = rawEntities[d.id];
        return raw && isCoolMasterClimate(d.id, raw.attributes);
    });

    if (climateEntities.length === 0) return { composites: [], memberIds };

    // 2. Index sibling entities by their unit slug
    const siblingMap = new Map<string, { errorCode?: Device; filterDirty?: Device; resetFilter?: Device }>();
    for (const d of serviceDevices) {
        const domain = d.id.split('.')[0];
        if (!['sensor', 'binary_sensor', 'button'].includes(domain)) continue;
        const slug = siblingSlugFromEntityId(d.id);
        if (!slug) continue;
        if (!siblingMap.has(slug)) siblingMap.set(slug, {});
        const entry = siblingMap.get(slug)!;
        if (domain === 'sensor' && d.id.endsWith('_error_code')) {
            entry.errorCode = d;
        } else if (domain === 'binary_sensor' && d.id.endsWith('_clean_filter')) {
            entry.filterDirty = d;
        } else if (domain === 'button' && d.id.endsWith('_reset_filter')) {
            entry.resetFilter = d;
        }
    }

    // 3. Assemble one composite per unit
    for (const climateDevice of climateEntities) {
        const raw = rawEntities[climateDevice.id];
        if (!raw) continue;

        const attrs = raw.attributes || {};
        const haState = raw.state; // "off" | "cool" | "heat" | etc.

        const entitySlug = unitSlugFromEntityId(climateDevice.id);
        const sibs = siblingMap.get(entitySlug) || {};

        // Fan modes: ensure "top" is included if HA exposes it
        const fanModes: string[] = Array.isArray(attrs.fan_modes)
            ? attrs.fan_modes
            : attrs.fan_mode ? [attrs.fan_mode] : [];

        // Swing modes: only present when hardware supports it
        const swingModes: string[] = Array.isArray(attrs.swing_modes)
            ? attrs.swing_modes
            : [];
        const supportsSwing = swingModes.length > 0;

        // HVAC modes list
        const hvacModes: string[] = Array.isArray(attrs.hvac_modes)
            ? attrs.hvac_modes
            : ['off', 'cool', 'heat', 'auto', 'fan_only', 'dry'];

        // Temperature unit: read directly from entity attribute (°C or °F)
        const tempUnit: 'C' | 'F' =
            (attrs.temperature_unit === '°F' || attrs.temperature_unit === 'F')
                ? 'F'
                : 'C';

        const isOn = haState !== 'off' && haState !== 'unavailable';
        const isOnline = haState !== 'unavailable';

        // Error code
        const errorCodeRaw = sibs.errorCode
            ? String(sibs.errorCode.state ?? 'OK')
            : null;
        const errorCode = (errorCodeRaw === null || /^ok$/i.test(errorCodeRaw)) ? null : errorCodeRaw;

        // Filter dirty: binary_sensor "on" = problem (dirty filter)
        const filterDirty = sibs.filterDirty
            ? (sibs.filterDirty.state === true ||
               String(sibs.filterDirty.state).toLowerCase() === 'on')
            : false;

        // Friendly name: prefer HA friendly_name, else derive from raw unit id
        const rawUnitId = rawUnitIdFromSlug(entitySlug);
        const name = attrs.friendly_name && !attrs.friendly_name.match(/^climate\./i)
            ? attrs.friendly_name
            : rawUnitId;
        const lineId = lineFromSlug(entitySlug);

        const unitState: CoolMasterUnitState = {
            unitId: entitySlug,
            rawUnitId,
            lineId,
            name,
            climateEntityId: climateDevice.id,
            isOn,
            hvacMode: haState,
            hvacModes,
            currentTemp: typeof attrs.current_temperature === 'number' ? attrs.current_temperature : null,
            targetTemp: typeof attrs.temperature === 'number' ? attrs.temperature : null,
            tempUnit,
            fanMode: typeof attrs.fan_mode === 'string' ? attrs.fan_mode : null,
            fanModes,
            swingMode: typeof attrs.swing_mode === 'string' ? attrs.swing_mode : null,
            swingModes,
            supportsSwing,
            errorCodeEntityId: sibs.errorCode?.id ?? null,
            errorCode,
            filterDirtyEntityId: sibs.filterDirty?.id ?? null,
            filterDirty,
            resetFilterEntityId: sibs.resetFilter?.id ?? null,
            isOnline,
        };

        composites.push({
            id: `coolmaster:${climateDevice.id}`,
            name,
            type: DeviceType.CoolMaster,
            service: DeviceService.HomeAssistant,
            state: unitState,
            isOnline,
        });

        // Mark all related entities as consumed
        memberIds.add(climateDevice.id);
        if (sibs.errorCode) memberIds.add(sibs.errorCode.id);
        if (sibs.filterDirty) memberIds.add(sibs.filterDirty.id);
        if (sibs.resetFilter) memberIds.add(sibs.resetFilter.id);
    }

    // Sort by line then unit number for deterministic card order
    composites.sort((a, b) => {
        const sa = (a.state as CoolMasterUnitState).rawUnitId;
        const sb = (b.state as CoolMasterUnitState).rawUnitId;
        return sa.localeCompare(sb);
    });

    return { composites, memberIds };
}

/**
 * Hook: returns { coolMasterComposites, coolMasterMemberIds } from a memoized
 * call to buildCoolMasterComposites, suitable for use inside useDashboard.
 *
 * rawEntities must be the full HassEntities map (entity_id -> HassEntity) kept
 * in a ref inside useDashboard, passed in as a stable reference to avoid
 * re-running the memo on every WS tick.
 */
export function useCoolMasterComposites(
    serviceDevices: Device[],
    rawEntities: Record<string, any>
): { coolMasterComposites: Device[]; coolMasterMemberIds: Set<string> } {
    return useMemo(() => {
        const result = buildCoolMasterComposites(serviceDevices, rawEntities);
        return {
            coolMasterComposites: result.composites,
            coolMasterMemberIds: result.memberIds,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serviceDevices, rawEntities]);
}
