import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectKitchen, KITCHEN_ENTITIES } from './useKitchenEntities';

const ent = (state: string, attributes: Record<string, any> = {}): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed: '',
  last_updated: '',
  context: { id: '', parent_id: null, user_id: null },
});

describe('projectKitchen', () => {
  it('returns all-unavailable / off defaults for an empty snapshot', () => {
    const v = projectKitchen({} as HassEntities);
    expect(v.lights).toHaveLength(4);
    expect(v.lights.every((l) => !l.available && !l.on && l.level === 0)).toBe(true);
    expect(v.lightsOnCount).toBe(0);
    expect(v.roomBrightness).toBe(0);
    expect(v.groupOn).toBe(false);
    expect(v.climate.available).toBe(false);
    expect(v.scenes.every((s) => !s.available)).toBe(true);
    expect(v.media.available).toBe(false);
  });

  it('maps brightness 0..255 to a 0..100 percentage and counts on-lights', () => {
    const ents = {
      'light.island_pendants': ent('on', { brightness: 204 }), // ~80%
      'light.under_cabinet': ent('on', { brightness: 255 }), // 100%
      'light.recessed_cans': ent('on', { brightness: 140 }), // ~55%
      'light.breakfast_nook': ent('off'),
    } as unknown as HassEntities;
    const v = projectKitchen(ents);
    const lvl = (id: string) => v.lights.find((l) => l.id === id)!.level;
    expect(lvl('light.island_pendants')).toBe(80);
    expect(lvl('light.under_cabinet')).toBe(100);
    expect(lvl('light.recessed_cans')).toBe(55);
    expect(v.lightsOnCount).toBe(3);
    // room brightness = avg of the ON fixtures
    expect(v.roomBrightness).toBe(Math.round((80 + 100 + 55) / 3));
  });

  it('treats unavailable/unknown lights as not-available and off', () => {
    const ents = {
      'light.island_pendants': ent('unavailable'),
      'light.under_cabinet': ent('unknown'),
    } as unknown as HassEntities;
    const v = projectKitchen(ents);
    expect(v.lights[0].available).toBe(false);
    expect(v.lights[0].on).toBe(false);
  });

  it('reads climate setpoint/current/action and slave-zone gating attrs', () => {
    const ents = {
      [KITCHEN_ENTITIES.climate]: ent('cool', {
        current_temperature: 72,
        temperature: 70,
        hvac_action: 'cooling',
        bp_is_master: false,
        bp_master_zone: 'Family Room',
        bp_humidity: 46,
      }),
    } as unknown as HassEntities;
    const v = projectKitchen(ents);
    expect(v.climate.available).toBe(true);
    expect(v.climate.current).toBe(72);
    expect(v.climate.setpoint).toBe(70);
    expect(v.climate.mode).toBe('cool');
    expect(v.climate.action).toBe('cooling');
    expect(v.climate.isMaster).toBe(false);
    expect(v.climate.masterZone).toBe('Family Room');
    expect(v.climate.hasGatingInfo).toBe(true);
    expect(v.climate.humidity).toBe(46);
  });

  it('degrades gracefully when climate has no master/slave attrs', () => {
    const ents = {
      [KITCHEN_ENTITIES.climate]: ent('cool', { current_temperature: 71, temperature: 72 }),
    } as unknown as HassEntities;
    const v = projectKitchen(ents);
    expect(v.climate.hasGatingInfo).toBe(false);
    expect(v.climate.isMaster).toBe(false);
    expect(v.climate.masterZone).toBeNull();
  });

  it('reads cover position and media now-playing', () => {
    const ents = {
      [KITCHEN_ENTITIES.shade]: ent('open', { current_position: 60 }),
      [KITCHEN_ENTITIES.media]: ent('playing', {
        media_title: 'Morning Acoustic',
        media_artist: 'Novo Amor',
        media_duration: 251,
        media_position: 108,
        volume_level: 0.34,
        friendly_name: 'Kitchen Sonos',
      }),
    } as unknown as HassEntities;
    const v = projectKitchen(ents);
    expect(v.shade.available).toBe(true);
    expect(v.shade.position).toBe(60);
    expect(v.media.playing).toBe(true);
    expect(v.media.title).toBe('Morning Acoustic');
    expect(v.media.artist).toBe('Novo Amor');
    expect(v.media.duration).toBe(251);
    expect(v.media.position).toBe(108);
    expect(v.media.volume).toBe(34);
  });

  it('marks scenes available only when present in the snapshot', () => {
    const ents = {
      'scene.kitchen_morning': ent('unknown'),
      'scene.kitchen_cook': ent('unknown'),
    } as unknown as HassEntities;
    const v = projectKitchen(ents);
    const byName = Object.fromEntries(v.scenes.map((s) => [s.name, s.available]));
    expect(byName['Morning']).toBe(true);
    expect(byName['Cook']).toBe(true);
    expect(byName['Dine']).toBe(false);
    expect(byName['Clean Up']).toBe(false);
  });
});
