import type { AreaConfig } from '../types';
import type { HaArea, HaEntityArea } from '../services/haClient';

// ---------------------------------------------------------------------------
// Admin Stage 2 (Increment 12) — pure helper that turns the one-time HA
// registry import into a curated `areas` map. Pure + dependency-light so it is
// unit-testable without a HA connection. The runtime never calls this — only
// the editor's "Import from Home Assistant areas" button does, ONCE.
// ---------------------------------------------------------------------------

// Build curated AreaConfig[] from HA's area registry + entity→area assignments.
// An entity's effective area is its own `area_id` if set, else the area of its
// device (resolved via `entityDeviceMap` if a device-area map were available;
// here we use the entity's direct area_id and the device_id passthrough already
// folded into HaEntityArea). Entities with no resolvable area are simply left
// out (they land in the editor's "Unassigned" bucket at render time). Areas are
// ordered by name for a stable initial layout.
export function buildAreasFromRegistry(
  haAreas: HaArea[],
  entityAreas: HaEntityArea[],
  // Optional device_id -> area_id map so an entity inheriting its area from its
  // device still gets bucketed. When absent we only use the entity's own area.
  deviceAreaMap?: Record<string, string>,
): AreaConfig[] {
  const sorted = [...haAreas].sort((a, b) => a.name.localeCompare(b.name));
  const byArea = new Map<string, string[]>();
  for (const a of sorted) byArea.set(a.area_id, []);

  for (const e of entityAreas) {
    let areaId = e.area_id;
    if (!areaId && e.device_id && deviceAreaMap) {
      areaId = deviceAreaMap[e.device_id] ?? null;
    }
    if (!areaId) continue;
    const bucket = byArea.get(areaId);
    if (bucket && !bucket.includes(e.entity_id)) bucket.push(e.entity_id);
  }

  return sorted.map((a, i) => ({
    id: a.area_id,
    name: a.name,
    order: i,
    entityIds: (byArea.get(a.area_id) || []).sort((x, y) => x.localeCompare(y)),
  }));
}

// Merge freshly-imported areas into an existing curated set WITHOUT clobbering
// the admin's hand edits: existing areas (by id) keep their name/order and gain
// any newly-discovered entityIds; brand-new areas are appended after the
// current max order. This makes the import button safe to press more than once.
export function mergeImportedAreas(
  existing: AreaConfig[],
  imported: AreaConfig[],
): AreaConfig[] {
  const byId = new Map(existing.map(a => [a.id, { ...a, entityIds: [...a.entityIds] }]));
  let maxOrder = existing.reduce((m, a) => Math.max(m, a.order), -1);

  for (const imp of imported) {
    const cur = byId.get(imp.id);
    if (cur) {
      for (const eid of imp.entityIds) {
        if (!cur.entityIds.includes(eid)) cur.entityIds.push(eid);
      }
    } else {
      byId.set(imp.id, { ...imp, order: ++maxOrder });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.order - b.order);
}
