import { describe, it, expect } from 'vitest';
import {
  isZoneSwitch,
  projectZone,
  groupZonesByLocation,
  projectController,
  discoverScenes,
  projectIrrigation,
  remainingLabel,
  lastWateredLabel,
  moistureColor,
  actuationGate,
  zoneRunCall,
  runDurationHint,
  zoneStopCall,
  sceneRunCall,
  controllerToggleCall,
  clampDuration,
  clampPct,
  UNZONED_LABEL,
  RAIN_SKIP_PROBABILITY,
  type EntityMap,
  type ZoneView,
} from './rachioLogic';

// A compact rachio_pro-shaped fixture: 4 zones across 2 locations + 1 unzoned,
// controller standby/rain-delay switches, rain sensor + online, forecast, and a
// pair of demo sprinkler scenes.
const fixture = (over: Partial<Record<string, any>> = {}): EntityMap => ({
  'switch.front_lawn_zone': {
    state: 'on',
    attributes: { friendly_name: 'Front Lawn', location: 'Front Yard', zone_number: 1, remaining_seconds: 312, device_class: undefined },
  },
  'switch.front_beds_zone': {
    state: 'off',
    attributes: { friendly_name: 'Front Beds', location: 'Front Yard', zone_number: 2 },
  },
  'switch.back_lawn_zone': {
    state: 'off',
    attributes: { friendly_name: 'Back Lawn', location: 'Back Yard', zone_number: 3 },
  },
  'switch.side_strip_zone': {
    state: 'off',
    attributes: { friendly_name: 'Side Strip', zone_number: 4 }, // no location => unzoned
  },
  // controller config switches (NO zone_number)
  'switch.controller_standby': { state: 'off', attributes: { friendly_name: 'Standby' } },
  'switch.controller_rain_delay': { state: 'off', attributes: { friendly_name: 'Rain delay' } },
  // sensors paired to zones by stem + device_class
  'sensor.front_lawn_zone_soil_moisture': { state: '46', attributes: { device_class: 'moisture', unit_of_measurement: '%' } },
  'sensor.front_lawn_zone_last_watered': { state: '2026-06-09T06:00:00+00:00', attributes: { device_class: 'timestamp' } },
  'sensor.back_lawn_zone_soil_moisture': { state: '14', attributes: { device_class: 'moisture', unit_of_measurement: '%' } },
  // controller binaries + forecast
  'binary_sensor.controller_online': { state: 'on', attributes: { device_class: 'connectivity' } },
  'binary_sensor.controller_rain_sensor': { state: 'off', attributes: { device_class: 'moisture' } },
  'sensor.controller_rain_probability': { state: '20', attributes: {} },
  'sensor.controller_forecast_temperature': { state: '78', attributes: { device_class: 'temperature', unit_of_measurement: '°F' } },
  'sensor.controller_forecast_humidity': { state: '55', attributes: { device_class: 'humidity', unit_of_measurement: '%' } },
  // demo sprinkler scenes (tagged)
  'script.evening_soak': { state: 'off', attributes: { friendly_name: 'Evening Soak', irrigation_scene: true } },
  'script.quick_rinse': { state: 'off', attributes: { friendly_name: 'Quick Rinse', irrigation_scene: true } },
  // a NON-rachio switch that must be ignored
  'switch.living_room_lamp': { state: 'on', attributes: { friendly_name: 'Lamp' } },
  ...over,
});

describe('isZoneSwitch', () => {
  it('matches a switch carrying zone_number', () => {
    const e = fixture();
    expect(isZoneSwitch('switch.front_lawn_zone', e['switch.front_lawn_zone'])).toBe(true);
  });
  it('rejects controller config switches (no zone_number)', () => {
    const e = fixture();
    expect(isZoneSwitch('switch.controller_standby', e['switch.controller_standby'])).toBe(false);
    expect(isZoneSwitch('switch.controller_rain_delay', e['switch.controller_rain_delay'])).toBe(false);
  });
  it('rejects unrelated switches and non-switch domains', () => {
    const e = fixture();
    expect(isZoneSwitch('switch.living_room_lamp', e['switch.living_room_lamp'])).toBe(false);
    expect(isZoneSwitch('sensor.front_lawn_zone_soil_moisture', e['sensor.front_lawn_zone_soil_moisture'])).toBe(false);
  });
  it('accepts zone_number === 0', () => {
    expect(isZoneSwitch('switch.z', { state: 'off', attributes: { zone_number: 0 } })).toBe(true);
  });
});

describe('projectZone', () => {
  it('projects running zone with remaining time + moisture + name', () => {
    const e = fixture();
    const z = projectZone(e, 'switch.front_lawn_zone', e['switch.front_lawn_zone']);
    expect(z.name).toBe('Front Lawn');
    expect(z.location).toBe('Front Yard');
    expect(z.zoneNumber).toBe(1);
    expect(z.running).toBe(true);
    expect(z.remainingSec).toBe(312);
    expect(z.moisturePct).toBe(46);
    expect(z.lastWatered).toBe('2026-06-09T06:00:00+00:00');
  });
  it('idle zone has no remaining time; moisture only when sensor present', () => {
    const e = fixture();
    const z = projectZone(e, 'switch.front_beds_zone', e['switch.front_beds_zone']);
    expect(z.running).toBe(false);
    expect(z.remainingSec).toBeNull();
    expect(z.moisturePct).toBeNull(); // no paired moisture sensor
  });
  it('zone without location label has null location', () => {
    const e = fixture();
    const z = projectZone(e, 'switch.side_strip_zone', e['switch.side_strip_zone']);
    expect(z.location).toBeNull();
  });
  it('unavailable zone reports available=false, not running', () => {
    const e = fixture({ 'switch.front_lawn_zone': { state: 'unavailable', attributes: { zone_number: 1, location: 'Front Yard' } } });
    const z = projectZone(e, 'switch.front_lawn_zone', e['switch.front_lawn_zone']);
    expect(z.available).toBe(false);
    expect(z.running).toBe(false);
  });
});

describe('groupZonesByLocation', () => {
  it('groups by location, alpha-sorts, trails the unzoned group last', () => {
    const { groups } = projectIrrigation(fixture());
    expect(groups.map((g) => g.location)).toEqual(['Back Yard', 'Front Yard', UNZONED_LABEL]);
    expect(groups[groups.length - 1].unzoned).toBe(true);
  });
  it('orders zones within a location by zone number', () => {
    const { groups } = projectIrrigation(fixture());
    const front = groups.find((g) => g.location === 'Front Yard')!;
    expect(front.zones.map((z) => z.zoneNumber)).toEqual([1, 2]);
  });
  it('all-labeled zones produce no unzoned group', () => {
    const zones: ZoneView[] = [
      { entityId: 'switch.a', name: 'A', location: 'Yard', zoneNumber: 1, available: true, running: false, remainingSec: null, moisturePct: null, lastWatered: null },
    ];
    const groups = groupZonesByLocation(zones);
    expect(groups).toHaveLength(1);
    expect(groups[0].unzoned).toBe(false);
  });
});

describe('projectController', () => {
  it('reads online, standby, rain-delay, rain-sensor, forecast', () => {
    const c = projectController(fixture());
    expect(c.online).toBe(true);
    expect(c.standby).toBe(false);
    expect(c.standbyEntity).toBe('switch.controller_standby');
    expect(c.rainDelay).toBe(false);
    expect(c.rainDelayEntity).toBe('switch.controller_rain_delay');
    expect(c.rainSensorWet).toBe(false);
    expect(c.rainProbability).toBe(20);
    expect(c.forecastTemp).toBe(78);
    expect(c.forecastTempUnit).toBe('°F');
    expect(c.forecastHumidity).toBe(55);
    expect(c.weatherSkip).toBe(false);
  });
  it('flags weatherSkip when rain sensor is wet', () => {
    const c = projectController(fixture({ 'binary_sensor.controller_rain_sensor': { state: 'on', attributes: { device_class: 'moisture' } } }));
    expect(c.rainSensorWet).toBe(true);
    expect(c.weatherSkip).toBe(true);
  });
  it('flags weatherSkip at/above the rain-probability threshold', () => {
    const c = projectController(fixture({ 'sensor.controller_rain_probability': { state: String(RAIN_SKIP_PROBABILITY), attributes: {} } }));
    expect(c.weatherSkip).toBe(true);
  });
  it('online is null when no connectivity sensor present', () => {
    const e = fixture();
    delete e['binary_sensor.controller_online'];
    expect(projectController(e).online).toBeNull();
  });
  it('reports rainDelay on when the rain-delay switch is on', () => {
    const c = projectController(fixture({ 'switch.controller_rain_delay': { state: 'on', attributes: { friendly_name: 'Rain delay', until: '2026-06-11T00:00:00+00:00' } } }));
    expect(c.rainDelay).toBe(true);
    expect(c.rainDelayUntil).toBe('2026-06-11T00:00:00+00:00');
  });
});

describe('discoverScenes', () => {
  it('discovers demo-tagged scene/script entities (sorted by name)', () => {
    const scenes = discoverScenes(fixture());
    expect(scenes.map((s) => s.name)).toEqual(['Evening Soak', 'Quick Rinse']);
    expect(scenes[0].entityId).toBe('script.evening_soak');
  });
  it('falls back to configured scene names when no tagged entities', () => {
    const bare: EntityMap = { 'switch.z_zone': { state: 'off', attributes: { zone_number: 1 } } };
    const scenes = discoverScenes(bare, ['Morning Cycle', 'Deep Soak']);
    expect(scenes.map((s) => s.name)).toEqual(['Deep Soak', 'Morning Cycle']);
    expect(scenes[0].entityId).toBeUndefined(); // runs via rachio_pro.run_scene
  });
  it('prefers tagged entities over configured names when both present', () => {
    const scenes = discoverScenes(fixture(), ['Ignored Name']);
    expect(scenes.every((s) => !!s.entityId)).toBe(true);
  });
  it('ignores untagged scene/script entities', () => {
    const e: EntityMap = { 'script.not_irrigation': { state: 'off', attributes: { friendly_name: 'Other' } } };
    expect(discoverScenes(e)).toHaveLength(0);
  });
});

describe('projectIrrigation (whole surface)', () => {
  it('discovers all zones, running set, controller, scenes', () => {
    const p = projectIrrigation(fixture());
    expect(p.zoneCount).toBe(4);
    expect(p.hasZones).toBe(true);
    expect(p.anyRunning).toBe(true);
    expect(p.runningZones.map((z) => z.name)).toEqual(['Front Lawn']);
    expect(p.scenes).toHaveLength(2);
  });
  it('hasZones=false on an empty store', () => {
    const p = projectIrrigation({});
    expect(p.hasZones).toBe(false);
    expect(p.zoneCount).toBe(0);
  });
});

describe('display helpers', () => {
  it('remainingLabel formats m:ss, null when not running', () => {
    expect(remainingLabel(312)).toBe('5:12');
    expect(remainingLabel(65)).toBe('1:05');
    expect(remainingLabel(0)).toBeNull();
    expect(remainingLabel(null)).toBeNull();
  });
  it('lastWateredLabel relative formatting', () => {
    const now = Date.parse('2026-06-09T12:00:00Z');
    expect(lastWateredLabel('2026-06-09T11:30:00Z', now)).toBe('30m ago');
    expect(lastWateredLabel('2026-06-09T09:00:00Z', now)).toBe('3h ago');
    expect(lastWateredLabel('2026-06-07T12:00:00Z', now)).toBe('2d ago');
    expect(lastWateredLabel(null)).toBe('—');
    expect(lastWateredLabel('not-a-date')).toBe('—');
  });
  it('moistureColor escalates dry → wet', () => {
    expect(moistureColor(10)).toBe('#f87171');
    expect(moistureColor(30)).toBe('#fbbf24');
    expect(moistureColor(60)).toBe('#38bdf8');
    expect(moistureColor(null)).toContain('text-dim');
  });
  it('clampPct + clampDuration bounds', () => {
    expect(clampPct(150)).toBe(100);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(null)).toBeNull();
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(999)).toBe(180);
    expect(clampDuration(12.6)).toBe(13);
  });
});

describe('actuationGate — water actuation ALWAYS confirm-gated', () => {
  it('every action requires confirm, even when allowed', () => {
    for (const action of ['zone-run', 'scene-run', 'rain-delay', 'standby'] as const) {
      const d = actuationGate(action, { available: true, entityId: 'switch.z', sceneName: 'S' });
      expect(d.requiresConfirm).toBe(true);
      expect(d.allowed).toBe(true);
    }
  });
  it('blocks in editor / locked', () => {
    expect(actuationGate('zone-run', { isEditor: true, entityId: 'switch.z', available: true }).allowed).toBe(false);
    expect(actuationGate('zone-run', { isLocked: true, entityId: 'switch.z', available: true }).allowed).toBe(false);
  });
  it('blocks when offline', () => {
    const d = actuationGate('zone-run', { available: false, entityId: 'switch.z' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('offline');
    expect(d.requiresConfirm).toBe(true); // never relaxes the confirm requirement
  });
  it('blocks zone-run with no entity', () => {
    expect(actuationGate('zone-run', { available: true }).allowed).toBe(false);
  });
  it('scene-run allowed with only a scene name (no entity)', () => {
    expect(actuationGate('scene-run', { available: true, sceneName: 'Evening Soak' }).allowed).toBe(true);
  });
  it('scene-run blocked with neither entity nor name', () => {
    expect(actuationGate('scene-run', { available: true }).reason).toBe('no-target');
  });
});

describe('service-call mapping', () => {
  it('zoneRunCall fires a PLAIN switch.turn_on (no extra fields → never 400s)', () => {
    expect(zoneRunCall({ entityId: 'switch.z', durationMin: 10 })).toEqual({
      domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.z' },
    });
    expect(zoneRunCall({ entityId: '', durationMin: 10 })).toBeNull();
  });
  it('runDurationHint clamps the picked duration to 1..180', () => {
    expect(runDurationHint(10)).toBe(10);
    expect(runDurationHint(999)).toBe(180);
    expect(runDurationHint(0)).toBe(1);
  });
  it('zoneStopCall fires switch.turn_off', () => {
    expect(zoneStopCall('switch.z')).toEqual({ domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.z' } });
    expect(zoneStopCall('')).toBeNull();
  });
  it('sceneRunCall: demo script -> script.turn_on; demo scene -> scene.turn_on; named -> rachio_pro.run_scene', () => {
    expect(sceneRunCall({ name: 'Evening Soak', entityId: 'script.evening_soak', available: true })).toEqual({
      domain: 'script', service: 'turn_on', data: { entity_id: 'script.evening_soak' },
    });
    expect(sceneRunCall({ name: 'Evening Soak', entityId: 'scene.evening_soak', available: true })).toEqual({
      domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.evening_soak' },
    });
    expect(sceneRunCall({ name: 'Evening Soak', available: true })).toEqual({
      domain: 'rachio_pro', service: 'run_scene', data: { scene: 'Evening Soak' },
    });
  });
  it('controllerToggleCall flips based on current state', () => {
    expect(controllerToggleCall('rain-delay', 'switch.rd', false)!.service).toBe('turn_on');
    expect(controllerToggleCall('rain-delay', 'switch.rd', true)!.service).toBe('turn_off');
    expect(controllerToggleCall('standby', 'switch.sb', false)!.service).toBe('turn_on');
    expect(controllerToggleCall('standby', '', false)).toBeNull();
  });
});
