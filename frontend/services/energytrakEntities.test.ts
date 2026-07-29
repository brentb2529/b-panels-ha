import { describe, it, expect } from 'vitest';
import { buildGeneratorState, energyTrakSites } from './energytrakEntities';

// Fixtures mirror what the `energytrak` integration actually publishes: every
// entity carries energytrak_site / energytrak_field, and a generator that never
// uploads equipment telemetry simply has no entity for RPM, output voltage or
// load — the integration does not create them.
const entity = (
    entity_id: string,
    state: string,
    field: string,
    extra: Record<string, any> = {},
) => ({
    entity_id,
    state,
    attributes: {
        energytrak_site: 'genmon-1234567890',
        energytrak_field: field,
        ...extra,
    },
    context: { id: '', parent_id: null, user_id: null },
    last_changed: '',
    last_updated: '',
});

const SNAPSHOT: any = Object.fromEntries(
    [
        entity('binary_sensor.gen_running', 'off', 'running', {
            friendly_name: 'Example Generator Running',
        }),
        entity('binary_sensor.gen_fault', 'off', 'fault'),
        entity('binary_sensor.gen_grid_power', 'on', 'grid_present'),
        entity('binary_sensor.gen_stale', 'on', 'equipment_data_stale'),
        entity('binary_sensor.gen_smart', 'on', 'smart_mode', { detection: 'AUTO' }),
        entity('sensor.gen_health', 'healthy', 'health'),
        entity('sensor.gen_status', 'standby', 'status'),
        entity('sensor.gen_grid_status', 'Present', 'grid_status'),
        entity('sensor.gen_batt', '13.1', 'battery_voltage'),
        entity('sensor.gen_hours', '90.47', 'engine_hours'),
        entity('sensor.gen_grid_v', '237', 'grid_voltage'),
        entity('sensor.gen_starts', '274', 'starts_count'),
        entity('sensor.gen_trips', '2', 'trips_count'),
        entity('sensor.gen_alarms', '0', 'active_alarm_count', { active_alarms: [] }),
        entity('sensor.gen_util', 'STOPPED OVER 150V', 'utility_monitor'),
        entity('sensor.gen_last_recv', '2026-07-29T15:27:51+00:00', 'last_received', {
            device_class: 'timestamp',
        }),
    ].map((e) => [e.entity_id, e]),
);

describe('energytrakEntities', () => {
    it('finds the sites present in a snapshot', () => {
        expect(energyTrakSites(SNAPSHOT)).toEqual(['genmon-1234567890']);
    });

    it('returns null when the integration is not publishing', () => {
        expect(buildGeneratorState({} as any)).toBeNull();
        expect(buildGeneratorState({ 'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} } } as any)).toBeNull();
    });

    it('builds the document shape the tile renders', () => {
        const built = buildGeneratorState(SNAPSHOT)!;
        expect(built.siteId).toBe('genmon-1234567890');
        expect(built.name).toBe('Example Generator');

        const s = built.state;
        // `health` drives the badge; `status` is the run state. Crossing these
        // wrong makes the badge read "STANDBY" instead of "healthy".
        expect(s.status).toBe('healthy');
        expect(s.siteStatus).toBe('healthy');
        expect(s.generatorStatus).toBe('standby');
        expect(s.siteHealth).toBe('healthy');
        expect(s.gridHealth).toBe('healthy');

        expect(s.batteryVoltage).toBe(13.1);
        expect(s.engineHours).toBe(90.47);
        expect(s.gridVoltage).toBe(237);
        expect(s.startsCount).toBe(274);
        expect(s.active).toBe(false);
        expect(s.fault).toBe(false);
        expect(s.gridStatus).toBe('Present');
        expect(s.equipmentDataStale).toBe(true);
        expect(s.smartModeEnabled).toBe(true);
        expect(s.smartModeDetection).toBe('AUTO');
        expect(s.activeAlarms).toEqual([]);
        expect(s.lastReceivedAt).toBe('2026-07-29T15:27:51+00:00');
        // Non-numeric strings must not be coerced.
        expect(s.utilityMonitor).toBe('STOPPED OVER 150V');
    });

    it('leaves unreported measurements undefined rather than zero', () => {
        const s = buildGeneratorState(SNAPSHOT)!.state;
        for (const key of ['outputVoltage', 'engineSpeed', 'loadPower', 'generatorFrequency', 'gridFrequency']) {
            expect(s[key]).toBeUndefined();
        }
    });

    it('falls back to the run state for the badge when Health is disabled', () => {
        const withoutHealth: any = { ...SNAPSHOT };
        delete withoutHealth['sensor.gen_health'];
        const s = buildGeneratorState(withoutHealth)!.state;
        expect(s.status).toBe('standby');
        // Health rows stay undefined rather than claiming "healthy".
        expect(s.siteHealth).toBeUndefined();
    });

    it('treats unavailable entities as absent, not as a value', () => {
        const degraded: any = {
            ...SNAPSHOT,
            'sensor.gen_batt': entity('sensor.gen_batt', 'unavailable', 'battery_voltage'),
            'binary_sensor.gen_fault': entity('binary_sensor.gen_fault', 'unknown', 'fault'),
        };
        const s = buildGeneratorState(degraded)!.state;
        expect(s.batteryVoltage).toBeUndefined();
        expect(s.fault).toBeUndefined();
    });

    it('matches a configured site id with or without the genmon- prefix', () => {
        expect(buildGeneratorState(SNAPSHOT, '1234567890')?.siteId).toBe('genmon-1234567890');
        expect(buildGeneratorState(SNAPSHOT, 'genmon-1234567890')?.siteId).toBe('genmon-1234567890');
        expect(buildGeneratorState(SNAPSHOT, 'genmon-other')).toBeNull();
    });
});
