// Build the Generator tile's telemetry document from Home Assistant entities.
//
// The tile used to fetch this document over HTTP from a standalone EnergyTrak
// poller running on a Raspberry Pi (via the b_panels/generator websocket
// proxy). The `energytrak` HACS integration replaces that poller: it talks to
// EnergyTrak's Firebase backend from inside Home Assistant and publishes the
// same measurements as entities. This module reassembles them into the exact
// shape the tile already renders, so the UI is unchanged.
//
// Grouping relies on two attributes the integration stamps on every entity:
//   energytrak_site   the site id, so multiple generators stay separate
//   energytrak_field  the stable field key (e.g. "battery_voltage")
// Friendly names and entity ids both move when a device is renamed or assigned
// to an area, so neither is safe to key on.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

const SITE_ATTR = 'energytrak_site';
const FIELD_ATTR = 'energytrak_field';

// energytrak_field -> the key the tile reads.
const FIELD_TO_KEY: Record<string, string> = {
    // The old poller's document had `status` = the health grade ("healthy") and
    // `generatorStatus` = the run state ("standby"). The integration splits
    // those into `health` and `status`, so they cross over here to keep the
    // tile's badge and Gen Status row reading exactly as they did.
    health: 'status',
    status: 'generatorStatus',
    grid_status: 'gridStatus',
    battery_voltage: 'batteryVoltage',
    engine_hours: 'engineHours',
    grid_voltage: 'gridVoltage',
    grid_frequency: 'gridFrequency',
    generator_frequency: 'generatorFrequency',
    output_voltage: 'outputVoltage',
    engine_speed: 'engineSpeed',
    load_power: 'loadPower',
    starts_count: 'startsCount',
    trips_count: 'tripsCount',
    operation_mode: 'operationMode',
    fault_condition: 'faultConditionText',
    utility_monitor: 'utilityMonitor',
    active_alarm_count: 'activeAlarmCount',
    equipment_data_age: 'equipmentDataAgeSeconds',
    equipment_data_timestamp: 'equipmentDataTimestamp',
    last_received: 'lastReceivedAt',
    last_changed: 'lastChangedAt',
    last_exercise: 'lastExerciseAt',
    last_exercise_duration: 'lastExerciseDurationMinutes',
    next_exercise: 'nextExerciseDue',
    utility_power: 'utilityPower',
    monitor_state: 'monitorState',
    network_strength: 'networkStrength',
    firmware_update_status: 'firmwareUpdateStatus',

    // ---- Local B-Infohub bridge ------------------------------------------
    // Readings the EnergyTrak cloud has never carried. They exist only while a
    // bridge is attached and its RS-485 bus is healthy, so every consumer must
    // treat them as optional -- the tile renders undefined as an em dash
    // rather than a confident zero.
    //
    // The SHARED readings above need no entry: the integration overlays the
    // bridge onto the same energytrak_field, so battery, engine hours,
    // voltages, frequency, speed and load are already local-backed whenever
    // the bridge is live. Keeping field names stable across a source switch is
    // exactly what lets this file stay ignorant of which source is talking.
    telemetry_source: 'telemetrySource',
    local_bus_age_seconds: 'localBusAgeSeconds',
    coolant_temperature: 'coolantTemperature',
    percentage_load: 'percentageLoad',
    cumulative_energy: 'cumulativeEnergyKwh',
    cumulative_apparent_energy: 'cumulativeApparentEnergyKvah',
    cumulative_reactive_energy: 'cumulativeReactiveEnergyKvarh',
    'generator_l1-l2_voltage': 'generatorL1L2Voltage',
    generator_l2_frequency: 'generatorL2Frequency',
    utility_l1_voltage: 'utilityL1Voltage',
    utility_l2_voltage: 'utilityL2Voltage',
    utility_l2_frequency: 'utilityL2Frequency',
    // NOT utility_l1-l2_voltage: that reading BECAME the shared `grid_voltage`
    // in energytrak 1.13.1, because the cloud's grid_voltage is the
    // line-to-line figure. It no longer exists as a separate local field.
    // NOT engine_run_time: that is the bridge's object id for the shared
    // `engine_hours` above. This file keys on energytrak_field, never on the
    // bridge's entity id.
};

// Binary sensors become booleans rather than their "on"/"off" string.
const BINARY_FIELD_TO_KEY: Record<string, string> = {
    running: 'active',
    grid_present: 'gridPresent',
    fault: 'fault',
    equipment_data_stale: 'equipmentDataStale',
    malfunction: 'hasMalfunction',
    monitor_online: 'monitorOnline',
    smart_mode: 'smartModeEnabled',

    // Local bridge. reachable and bus-healthy are kept apart deliberately:
    // both look like "values stopped moving", but one is the ESP32 not
    // answering and the other is the generator having gone quiet on it --
    // different faults, at opposite ends of the install.
    local_bridge_connected: 'bridgeReachable',
    local_bus_healthy: 'busHealthy',
    exercising: 'exercising',
    scheduled_exercise_in_progress: 'scheduledExerciseInProgress',
    engine_running: 'engineRunning',
    engine_starting: 'engineStarting',
    utility_power_failure: 'utilityPowerFailure',
};

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

export interface GeneratorEntityState {
    siteId: string;
    name: string;
    state: Record<string, any>;
}

const siteOf = (e: HassEntity): string | null => {
    const site = (e?.attributes as any)?.[SITE_ATTR];
    return site ? String(site) : null;
};

// Home Assistant reports every state as a string. Numeric sensors come back as
// numbers so the tile's formatting behaves as it did with the HTTP document. A
// field the generator does not report stays undefined rather than becoming 0 —
// some units never send output voltage, RPM or load at all, and a confident
// zero presents absent data as a measurement.
const parseValue = (entity: HassEntity): any => {
    const text = String(entity.state ?? '');
    if (UNAVAILABLE.has(text.toLowerCase())) return undefined;
    if ((entity.attributes as any)?.device_class === 'timestamp') return text;
    if (/^-?\d+(\.\d+)?$/.test(text)) {
        const n = Number(text);
        return Number.isNaN(n) ? text : n;
    }
    return text;
};

const applyEntity = (target: Record<string, any>, entity: HassEntity): void => {
    const field = (entity.attributes as any)?.[FIELD_ATTR];
    if (!field) return;

    const [domain] = String(entity.entity_id || '').split('.');
    if (domain === 'binary_sensor') {
        const key = BINARY_FIELD_TO_KEY[field];
        if (!key) return;
        const raw = String(entity.state ?? '').toLowerCase();
        target[key] = UNAVAILABLE.has(raw) ? undefined : raw === 'on';
        if (field === 'smart_mode') {
            const detection = (entity.attributes as any)?.detection;
            if (detection) target.smartModeDetection = detection;
        }
        return;
    }

    const key = FIELD_TO_KEY[field];
    if (key) target[key] = parseValue(entity);

    // WHICH bridge, not merely "local". The integration stamps the address on
    // the telemetry_source sensor so a reading can be traced back to hardware,
    // and it stamps it even while the source is cloud -- "the bridge we are NOT
    // using is at 192.168.1.62" is exactly what you need in order to go and
    // look at it.
    if (field === 'telemetry_source') {
        const host = (entity.attributes as any)?.bridge_host;
        const port = (entity.attributes as any)?.bridge_port;
        if (host) target.bridgeHost = host;
        if (port) target.bridgePort = port;
    }

    // WHEN a state began, not just what it is.
    //
    // "Running" is almost useless on its own during an outage -- the question
    // is how long, because that is what tells you whether to worry about fuel,
    // and it is the first thing anyone asks. HA carries last_changed on every
    // entity and it costs nothing to keep.
    if (field === 'running' || field === 'engine_running') {
        const on = String(entity.state ?? '').toLowerCase() === 'on';
        target.runningSince = on ? (entity.last_changed || undefined) : undefined;
    }
    if (field === 'utility_power_failure') {
        const lost = String(entity.state ?? '').toLowerCase() === 'on';
        target.gridLostSince = lost ? (entity.last_changed || undefined) : undefined;
    }

    // The tile tests `faultCondition === true`, but this field arrives as text
    // ("False" from the bridge, a fault string from the cloud), so that check
    // could never match. Publish a real boolean alongside the text.
    if (field === 'fault_condition') {
        const t = String(parseValue(entity) ?? '').trim().toLowerCase();
        target.faultCondition = t !== '' && t !== 'false' && t !== 'none' && t !== '0';
    }

    if (field === 'active_alarm_count') {
        const alarms = (entity.attributes as any)?.active_alarms;
        if (Array.isArray(alarms)) target.activeAlarms = alarms;
    }
};

/** Every EnergyTrak site id present in the current entity snapshot. */
export const energyTrakSites = (entities: HassEntities): string[] => {
    const sites = new Set<string>();
    for (const entity of Object.values(entities || {})) {
        const site = siteOf(entity);
        if (site) sites.add(site);
    }
    return [...sites].sort();
};

/**
 * Assemble the telemetry document for one site. Returns null when the
 * integration is not installed or has published nothing yet, which lets the
 * tile fall back to its configured HTTP endpoint.
 *
 * `siteId` selects among multiple generators; when omitted the only site is
 * used (or the first, alphabetically, if there are several).
 */
export const buildGeneratorState = (
    entities: HassEntities,
    siteId?: string | null,
): GeneratorEntityState | null => {
    const wanted = (siteId || '').trim();
    const sites = energyTrakSites(entities);
    if (sites.length === 0) return null;

    // Accept the site id with or without the "genmon-" prefix, since the tile
    // config may hold either.
    const match =
        sites.find((s) => s === wanted) ||
        sites.find((s) => s.replace('genmon-', '') === wanted.replace('genmon-', '')) ||
        (wanted ? null : sites[0]);
    if (!match) return null;

    const mine = Object.values(entities).filter((e) => siteOf(e) === match);
    if (mine.length === 0) return null;

    const state: Record<string, any> = {};
    for (const entity of mine) applyEntity(state, entity);

    // One Health sensor drives the badge label and the three health rows'
    // colour. It is enabled by default, but an instance upgraded from an
    // earlier version of the integration keeps whatever the registry recorded —
    // Home Assistant applies entity_registry_enabled_default only at first
    // registration. Fall back to the run state so the badge reads "standby"
    // rather than "Unknown", and leave the health rows undefined rather than
    // inventing "healthy", so their colour degrades to neutral instead of lying.
    if (state.status !== undefined) {
        state.siteHealth = state.status;
        state.gridHealth = state.status;
        state.generatorHealth = state.status;
    } else {
        state.status = state.generatorStatus;
    }
    state.siteStatus = state.status;

    // HA composes friendly_name as "<device name> <entity name>"; the Running
    // binary sensor's entity name is always "Running", so stripping it leaves
    // the device name.
    const running = mine.find((e) => (e.attributes as any)?.[FIELD_ATTR] === 'running');
    const friendly = String((running?.attributes as any)?.friendly_name || '');
    const name = friendly.replace(/\s*Running$/i, '').trim() || 'Generator';

    return { siteId: match, name, state };
};
