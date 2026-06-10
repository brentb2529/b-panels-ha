import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectClimate } from './useClimateEntities';

const ent = (state: string, attributes: Record<string, any> = {}): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed: '',
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});

// A climate zone with the demo bp_* topology attrs + a temperature companion.
const zone = (
  mode: string,
  opts: { current?: number; setpoint?: number; rh?: number; action?: string; master?: boolean; masterZone?: string } = {},
) =>
  ent(mode, {
    current_temperature: opts.current,
    temperature: opts.setpoint,
    current_humidity: opts.rh,
    hvac_action: opts.action,
    ...(opts.master !== undefined ? { bp_is_master: opts.master } : {}),
    ...(opts.masterZone !== undefined ? { bp_master_zone: opts.masterZone } : {}),
    min_temp: 60,
    max_temp: 85,
  });

describe('projectClimate', () => {
  it('returns empty / unavailable defaults for an empty snapshot', () => {
    const v = projectClimate({} as HassEntities);
    expect(v.zones.every((z) => !z.available)).toBe(true);
    expect(v.groups).toHaveLength(0);
    expect(v.summary.zoneCount).toBe(0);
    expect(v.summary.avgTemp).toBeNull();
    expect(v.summary.dominant).toBe('off');
    // every offline zone lands in "others" (em-dash treatment in the panel)
    expect(v.others.length).toBe(v.zones.length);
  });

  it('groups slaves under their master from STATE ATTRIBUTES only', () => {
    const ents = {
      'climate.living_zone': zone('cool', { current: 71, setpoint: 71, rh: 46, action: 'cooling', master: true }),
      'climate.kitchen_zone': zone('cool', { current: 72, setpoint: 72, action: 'cooling', master: false, masterZone: 'Family Room' }),
      'climate.dining_zone': zone('cool', { current: 71, setpoint: 72, action: 'idle', master: false, masterZone: 'Family Room' }),
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    expect(v.groups).toHaveLength(1);
    const g = v.groups[0];
    expect(g.master.name).toBe('Family Room');
    expect(g.master.isMaster).toBe(true);
    expect(g.slaves.map((s) => s.name).sort()).toEqual(['Dining', 'Kitchen']);
    // slaves carry a live setpoint but are mode-read-back (masterZone set)
    expect(g.slaves.every((s) => s.masterZone === 'Family Room')).toBe(true);
    expect(g.slaves.every((s) => !s.isMaster)).toBe(true);
  });

  it('computes house avg temp/RH and dominant calling mode (panel-side, excl offline)', () => {
    const ents = {
      'climate.living_zone': zone('cool', { current: 70, setpoint: 71, rh: 46, action: 'cooling', master: true }),
      'climate.kitchen_zone': zone('cool', { current: 72, setpoint: 72, rh: 48, action: 'cooling', master: false, masterZone: 'Family Room' }),
      'climate.dining_zone': zone('cool', { current: 74, setpoint: 72, action: 'idle', master: false, masterZone: 'Family Room' }),
      // offline zone — excluded from avg + counts
      'climate.wine_room': ent('unavailable'),
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    expect(v.summary.zoneCount).toBe(3);
    expect(v.summary.avgTemp).toBe(72); // (70+72+74)/3
    expect(v.summary.avgRh).toBe(47);   // (46+48)/2
    expect(v.summary.callingCool).toBe(2);
    expect(v.summary.callingHeat).toBe(0);
    expect(v.summary.idle).toBe(1);
    expect(v.summary.dominant).toBe('cool');
    // the offline zone shows up in "others" for the em-dash pattern
    expect(v.others.some((z) => z.id === 'climate.wine_room' && !z.available)).toBe(true);
  });

  it('picks heat as dominant when more zones call for heat', () => {
    const ents = {
      'climate.living_zone': zone('heat', { current: 68, action: 'heating', master: true }),
      'climate.primary_zone': zone('heat', { current: 67, action: 'heating', master: true }),
      'climate.kitchen_zone': zone('cool', { current: 72, action: 'cooling', master: true }),
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    expect(v.summary.callingHeat).toBe(2);
    expect(v.summary.callingCool).toBe(1);
    expect(v.summary.dominant).toBe('heat');
  });

  it('derives mode/action and treats master-with-no-slaves as an independent (not a left group)', () => {
    const ents = {
      // a topology-bearing master with slaves → left group
      'climate.living_zone': zone('cool', { current: 71, action: 'cooling', master: true }),
      'climate.kitchen_zone': zone('cool', { current: 72, action: 'cooling', master: false, masterZone: 'Family Room' }),
      // an independent zone with NO topology attrs at all
      'climate.patio_heater': ent('off', { current_temperature: 80, hvac_action: 'off' }),
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    // family room group present
    expect(v.groups.map((g) => g.master.name)).toContain('Family Room');
    // patio heater has no topology → independent → in "others"
    const patio = v.zones.find((z) => z.id === 'climate.patio_heater')!;
    expect(patio.hasTopology).toBe(false);
    expect(patio.calling).toBe('off');
    expect(v.others.some((z) => z.id === 'climate.patio_heater')).toBe(true);
    // and NOT pulled into the left groups
    expect(v.groups.every((g) => g.master.id !== 'climate.patio_heater')).toBe(true);
  });

  it('degrades gracefully when a zone has no topology attrs (treated as its own master)', () => {
    const ents = {
      'climate.living_zone': zone('cool', { current: 71, setpoint: 72 }),
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    const z = v.zones.find((x) => x.id === 'climate.living_zone')!;
    expect(z.hasTopology).toBe(false);
    expect(z.isMaster).toBe(true);       // default master so it stays controllable
    expect(z.masterZone).toBeNull();
    expect(z.current).toBe(71);
    expect(z.setpoint).toBe(72);
    // with no topology it is NOT a left-column group (those require hasTopology)
    expect(v.groups).toHaveLength(0);
    expect(v.independents.some((x) => x.id === 'climate.living_zone')).toBe(true);
  });

  it('prefers the companion temperature sensor over the climate current_temperature attr', () => {
    const ents = {
      'climate.living_zone': zone('cool', { current: 99, master: true }), // attr says 99
      'sensor.hd_living_temperature': ent('70'),                          // sensor says 70
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    const z = v.zones.find((x) => x.id === 'climate.living_zone')!;
    expect(z.current).toBe(70); // companion sensor wins
  });

  it('reads real Airzone topology attrs (is_master / master_zone), not just the demo bp_* ones', () => {
    const ents = {
      'climate.primary_zone': ent('cool', { is_master: true, current_temperature: 70, hvac_action: 'cooling' }),
      'climate.office_zone': ent('cool', { is_master: false, master_zone: 'Primary Suite', current_temperature: 72, hvac_action: 'cooling' }),
    } as unknown as HassEntities;
    const v = projectClimate(ents);
    const g = v.groups.find((x) => x.master.id === 'climate.primary_zone');
    expect(g).toBeDefined();
    expect(g!.master.hasTopology).toBe(true);
    expect(g!.slaves.map((s) => s.id)).toContain('climate.office_zone');
  });
});
