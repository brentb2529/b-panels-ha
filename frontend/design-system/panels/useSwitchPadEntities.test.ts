import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectSwitchPad, MAX_SWITCHES } from './useSwitchPadEntities';
import type { TileConfig } from '../../types';

const ent = (entity_id: string, state: string, attributes: Record<string, any> = {}) =>
  ({ entity_id, state, attributes, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } });

const ents: HassEntities = {
  'light.vanity': ent('light.vanity', 'on', { friendly_name: 'Vanity', brightness: 128 }),
  'light.ceiling': ent('light.ceiling', 'off', { friendly_name: 'Ceiling' }),
  'fan.bath_fan': ent('fan.bath_fan', 'on', { friendly_name: 'Bath Fan' }),
  'switch.pool_pump': ent('switch.pool_pump', 'on', { friendly_name: 'Pool Pump' }),
  'scene.goodnight': ent('scene.goodnight', '2026-11-04T20:00:00Z', { friendly_name: 'Goodnight' }),
  'sensor.temp': ent('sensor.temp', '71', { friendly_name: 'Temp' }),
  'light.dead': ent('light.dead', 'unavailable', { friendly_name: 'Dead' }),
} as unknown as HassEntities;

const tile = (id: string, entityId: string, extra: Partial<TileConfig> = {}): TileConfig =>
  ({ id, deviceId: entityId, ...extra } as TileConfig);

describe('projectSwitchPad', () => {
  it('maps domains to toggle / momentary / display and reads state', () => {
    const v = projectSwitchPad(ents, [
      tile('a', 'light.vanity'), tile('b', 'light.ceiling'), tile('c', 'fan.bath_fan'),
      tile('d', 'scene.goodnight'), tile('e', 'sensor.temp'),
    ]);
    const [vanity, ceiling, fan, scene, temp] = v.switches;
    expect(vanity).toMatchObject({ kind: 'toggle', on: true, brightness: 50, detail: 'On · 50%', icon: 'light' });
    expect(ceiling).toMatchObject({ kind: 'toggle', on: false, detail: 'Off' });
    expect(fan).toMatchObject({ kind: 'toggle', on: true, icon: 'fan' });
    expect(scene).toMatchObject({ kind: 'momentary', on: false, detail: 'Tap to set', icon: 'scene' });
    expect(temp).toMatchObject({ kind: 'display' });
    expect(v.onCount).toBe(2);
    expect(v.toggleCount).toBe(3);
  });

  it('locked tiles are display-only even for toggle domains', () => {
    const v = projectSwitchPad(ents, [tile('p', 'switch.pool_pump', { isLocked: true })]);
    expect(v.switches[0]).toMatchObject({ kind: 'display', gated: true, on: true });
    expect(v.toggleCount).toBe(0);
  });

  it('uses the tile label over friendly_name', () => {
    const v = projectSwitchPad(ents, [tile('x', 'light.ceiling', { label: 'Overhead' })]);
    expect(v.switches[0]).toMatchObject({ name: 'Overhead', entityId: 'light.ceiling' });
  });

  it('requirePin tiles still toggle but are flagged, and All Off skips them', () => {
    const v = projectSwitchPad(ents, [tile('v', 'light.vanity', { requirePin: true })]);
    expect(v.switches[0]).toMatchObject({ kind: 'toggle', requirePin: true });
  });

  it('caps at MAX_SWITCHES and reports the overflow', () => {
    const tiles = Array.from({ length: 8 }, (_, i) => tile(`t${i}`, 'light.ceiling'));
    const v = projectSwitchPad(ents, tiles);
    expect(v.switches).toHaveLength(MAX_SWITCHES);
    expect(v.extraTiles).toBe(2);
  });

  it('marks missing and unavailable entities as unavailable', () => {
    const v = projectSwitchPad(ents, [tile('m', 'light.missing'), tile('d', 'light.dead')]);
    expect(v.switches[0]).toMatchObject({ available: false, detail: 'Not found' });
    expect(v.switches[1]).toMatchObject({ available: false, detail: 'Unavailable' });
    expect(v.toggleCount).toBe(0);
  });
});
