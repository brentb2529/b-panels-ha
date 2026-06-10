import type { TileConfig } from '../types';
import { isAlwaysEquipmentGated } from '../components/tileTypes';

// ---------------------------------------------------------------------------
// Admin Stage 1 (Inc 11) boot-migration helpers — pure, additive, in-memory.
//
// These fill MISSING fields on a legacy tile; they never remove or rewrite an
// existing field, so applying them at boot can't trip the server clobber-guard
// (which refuses an empty-over-populated save). The migration is held in memory
// until the next real user-driven save persists it.
// ---------------------------------------------------------------------------

// Current dashboard-config schema version (also exported from useDashboard for
// the runtime; duplicated here as the migration's source of truth so the pure
// helper has no React import).
export const CONFIG_SCHEMA_VERSION = 2;

// Migrate a single tile in place-style (returns a new object when it changed).
//  (a) derive `entityId` from `deviceId` when missing (HA `id === entity_id`,
//      heuristic: a dotted id like "light.kitchen");
//  (b) force `gatingFlags.equipmentGated` for always-gated tile types.
export function migrateTile(tile: TileConfig): TileConfig {
  let next = tile;

  if (!next.entityId && typeof next.deviceId === 'string' && next.deviceId.includes('.')) {
    next = { ...next, entityId: next.deviceId };
  }

  if (isAlwaysEquipmentGated(next.tileType) && next.gatingFlags?.equipmentGated !== true) {
    next = { ...next, gatingFlags: { ...(next.gatingFlags || {}), equipmentGated: true } };
  }

  return next;
}
