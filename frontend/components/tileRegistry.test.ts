import { describe, it, expect } from 'vitest';
import { resolveTileComponent, resolveTile } from './tileRegistry';
import {
  tileTypeCatalog,
  suggestTileType,
  resolveTileTypeComponent,
  getCompatibleTileTypes,
} from './tileTypes';
import SwitchTile from './tiles/SwitchTile';
import DimmerTile from './tiles/DimmerTile';
import GlassSwitchTile from '../design-system/tiles/GlassSwitchTile';
import GlassDimmerTile from '../design-system/tiles/GlassDimmerTile';
import GlassSceneTile from '../design-system/tiles/GlassSceneTile';
import GlassSensorTile from '../design-system/tiles/GlassSensorTile';
import { Device, DeviceType, DeviceService, TileConfig } from '../types';

// Minimal real Device fixtures. `id === entity_id` for HA-sourced devices.
function dev(id: string, type: DeviceType): Device {
  return {
    id,
    name: id,
    type,
    service: DeviceService.HomeAssistant,
    state: 'off',
  };
}

function tile(overrides: Partial<TileConfig>): TileConfig {
  return { id: 'tile-test', deviceId: overrides.deviceId ?? 'switch.test', ...overrides };
}

describe('tileTypes catalog (design-system Inc 1)', () => {
  it('serves the liquid-glass starter set for the LOCKED domains', () => {
    expect(Object.keys(tileTypeCatalog).sort()).toEqual(['dimmer', 'scene', 'sensor', 'switch']);
    expect(tileTypeCatalog.switch.component).toBe(GlassSwitchTile);
    expect(tileTypeCatalog.dimmer.component).toBe(GlassDimmerTile);
    expect(tileTypeCatalog.scene.component).toBe(GlassSceneTile);
    expect(tileTypeCatalog.sensor.component).toBe(GlassSensorTile);
  });

  it('no longer points the catalog at the legacy tile components', () => {
    // The legacy tiles still exist (inferred/fallback path) but the explicit
    // admin-chosen catalog now renders the glass versions.
    expect(tileTypeCatalog.switch.component).not.toBe(SwitchTile);
    expect(tileTypeCatalog.dimmer.component).not.toBe(DimmerTile);
  });

  it('keeps every entry non-gated / LOCKED with declared domains', () => {
    for (const def of Object.values(tileTypeCatalog)) {
      expect(def.alwaysEquipmentGated).toBe(false);
      expect(def.contractStatus).toBe('LOCKED');
      expect(Array.isArray(def.acceptsDomains)).toBe(true);
    }
  });

  it('auto-suggests the right glass tile per domain', () => {
    expect(suggestTileType('switch.porch')?.key).toBe('switch');
    expect(suggestTileType('input_boolean.guest')?.key).toBe('switch');
    expect(suggestTileType('light.kitchen')?.key).toBe('dimmer');
    expect(suggestTileType('scene.evening')?.key).toBe('scene');
    expect(suggestTileType('sensor.temp')?.key).toBe('sensor');
    expect(suggestTileType('input_number.target')?.key).toBe('sensor');
  });

  it('returns no suggestion for a domain the catalog does not accept', () => {
    expect(suggestTileType('lock.front')).toBeUndefined();
    expect(getCompatibleTileTypes('lock.front')).toEqual([]);
  });
});

describe('dual-path tile resolution (Slice 0)', () => {
  it('uses the catalog component when tileType is set', () => {
    // A light entity rendered with an explicit `switch` tileType resolves to
    // the catalog component (the glass switch), NOT the inferred DimmerTile.
    const t = tile({ deviceId: 'light.kitchen', tileType: 'switch', entityId: 'light.kitchen' });
    const d = dev('light.kitchen', DeviceType.Dimmer);
    expect(resolveTileComponent(t, d)).toBe(GlassSwitchTile);
    expect(resolveTileComponent(t, d)).toBe(resolveTileTypeComponent('switch'));
    expect(resolveTileComponent(t, d)).not.toBe(DimmerTile);
  });

  it('falls back to the inferred path when tileType is absent (legacy tile)', () => {
    // No tileType -> resolves identically to the legacy resolveTile(device).
    const legacy = tile({ deviceId: 'light.kitchen' });
    const d = dev('light.kitchen', DeviceType.Dimmer);
    expect(legacy.tileType).toBeUndefined();
    expect(resolveTileComponent(legacy, d)).toBe(resolveTile(d));
    expect(resolveTileComponent(legacy, d)).toBe(DimmerTile);
  });

  it('falls back to the inferred path when tileType is an unknown key', () => {
    const t = tile({ deviceId: 'switch.test', tileType: 'no-such-type' });
    const d = dev('switch.test', DeviceType.Switch);
    expect(resolveTileComponent(t, d)).toBe(resolveTile(d));
    expect(resolveTileComponent(t, d)).toBe(SwitchTile);
  });
});

// Mirrors the exact binding-write branch in useDashboard.addTileToPanel:
// when the editor supplies a binding, the new TileConfig must carry
// tileType + entityId; when it does not, both stay undefined (legacy).
function buildTile(
  deviceId: string,
  binding?: { tileType?: string; entityId?: string },
): TileConfig {
  const newTile: TileConfig = { id: 'tile-1', deviceId, width: 1, height: 1, x: 0, y: 0 };
  if (binding?.tileType !== undefined) newTile.tileType = binding.tileType;
  if (binding?.entityId !== undefined) newTile.entityId = binding.entityId;
  return newTile;
}

describe('addTileToPanel binding persistence (Slice 0)', () => {
  it('writes tileType + entityId onto the new tile when the editor binds', () => {
    const suggestion = suggestTileType('switch.porch');
    expect(suggestion?.key).toBe('switch');
    const built = buildTile('switch.porch', { tileType: suggestion!.key, entityId: 'switch.porch' });
    expect(built.tileType).toBe('switch');
    expect(built.entityId).toBe('switch.porch');
  });

  it('leaves tileType + entityId undefined for a legacy/inferred add', () => {
    const built = buildTile('switch.porch');
    expect(built.tileType).toBeUndefined();
    expect(built.entityId).toBeUndefined();
  });
});
