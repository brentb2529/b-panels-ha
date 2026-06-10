import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { HassEntities } from 'home-assistant-js-websocket';
import {
  projectWeatherSafety,
  projectFreeze,
  projectStorm,
  isLifeSafetyActive,
  fmtExpires,
  fmtSince,
  ALARM_ENTITY_ID,
  SEVERITY_LABEL,
} from './weatherSafety';

// Freeze + Storm protection — pure-projection tests.
//
// Covers (per the build brief):
//   • freeze-active surfacing
//   • storm-alert parsing + banner activation
//   • life-safety OUTRANKS storm/freeze (precedence yield)
//   • no-actuation guard (the tier imports NO callService, by construction)

const NOW = new Date('2026-06-10T19:42:00').getTime();

const ent = (
  entity_id: string,
  state: string,
  attributes: Record<string, any> = {},
  last_changed = '2026-06-10T19:30:00',
): any => ({
  entity_id,
  state,
  attributes,
  last_changed,
  last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

const feed = (...ents: any[]): HassEntities => {
  const f: any = {};
  for (const e of ents) f[e.entity_id] = e;
  return f;
};

// A demo IntelliCenter freeze-protection binary_sensor (device_class:cold — the
// LOCKED contract interface) and a demo NWS-shape severe-weather alert sensor.
const freezeSensor = (state: 'on' | 'off') =>
  ent('binary_sensor.pool_freeze_protection', state, {
    device_class: 'cold',
    friendly_name: 'Pool Freeze Protection',
  });

const stormSensor = (count: number, attrs: Record<string, any> = {}) =>
  ent('sensor.home_weather_alerts', String(count), {
    friendly_name: 'Home Weather Alerts',
    event: 'Winter Storm Warning',
    headline: 'Winter Storm Warning issued for your area until 11 PM EDT.',
    severity: 'Severe',
    expires: '2026-06-10T23:00:00',
    ...attrs,
  });

const alarm = (state: string) => ent(ALARM_ENTITY_ID, state, { open_sensors: {} });

describe('projectFreeze — device_class:cold (LOCKED contract interface)', () => {
  it('detects an active freeze binary_sensor generically', () => {
    const v = projectFreeze(feed(freezeSensor('on')));
    expect(v.present).toBe(true);
    expect(v.active).toBe(true);
    expect(v.entityId).toBe('binary_sensor.pool_freeze_protection');
    expect(v.name).toBe('Pool Freeze Protection');
    expect(v.sinceIso).toBe('2026-06-10T19:30:00');
  });

  it('is present-but-inactive when the freeze sensor is off', () => {
    const v = projectFreeze(feed(freezeSensor('off')));
    expect(v.present).toBe(true);
    expect(v.active).toBe(false);
  });

  it('honors an explicitly configured freeze entity id', () => {
    const f = feed(
      ent('binary_sensor.some_other_cold', 'off', { device_class: 'cold' }),
      ent('binary_sensor.my_freeze', 'on', { device_class: 'cold', friendly_name: 'My Freeze' }),
    );
    const v = projectFreeze(f, { freezeEntityId: 'binary_sensor.my_freeze' });
    expect(v.entityId).toBe('binary_sensor.my_freeze');
    expect(v.active).toBe(true);
  });

  it('is absent when no cold sensor exists', () => {
    expect(projectFreeze(feed()).present).toBe(false);
  });
});

describe('projectStorm — severe-weather alert parsing (NWS-shape, generic)', () => {
  it('parses an active alert: event / headline / severity / expires / count', () => {
    const v = projectStorm(feed(stormSensor(1)));
    expect(v.present).toBe(true);
    expect(v.active).toBe(true);
    expect(v.event).toBe('Winter Storm Warning');
    expect(v.headline).toMatch(/Winter Storm Warning issued/);
    expect(v.severity).toBe('severe');
    expect(v.expiresIso).toBe('2026-06-10T23:00:00');
    expect(v.count).toBe(1);
  });

  it('reports concurrent alert count', () => {
    const v = projectStorm(feed(stormSensor(3)));
    expect(v.count).toBe(3);
    expect(v.active).toBe(true);
  });

  it('is inactive when the alert count is 0 (no alerts)', () => {
    const v = projectStorm(feed(stormSensor(0)));
    expect(v.present).toBe(true);
    expect(v.active).toBe(false);
  });

  it('handles a binary_sensor-shape alert feed (on/off)', () => {
    const f = feed(
      ent('binary_sensor.severe_weather_alert', 'on', {
        device_class: 'safety',
        friendly_name: 'Severe Weather Alert',
        event: 'Tornado Warning',
        severity: 'Extreme',
        expires: '2026-06-10T20:15:00',
      }),
    );
    const v = projectStorm(f);
    expect(v.active).toBe(true);
    expect(v.event).toBe('Tornado Warning');
    expect(v.severity).toBe('extreme');
  });

  it('honors an explicitly configured alert entity id', () => {
    const f = feed(
      stormSensor(0),
      ent('sensor.custom_alerts', '1', { event: 'Flood Warning', severity: 'Moderate' }),
    );
    const v = projectStorm(f, { alertEntityId: 'sensor.custom_alerts' });
    expect(v.entityId).toBe('sensor.custom_alerts');
    expect(v.event).toBe('Flood Warning');
    expect(v.severity).toBe('moderate');
  });

  it('falls back to a generic event label when none is given', () => {
    const f = feed(ent('sensor.weather_alerts', '1', { headline: 'Something is happening' }));
    const v = projectStorm(f);
    expect(v.event).toBe('Severe weather alert');
  });
});

describe('projectWeatherSafety — top-level kind + surfacing', () => {
  it('storm only → active, kind=storm', () => {
    const v = projectWeatherSafety(feed(stormSensor(1), alarm('disarmed')));
    expect(v.active).toBe(true);
    expect(v.kind).toBe('storm');
    expect(v.suppressedByLifeSafety).toBe(false);
  });

  it('freeze only → active, kind=freeze', () => {
    const v = projectWeatherSafety(feed(freezeSensor('on'), alarm('disarmed')));
    expect(v.active).toBe(true);
    expect(v.kind).toBe('freeze');
  });

  it('both → active, kind=storm+freeze', () => {
    const v = projectWeatherSafety(feed(freezeSensor('on'), stormSensor(1), alarm('armed_home')));
    expect(v.active).toBe(true);
    expect(v.kind).toBe('storm+freeze');
  });

  it('neither → inactive, kind=null', () => {
    const v = projectWeatherSafety(feed(freezeSensor('off'), stormSensor(0), alarm('disarmed')));
    expect(v.active).toBe(false);
    expect(v.kind).toBeNull();
  });
});

describe('PRECEDENCE — life-safety ALWAYS outranks the weather-safety tier', () => {
  it('isLifeSafetyActive: only a triggered panel counts', () => {
    expect(isLifeSafetyActive(feed(alarm('triggered')))).toBe(true);
    expect(isLifeSafetyActive(feed(alarm('armed_away')))).toBe(false);
    expect(isLifeSafetyActive(feed(alarm('disarmed')))).toBe(false);
    expect(isLifeSafetyActive(feed())).toBe(false);
  });

  it('storm + life-safety triggered → weather tier YIELDS (active=false, suppressed=true)', () => {
    const v = projectWeatherSafety(feed(stormSensor(1), alarm('triggered')));
    // the underlying storm is still parsed/present...
    expect(v.storm.active).toBe(true);
    // ...but the tier yields to the life-safety takeover.
    expect(v.suppressedByLifeSafety).toBe(true);
    expect(v.active).toBe(false);
  });

  it('freeze + storm + life-safety triggered → still yields', () => {
    const v = projectWeatherSafety(feed(freezeSensor('on'), stormSensor(2), alarm('triggered')));
    expect(v.freeze.active).toBe(true);
    expect(v.storm.active).toBe(true);
    expect(v.suppressedByLifeSafety).toBe(true);
    expect(v.active).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('fmtExpires renders a clock + relative window', () => {
    expect(fmtExpires('2026-06-10T20:12:00', NOW)).toMatch(/Until 8:12 PM · ~30m/);
    expect(fmtExpires('2026-06-10T22:42:00', NOW)).toMatch(/Until 10:42 PM · ~3h/);
    expect(fmtExpires(null, NOW)).toBe('');
  });
  it('fmtSince renders a clock', () => {
    expect(fmtSince('2026-06-10T19:30:00')).toBe('7:30 PM');
    expect(fmtSince(null)).toBe('');
  });
  it('SEVERITY_LABEL covers all severities', () => {
    expect(SEVERITY_LABEL.extreme).toBe('Extreme');
    expect(SEVERITY_LABEL.unknown).toBe('Advisory');
  });
});

describe('NO-ACTUATION GUARD — the tier issues ZERO service calls', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => readFileSync(join(here, f), 'utf8');

  // Strip // line-comments and /* block-comments */ so the prose that DESCRIBES
  // the no-actuation posture (which mentions "callService") doesn't trip the
  // guard — we only want to catch real imports / call sites.
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('no source file in the tier IMPORTS or CALLS a service-dispatch function', () => {
    for (const f of ['weatherSafety.ts', 'useWeatherSafety.ts', 'WeatherSafetyBanner.tsx']) {
      const code = stripComments(read(f));
      // No actual call to callService / .callService( anywhere in the code.
      expect(code, `${f} must not call callService(...)`).not.toMatch(/callService\s*\(/);
      // No import of a service-dispatch helper (callService / callApi / hass).
      expect(code, `${f} must not import a service dispatcher`).not.toMatch(
        /import[^;]*\b(callService|callApi|callWS)\b/,
      );
      // No HA service domains being driven (pump/shade/valve/scene/automation).
      expect(code, `${f} must not reference a service domain string`).not.toMatch(
        /['"](pump|cover|valve|switch|climate|scene|script)\.[a-z_]+['"]/,
      );
    }
  });

  it('the banner explicitly documents the equipment-mediated / no-actuation posture', () => {
    const src = read('WeatherSafetyBanner.tsx');
    expect(src).toMatch(/NO EQUIPMENT ACTUATION/);
    expect(src).toMatch(/equipment-mediated/);
  });
});
