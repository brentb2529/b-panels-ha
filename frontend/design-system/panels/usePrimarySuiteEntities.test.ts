import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectSuite, SUITE_ENTITIES } from './usePrimarySuiteEntities';

const ent = (state: string, attributes: Record<string, any> = {}): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed: '',
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});

describe('projectSuite', () => {
  it('returns all-unavailable / off defaults for an empty snapshot', () => {
    const v = projectSuite({} as HassEntities);
    expect(v.lights).toHaveLength(3);
    expect(v.lights.every((l) => !l.available && !l.on && l.level === 0)).toBe(true);
    expect(v.lightsOnCount).toBe(0);
    expect(v.roomBrightness).toBe(0);
    expect(v.groupOn).toBe(false);
    expect(v.climate.available).toBe(false);
    expect(v.scenes.every((s) => !s.available)).toBe(true);
    expect(v.shade.available).toBe(false);
    expect(v.media.available).toBe(false);
  });

  it('maps brightness 0..255 to a 0..100 percentage and counts on-lights', () => {
    const ents = {
      'light.bedside_left': ent('on', { brightness: 46 }), // ~18%
      'light.bedside_right': ent('on', { brightness: 46 }), // ~18%
      'light.cove_ceiling': ent('off'),
    } as unknown as HassEntities;
    const v = projectSuite(ents);
    const lvl = (id: string) => v.lights.find((l) => l.id === id)!.level;
    expect(lvl('light.bedside_left')).toBe(18);
    expect(lvl('light.bedside_right')).toBe(18);
    expect(lvl('light.cove_ceiling')).toBe(0);
    expect(v.lightsOnCount).toBe(2);
    expect(v.roomBrightness).toBe(18);
  });

  it('treats unavailable/unknown lights as not-available and off', () => {
    const ents = {
      'light.bedside_left': ent('unavailable'),
      'light.bedside_right': ent('unknown'),
    } as unknown as HassEntities;
    const v = projectSuite(ents);
    expect(v.lights[0].available).toBe(false);
    expect(v.lights[0].on).toBe(false);
  });

  it('treats the suite zone as a MASTER (full mode) when bp_is_master is true', () => {
    const ents = {
      [SUITE_ENTITIES.climate]: ent('cool', {
        current_temperature: 70,
        temperature: 70,
        hvac_action: 'cooling',
        min_temp: 60,
        max_temp: 85,
        bp_is_master: true,
        bp_humidity: 48,
      }),
    } as unknown as HassEntities;
    const v = projectSuite(ents);
    expect(v.climate.available).toBe(true);
    expect(v.climate.current).toBe(70);
    expect(v.climate.setpoint).toBe(70);
    expect(v.climate.mode).toBe('cool');
    expect(v.climate.rawMode).toBe('cool');
    expect(v.climate.action).toBe('cooling');
    expect(v.climate.isMaster).toBe(true);
    expect(v.climate.masterZone).toBeNull();
    expect(v.climate.hasGatingInfo).toBe(true);
    expect(v.climate.humidity).toBe(48);
    expect(v.climate.minTemp).toBe(60);
    expect(v.climate.maxTemp).toBe(85);
  });

  it('maps heat_cool/auto hvac modes to "auto"', () => {
    const ents = {
      [SUITE_ENTITIES.climate]: ent('heat_cool', { temperature: 71 }),
    } as unknown as HassEntities;
    expect(projectSuite(ents).climate.mode).toBe('auto');
  });

  it('degrades to a controllable master when no topology attrs are present', () => {
    const ents = {
      [SUITE_ENTITIES.climate]: ent('cool', { current_temperature: 71, temperature: 70 }),
    } as unknown as HassEntities;
    const v = projectSuite(ents);
    expect(v.climate.hasGatingInfo).toBe(false);
    expect(v.climate.isMaster).toBe(true);
    expect(v.climate.masterZone).toBeNull();
  });

  it('reads blackout shade position and media now-playing', () => {
    const ents = {
      [SUITE_ENTITIES.shade]: ent('open', { current_position: 10 }),
      [SUITE_ENTITIES.media]: ent('playing', {
        media_title: 'Sleep · Rain & Piano',
        media_artist: 'Ambient Mix',
        media_duration: 1800,
        media_position: 240,
        volume_level: 0.18,
        friendly_name: 'Primary Suite Sonos',
      }),
    } as unknown as HassEntities;
    const v = projectSuite(ents);
    expect(v.shade.available).toBe(true);
    expect(v.shade.position).toBe(10);
    expect(v.media.playing).toBe(true);
    expect(v.media.title).toBe('Sleep · Rain & Piano');
    expect(v.media.artist).toBe('Ambient Mix');
    expect(v.media.duration).toBe(1800);
    expect(v.media.position).toBe(240);
    expect(v.media.volume).toBe(18);
  });

  it('falls back to closed (0) when a shade has no current_position attr', () => {
    const ents = {
      [SUITE_ENTITIES.shade]: ent('closed'),
    } as unknown as HassEntities;
    expect(projectSuite(ents).shade.position).toBe(0);
  });

  it('marks scenes available only when present in the snapshot', () => {
    const ents = {
      'scene.suite_wake': ent('unknown'),
      'scene.suite_relax': ent('unknown'),
    } as unknown as HassEntities;
    const v = projectSuite(ents);
    const byName = Object.fromEntries(v.scenes.map((s) => [s.name, s.available]));
    expect(byName['Wake']).toBe(true);
    expect(byName['Relax']).toBe(true);
    expect(byName['Read']).toBe(false);
    expect(byName['Goodnight']).toBe(false);
  });
});
