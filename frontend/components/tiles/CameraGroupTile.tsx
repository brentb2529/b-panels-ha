
import React from 'react';
import { Device, TileConfig } from '../../types';
import { IconLayoutGrid } from '../icons';
import TileWrapper from './TileWrapper';
import { fluidIcon, fluidTextXs } from './tileScale';

interface CameraGroupTileProps {
    device: Device;
    tile: TileConfig;
    onEnlarge?: (device: Device) => void;
    isEditor?: boolean;
    cornerClassName?: string;
}

const CameraGroupTile = ({ device, tile, onEnlarge, isEditor, cornerClassName }: CameraGroupTileProps) => {
    const handleClick = () => {
        if (!isEditor && !tile.isLocked && onEnlarge) {
            onEnlarge(device);
        }
    };

    const cameraIds = (device.state as any)?.cameraIds || [];
    const count = cameraIds.length;

    return (
        <TileWrapper 
            label={tile.label || ''} 
            onClick={handleClick}
            isLocked={tile.isLocked}
            isEditor={isEditor}
            className={cornerClassName}
        >
            <div className="relative flex items-center justify-center flex-1">
                {/* Dimensional halo disc behind the grid glyph — turns it into a real focal point */}
                <div
                    className="relative flex items-center justify-center rounded-full"
                    style={{
                        width: 'clamp(2.75rem, 40cqmin, 5.5rem)',
                        aspectRatio: '1 / 1',
                        background: 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.10), rgb(255 255 255 / 0.02) 70%, transparent)',
                        border: '1px solid rgb(255 255 255 / 0.10)',
                        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.12), inset 0 -2px 6px rgb(0 0 0 / 0.22)',
                    }}
                >
                    <IconLayoutGrid className="text-gray-200" style={fluidIcon(2.5)} />
                    <span
                        className="absolute -top-1 -right-1 text-white font-bold rounded-full flex items-center justify-center tabular-nums"
                        style={{
                            ...fluidTextXs,
                            minWidth: 'clamp(1.1rem, 13cqmin, 1.5rem)',
                            height: 'clamp(1.1rem, 13cqmin, 1.5rem)',
                            padding: '0 0.3rem',
                            background: 'rgb(var(--accent))',
                            border: '2px solid rgb(var(--surface))',
                            boxShadow: '0 0 10px -2px rgb(var(--accent)), inset 0 1px 0 rgb(255 255 255 / 0.25)',
                        }}
                    >
                        {count}
                    </span>
                </div>
            </div>
        </TileWrapper>
    );
};

export default CameraGroupTile;
