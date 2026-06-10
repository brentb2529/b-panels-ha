import type { TileComponent } from './tileRegistry';
// Admin Stage 1 (Increment 11): the tile-type catalog grows from the Slice-0
// starter set (switch/dimmer/scene/sensor) into a full PLACEABLE-tile catalog
// over the common HA domains, each rendering a liquid-glass design-language
// component. This is the EXPLICIT, admin-chosen resolution path; legacy tiles
// without a `tileType` still resolve via the inferred `resolveTile(device)`
// fallback in `tileRegistry.tsx`, unchanged.
//
// NOTE (architecture): the bespoke `compilationKind` panels (Kitchen / Home /
// Pool / Climate / Suite / Security / Lighting) remain CURATED fixed-layout
// experiences and are NOT decomposed into placeable tiles. Deep decomposition of
// those compilations into individually-placeable rich domain tiles is DEFERRED.
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

export type ContractStatus = 'LOCKED' | 'PROPOSED' | 'GATED';

// A single options-schema field for a tile type. Stubbed in Stage 1 (a few
// entries declare fields); consumed by the inspector in a later stage.
export interface OptionFieldDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  optional?: boolean;
  default?: string | number | boolean;
}

// A secondary entity binding a tile type may request (e.g. a climate tile that
// also wants a humidity sensor). Declared for the inspector in a later stage.
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
  // Inspector affordances declared for a later stage.
  secondaryBindings?: SecondaryBindingDef[];
  optionsSchema?: OptionFieldDef[];
  // SAFETY: when true the editor MUST set `gatingFlags.equipmentGated = true`
  // and the inspector shows display-only "safety gating enforced" — it can
  // never be cleared by the user. `Tile.tsx` enforces confirm/PIN AND issues
  // NO actuation for an equipment-gated tile; the Python `config/save` path
  // re-forces this flag server-side as defense-in-depth.
  alwaysEquipmentGated?: boolean;
  // Honest contract label for the surface (PROPOSED/GATED vs LOCKED).
  contractStatus?: ContractStatus;
  // The React component this tile type renders (a liquid-glass tile).
  component: TileComponent;
}

// The set of tile-type keys that are ALWAYS equipment-gated. Mirrored verbatim
// in `custom_components/b_panels/__init__.py` (server-side defense-in-depth) —
// keep the two lists in sync. These cover the life-safety / equipment surfaces:
// alarm arm/disarm, locks, the AKVO movable floor, the panic dispatch, garage
// doors, and pool bodies. (Stage 1 does NOT enable actuation for any of these —
// the gated entries render display-only; the flag is hardening, not enablement.)
export const ALWAYS_EQUIPMENT_GATED_TYPES: readonly string[] = [
  'alarm',
  'lock',
  'akvo-floor',
  'panic',
  'garage-cover',
  'pool-body',
];

// Whether a tile type is always equipment-gated (catalog flag is authoritative;
// the const list above is the fallback so the server and any non-catalog code
// agree even if the catalog entry is missing).
export function isAlwaysEquipmentGated(tileType?: string): boolean {
  if (!tileType) return false;
  const def = tileTypeCatalog[tileType];
  if (def?.alwaysEquipmentGated) return true;
  return ALWAYS_EQUIPMENT_GATED_TYPES.includes(tileType);
}

// The catalog, keyed by `tileType`. Order is picker-display order.
export const tileTypeCatalog: Record<string, TileTypeDefinition> = {
  // ── Common control / display placeable tiles (LOCKED) ──────────────────
  switch: {
    key: 'switch',
    label: 'Switch',
    description: 'On/off control for a switch or input boolean.',
    acceptsDomains: ['switch', 'input_boolean', 'fan', 'siren'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassSwitchTile,
  },
  dimmer: {
    key: 'dimmer',
    label: 'Dimmer',
    description: 'Brightness + on/off control for a dimmable light.',
    acceptsDomains: ['light'],
    optionsSchema: [
      { key: 'showColor', label: 'Show live light color', type: 'boolean', optional: true, default: true },
    ],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassDimmerTile,
  },
  'light-group': {
    key: 'light-group',
    label: 'Light Group',
    description: 'A curated group of lights: master on/off + dim, with an honest "N of M on" rollup when the group reports member counts.',
    acceptsDomains: ['light', 'group'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassLightGroupTile,
  },
  scene: {
    key: 'scene',
    label: 'Scene',
    description: 'Activate a scene (scene.turn_on). Shows last-activated time; no fake active state.',
    acceptsDomains: ['scene', 'script'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassSceneTile,
  },
  cover: {
    key: 'cover',
    label: 'Shade / Cover',
    description: 'Position control for a shade/blind/cover with a live position readout and visualizer.',
    acceptsDomains: ['cover'],
    acceptsDeviceClasses: ['shade', 'blind', 'curtain', 'shutter', 'awning', 'window'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassShadeTile,
  },
  climate: {
    key: 'climate',
    label: 'Thermostat',
    description: 'Thermostat-style tile: setpoint nudges + mode cycle + ambient readout for a single climate entity.',
    acceptsDomains: ['climate'],
    secondaryBindings: [
      { key: 'humidity', label: 'Humidity sensor', acceptsDomains: ['sensor'], optional: true },
    ],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassClimateTile,
  },
  'media-player': {
    key: 'media-player',
    label: 'Media Player',
    description: 'Now-playing + transport + volume for a Sonos / HA media-player speaker.',
    acceptsDomains: ['media_player'],
    acceptsDeviceClasses: ['speaker', 'receiver'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassMediaTile,
  },
  camera: {
    key: 'camera',
    label: 'Camera',
    description: '16:9 live camera feed with a poster snapshot and a calm "feed unavailable" fallback. Display-only.',
    acceptsDomains: ['camera'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassCameraTile,
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
  'litter-robot': {
    key: 'litter-robot',
    label: 'Litter-Robot',
    description: 'Rich Whisker / Litter-Robot tile: animated litter-level + waste-drawer visualizers, status pill, scoops-saved, hopper + last-cycle, with press-and-hold Cycle / Night-light / Panel-lock controls. Low-hazard appliance — confirm-gated, not equipment-gated.',
    // Binds to the robot composite (which surfaces as a vacuum-backed device);
    // the composite folds the Whisker sensors/switches/buttons into one state.
    acceptsDomains: ['vacuum'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassLitterRobotTile,
  },
  // ── Sub-Zero / Wolf / Cove appliances (subzero_wolf integration) ───────
  // All three bind to an appliance COMPOSITE device (the integration's per-zone
  // / per-cavity / cycle entities folded into one ApplianceState by
  // useDashboard). Display-only; the composite anchors on the appliance's
  // sensor entities, so `acceptsDomains: ['sensor']` lets the picker suggest
  // them. Binding is by deviceId (the `appliance:*` composite).
  'subzero-fridge': {
    key: 'subzero-fridge',
    label: 'Fridge / Freezer (Sub-Zero)',
    description: 'Rich Sub-Zero fridge/freezer tile: per-zone set-point + measured temperature with an animated cool/frost indicator, door-open state, and water/air filter alerts. Display-only — Sub-Zero set-points are read-only at the appliance, so this tile exposes no writes.',
    acceptsDomains: ['sensor'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassFridgeTile,
  },
  'wolf-oven': {
    key: 'wolf-oven',
    label: 'Oven / Range (Wolf)',
    description: 'Rich Wolf oven/range tile: per-cavity measured temp with an animated heating ring, cook mode, probe temperature, oven light read-back. Controls are READ-ONLY — the oven set-temp / probe / light WRITES are equipment-gated (enable in the integration options after hardware verification); this tile renders them disabled and issues no actuation.',
    acceptsDomains: ['sensor'],
    // SAFETY: the oven write path is equipment-gated. This tile is display-only
    // and issues ZERO actuation, so it is NOT marked alwaysEquipmentGated (which
    // governs Tile.tsx confirm/PIN for tiles that COULD actuate) — instead the
    // tile itself has no write code path. Marked GATED so the contract label is
    // honest about the oven write gate.
    alwaysEquipmentGated: false,
    contractStatus: 'GATED',
    component: GlassOvenTile,
  },
  'cove-dishwasher': {
    key: 'cove-dishwasher',
    label: 'Dishwasher (Cove)',
    description: 'Rich Cove dishwasher tile: cycle status with an animated wash/progress ring, time-remaining, and clean/running/door state. Display-only.',
    acceptsDomains: ['sensor'],
    alwaysEquipmentGated: false,
    contractStatus: 'LOCKED',
    component: GlassDishwasherTile,
  },

  // ── Equipment-gated / life-safety surfaces ─────────────────────────────
  // These render DISPLAY-ONLY in Stage 1. `alwaysEquipmentGated: true` forces
  // the editor to set (and never clear) `equipmentGated`, makes `Tile.tsx`
  // suppress actuation, and is re-forced server-side. NO actuation is enabled
  // here — these are honest, gated displays only.
  alarm: {
    key: 'alarm',
    label: 'Arming Status',
    description: 'Display-only Alarmo / alarm_control_panel arming state. Never arms or disarms — arm/disarm lives in the curated Security panel with PIN entry.',
    acceptsDomains: ['alarm_control_panel'],
    alwaysEquipmentGated: true,
    contractStatus: 'GATED',
    component: GlassArmingStatusTile,
  },
  'arming-status': {
    key: 'arming-status',
    label: 'Arming Status (display)',
    description: 'Alias of the display-only arming-state readout for explicit placement.',
    acceptsDomains: ['alarm_control_panel'],
    alwaysEquipmentGated: true,
    contractStatus: 'GATED',
    component: GlassArmingStatusTile,
  },
  lock: {
    key: 'lock',
    label: 'Lock',
    description: 'Lock state display. Equipment-gated: shown display-only in Stage 1, no actuation enabled.',
    acceptsDomains: ['lock'],
    alwaysEquipmentGated: true,
    contractStatus: 'GATED',
    // Renders the glass switch shell for lock state (display-only; gating in
    // Tile.tsx suppresses the toggle). No lock/unlock is wired here.
    component: GlassSwitchTile,
  },
  'garage-cover': {
    key: 'garage-cover',
    label: 'Garage Door',
    description: 'Garage-door cover. Equipment-gated: display-only in Stage 1, no actuation enabled.',
    acceptsDomains: ['cover'],
    acceptsDeviceClasses: ['garage', 'gate', 'door'],
    alwaysEquipmentGated: true,
    contractStatus: 'GATED',
    component: GlassShadeTile,
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
// the editor to auto-suggest a tile type when an entity is added. Domain-level
// filtering; device_class refinement (`acceptsDeviceClasses`) is applied by the
// editor when an entity's device_class is known.
export function getCompatibleTileTypes(entityId: string): TileTypeDefinition[] {
  const domain = domainOf(entityId);
  return Object.values(tileTypeCatalog).filter(def => def.acceptsDomains?.includes(domain));
}

// Catalog entries compatible with an entity given BOTH its domain and (when
// known) its device_class. A type with `acceptsDeviceClasses` only matches when
// the entity's device_class is in that list; a type without the field matches
// any device_class in its accepted domains. Used by the editor's in-app picker
// so e.g. a `cover` with device_class 'garage' offers the Garage Door type but
// a plain shade cover does not. Falls back to domain-only when deviceClass is
// undefined.
export function getCompatibleTileTypesForDevice(
  entityId: string,
  deviceClass?: string,
): TileTypeDefinition[] {
  const byDomain = getCompatibleTileTypes(entityId);
  if (!deviceClass) return byDomain;
  const dc = deviceClass.toLowerCase();
  return byDomain.filter(def => {
    if (!def.acceptsDeviceClasses || def.acceptsDeviceClasses.length === 0) return true;
    return def.acceptsDeviceClasses.map(c => c.toLowerCase()).includes(dc);
  });
}

// The single best-guess tile type for an entity (first compatible NON-gated
// match), or `undefined` when nothing in the catalog accepts the domain. We
// never auto-suggest an equipment-gated type — gated placement is always an
// explicit admin choice, never a default.
export function suggestTileType(entityId: string): TileTypeDefinition | undefined {
  const compatible = getCompatibleTileTypes(entityId);
  return compatible.find(def => !def.alwaysEquipmentGated) ?? undefined;
}
