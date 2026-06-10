import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import {
  projectTakeover,
  branchFromDeviceClass,
  tierOf,
  ALARM_ENTITY_ID,
  fmtRelative,
} from './lifeSafety';

const NOW = new Date('2026-06-09T19:42:00').getTime();

const ent = (state: string, attributes: Record<string, any> = {}, last_changed = '2026-06-09T19:41:20'): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed,
  last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

// Build an entity feed with the alarm panel triggered + the given open sensors,
// where each open-sensor id maps to a sensor entity carrying a device_class.
const feed = (
  openSensors: Record<string, string>,
  sensorDefs: Record<string, { device_class?: string; friendly_name?: string }>,
  alarmAttrs: Record<string, any> = {},
): HassEntities => {
  const f: any = {
    [ALARM_ENTITY_ID]: ent('triggered', { open_sensors: openSensors, ...alarmAttrs }),
  };
  for (const [id, d] of Object.entries(sensorDefs)) {
    f[id] = ent('on', { device_class: d.device_class, friendly_name: d.friendly_name });
  }
  return f;
};

describe('branchFromDeviceClass — type branch', () => {
  it('maps fire device_classes', () => {
    expect(branchFromDeviceClass('smoke')).toBe('fire');
    expect(branchFromDeviceClass('heat')).toBe('fire');
  });
  it('maps CO + gas', () => {
    expect(branchFromDeviceClass('carbon_monoxide')).toBe('co');
    expect(branchFromDeviceClass('co')).toBe('co');
    expect(branchFromDeviceClass('gas')).toBe('gas');
  });
  it('maps intrusion device_classes', () => {
    expect(branchFromDeviceClass('door')).toBe('intrusion');
    expect(branchFromDeviceClass('window')).toBe('intrusion');
    expect(branchFromDeviceClass('motion')).toBe('intrusion');
    expect(branchFromDeviceClass('opening')).toBe('intrusion');
  });
  it('falls back to EVACUATE when device_class is absent/unknown', () => {
    expect(branchFromDeviceClass(undefined)).toBe('evacuate');
    expect(branchFromDeviceClass(null)).toBe('evacuate');
    expect(branchFromDeviceClass('')).toBe('evacuate');
    expect(branchFromDeviceClass('battery')).toBe('evacuate');
  });
  it('tier: life-safety = 1, intrusion = 2', () => {
    expect(tierOf('fire')).toBe(1);
    expect(tierOf('co')).toBe(1);
    expect(tierOf('gas')).toBe(1);
    expect(tierOf('evacuate')).toBe(1);
    expect(tierOf('intrusion')).toBe(2);
  });
});

describe('projectTakeover — triggered panel + open_sensors parsing', () => {
  it('is inactive when the panel is disarmed', () => {
    const f: any = { [ALARM_ENTITY_ID]: ent('disarmed') };
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.active).toBe(false);
    expect(v.freshness).toBe('known-good');
  });

  it('is inactive on arming/pending (only triggered raises the takeover)', () => {
    expect(projectTakeover({ [ALARM_ENTITY_ID]: ent('arming') } as any, true, NOW, NOW).active).toBe(false);
    expect(projectTakeover({ [ALARM_ENTITY_ID]: ent('pending') } as any, true, NOW, NOW).active).toBe(false);
  });

  it('FIRE: a triggered smoke sensor → fire, tier 1', () => {
    const f = feed(
      { 'binary_sensor.garage_smoke': 'on' },
      { 'binary_sensor.garage_smoke': { device_class: 'smoke', friendly_name: 'Garage' } },
    );
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.active).toBe(true);
    expect(v.type).toBe('fire');
    expect(v.tier).toBe(1);
    expect(v.initiatingZone).toBe('Garage');
    expect(v.sensors).toHaveLength(1);
  });

  it('INTRUSION: a triggered door sensor → intrusion, tier 2', () => {
    const f = feed(
      { 'binary_sensor.front_door': 'on' },
      { 'binary_sensor.front_door': { device_class: 'door', friendly_name: 'Front Door' } },
      { arm_mode: 'armed_away', delay: 30 },
    );
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.active).toBe(true);
    expect(v.type).toBe('intrusion');
    expect(v.tier).toBe(2);
    expect(v.initiatingZone).toBe('Front Door');
    expect(v.armModeAtTrip).toBe('Armed · Away');
    expect(v.entryDelayTotal).toBe(30);
  });

  it('CO outranks a concurrent intrusion (life-safety wins)', () => {
    const f = feed(
      { 'binary_sensor.hall_co': 'on', 'binary_sensor.front_door': 'on' },
      {
        'binary_sensor.hall_co': { device_class: 'carbon_monoxide', friendly_name: 'Hall' },
        'binary_sensor.front_door': { device_class: 'door', friendly_name: 'Front Door' },
      },
    );
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.type).toBe('co');
    expect(v.tier).toBe(1);
    // multiplicity only counts the WINNING type's sensors
    expect(v.matchingSensors).toHaveLength(1);
    expect(v.matchingSensors[0].name).toBe('Hall');
  });

  it('GAS outranks fire (highest life-safety rank wins)', () => {
    const f = feed(
      { 'binary_sensor.kitchen_gas': 'on', 'binary_sensor.garage_smoke': 'on' },
      {
        'binary_sensor.kitchen_gas': { device_class: 'gas', friendly_name: 'Kitchen' },
        'binary_sensor.garage_smoke': { device_class: 'smoke', friendly_name: 'Garage' },
      },
    );
    expect(projectTakeover(f, true, NOW, NOW).type).toBe('gas');
  });

  it('multiplicity: two fire zones → both matching, spreading', () => {
    const f = feed(
      { 'binary_sensor.garage_smoke': 'on', 'binary_sensor.kitchen_smoke': 'on' },
      {
        'binary_sensor.garage_smoke': { device_class: 'smoke', friendly_name: 'Garage' },
        'binary_sensor.kitchen_smoke': { device_class: 'smoke', friendly_name: 'Kitchen' },
      },
    );
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.type).toBe('fire');
    expect(v.matchingSensors.map((s) => s.name).sort()).toEqual(['Garage', 'Kitchen']);
  });

  it('EVACUATE fallback: triggered with NO open_sensors → evacuate, tier 1 (never silently intrusion)', () => {
    const f: any = { [ALARM_ENTITY_ID]: ent('triggered', { open_sensors: {} }) };
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.active).toBe(true);
    expect(v.type).toBe('evacuate');
    expect(v.tier).toBe(1);
  });

  it('EVACUATE fallback: triggered sensor with absent device_class → evacuate', () => {
    const f = feed(
      { 'binary_sensor.unknown_zone': 'on' },
      { 'binary_sensor.unknown_zone': { friendly_name: 'Unknown Zone' } },
    );
    const v = projectTakeover(f, true, NOW, NOW);
    expect(v.type).toBe('evacuate');
    expect(v.tier).toBe(1);
  });
});

describe('projectTakeover — three-state freshness (signal-lost / stale)', () => {
  it('signal-lost when the WS is disconnected', () => {
    const f = feed(
      { 'binary_sensor.garage_smoke': 'on' },
      { 'binary_sensor.garage_smoke': { device_class: 'smoke' } },
    );
    const v = projectTakeover(f, false, NOW, NOW);
    expect(v.freshness).toBe('signal-lost');
    // active is false because we cannot trust the feed — but it reads UNKNOWN,
    // not "all clear" (the consumer raises the signal-lost banner).
    expect(v.active).toBe(false);
  });

  it('signal-lost when the alarm entity is missing', () => {
    expect(projectTakeover({}, true, NOW, NOW).freshness).toBe('signal-lost');
  });

  it('signal-lost when the alarm entity is unavailable', () => {
    const f: any = { [ALARM_ENTITY_ID]: ent('unavailable') };
    expect(projectTakeover(f, true, NOW, NOW).freshness).toBe('signal-lost');
  });

  it('stale when connected but no fresh push within the window', () => {
    const f: any = { [ALARM_ENTITY_ID]: ent('disarmed') };
    const lastSeen = NOW - 60000; // 60s ago, > 45s window
    const v = projectTakeover(f, true, lastSeen, NOW, 45000);
    expect(v.freshness).toBe('stale');
  });

  it('known-good when connected + fresh', () => {
    const f: any = { [ALARM_ENTITY_ID]: ent('disarmed') };
    const v = projectTakeover(f, true, NOW - 1000, NOW, 45000);
    expect(v.freshness).toBe('known-good');
  });

  it('signal-lost reports last-known label + iso (not "clear")', () => {
    const v = projectTakeover({}, false, NOW, NOW);
    expect(v.lastKnownLabel).toBeNull(); // no entity → null, NOT a green "clear"
    // with an entity present but disconnected, last-known is surfaced
    const f: any = { [ALARM_ENTITY_ID]: ent('disarmed', {}, '2026-06-09T19:39:00') };
    const v2 = projectTakeover(f, false, NOW, NOW);
    expect(v2.freshness).toBe('signal-lost');
    expect(v2.lastKnownLabel).toBe('Disarmed');
    expect(v2.lastKnownIso).toBe('2026-06-09T19:39:00');
  });
});

describe('fmtRelative', () => {
  it('formats sub-minute + minute ages', () => {
    expect(fmtRelative('2026-06-09T19:41:20', NOW)).toBe('40s ago');
    expect(fmtRelative('2026-06-09T19:38:48', NOW)).toBe('3m 12s ago');
    expect(fmtRelative(null, NOW)).toBe('');
  });
});
