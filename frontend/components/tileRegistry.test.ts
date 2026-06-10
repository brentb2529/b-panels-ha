import { describe, it, expect } from 'vitest';
import { resolveTileComponent, resolveTile } from './tileRegistry';
import {
  tileTypeCatalog,
  suggestTileType,
  resolveTileTypeComponent,
  getCompatibleTileTypes,
  isAlwaysEquipmentGated,
  ALWAYS_EQUIPMENT_GATED_TYPES,
} from './tileTypes';
import SwitchTile from './tiles/SwitchTile';
import DimmerTile from './tiles/DimmerTile';
import GlassSwitchTile from '../design-system/tiles/GlassSwitchTile';
import GlassDimmerTile from '../design-system/tiles/GlassDimmerTile';
import GlassSceneTile from '../design-system/tiles/GlassSceneTile';
import GlassSensorTile from '../design-system/tiles/GlassSensorTile';
import GlassShadeTile from '../design-system/tiles/GlassShadeTile';
import GlassClimateTile from '../design-system/tiles/GlassClimateTile';
import GlassMediaTile from '../design-system/tiles/GlassMediaTile';
import GlassCameraTile from '../design-system/tiles/GlassCameraTile';
import GlassLightGroupTile from '../design-system/tiles/GlassLightGroupTile';
import GlassArmingStatusTile from '../design-system/tiles/GlassArmingStatusTile';
import GlassLitterRobotTile from '../design-system/tiles/GlassLitterRobotTile';
import GlassFridgeTile from '../design-system/tiles/GlassFridgeTile';
import GlassOvenTile from '../design-system/tiles/GlassOvenTile';
import GlassDishwasherTile from '../design-system/tiles/GlassDishwasherTile';
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

describe('tileTypes catalog (Admin Stage 1 — Inc 11)', () => {
  it('serves the full placeable catalog over the common domains', () => {
    // Starter set + the Stage-1 placeable additions + the gated surfaces.
    expect(Object.keys(tileTypeCatalog).sort()).toEqual([
      'alarm',
      'arming-status',
      'camera',
      'climate',
      'cove-dishwasher',
      'cover',
      'dimmer',
      'garage-cover',
      'light-group',
      'litter-robot',
      'lock',
      'media-player',
      'scene',
      'sensor',
      'subzero-fridge',
      'switch',
      'wolf-oven',
    ]);
    expect(tileTypeCatalog.switch.component).toBe(GlassSwitchTile);
    expect(tileTypeCatalog.dimmer.component).toBe(GlassDimmerTile);
    expect(tileTypeCatalog.scene.component).toBe(GlassSceneTile);
    expect(tileTypeCatalog.sensor.component).toBe(GlassSensorTile);
    expect(tileTypeCatalog.cover.component).toBe(GlassShadeTile);
    expect(tileTypeCatalog.climate.component).toBe(GlassClimateTile);
    expect(tileTypeCatalog['media-player'].component).toBe(GlassMediaTile);
    expect(tileTypeCatalog.camera.component).toBe(GlassCameraTile);
    expect(tileTypeCatalog['light-group'].component).toBe(GlassLightGroupTile);
    expect(tileTypeCatalog.alarm.component).toBe(GlassArmingStatusTile);
    expect(tileTypeCatalog['arming-status'].component).toBe(GlassArmingStatusTile);
    expect(tileTypeCatalog['litter-robot'].component).toBe(GlassLitterRobotTile);
    expect(tileTypeCatalog['subzero-fridge'].component).toBe(GlassFridgeTile);
    expect(tileTypeCatalog['wolf-oven'].component).toBe(GlassOvenTile);
    expect(tileTypeCatalog['cove-dishwasher'].component).toBe(GlassDishwasherTile);
    // SAFETY: the Wolf oven tile is GATED in the contract (oven write gate).
    expect(tileTypeCatalog['wolf-oven'].contractStatus).toBe('GATED');
  });

  it('no longer points the catalog at the legacy tile components', () => {
    expect(tileTypeCatalog.switch.component).not.toBe(SwitchTile);
    expect(tileTypeCatalog.dimmer.component).not.toBe(DimmerTile);
  });

  it('every entry declares domains + an honest contract status', () => {
    for (const def of Object.values(tileTypeCatalog)) {
      expect(Array.isArray(def.acceptsDomains)).toBe(true);
      expect(['LOCKED', 'PROPOSED', 'GATED']).toContain(def.contractStatus);
    }
  });

  it('marks the life-safety / equipment types alwaysEquipmentGated + GATED', () => {
    for (const key of ['alarm', 'arming-status', 'lock', 'garage-cover']) {
      expect(tileTypeCatalog[key].alwaysEquipmentGated).toBe(true);
      expect(tileTypeCatalog[key].contractStatus).toBe('GATED');
    }
    // The plain control/display tiles must NOT be gated.
    for (const key of ['switch', 'dimmer', 'scene', 'sensor', 'cover', 'climate', 'media-player', 'camera', 'light-group', 'litter-robot']) {
      expect(tileTypeCatalog[key].alwaysEquipmentGated).toBe(false);
      expect(tileTypeCatalog[key].contractStatus).toBe('LOCKED');
    }
  });

  it('isAlwaysEquipmentGated agrees with the catalog and the const list', () => {
    for (const t of ALWAYS_EQUIPMENT_GATED_TYPES) expect(isAlwaysEquipmentGated(t)).toBe(true);
    expect(isAlwaysEquipmentGated('alarm')).toBe(true);
    expect(isAlwaysEquipmentGated('lock')).toBe(true);
    expect(isAlwaysEquipmentGated('akvo-floor')).toBe(true); // const-list fallback (no catalog entry)
    expect(isAlwaysEquipmentGated('switch')).toBe(false);
    expect(isAlwaysEquipmentGated('climate')).toBe(false);
    expect(isAlwaysEquipmentGated(undefined)).toBe(false);
  });

  it('auto-suggests the right glass tile per domain (never a gated type)', () => {
    expect(suggestTileType('switch.porch')?.key).toBe('switch');
    expect(suggestTileType('input_boolean.guest')?.key).toBe('switch');
    expect(suggestTileType('light.kitchen')?.key).toBe('dimmer');
    expect(suggestTileType('scene.evening')?.key).toBe('scene');
    expect(suggestTileType('sensor.temp')?.key).toBe('sensor');
    expect(suggestTileType('input_number.target')?.key).toBe('sensor');
    expect(suggestTileType('cover.living')?.key).toBe('cover');
    expect(suggestTileType('climate.office')?.key).toBe('climate');
    expect(suggestTileType('media_player.sonos')?.key).toBe('media-player');
    expect(suggestTileType('camera.front')?.key).toBe('camera');
    // A lock IS compatible but is gated, so it is never AUTO-suggested.
    expect(suggestTileType('lock.front')).toBeUndefined();
    expect(getCompatibleTileTypes('lock.front').map(d => d.key)).toEqual(['lock']);
  });

  it('suggests the litter-robot tile for a vacuum-backed robot', () => {
    expect(suggestTileType('vacuum.litter_robot')?.key).toBe('litter-robot');
    expect(getCompatibleTileTypes('vacuum.litter_robot').map(d => d.key)).toEqual(['litter-robot']);
  });

  it('returns no suggestion for a domain the catalog does not accept', () => {
    expect(suggestTileType('weather.home')).toBeUndefined();
    expect(getCompatibleTileTypes('weather.home')).toEqual([]);
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
