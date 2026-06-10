import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

  it('picks the most-recently-run signature scene as active (no fake active)', () => {
    const ents = {
      'script.scene_goodnight': ent('off', {}, '2026-06-09T22:00:00+00:00'),
      'script.scene_entertain': ent('off', {}, '2026-06-09T19:42:00+00:00'),
      'script.scene_wake': ent('off', {}, ''),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.activeScene).toBe('script.scene_goodnight');
    const byName = Object.fromEntries(v.scenes.map((s) => [s.name, s.available]));
    expect(byName['Goodnight']).toBe(true);
    expect(byName['Entertain']).toBe(true);
    expect(byName['Vacation']).toBe(false);
  });

  it('uses attributes.last_triggered when it is the more recent signal', () => {
    const ents = {
      'script.scene_movie': ent('off', { last_triggered: '2026-06-09T20:30:00+00:00' }, '2026-06-09T06:00:00+00:00'),
      'script.scene_wake': ent('off', {}, '2026-06-09T07:00:00+00:00'),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.activeScene).toBe('script.scene_movie');
  });

  it('returns null activeScene when no scene has a real timestamp', () => {
    const ents = {
      'script.scene_goodnight': ent('off', {}, ''),
    } as unknown as HassEntities;
    const v = projectHome(ents);
    expect(v.activeScene).toBeNull();
  });
});

// ── Signature scenes (H1): the six experiences are server-side SCRIPTS and the
// activation is low-hazard; the gated finishing step is confirm-only. ────────
describe('Signature scenes are scripts; gated steps are display-only metadata', () => {
  it('binds the six experiences to script.scene_* ids', () => {
    const ids = HOME_ENTITIES.scenes.map((s) => s.id);
    expect(ids).toEqual([
      'script.scene_goodnight', 'script.scene_wake', 'script.scene_movie',
      'script.scene_entertain', 'script.scene_vacation', 'script.scene_away_arrival',
    ]);
    expect(ids.every((id) => id.startsWith('script.scene_'))).toBe(true);
  });

  it('every scene has experience copy; gated steps are metadata only (no service)', async () => {
    const { SIGNATURE_SCENES } = await import('./useHomeEntities');
    for (const s of HOME_ENTITIES.scenes) {
      const exp = SIGNATURE_SCENES[s.id];
      expect(exp, `experience copy for ${s.id}`).toBeTruthy();
      expect(exp.low.length).toBeGreaterThan(0);
      // A gated step (when present) is pure copy — label + detail strings, never
      // an entity id or a service call.
      if (exp.gated) {
        expect(typeof exp.gated.label).toBe('string');
        expect(typeof exp.gated.detail).toBe('string');
        expect(exp.gated.detail.toLowerCase()).toContain('gated');
      }
    }
  });
});

// ── F-1 (inc16) — pool body is EQUIPMENT-GATED: the Home surface must issue NO
// actuation on the pool body. The body (OBJTYPE=BODY) drives the pool pump, so
// per CLAUDE.md it is never auto-applied without human approval. The Home panel
// renders the body STATUS + a gated "confirm" affordance only; control lives on
// the Pool panel behind on-site authorization. These guards assert the leak is
// closed at the source so it can't silently regress. ────────────────────────
describe('F-1: Home pool-body control issues NO actuation', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const hookSrc = readFileSync(join(here, 'useHomeEntities.ts'), 'utf8');
  const panelSrc = readFileSync(join(here, 'HomePanel.tsx'), 'utf8');

  it('the home-entities hook still READS the pool body state (display)', () => {
    // status must remain available so the card can show running/standby.
    expect(HOME_ENTITIES.pool.body).toBe('switch.pool_body');
    const v = projectHome({ [HOME_ENTITIES.pool.body]: ent('on') } as unknown as HassEntities);
    expect(v.pool.on).toBe(true);
    expect(v.pool.bodyAvailable).toBe(true);
  });

  it('exposes NO pool-body actuation action (only low-hazard scenes)', () => {
    // The HomeActions surface must not carry any body toggle.
    expect(hookSrc).not.toMatch(/togglePoolBody/);
    // The only callService calls in the hook are the low-hazard scene
    // activation (script.turn_on for signature scenes, scene.turn_on fallback).
    const calls = hookSrc.match(/callService\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => /'script',\s*'turn_on'/.test(c))).toBe(true);
    expect(calls.some((c) => /'scene',\s*'turn_on'/.test(c))).toBe(true);
    // No switch service is ever issued from the Home hook.
    expect(hookSrc).not.toMatch(/callService\(\s*'switch'/);
    expect(hookSrc).not.toMatch(/'switch',\s*(on\s*\?|'turn_on'|'turn_off')/);
    // No gated-actor service is EVER issued from the Home hook: no arm/disarm,
    // lock/unlock, cover, or AKVO move. (The gated finishing step is a separate,
    // confirm-only UI affordance that issues no live actuation.)
    expect(hookSrc).not.toMatch(/callService\(\s*'alarm_control_panel'/);
    expect(hookSrc).not.toMatch(/callService\(\s*'lock'/);
    expect(hookSrc).not.toMatch(/callService\(\s*'cover'/);
    expect(hookSrc).not.toMatch(/callService\(\s*'akvo/);
  });

  it('the Home panel renders the pool body as gated/display-only (no live toggle)', () => {
    // No actuating handler on the body control.
    expect(panelSrc).not.toMatch(/togglePoolBody/);
    // The body footer must NOT contain a clickable switch button.
    expect(panelSrc).not.toMatch(/onClick=\{\(\)\s*=>\s*h\.actions\.togglePoolBody/);
    // It carries the gated affordance markers instead.
    expect(panelSrc).toMatch(/hp-toggle-inline gated/);
    expect(panelSrc).toMatch(/confirm/);
    // The only h.actions.* call left on the panel is the scene activation.
    const actionCalls = panelSrc.match(/h\.actions\.\w+/g) ?? [];
    expect(actionCalls.every((c) => c === 'h.actions.activateScene')).toBe(true);
  });
});
