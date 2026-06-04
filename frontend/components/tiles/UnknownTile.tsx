
import React from 'react';
import { TileConfig, Device } from '../../types';
import TileWrapper from './TileWrapper';
import { IconInfo } from '../icons';
import { fluidIcon, fluidTextSm, fluidTextXs } from './tileScale';

// A misconfigured / unsupported tile is a benign config issue, not an
// emergency — so it gets a neutral, dashed "missing" treatment rather than
// alarm-red, which is reserved strictly for active danger states.
const UnknownTile = ({ tile, device, isEditor, cornerClassName }: { tile: TileConfig, device?: Device; isEditor?: boolean; cornerClassName?: string }) => {
    const message = device ? 'Unsupported Type' : 'Device Not Found';
    return (
        <TileWrapper label={tile.label || 'Unconfigured'} className={`rounded-tile !border-2 !border-dashed !border-gray-600 ${cornerClassName || ''}`} isEditor={isEditor}>
            <IconInfo className="text-gray-500" style={fluidIcon(2)} />
            <p className="text-gray-400" style={fluidTextSm}>{message}</p>
            {device && <p className="text-gray-400" style={fluidTextXs}>{device.type}</p>}
        </TileWrapper>
    );
};

export default UnknownTile;
