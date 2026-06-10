import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { HassEntities } from 'home-assistant-js-websocket';
import {
  projectGarage,
  projectDoorbellRing,
  isLifeSafetyActive,
  isWeatherSafetyActive,
  fmtOpenFor,
  fmtRingClock,
} from './entry';

// Doorbell + Garage entry experience — pure-projection tests
// (feat/doorbell-garage). Covers, per the build brief:
//   • garage status (open/closed/opening) + confirm-to-close fires NO actuation
//   • open-at-night + open-while-armed-away alert logic
//   • doorbell ring tier YIELDS to life-safety AND to weather-safety
//   • gate/door release + close issue NO service (grep guard over the tier)

const NOW = new Date('2026-06-10T23:30:00').getTime();   // 11:30 PM (night)
const DAY = new Date('2026-06-10T14:00:00').getTime();   // 2:00 PM (day)

const ent = (
  entity_id: string,
  state: string,
  attributes: Record<string, any> = {},
  last_changed = '2026-06-10T23:25:00',
): any => ({
  entity_id, state, attributes,
  last_changed, last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

const feed = (...ents: any[]): HassEntities => {
  const f: any = {};
  for (const e of ents) f[e.entity_id] = e;
  return f;
};

// Demo backing entities shaped like the real sources.
const garageCover = (state: string, id = 'cover.garage_door') =>
  ent(id, state, { device_class: 'garage', friendly_name: 'Garage Door' });
const alarm = (state: string) => ent('alarm_control_panel.house', state);
const freezeSensor = (state: 'on' | 'off') =>
  ent('binary_sensor.pool_freeze_protection', state, { device_class: 'cold' });
const stormSensor = (count: number) =>
  ent('sensor.home_weather_alerts', String(count), { event: 'Winter Storm Warning', severity: 'Severe' });
const doorbellBs = (state: 'on' | 'off', last = '2026-06-10T23:29:50') =>
  ent('binary_sensor.front_door_doorbell', state, { device_class: 'doorbell', friendly_name: 'Front Door Doorbell' }, last);
const doorbellEvent = (last: string) =>
  ent('event.front_door_doorbell', '2026-06-10T23:29:50+00:00', { event_type: 'ring', event_types: ['ring'] }, last);

// ── GARAGE STATUS ────────────────────────────────────────────────────────────
describe('garage — status projection', () => {
  it('reports closed / open / opening states by device_class:garage', () => {
    expect(projectGarage(feed(garageCover('closed')), { nowMs: DAY }).doors[0].state).toBe('closed');
    expect(projectGarage(feed(garageCover('open')), { nowMs: DAY }).doors[0].state).toBe('open');
    const opening = projectGarage(feed(garageCover('opening')), { nowMs: DAY }).doors[0];
    expect(opening.state).toBe('opening');
    expect(opening.stateLabel).toBe('Opening…');
    expect(opening.open).toBe(true); // moving counts as "attention/open"
  });

  it('auto-detects generically (no hardcoded id) and humanizes the name', () => {
    const v = projectGarage(feed(garageCover('open', 'cover.west_bay')), { nowMs: DAY });
    expect(v.present).toBe(true);
    expect(v.doors[0].id).toBe('cover.west_bay');
  });

  it('ignores non-garage covers (e.g. window shades)', () => {
    const shade = ent('cover.living_shade', 'open', { device_class: 'shade' });
    const v = projectGarage(feed(shade), { nowMs: DAY });
    expect(v.present).toBe(false);
    expect(v.doors).toHaveLength(0);
  });

  it('absent garage → honest inert view', () => {
    const v = projectGarage(feed(), { nowMs: DAY });
    expect(v.present).toBe(false);
    expect(v.summary).toMatch(/no garage/i);
  });
});

// ── GARAGE ALERT LOGIC ─────────────────────────────────────────────────────
describe('garage — proactive alert logic (open-at-night / open-armed-away)', () => {
  it('open after night hour → open-at-night alert', () => {
    const v = projectGarage(feed(garageCover('open'), alarm('disarmed')), { nowMs: NOW, nightHour: 22 });
    expect(v.alerts).toHaveLength(1);
    expect(v.alerts[0].kind).toBe('open-at-night');
  });

  it('open during the day (no arm) → NO alert', () => {
    const v = projectGarage(feed(garageCover('open'), alarm('disarmed')), { nowMs: DAY, nightHour: 22 });
    expect(v.alerts).toHaveLength(0);
  });

  it('open while Armed Away → open-armed-away alert (even in daytime)', () => {
    const v = projectGarage(feed(garageCover('open'), alarm('armed_away')), { nowMs: DAY, nightHour: 22 });
    expect(v.alerts).toHaveLength(1);
    expect(v.alerts[0].kind).toBe('open-armed-away');
  });

  it('armed-away takes priority over night for the same door (one alert, not two)', () => {
    const v = projectGarage(feed(garageCover('open'), alarm('armed_away')), { nowMs: NOW, nightHour: 22 });
    expect(v.alerts).toHaveLength(1);
    expect(v.alerts[0].kind).toBe('open-armed-away');
  });

  it('CLOSED door → never alerts, regardless of time/arm', () => {
    expect(projectGarage(feed(garageCover('closed'), alarm('armed_away')), { nowMs: NOW }).alerts).toHaveLength(0);
    expect(projectGarage(feed(garageCover('closed'), alarm('disarmed')), { nowMs: NOW }).alerts).toHaveLength(0);
  });

  it('a transiently MOVING door (opening) does not raise an open alert', () => {
    const v = projectGarage(feed(garageCover('opening'), alarm('armed_away')), { nowMs: NOW });
    expect(v.alerts).toHaveLength(0);
  });
});

// ── DOORBELL RING TIER + PRECEDENCE ──────────────────────────────────────────
describe('doorbell ring — tiering (yields to life-safety AND weather-safety)', () => {
  it('a fresh ring with no higher tier → active', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on')), { nowMs: NOW });
    expect(v.ringing).toBe(true);
    expect(v.active).toBe(true);
  });

  it('a stale ring (outside the transient window) → not ringing', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on', '2026-06-10T22:00:00')), { nowMs: NOW, ringWindowMs: 40_000 });
    expect(v.ringing).toBe(false);
    expect(v.active).toBe(false);
  });

  it('an event-entity ring (fresh last_changed) → ringing', () => {
    const v = projectDoorbellRing(feed(doorbellEvent('2026-06-10T23:29:55')), { nowMs: NOW });
    expect(v.ringing).toBe(true);
    expect(v.active).toBe(true);
  });

  it('ring + LIFE-SAFETY (alarm triggered) → YIELDS (active=false, suppressed flag set)', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on'), alarm('triggered')), { nowMs: NOW });
    expect(v.ringing).toBe(true);             // the ring is still happening...
    expect(v.suppressedByLifeSafety).toBe(true);
    expect(v.active).toBe(false);             // ...but the overlay yields.
  });

  it('ring + WEATHER-SAFETY (freeze) → YIELDS to weather', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on'), freezeSensor('on')), { nowMs: NOW });
    expect(v.ringing).toBe(true);
    expect(v.suppressedByWeatherSafety).toBe(true);
    expect(v.active).toBe(false);
  });

  it('ring + WEATHER-SAFETY (storm alert) → YIELDS to weather', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on'), stormSensor(1)), { nowMs: NOW });
    expect(v.suppressedByWeatherSafety).toBe(true);
    expect(v.active).toBe(false);
  });

  it('full precedence: life-safety > weather > ring (all three present → ring inactive, life-safety flagged)', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on'), freezeSensor('on'), alarm('triggered')), { nowMs: NOW });
    expect(v.suppressedByLifeSafety).toBe(true);
    expect(v.suppressedByWeatherSafety).toBe(true);
    expect(v.active).toBe(false);
  });

  it('no doorbell entity → inert (no overlay)', () => {
    const v = projectDoorbellRing(feed(), { nowMs: NOW });
    expect(v.present).toBe(false);
    expect(v.active).toBe(false);
  });

  it('camera is honest-absent (no stream) when UniFi not in dev', () => {
    const v = projectDoorbellRing(feed(doorbellBs('on')), { nowMs: NOW });
    expect(v.cameraHasStream).toBe(false);
  });
});

describe('precedence helpers — single source of truth', () => {
  it('isLifeSafetyActive: only a triggered panel counts', () => {
    expect(isLifeSafetyActive(feed(alarm('triggered')))).toBe(true);
    expect(isLifeSafetyActive(feed(alarm('armed_away')))).toBe(false);
    expect(isLifeSafetyActive(feed())).toBe(false);
  });
  it('isWeatherSafetyActive: a freeze OR an active storm counts', () => {
    expect(isWeatherSafetyActive(feed(freezeSensor('on')))).toBe(true);
    expect(isWeatherSafetyActive(feed(freezeSensor('off')))).toBe(false);
    expect(isWeatherSafetyActive(feed(stormSensor(2)))).toBe(true);
    expect(isWeatherSafetyActive(feed(stormSensor(0)))).toBe(false);
    expect(isWeatherSafetyActive(feed())).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('fmtOpenFor renders a relative age', () => {
    expect(fmtOpenFor('2026-06-10T23:15:00', NOW)).toBe('~15m');
    expect(fmtOpenFor('2026-06-10T21:00:00', NOW)).toMatch(/~2h 30m/);
    expect(fmtOpenFor(null, NOW)).toBe('');
  });
  it('fmtRingClock renders a clock', () => {
    expect(fmtRingClock('2026-06-10T23:29:50')).toBe('11:29 PM');
    expect(fmtRingClock(null)).toBe('');
  });
});

// ── NO-ACTUATION GUARD — the whole entry tier issues ZERO service calls ──────
describe('NO-ACTUATION GUARD — close / release / talk fire nothing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => readFileSync(join(here, f), 'utf8');

  // Strip comments so the prose DESCRIBING the no-actuation posture (which
  // mentions callService / cover.close) doesn't trip the guard.
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const TIER_FILES = [
    'entry.ts',
    'useGarage.ts',
    'useDoorbellRing.ts',
    'DoorbellRingOverlay.tsx',
    'GarageControls.tsx',
  ];

  it('no source file in the entry tier CALLS a service-dispatch function', () => {
    for (const f of TIER_FILES) {
      const code = stripComments(read(f));
      expect(code, `${f} must not call callService(...)`).not.toMatch(/callService\s*\(/);
      expect(code, `${f} must not call .callService(...)`).not.toMatch(/\.callService\s*\(/);
    }
  });

  it('no source file in the entry tier IMPORTS a service dispatcher', () => {
    for (const f of TIER_FILES) {
      const code = stripComments(read(f));
      expect(code, `${f} must not import a service dispatcher`).not.toMatch(
        /import[^;]*\b(callService|callApi|callWS)\b/,
      );
    }
  });

  it('no source file references an actuating service domain string', () => {
    for (const f of TIER_FILES) {
      const code = stripComments(read(f));
      // cover.<verb>, lock.<verb>, switch.<verb>, scene/script — none may be
      // driven. (Entity *ids* like cover.garage_door are matched + skipped:
      // we only flag the open/close/lock/unlock/turn_* service verbs.)
      expect(code, `${f} must not call a cover/lock/switch service`).not.toMatch(
        /['"](cover|lock|switch|scene|script)\.(open|close|lock|unlock|toggle|turn_on|turn_off|open_cover|close_cover)['"]/,
      );
    }
  });

  it('the overlay + controls document the gated / placeholder posture', () => {
    expect(read('DoorbellRingOverlay.tsx')).toMatch(/NO LIVE ACTUATION/);
    expect(read('DoorbellRingOverlay.tsx')).toMatch(/go2rtc/);          // documented audio deferral
    expect(read('GarageControls.tsx')).toMatch(/never auto-close|never automatic/i);
  });
});
