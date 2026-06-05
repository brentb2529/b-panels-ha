
import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconSun } from '../icons';
import TileWrapper from './TileWrapper';
import TileButton from './TileButton';
import { fluidIcon, fluidTextSm, fluidPadY } from './tileScale';

const SceneTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { triggerScene, requestPin } = useDashboardActions();
    const isActivating = !!device.state;
    const isLocked = !!tile.isLocked;

    const handleTrigger = () => {
        if (isEditor || isLocked) return;
        const action = () => triggerScene(device.id);
        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    return (
        <TileWrapper
            label={tile.label || ''}
            isActive={isActivating}
            isProtected={tile.requirePin}
            isLocked={isLocked}
            isEditor={isEditor}
            className={cornerClassName}
        >
            <IconSun className={`transition ${isActivating ? 'text-brand-blue' : 'text-gray-400'}`} style={{ ...fluidIcon(2.5), filter: isActivating ? 'drop-shadow(0 0 8px #00aaff)' : undefined }} />
            <div className="w-full px-2 mt-auto">
                <TileButton
                    onClick={handleTrigger}
                    className="w-full"
                    variant="primary"
                    disabled={isEditor || isLocked}
                    style={{ height: 'auto', ...fluidPadY(0.5625), ...fluidTextSm }}
                >
                    {isActivating ? 'Activating...' : 'Trigger'}
                </TileButton>
            </div>
        </TileWrapper>
    );
};

export default SceneTile;
