
import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import { IconThermometer, IconFlame, IconSnowflake, IconPower, IconPlus, IconTrash2 } from '../icons';
import TileWrapper, { TileAccent } from './TileWrapper';
import { fluidTextXs, fluidText4xl, fluidTextLg, fluidIcon } from './tileScale';

const ThermostatTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { updateDeviceState, requestPin } = useDashboard();
    const state = device.state as { mode: 'cool' | 'heat' | 'off', currentTemp: number, setpoint: number };
    const isLocked = !!tile.isLocked;
    
    const isActive = state.mode !== 'off';

    // Accent follows the active mode so the glow runs warm for heat, cool for AC.
    const accent: TileAccent = state.mode === 'heat' ? 'warn' : state.mode === 'cool' ? 'water' : 'brand';

    const handleProtectedAction = (action: () => void) => {
        if (isEditor || isLocked) return;
        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    const handleSetpointChange = (delta: number) => {
        handleProtectedAction(() => {
            const newSetpoint = state.setpoint + delta;
            updateDeviceState(device.id, { ...state, setpoint: newSetpoint });
        });
    };

    const handleModeChange = () => {
        handleProtectedAction(() => {
            const modes = ['off', 'cool', 'heat'];
            const currentModeIndex = modes.indexOf(state.mode);
            const nextMode = modes[(currentModeIndex + 1) % modes.length] as 'cool' | 'heat' | 'off';
            updateDeviceState(device.id, { ...state, mode: nextMode });
        });
    };

    const isUnavailable = device.isOnline === false;

    const ModeIcon = () => {
        // Active modes glow in their hue (heat orange, cool cyan); off stays flat.
        switch (state.mode) {
            case 'heat': return <IconFlame className="text-orange-400" style={{ ...fluidIcon(1.25), filter: !isUnavailable ? 'drop-shadow(0 0 5px #fb923c)' : undefined }} />;
            case 'cool': return <IconSnowflake className="text-cyan-400" style={{ ...fluidIcon(1.25), filter: !isUnavailable ? 'drop-shadow(0 0 5px #22d3ee)' : undefined }} />;
            default: return <IconPower className="text-gray-400" style={fluidIcon(1.25)} />;
        }
    };
    
    return (
        <TileWrapper
            label={tile.label || ''}
            isActive={isActive}
            accent={accent}
            isUnavailable={device.isOnline === false}
            isProtected={tile.requirePin}
            isLocked={isLocked} 
            isEditor={isEditor} 
            className={cornerClassName}
            batteryLevel={device.battery}
        >
            <div className="flex-1 flex flex-col justify-center items-center w-full">
                <div className="text-gray-300 tabular-nums" style={fluidTextXs}>
                    {state.currentTemp.toFixed(1)}°C
                </div>
                <div className="font-bold tabular-nums text-white" style={fluidText4xl}>
                    {state.setpoint.toFixed(1)}<span className="text-gray-400" style={{ fontSize: '0.5em' }}>°</span>
                </div>
                 <div className="flex items-center justify-center gap-2 w-full px-1">
                    <button onClick={() => handleSetpointChange(-0.5)} className={`p-2 rounded-full hover:bg-gray-600 active:scale-90 transition-transform ${(isEditor || isLocked) ? 'opacity-50 cursor-not-allowed' : ''}`} style={fluidTextLg} disabled={isEditor || isLocked}>-</button>
                    <button onClick={handleModeChange} className={`p-2 rounded-full hover:bg-gray-600 ${(isEditor || isLocked) ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={isEditor || isLocked}>
                        <ModeIcon />
                    </button>
                     <button onClick={() => handleSetpointChange(0.5)} className={`p-2 rounded-full hover:bg-gray-600 active:scale-90 transition-transform ${(isEditor || isLocked) ? 'opacity-50 cursor-not-allowed' : ''}`} style={fluidTextLg} disabled={isEditor || isLocked}>+</button>
                </div>
            </div>
        </TileWrapper>
    );
};

export default ThermostatTile;
