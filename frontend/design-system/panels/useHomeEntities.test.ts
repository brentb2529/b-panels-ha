import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectHome, HOME_ENTITIES } from './useHomeEntities';

const ent = (state: string, attributes: Record<string, any> = {}, last_changed = ''): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed,
  last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

describe('projectHome', () => {
  it('returns honest unavailable/empty defaults on an empty snapshot', () => {
    const v = projectHome({} as HassEntities);
    expect(v.pool.available).toBe(false);
    expect(v.pool.water).toBeNull();
    expect(v.pool.on).toBe(false);
    expect(v.climate.available).toBe(false);
    expect(v.climate.avg).toBeNull();
    expect(v.lights.onCount).toBe(0);
    expect(v.lights.total).toBe(8);
    expect(v.generator.available).toBe(false);
    expect(v.generator.summary).toBe('Cloud account not connected');
    expect(v.akvo.present).toBe(false);
    expect(v.security.available).toBe(false);
    expect(v.weather.available).toBe(false);
    expect(v.scenes.every((s) => !s.available)).toBe(true);
    expect(v.activeScene).toBeNull();
  });

  it('builds a glanceable pool summary and reads the body switch', () => {
    const ents = {
      [HOME_ENTITIES.pool.water]: ent('88'),
      [HOME_ENTITIES.pool.ph]: ent('7.5'),
      [HOME_ENTITIES.pool.salt]: ent('3100'),
      [HOME_ENTITIES.pool.body]: ent('on'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.pool.available).toBe(true);
    expect(v.pool.on).toBe(true);
    expect(v.pool.bodyAvailable).toBe(true);
    expect(v.pool.summary).toBe('Water 88°F · pH 7.5 · Salt 3.1k ppm');
  });

  it('averages climate zones, picks the dominant mode and surfaces active action', () => {
    const ents = {
      'climate.kitchen_zone': ent('cool', { current_temperature: 72, hvac_action: 'cooling' }),
      'climate.living_zone': ent('cool', { current_temperature: 70, hvac_action: 'idle' }),
      'climate.primary_zone': ent('heat', { current_temperature: 71, hvac_action: 'idle' }),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.climate.zoneCount).toBe(3);
    expect(v.climate.avg).toBe(71); // round((72+70+71)/3)
    expect(v.climate.mode).toBe('cool'); // 2 cool vs 1 heat
    expect(v.climate.action).toBe('cooling');
    expect(v.climate.summary).toContain('Avg 71°F');
    expect(v.climate.summary).toContain('Cooling');
  });

  it('ignores unavailable zones in the average', () => {
    const ents = {
      'climate.kitchen_zone': ent('cool', { current_temperature: 70 }),
      'climate.living_zone': ent('unavailable'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.climate.zoneCount).toBe(1);
    expect(v.climate.avg).toBe(70);
  });

  it('counts lights on, names them, and tracks the house group', () => {
    const ents = {
      'light.great_room_lights': ent('on'),
      'light.master_lights': ent('on'),
      'light.kitchen_house_lights': ent('off'),
      'light.all_house_lights': ent('on'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.lights.onCount).toBe(2);
    expect(v.lights.onNames).toEqual(['Great Room', 'Master']);
    expect(v.lights.groupOn).toBe(true);
    expect(v.lights.summary).toBe('2 of 8 on');
  });

  it('renders the generator as connected only when its sensor is available', () => {
    const v1 = projectHome({ [HOME_ENTITIES.generator]: ent('ready') } as unknown as HassEntities);
    expect(v1.generator.available).toBe(true);
    expect(v1.generator.summary).toBe('Ready');
    const v2 = projectHome({ [HOME_ENTITIES.generator]: ent('unavailable') } as unknown as HassEntities);
    expect(v2.generator.available).toBe(false);
  });

  it('reads the real AKVO floor as present, display-only, with position', () => {
    const ents = {
      [HOME_ENTITIES.akvo.systemReady]: ent('on'),
      [HOME_ENTITIES.akvo.extReady]: ent('on'),
      [HOME_ENTITIES.akvo.fault]: ent('off'),
      [HOME_ENTITIES.akvo.position]: ent('0.0'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.akvo.present).toBe(true);
    expect(v.akvo.systemReady).toBe(true);
    expect(v.akvo.extReady).toBe(true);
    expect(v.akvo.fault).toBe(false);
    expect(v.akvo.position).toBe(0);
    expect(v.akvo.summary).toContain('PLC-mediated');
    expect(v.akvo.summary).toContain('ready');
  });

  it('flags an AKVO fault honestly', () => {
    const ents = {
      [HOME_ENTITIES.akvo.systemReady]: ent('off'),
      [HOME_ENTITIES.akvo.fault]: ent('on'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.akvo.present).toBe(true);
    expect(v.akvo.fault).toBe(true);
    expect(v.akvo.summary).toContain('Fault');
  });

  it('rolls up security from the real alarm + demo sensors', () => {
    const ents = {
      [HOME_ENTITIES.security.alarm]: ent('disarmed'),
      'binary_sensor.front_door': ent('on'),
      'binary_sensor.patio_slider': ent('off'),
      'binary_sensor.great_room_motion': ent('off'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.security.available).toBe(true);
    expect(v.security.armState).toBe('disarmed');
    expect(v.security.openContacts).toBe(1);
    expect(v.security.motionActive).toBe(false);
    expect(v.security.summary).toContain('1 open');
  });

  it('reports all-clear when armed away with no open sensors', () => {
    const ents = {
      [HOME_ENTITIES.security.alarm]: ent('armed_away'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.security.armState).toBe('armed_away');
    expect(v.security.openContacts).toBe(0);
    expect(v.security.summary).toBe('All clear · no motion');
  });

  it('reads weather temp/condition and daytime from sun', () => {
    const ents = {
      [HOME_ENTITIES.weather]: ent('cloudy', { temperature: 82 }),
      [HOME_ENTITIES.sun]: ent('above_horizon'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.weather.available).toBe(true);
    expect(v.weather.temp).toBe(82);
    expect(v.weather.condition).toBe('cloudy');
    expect(v.weather.isDaytime).toBe(true);
  });

  it('picks the most-recently-changed scene as active (no fake active)', () => {
    const ents = {
      'scene.home_morning': ent('2026-06-09T06:00:00+00:00', {}, '2026-06-09T06:00:00+00:00'),
      'scene.home_evening': ent('2026-06-09T19:42:00+00:00', {}, '2026-06-09T19:42:00+00:00'),
      'scene.home_night': ent('unknown', {}, ''),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.activeScene).toBe('scene.home_evening');
    const byName = Object.fromEntries(v.scenes.map((s) => [s.name, s.available]));
    expect(byName['Morning']).toBe(true);
    expect(byName['Evening']).toBe(true);
    expect(byName['Guest']).toBe(false);
  });

  it('returns null activeScene when no scene has a real timestamp', () => {
    const ents = {
      'scene.home_morning': ent('unknown', {}, ''),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.activeScene).toBeNull();
  });
});
