import type { TileComponent } from './tileRegistry';
// Design-system increment 1: the catalog now serves the NEW liquid-glass tiles
// (cool palette + glass material + Cormorant/DM Sans type) for these LOCKED
// domains. The legacy tiles still exist and remain the inferred/fallback path
// for tiles WITHOUT a `tileType`; only the admin-chosen (explicit) path renders
// the glass versions.
import GlassSwitchTile from '../design-system/tiles/GlassSwitchTile';
import GlassDimmerTile from '../design-system/tiles/GlassDimmerTile';
import GlassSceneTile from '../design-system/tiles/GlassSceneTile';
import GlassSensorTile from '../design-system/tiles/GlassSensorTile';

// ---------------------------------------------------------------------------
// Tile-type catalog (Admin / config-flow — Vertical Slice 0)
//
// This is the EXPLICIT, admin-chosen tile-resolution path. A `TileConfig` that
// carries a `tileType` is resolved against this catalog by key; a `TileConfig`
// WITHOUT a `tileType` (every legacy tile) is untouched and continues to use
// the inferred `resolveTile(device)` path in `tileRegistry.tsx`.
//
// Slice 0 intentionally ships only TWO entries, and both WRAP existing tile
// components — no new tile UI. The shape carries the Stage-1 fields
// (`alwaysEquipmentGated`, `contractStatus`, etc.) even though Slice 0 does
// not consume them, so the catalog can be extended in place without a schema
// churn. Gating ENFORCEMENT is deliberately deferred to Stage 1; Slice 0 only
// registers LOCKED, non-gated display/control bindings (switch + dimmer).
// ---------------------------------------------------------------------------

export type ContractStatus = 'LOCKED' | 'PROPOSED' | 'GATED';

// A single options-schema field for a tile type. Unused in Slice 0; present so
// Stage 1 can author per-tile config fields without changing this interface.
export interface OptionFieldDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  optional?: boolean;
  default?: string | number | boolean;
}

// A secondary entity binding a tile type may request (e.g. a climate tile that
// also wants a humidity sensor). Unused in Slice 0; present for Stage 1+.
export interface SecondaryBindingDef {
  key: string;
  label: string;
  acceptsDomains?: string[];
  optional?: boolean;
}

export interface TileTypeDefinition {
  // Stable catalog key persisted as `TileConfig.tileType`.
  key: string;
  // Human label shown in the admin picker / inspector.
  label: string;
  description: string;
  // HA domains this tile type can bind (e.g. ['switch','input_boolean']).
  // Used by `getCompatibleTileTypes` to auto-suggest a type for an entity.
  acceptsDomains?: string[];
  // HA device_classes this tile type can bind (refines `acceptsDomains`).
  acceptsDeviceClasses?: string[];
  // Stage 1+ fields — declared now so the catalog shape is stable.
  secondaryBindings?: SecondaryBindingDef[];
  optionsSchema?: OptionFieldDef[];
  // SAFETY: when true the editor MUST set `equipmentGated` and the inspector
  // shows display-only "safety gating enforced" — it can never be cleared.
  // No Slice 0 entry sets this (switch/light are not gated).
  alwaysEquipmentGated?: boolean;
  // Honest contract label for PROPOSED/GATED surfaces. Slice 0 entries are
  // LOCKED display/control bindings.
  contractStatus?: ContractStatus;
  // The React component this tile type renders. Wraps an EXISTING tile in
  // Slice 0 — no new tile UI is introduced.
  component: TileComponent;
}

// The catalog, keyed by `tileType`. Order matters only for picker display.
// Every entry here renders the liquid-glass design-language component; all are
// LOCKED display/control bindings (no equipment-gated entries in this increment).
export const tileTypeCatalog: Record<string, TileTypeDefinition> = {
  switch: {
    key: 'switch',
    label: 'Switch',
    description: 'On/off control for a switch or input boolean.',
    acceptsDomains: ['switch', 'input_boolean'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassSwitchTile,
  },
  dimmer: {
    key: 'dimmer',
    label: 'Dimmer',
    description: 'Brightness + on/off control for a dimmable light.',
    acceptsDomains: ['light'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassDimmerTile,
  },
  scene: {
    key: 'scene',
    label: 'Scene',
    description: 'Activate a scene (scene.turn_on). Shows last-activated time; no fake active state.',
    acceptsDomains: ['scene'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassSceneTile,
  },
  sensor: {
    key: 'sensor',
    label: 'Sensor',
    description: 'Read-only value readout (tabular figures, em-dash on unavailable).',
    acceptsDomains: ['sensor', 'input_number', 'number'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassSensorTile,
  },
};

// Resolve the component for an explicit `tileType`, or `undefined` if the key
// is unknown (caller falls back to the inferred path). Pure lookup — no side
// effects, safe for the render hot path.
export function resolveTileTypeComponent(tileType: string): TileComponent | undefined {
  return tileTypeCatalog[tileType]?.component;
}

// Look up a catalog definition by key.
export function getTileTypeDefinition(tileType: string): TileTypeDefinition | undefined {
  return tileTypeCatalog[tileType];
}

// Extract the HA domain from an entity_id (e.g. "light.kitchen" -> "light").
export function domainOf(entityId: string): string {
  return (entityId.split('.')[0] || '').toLowerCase();
}

// Catalog entries whose `acceptsDomains` includes the entity's domain. Used by
// the editor to auto-suggest a tile type when an entity is added. Slice 0 keeps
// this domain-only (no device_class refinement yet).
export function getCompatibleTileTypes(entityId: string): TileTypeDefinition[] {
  const domain = domainOf(entityId);
  return Object.values(tileTypeCatalog).filter(def =>
    def.acceptsDomains?.includes(domain),
  );
}

// The single best-guess tile type for an entity (first compatible match), or
// `undefined` when nothing in the catalog accepts the domain (the editor then
// falls back to the inferred/legacy add path).
export function suggestTileType(entityId: string): TileTypeDefinition | undefined {
  return getCompatibleTileTypes(entityId)[0];
}
