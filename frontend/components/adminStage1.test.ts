import { describe, it, expect } from 'vitest';
import { applyGatingEnforcement } from './Tile';
import { migrateTile, CONFIG_SCHEMA_VERSION } from '../hooks/configMigration';
import { isAlwaysEquipmentGated } from './tileTypes';
import type { TileConfig } from '../types';

const tile = (o: Partial<TileConfig>): TileConfig => ({ id: 't', deviceId: o.deviceId ?? 'switch.x', ...o });

describe('gating enforcement (client — Tile.applyGatingEnforcement)', () => {
  it('forces isLocked + requirePin for an always-gated tile type', () => {
    const out = applyGatingEnforcement(tile({ tileType: 'lock', deviceId: 'lock.front' }));
    expect(out.isLocked).toBe(true);
    expect(out.requirePin).toBe(true);
  });

  it('forces gating when gatingFlags.equipmentGated is set even on a non-gated type', () => {
    const out = applyGatingEnforcement(tile({ tileType: 'switch', gatingFlags: { equipmentGated: true } }));
    expect(out.isLocked).toBe(true);
  });

  it('leaves a normal tile untouched (no actuation suppression)', () => {
    const input = tile({ tileType: 'switch', deviceId: 'switch.porch' });
    const out = applyGatingEnforcement(input);
    expect(out).toBe(input); // same reference — no change
    expect(out.isLocked).toBeUndefined();
  });

  it('is idempotent for an already locked+pin gated tile', () => {
    const input = tile({ tileType: 'alarm', isLocked: true, requirePin: true });
    expect(applyGatingEnforcement(input)).toBe(input);
  });
});

describe('boot migration (configMigration.migrateTile)', () => {
  it('derives entityId from deviceId for a legacy HA tile that lacks it', () => {
    const out = migrateTile(tile({ deviceId: 'light.kitchen' }));
    expect(out.entityId).toBe('light.kitchen');
  });

  it('does NOT derive entityId for a non-dotted deviceId', () => {
    const out = migrateTile(tile({ deviceId: 'hometile-sthm-panel' }));
    expect(out.entityId).toBeUndefined();
  });

  it('preserves an existing entityId (additive only)', () => {
    const out = migrateTile(tile({ deviceId: 'light.kitchen', entityId: 'light.explicit' }));
    expect(out.entityId).toBe('light.explicit');
  });

  it('forces equipmentGated for an always-gated tile type', () => {
    const out = migrateTile(tile({ tileType: 'lock', deviceId: 'lock.front' }));
    expect(out.gatingFlags?.equipmentGated).toBe(true);
  });

  it('leaves a non-gated legacy tile without gatingFlags', () => {
    const out = migrateTile(tile({ deviceId: 'switch.porch' }));
    expect(out.gatingFlags).toBeUndefined();
  });

  it('schema version is v2', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(2);
  });
});

describe('isAlwaysEquipmentGated coverage for the gated set', () => {
  it('covers alarm/lock/akvo-floor/panic/garage-cover/pool-body', () => {
    for (const t of ['alarm', 'lock', 'akvo-floor', 'panic', 'garage-cover', 'pool-body']) {
      expect(isAlwaysEquipmentGated(t)).toBe(true);
    }
  });
});
