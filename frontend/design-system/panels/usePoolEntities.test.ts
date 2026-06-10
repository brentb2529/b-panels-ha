import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectPool, POOL_ENTITIES } from './usePoolEntities';

const ent = (state: string, attributes: Record<string, any> = {}): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed: '',
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});

describe('projectPool', () => {
  it('returns all-unavailable / off / null defaults for an empty snapshot', () => {
    const v = projectPool({} as HassEntities);
    expect(v.pool.available).toBe(false);
    expect(v.pool.on).toBe(false);
    expect(v.pool.temp).toBeNull();
    expect(v.pool.setpoint).toBeNull();
    expect(v.spa.available).toBe(false);
    expect(v.waterfall.available).toBe(false);
    expect(v.chem.ph).toBeNull();
    expect(v.chem.orp).toBeNull();
    expect(v.pump.available).toBe(false);
    expect(v.pump.rpm).toBeNull();
    expect(v.fixtures).toHaveLength(4);
    expect(v.fixtures.every((f) => !f.available && !f.on && f.level === 0)).toBe(true);
    expect(v.lightsOnCount).toBe(0);
    expect(v.shade.available).toBe(false);
    expect(v.scenes.every((s) => !s.available)).toBe(true);
    expect(v.akvo.available).toBe(false);
    expect(v.poolActive).toBe(false);
  });

  it('projects pool/spa bodies — run state, current temp, heater setpoint + unit', () => {
    const ents = {
      [POOL_ENTITIES.poolBodySwitch]: ent('on'),
      [POOL_ENTITIES.poolTemp]: ent('88', { unit_of_measurement: '°F' }),
      // heater id resolves to the first present of the candidate list
      [POOL_ENTITIES.poolHeater[0]]: ent('on', { temperature: 84, hvac_action: 'heating' }),
      [POOL_ENTITIES.spaBodySwitch]: ent('off'),
      [POOL_ENTITIES.spaTemp]: ent('98'),
      [POOL_ENTITIES.spaHeater[0]]: ent('off', { temperature: 102 }),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    expect(v.pool.available).toBe(true);
    expect(v.pool.on).toBe(true);
    expect(v.pool.temp).toBe(88);
    expect(v.pool.setpoint).toBe(84);
    expect(v.pool.heating).toBe(true);
    expect(v.pool.unit).toBe('°F');
    expect(v.spa.on).toBe(false);
    expect(v.spa.temp).toBe(98);
    expect(v.spa.setpoint).toBe(102);
    expect(v.spa.heating).toBe(false);
    // pool body running → pool active
    expect(v.poolActive).toBe(true);
  });

  it('falls back to the climate-form heater id for setpoint when no water_heater is present', () => {
    const ents = {
      [POOL_ENTITIES.poolBodySwitch]: ent('on'),
      [POOL_ENTITIES.poolTemp]: ent('88'),
      // only the climate form exists (cooling-capable body) — second candidate
      [POOL_ENTITIES.poolHeater[1]]: ent('heat', { temperature: 86, hvac_action: 'heating' }),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    expect(v.pool.setpoint).toBe(86);
    expect(v.pool.heating).toBe(true);
  });

  it('reads chemistry sensors and treats unavailable as null', () => {
    const ents = {
      [POOL_ENTITIES.ph]: ent('7.5'),
      [POOL_ENTITIES.orp]: ent('720'),
      [POOL_ENTITIES.salt]: ent('3200'),
      [POOL_ENTITIES.swg]: ent('unavailable'),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    expect(v.chem.ph).toBe(7.5);
    expect(v.chem.orp).toBe(720);
    expect(v.chem.salt).toBe(3200);
    expect(v.chem.swg).toBeNull();
  });

  it('reads pump telemetry and marks pool active when RPM > 0', () => {
    const ents = {
      [POOL_ENTITIES.pumpRpm]: ent('2450'),
      [POOL_ENTITIES.pumpGpm]: ent('420'),
      [POOL_ENTITIES.pumpKw]: ent('1.4'),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    expect(v.pump.available).toBe(true);
    expect(v.pump.rpm).toBe(2450);
    expect(v.pump.gpm).toBe(420);
    expect(v.pump.kw).toBe(1.4);
    expect(v.poolActive).toBe(true);
  });

  it('maps fixture brightness 0..255 to 0..100 and counts on-lights', () => {
    const ents = {
      'light.pool_light': ent('on', { brightness: 255, effect: 'Color Swim', effect_list: ['Off', 'Color Swim', 'Party'] }),
      'light.patio_overhead': ent('on', { brightness: 191 }), // 75%
      'light.patio_path': ent('off'),
      'light.pool_cabana': ent('unavailable'),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    const lvl = (id: string) => v.fixtures.find((f) => f.id === id)!.level;
    expect(lvl('light.pool_light')).toBe(100);
    expect(lvl('light.patio_overhead')).toBe(75);
    expect(v.fixtures.find((f) => f.id === 'light.patio_path')!.on).toBe(false);
    expect(v.fixtures.find((f) => f.id === 'light.pool_cabana')!.available).toBe(false);
    expect(v.lightsOnCount).toBe(2);
    expect(v.poolLightEffect).toBe('Color Swim');
    expect(v.poolLightEffects).toEqual(['Off', 'Color Swim', 'Party']);
  });

  it('reads the shade cover position and falls back to open/closed state', () => {
    const v1 = projectPool({ [POOL_ENTITIES.shade]: ent('open', { current_position: 55 }) } as unknown as HassEntities);
    expect(v1.shade.available).toBe(true);
    expect(v1.shade.position).toBe(55);
    const v2 = projectPool({ [POOL_ENTITIES.shade]: ent('open') } as unknown as HassEntities);
    expect(v2.shade.position).toBe(100);
    const v3 = projectPool({ [POOL_ENTITIES.shade]: ent('closed') } as unknown as HassEntities);
    expect(v3.shade.position).toBe(0);
  });

  it('marks scenes available only when present in the snapshot', () => {
    const ents = {
      'scene.pool_lights_on': ent('unknown'),
      'scene.pool_party': ent('unknown'),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    const byName = Object.fromEntries(v.scenes.map((s) => [s.name, s.available]));
    expect(byName['Lights On']).toBe(true);
    expect(byName['Party Mode']).toBe(true);
    expect(byName['Lights Off']).toBe(false);
  });

  it('projects AKVO read entities (display-only) including depths, current, moving', () => {
    const a = POOL_ENTITIES.akvo;
    const ents = {
      [a.mainPos]: ent('1.97'),
      [a.bajaPos]: ent('0.66'),
      [a.mainCur]: ent('0.3'),
      [a.bajaCur]: ent('0.2'),
      [a.activeConfig]: ent('Dive'),
      [a.moving]: ent('off'),
    } as unknown as HassEntities;
    const v = projectPool(ents);
    expect(v.akvo.available).toBe(true);
    expect(v.akvo.mainDepth).toBe(1.97);
    expect(v.akvo.bajaDepth).toBe(0.66);
    expect(v.akvo.mainCurrent).toBe(0.3);
    expect(v.akvo.bajaCurrent).toBe(0.2);
    expect(v.akvo.activeConfig).toBe('Dive');
    expect(v.akvo.moving).toBe(false);
  });
});
