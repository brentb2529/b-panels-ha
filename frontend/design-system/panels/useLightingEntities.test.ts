import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectLighting, LIGHTING_AREAS, LIGHTING_SCENES, LIGHTING_SHADES, LIGHTING_KEYPADS } from './useLightingEntities';

const ent = (state: string, attributes: Record<string, any> = {}, last_changed = '2026-06-09T19:42:00'): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed,
  last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

describe('projectLighting — areas (curated map, panel-side aggregation)', () => {
  it('returns one view per curated area with zeroed counts on an empty snapshot', () => {
    const v = projectLighting({} as HassEntities);
    expect(v.areas).toHaveLength(LIGHTING_AREAS.length);
    for (const a of v.areas) {
      expect(a.total).toBe(0);
      expect(a.onCount).toBe(0);
      expect(a.anyOn).toBe(false);
      expect(a.available).toBe(false);
    }
    expect(v.onTotal).toBe(0);
    expect(v.fixtureTotal).toBe(0);
  });

  it('counts "N of M on" excluding unavailable fixtures', () => {
    // Kitchen has 5 curated lights; mark 2 on, 1 off, 1 unavailable, 1 missing.
    const kitchen = LIGHTING_AREAS.find((a) => a.name === 'Kitchen')!;
    const ents = {
      [kitchen.lights[0]]: ent('on', { brightness: 255 }),
      [kitchen.lights[1]]: ent('on', { brightness: 128 }),
      [kitchen.lights[2]]: ent('off'),
      [kitchen.lights[3]]: ent('unavailable'),
      // kitchen.lights[4] missing entirely
    } as unknown as HassEntities;
    const v = projectLighting(ents);
    const k = v.areas.find((a) => a.name === 'Kitchen')!;
    expect(k.total).toBe(3);   // present + available (on,on,off) — excludes unavailable + missing
    expect(k.onCount).toBe(2);
    expect(k.anyOn).toBe(true);
    expect(k.available).toBe(true);
  });

  it('computes the master-dim brightness as the average of the ON fixtures (0..100)', () => {
    const suite = LIGHTING_AREAS.find((a) => a.name === 'Primary Suite')!;
    const ents = {
      [suite.lights[0]]: ent('on', { brightness: 255 }), // 100%
      [suite.lights[1]]: ent('on', { brightness: 128 }), // ~50%
      [suite.lights[2]]: ent('off'),
    } as unknown as HassEntities;
    const v = projectLighting(ents);
    const s = v.areas.find((a) => a.name === 'Primary Suite')!;
    // avg of 100 and 50 = 75 (off fixture excluded)
    expect(s.brightness).toBe(75);
  });
});

describe('projectLighting — scenes (real last-activated, no fake active)', () => {
  it('marks scenes available and surfaces real last-activation, never an "active" flag', () => {
    const ents = {
      'scene.home_evening': ent('2026-06-09T19:42:00'),
      'scene.home_morning': ent('2026-06-09T08:05:00'),
      // away/night present but never fired (unknown)
      'scene.home_away': ent('unknown'),
    } as unknown as HassEntities;
    const v = projectLighting(ents);
    const evening = v.scenes.find((s) => s.name === 'Evening')!;
    const away = v.scenes.find((s) => s.name === 'Away')!;
    expect(evening.available).toBe(true);
    expect(evening.lastActivated).toBeTruthy();
    expect(away.lastActivated).toBeNull(); // never fired → no fake
    // last scene = most recent ts (Evening @ 19:42 > Morning @ 08:05)
    expect(v.lastScene?.name).toBe('Evening');
    // there is no "active" boolean on a scene view (no fake active)
    expect((evening as any).active).toBeUndefined();
  });

  it('includes a synthetic "All Off" scene that is always available and never timestamped', () => {
    const allOff = LIGHTING_SCENES.find((s) => s.id === '__all_off__')!;
    expect(allOff).toBeTruthy();
    const v = projectLighting({} as HassEntities);
    const aoView = v.scenes.find((s) => s.id === '__all_off__')!;
    expect(aoView.available).toBe(true);
    expect(aoView.lastActivated).toBeNull();
    expect(aoView.ts).toBe(0);
    expect(v.scenesCount).toBe(LIGHTING_SCENES.length - 1); // synthetic excluded from count
  });
});

describe('projectLighting — shades (cover position)', () => {
  it('reads current_position and falls back to open/closed', () => {
    const ents = {
      [LIGHTING_SHADES[0].id]: ent('open', { current_position: 75 }),
      [LIGHTING_SHADES[1].id]: ent('open'), // no position attr → 100
      [LIGHTING_SHADES[2].id]: ent('closed'),
    } as unknown as HassEntities;
    const v = projectLighting(ents);
    expect(v.shades[0].position).toBe(75);
    expect(v.shades[0].available).toBe(true);
    expect(v.shades[1].position).toBe(100);
    expect(v.shades[2].position).toBe(0);
  });
});

describe('projectLighting — keypad LED state (display-only diagnostic)', () => {
  it('reflects binary_sensor LED on/off state for each keypad button', () => {
    const kp = LIGHTING_KEYPADS[0];
    const ents = {
      [kp.buttons[0].id]: ent('on'),
      [kp.buttons[1].id]: ent('off'),
    } as unknown as HassEntities;
    const v = projectLighting(ents);
    const view = v.keypads[0];
    expect(view.buttons[0].on).toBe(true);
    expect(view.buttons[0].available).toBe(true);
    expect(view.buttons[1].on).toBe(false);
    // a missing LED entity → unavailable, not lit
    expect(view.buttons[view.buttons.length - 1].available).toBe(false);
    expect(view.buttons[view.buttons.length - 1].on).toBe(false);
  });
});
