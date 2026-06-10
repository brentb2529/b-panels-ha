import { describe, it, expect } from 'vitest';
import {
  getCompatibleTileTypes,
  getCompatibleTileTypesForDevice,
  suggestTileType,
  tileTypeCatalog,
} from './tileTypes';
import {
  entityMatchesSelector,
  resolveSelector,
  resolveTileEntityId,
  resolveSecondaryEntityId,
  type SelectableEntity,
} from '../services/entitySelector';
import { buildAreasFromRegistry, mergeImportedAreas } from '../hooks/areaSeed';
import type { TileConfig, AreaConfig, EntitySelector } from '../types';
import type { HaArea, HaEntityArea } from '../services/haClient';

// ─────────────────────────────────────────────────────────────────────────
// Areas CRUD + seed (the pure helpers; the React mutators wrap these)
// ─────────────────────────────────────────────────────────────────────────
describe('areas seed + merge (areaSeed)', () => {
  const haAreas: HaArea[] = [
    { area_id: 'living', name: 'Living Room' },
    { area_id: 'kitchen', name: 'Kitchen' },
  ];
  const entityAreas: HaEntityArea[] = [
    { entity_id: 'light.kitchen', area_id: 'kitchen', device_id: null },
    { entity_id: 'switch.lamp', area_id: 'living', device_id: null },
    { entity_id: 'sensor.no_area', area_id: null, device_id: null },
    // device-inherited area:
    { entity_id: 'climate.master', area_id: null, device_id: 'dev-1' },
  ];

  it('builds curated areas from the registry, sorted by name', () => {
    const areas = buildAreasFromRegistry(haAreas, entityAreas, { 'dev-1': 'living' });
    expect(areas.map(a => a.name)).toEqual(['Kitchen', 'Living Room']);
    const kitchen = areas.find(a => a.id === 'kitchen')!;
    const living = areas.find(a => a.id === 'living')!;
    expect(kitchen.entityIds).toEqual(['light.kitchen']);
    // device-inherited climate.master + the direct switch.lamp:
    expect(living.entityIds.sort()).toEqual(['climate.master', 'switch.lamp']);
    // an entity with no resolvable area is left out (lands Unassigned at render):
    expect(areas.some(a => a.entityIds.includes('sensor.no_area'))).toBe(false);
    // order is stable, ascending:
    expect(areas.map(a => a.order)).toEqual([0, 1]);
  });

  it('merges imports without clobbering hand edits + appends new areas', () => {
    const existing: AreaConfig[] = [
      { id: 'kitchen', name: 'My Kitchen', order: 0, entityIds: ['light.island'] },
    ];
    const imported = buildAreasFromRegistry(haAreas, entityAreas);
    const merged = mergeImportedAreas(existing, imported);
    const kitchen = merged.find(a => a.id === 'kitchen')!;
    // hand-renamed name + order preserved; imported entity added, edit kept:
    expect(kitchen.name).toBe('My Kitchen');
    expect(kitchen.entityIds.sort()).toEqual(['light.island', 'light.kitchen']);
    // a brand-new area is appended after the current max order:
    const living = merged.find(a => a.id === 'living')!;
    expect(living.order).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Area-grouped browser grouping (the pure grouping the editor memo performs)
// ─────────────────────────────────────────────────────────────────────────
function groupByArea(
  areas: AreaConfig[],
  available: { id: string }[],
): { id: string; name: string; ids: string[] }[] {
  const sortedAreas = [...areas].sort((a, b) => a.order - b.order);
  const entityToArea = new Map<string, string>();
  for (const a of areas) for (const e of a.entityIds) entityToArea.set(e, a.id);
  const buckets = new Map<string, string[]>();
  for (const a of sortedAreas) buckets.set(a.id, []);
  const unassigned: string[] = [];
  for (const d of available) {
    const areaId = entityToArea.get(d.id);
    if (areaId && buckets.has(areaId)) buckets.get(areaId)!.push(d.id);
    else unassigned.push(d.id);
  }
  const out = sortedAreas
    .filter(a => buckets.get(a.id)!.length > 0)
    .map(a => ({ id: a.id, name: a.name, ids: buckets.get(a.id)! }));
  if (unassigned.length) out.push({ id: '__unassigned__', name: 'Unassigned', ids: unassigned });
  return out;
}

describe('area-grouped browser grouping', () => {
  const areas: AreaConfig[] = [
    { id: 'living', name: 'Living', order: 1, entityIds: ['switch.lamp'] },
    { id: 'kitchen', name: 'Kitchen', order: 0, entityIds: ['light.kitchen'] },
  ];
  it('groups available devices by area (ordered) with an Unassigned bucket', () => {
    const groups = groupByArea(areas, [
      { id: 'light.kitchen' }, { id: 'switch.lamp' }, { id: 'sensor.orphan' },
    ]);
    expect(groups.map(g => g.name)).toEqual(['Kitchen', 'Living', 'Unassigned']);
    expect(groups[0].ids).toEqual(['light.kitchen']);
    expect(groups[2].ids).toEqual(['sensor.orphan']);
  });
  it('drops empty areas and omits Unassigned when nothing is orphaned', () => {
    const groups = groupByArea(areas, [{ id: 'light.kitchen' }]);
    expect(groups.map(g => g.name)).toEqual(['Kitchen']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tile-type picker: single / multi / none
// ─────────────────────────────────────────────────────────────────────────
describe('tile-type picker candidates (single / multi / none)', () => {
  it('single non-gated candidate → adds directly (switch)', () => {
    const cands = getCompatibleTileTypesForDevice('switch.porch');
    const nonGated = cands.filter(c => !c.alwaysEquipmentGated);
    expect(cands).toHaveLength(1);
    expect(nonGated).toHaveLength(1);
    expect(nonGated[0].key).toBe('switch');
  });

  it('multiple candidates → picker (a light offers dimmer + light-group)', () => {
    // the `light` domain matches both the `dimmer` and `light-group` types
    const cands = getCompatibleTileTypesForDevice('light.kitchen');
    const keys = cands.map(c => c.key).sort();
    expect(keys).toEqual(['dimmer', 'light-group']);
    // the auto-suggested default is the first non-gated (dimmer):
    expect(suggestTileType('light.kitchen')?.key).toBe('dimmer');
  });

  it('device_class refinement: a garage cover only offers the gated garage-cover', () => {
    // garage-cover requires device_class 'garage'; plain `cover` requires a
    // shade-family class, so a garage cover matches only garage-cover (gated).
    const cands = getCompatibleTileTypesForDevice('cover.garage', 'garage');
    expect(cands.map(c => c.key)).toEqual(['garage-cover']);
    expect(cands[0].alwaysEquipmentGated).toBe(true);
  });

  it('device_class refinement: a plain shade only offers the cover type', () => {
    const cands = getCompatibleTileTypesForDevice('cover.living', 'shade');
    expect(cands.map(c => c.key)).toEqual(['cover']);
  });

  it('no candidates → empty (caller offers generic)', () => {
    expect(getCompatibleTileTypes('weather.home')).toEqual([]);
    expect(getCompatibleTileTypesForDevice('weather.home')).toEqual([]);
  });

  it('a vacuum-backed robot offers the litter-robot tile', () => {
    expect(getCompatibleTileTypes('vacuum.litter_robot').map(c => c.key)).toEqual(['litter-robot']);
  });

  it('a lone GATED candidate is not auto-suggested (routes to picker)', () => {
    const cands = getCompatibleTileTypesForDevice('lock.front');
    expect(cands.map(c => c.key)).toEqual(['lock']);
    expect(cands[0].alwaysEquipmentGated).toBe(true);
    expect(suggestTileType('lock.front')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Bind-by-selection: resolution + rename survival
// ─────────────────────────────────────────────────────────────────────────
function tile(overrides: Partial<TileConfig>): TileConfig {
  return { id: 't', deviceId: overrides.deviceId ?? 'switch.x', ...overrides };
}

describe('selector resolution + rename survival', () => {
  const snapshot = (): SelectableEntity[] => [
    { entity_id: 'climate.airzone_master', attributes: { device_class: 'climate', zone_role: 'master', objtype: 'BODY' } },
    { entity_id: 'climate.airzone_slave', attributes: { zone_role: 'slave' } },
    { entity_id: 'switch.porch', attributes: {} },
  ];

  it('matches by domain + device_class + objType + attrMatch', () => {
    const sel: EntitySelector = { domain: 'climate', attrMatch: { zone_role: 'master' } };
    expect(resolveSelector(sel, snapshot())).toBe('climate.airzone_master');
    expect(entityMatchesSelector(snapshot()[0], sel)).toBe(true);
    expect(entityMatchesSelector(snapshot()[1], sel)).toBe(false);
    // objType (IntelliCenter OBJTYPE) is case-insensitive:
    expect(resolveSelector({ domain: 'climate', objType: 'body' }, snapshot())).toBe('climate.airzone_master');
  });

  it('a direct primary id resolves to that id', () => {
    const t = tile({ deviceId: 'switch.porch', bindings: { primary: 'switch.porch' } });
    expect(resolveTileEntityId(t, snapshot())).toBe('switch.porch');
  });

  it('SURVIVES a rename: selector re-resolves to the renamed entity', () => {
    const t = tile({ deviceId: 'climate.airzone_master', bindings: { selector: { domain: 'climate', attrMatch: { zone_role: 'master' } } } });
    // before rename:
    expect(resolveTileEntityId(t, snapshot())).toBe('climate.airzone_master');
    // HA renames the entity_id; the attribute that the selector pins is unchanged:
    const renamed: SelectableEntity[] = [
      { entity_id: 'climate.living_master', attributes: { zone_role: 'master' } },
      { entity_id: 'switch.porch', attributes: {} },
    ];
    expect(resolveTileEntityId(t, renamed)).toBe('climate.living_master');
    // a literal-id tile would have broken on the same rename:
    const literal = tile({ deviceId: 'climate.airzone_master', entityId: 'climate.airzone_master' });
    expect(resolveTileEntityId(literal, renamed)).toBe('climate.airzone_master'); // points at a now-missing id
    expect(renamed.some(e => e.entity_id === 'climate.airzone_master')).toBe(false);
  });

  it('unresolved selector yields undefined (not a silent deviceId fallback)', () => {
    const t = tile({ deviceId: 'climate.airzone_master', bindings: { selector: { domain: 'climate', attrMatch: { zone_role: 'nope' } } } });
    expect(resolveTileEntityId(t, snapshot())).toBeUndefined();
  });

  it('legacy tile (no bindings) resolves to its deviceId, unchanged', () => {
    const t = tile({ deviceId: 'light.kitchen' });
    expect(resolveTileEntityId(t, snapshot())).toBe('light.kitchen');
  });

  it('resolves a secondary binding by key', () => {
    const t = tile({ deviceId: 'climate.x', bindings: { primary: 'climate.x', secondary: { humidity: { primary: 'sensor.rh' } } } });
    expect(resolveSecondaryEntityId(t, 'humidity', snapshot())).toBe('sensor.rh');
    expect(resolveSecondaryEntityId(t, 'missing', snapshot())).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// New Panel: the extended addPanel option shape (the mutator builds a panel
// with these fields; mirror its construction here).
// ─────────────────────────────────────────────────────────────────────────
describe('New Panel construction (addPanel opts)', () => {
  function buildPanel(name: string, opts?: { columns?: number; rowHeight?: number; themeMode?: any; parentId?: string }) {
    return {
      id: 'panel-x',
      name,
      tiles: [],
      highlights: [],
      columns: opts?.columns ?? 8,
      rowHeight: opts?.rowHeight ?? 120,
      themeMode: opts?.themeMode ?? 'dark',
      ...(opts?.parentId ? { parentId: opts.parentId } : {}),
    };
  }
  it('applies provided columns/rowHeight/theme/parent', () => {
    const p = buildPanel('Guest', { columns: 12, rowHeight: 100, themeMode: 'light', parentId: 'panel-home' });
    expect(p).toMatchObject({ name: 'Guest', columns: 12, rowHeight: 100, themeMode: 'light', parentId: 'panel-home' });
  });
  it('defaults match the legacy add when no opts given', () => {
    const p = buildPanel('Plain');
    expect(p).toMatchObject({ columns: 8, rowHeight: 120, themeMode: 'dark' });
    expect('parentId' in p).toBe(false);
  });
});

// Sanity: the climate catalog entry declares the humidity secondary binding the
// inspector renders.
describe('catalog secondary bindings', () => {
  it('climate declares an optional humidity sensor secondary binding', () => {
    const sb = tileTypeCatalog.climate.secondaryBindings;
    expect(sb?.[0]).toMatchObject({ key: 'humidity', optional: true });
    expect(sb?.[0].acceptsDomains).toContain('sensor');
  });
});
