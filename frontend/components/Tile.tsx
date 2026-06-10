
import React from 'react';
import { TileConfig, Device } from '../types';
import UnknownTile from './tiles/UnknownTile';
import { resolveTileComponent } from './tileRegistry';
import { isAlwaysEquipmentGated } from './tileTypes';

interface TileProps {
  tile: TileConfig;
  device?: Device;
  onEnlarge?: (device: Device) => void;
  isEditor?: boolean;
  cornerClassName?: string;
}

// SAFETY (Admin Stage 1, Inc 11): equipment-gated enforcement. A tile is
// equipment-gated when its persisted `gatingFlags.equipmentGated` is set OR its
// `tileType` is one of the always-gated types (alarm/lock/akvo-floor/panic/
// garage-cover/pool-body). For a gated tile we FORCE `isLocked: true` and
// `requirePin: true` on the TileConfig handed to the rendered tile component.
// Every tile (glass + legacy) already short-circuits its action handlers on
// `isLocked`, so this guarantees NO actuation is issued from a gated tile —
// regardless of the user-facing toggles — while still showing the lock/PIN
// affordances. This is the client half of the defense; `config/save` re-forces
// the flag server-side. NOTE: this hardening does NOT enable any gated
// actuation; gated tiles ship display-only in Stage 1.
export function applyGatingEnforcement(tile: TileConfig): TileConfig {
  const gated = tile.gatingFlags?.equipmentGated === true || isAlwaysEquipmentGated(tile.tileType);
  if (!gated) return tile;
  if (tile.isLocked && tile.requirePin) return tile; // already locked + PIN
  return { ...tile, isLocked: true, requirePin: true };
}

const Tile = ({ tile, device, onEnlarge, isEditor, cornerClassName }: TileProps) => {
  if (!device) {
    return <UnknownTile tile={tile} isEditor={isEditor} cornerClassName={cornerClassName} />;
  }

  // Dual-path: explicit `tile.tileType` (admin-chosen, from the tileTypes
  // catalog) takes precedence; otherwise falls back to the inferred
  // DeviceType path. Legacy tiles have no `tileType` and resolve as before.
  const ResolvedTile = resolveTileComponent(tile, device);
  const effectiveTile = applyGatingEnforcement(tile);
  return (
    <ResolvedTile
      device={device}
      tile={effectiveTile}
      onEnlarge={onEnlarge}
      isEditor={isEditor}
      cornerClassName={cornerClassName}
    />
  );
};

// Memoized: the realtime layer keeps unchanged Device objects referentially
// stable (immer), so a tile only re-renders when its own device/tile/props
// actually change — not on every entity update elsewhere on the dashboard.
export default React.memo(Tile);
