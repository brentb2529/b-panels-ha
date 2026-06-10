import type { EntitySelector, TileConfig } from '../types';

// ---------------------------------------------------------------------------
// Admin Stage 2 (Increment 12) — bind-by-selection resolution.
//
// A tile may bind EITHER a literal entity_id (`bindings.primary` / legacy
// `entityId` / `deviceId`) OR an `EntitySelector` resolved at runtime against
// the LIVE states snapshot. Selector mode is what lets module-integration tiles
// (IntelliCenter / Airzone) self-resolve and survive an entity rename
// (ENTITY_CONTRACT Surface 1/2): the binding pins (domain, device_class,
// OBJTYPE, attribute matches) rather than a literal id, so renaming
// `climate.airzone_master` → `climate.living_master` keeps resolving.
//
// PURE + dependency-free so it is unit-testable and safe on the render hot
// path. It reads a minimal entity-record shape (entity_id + attributes), which
// both the raw HA states snapshot and the mapped Device list can supply.
// ---------------------------------------------------------------------------

export interface SelectableEntity {
  entity_id: string;
  attributes?: Record<string, any>;
}

function domainOf(entityId: string): string {
  return (entityId.split('.')[0] || '').toLowerCase();
}

// Case-insensitive string compare of two attribute-ish values.
function eqCI(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

// Does a single entity record satisfy every constraint in the selector?
export function entityMatchesSelector(ent: SelectableEntity, sel: EntitySelector): boolean {
  if (!ent?.entity_id) return false;
  if (domainOf(ent.entity_id) !== (sel.domain || '').toLowerCase()) return false;

  const attrs = ent.attributes || {};

  if (sel.deviceClass) {
    if (!eqCI(attrs.device_class, sel.deviceClass)) return false;
  }

  if (sel.objType) {
    // IntelliCenter exposes its object type under a few possible keys depending
    // on the integration version; accept any of them, case-insensitively.
    const ot = attrs.objtype ?? attrs.OBJTYP ?? attrs.objtyp ?? attrs.obj_type;
    if (!eqCI(ot, sel.objType)) return false;
  }

  if (sel.attrMatch) {
    for (const [k, v] of Object.entries(sel.attrMatch)) {
      if (!eqCI(attrs[k], v)) return false;
    }
  }

  return true;
}

// Resolve a selector to a single entity_id against the live entity list. The
// FIRST match by sorted entity_id wins, so resolution is deterministic and
// stable across snapshots (a set of equally-valid matches always picks the same
// one). Returns undefined when nothing matches (caller renders "not found").
export function resolveSelector(
  sel: EntitySelector,
  entities: SelectableEntity[],
): string | undefined {
  const matches = entities
    .filter(e => entityMatchesSelector(e, sel))
    .map(e => e.entity_id)
    .sort((a, b) => a.localeCompare(b));
  return matches[0];
}

// The entity_id a tile should resolve to, given the live entity list. Order of
// precedence (all additive — a legacy tile with none of these falls straight
// through to its `deviceId`):
//   1. bindings.primary          — explicit direct id (homeowner add)
//   2. bindings.selector         — runtime selector (module self-resolve)
//   3. tile.entityId             — Slice-0 explicit id
//   4. tile.deviceId             — legacy
// A selector that resolves to nothing yields `undefined` (a deliberate
// "not found"); we do NOT silently fall back to deviceId for an unresolved
// selector, because that would mask a genuine binding break.
export function resolveTileEntityId(
  tile: TileConfig,
  entities: SelectableEntity[],
): string | undefined {
  if (tile.bindings?.primary) return tile.bindings.primary;
  if (tile.bindings?.selector) return resolveSelector(tile.bindings.selector, entities);
  if (tile.entityId) return tile.entityId;
  return tile.deviceId;
}

// Resolve a tile's secondary binding (by key) to an entity_id, if any.
export function resolveSecondaryEntityId(
  tile: TileConfig,
  key: string,
  entities: SelectableEntity[],
): string | undefined {
  const ref = tile.bindings?.secondary?.[key];
  if (!ref) return undefined;
  if (ref.primary) return ref.primary;
  if (ref.selector) return resolveSelector(ref.selector, entities);
  return undefined;
}
