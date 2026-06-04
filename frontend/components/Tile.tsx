
import React from 'react';
import { TileConfig, Device } from '../types';
import UnknownTile from './tiles/UnknownTile';
import { resolveTile } from './tileRegistry';

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

  const ResolvedTile = resolveTile(device);
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

export default Tile;
