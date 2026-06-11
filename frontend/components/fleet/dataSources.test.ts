import { describe, it, expect } from 'vitest';
import {
  projectDataSources,
  groupByCategory,
  STALE_AFTER_MS,
  type RawState,
  type ConfigEntryLite,
} from './dataSources';

const NOW = Date.parse('2026-06-11T12:00:00Z');
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

const st = (entity_id: string, state: string, extra: Partial<RawState> = {}): RawState => ({
  entity_id,
  state,
  last_changed: isoAgo(1000),
  ...extra,
});

const rowFor = (rows: ReturnType<typeof projectDataSources>, key: string) =>
  rows.find((r) => r.key === key)!;

describe('projectDataSources', () => {
  it('marks an absent source not-configured (never fake-green)', () => {
    const rows = projectDataSources([], [], NOW);
    const ic = rowFor(rows, 'intellicenter');
    expect(ic.configured).toBe(false);
    expect(ic.status).toBe('not-configured');
    expect(ic.entityCount).toBe(0);
  });

  it('reports connected when all entities of a source are available', () => {
    const states = [
      st('switch.intellicenter_pool_pump', 'on'),
      st('sensor.intellicenter_pool_temp', '82'),
    ];
    const rows = projectDataSources(states, [], NOW);
    const ic = rowFor(rows, 'intellicenter');
    expect(ic.configured).toBe(true);
    expect(ic.status).toBe('connected');
    expect(ic.entityCount).toBe(2);
    expect(ic.unavailableCount).toBe(0);
    expect(ic.lastUpdate).not.toBeNull();
  });

  it('flags stale when some (not all) entities are unavailable', () => {
    const states = [
      st('light.lutron_kitchen', 'on'),
      st('light.lutron_hall', 'unavailable'),
    ];
    const rows = projectDataSources(states, [], NOW);
    const lutron = rowFor(rows, 'lutron');
    expect(lutron.status).toBe('stale');
    expect(lutron.unavailableCount).toBe(1);
    expect(lutron.unavailable).toEqual(['light.lutron_hall']);
  });

  it('flags erroring when ALL entities of a source are unavailable', () => {
    const states = [
      st('media_player.sonos_living', 'unavailable'),
      st('media_player.sonos_kitchen', 'unknown'),
    ];
    const rows = projectDataSources(states, [], NOW);
    const sonos = rowFor(rows, 'sonos');
    expect(sonos.status).toBe('erroring');
    expect(sonos.unavailableCount).toBe(2);
  });

  it('flags stale when the feed has not updated within the stale window', () => {
    const states = [
      st('sensor.airzone_temp', '72', { last_changed: isoAgo(STALE_AFTER_MS + 60_000) }),
    ];
    const rows = projectDataSources(states, [], NOW);
    const az = rowFor(rows, 'airzone');
    expect(az.status).toBe('stale');
    expect(az.note).toMatch(/stale/i);
  });

  it('config_entries setup_error makes a source erroring even with live entities', () => {
    const states = [st('climate.coolmaster_office', 'cool')];
    const entries: ConfigEntryLite[] = [
      { domain: 'coolmaster', title: 'CoolMasterNet', state: 'setup_retry', reason: 'cannot_connect' },
    ];
    const rows = projectDataSources(states, entries, NOW);
    const cm = rowFor(rows, 'coolmaster');
    expect(cm.status).toBe('erroring');
    expect(cm.integrationState).toBe('setup_retry');
    expect(cm.note).toMatch(/cannot_connect/);
  });

  it('config_entries present but no entities still counts as configured', () => {
    const entries: ConfigEntryLite[] = [
      { domain: 'rachio', title: 'Rachio', state: 'loaded' },
    ];
    const rows = projectDataSources([], entries, NOW);
    const rachio = rowFor(rows, 'rachio');
    expect(rachio.configured).toBe(true);
    expect(rachio.entityCount).toBe(0);
    // no entities → connected on the basis of the loaded entry (no unavailable)
    expect(rachio.status).toBe('connected');
  });

  it('excludes internal/diagnostic domains and entity_category from rollups', () => {
    const states = [
      st('switch.intellicenter_pump', 'on'),
      st('button.intellicenter_reset', 'unknown'), // excluded domain
      st('sensor.intellicenter_diag', 'unavailable', { attributes: { entity_category: 'diagnostic' } }),
    ];
    const rows = projectDataSources(states, [], NOW);
    const ic = rowFor(rows, 'intellicenter');
    expect(ic.entityCount).toBe(1); // only the switch counts
    expect(ic.status).toBe('connected');
  });

  it('does not actuate — module exports only pure projections', () => {
    // sanity: re-running yields identical output (no side effects)
    const states = [st('switch.intellicenter_pump', 'on')];
    const a = projectDataSources(states, [], NOW);
    const b = projectDataSources(states, [], NOW);
    expect(a).toEqual(b);
  });
});

describe('groupByCategory', () => {
  it('groups rows by category preserving first-seen order', () => {
    const rows = projectDataSources([st('switch.intellicenter_pump', 'on')], [], NOW);
    const groups = groupByCategory(rows);
    const cats = groups.map((g) => g.category);
    expect(cats[0]).toBe('Pool');
    expect(cats).toContain('Security');
    // every row is accounted for exactly once
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(rows.length);
  });
});
