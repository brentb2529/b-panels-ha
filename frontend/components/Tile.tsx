
import React from 'react';
import { TileConfig, Device } from '../types';
import UnknownTile from './tiles/UnknownTile';
import { resolveTileComponent } from './tileRegistry';

interface TileProps {
  tile: TileConfig;
  device?: Device;
  onEnlarge?: (device: Device) => void;
  isEditor?: boolean;
  cornerClassName?: string;
}

const Tile = ({ tile, device, onEnlarge, isEditor, cornerClassName }: TileProps) => {
  if (!device) {
    return <UnknownTile tile={tile} isEditor={isEditor} cornerClassName={cornerClassName} />;
  }

  // Dual-path: explicit `tile.tileType` (admin-chosen, from the tileTypes
  // catalog) takes precedence; otherwise falls back to the inferred
  // DeviceType path. Legacy tiles have no `tileType` and resolve as before.
  const ResolvedTile = resolveTileComponent(tile, device);
  return (
    <ResolvedTile
      device={device}
      tile={tile}
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
