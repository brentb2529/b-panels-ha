
import React from 'react';
import { Device, TileConfig, DeviceType } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconLightbulb, IconLightbulbOff, IconZap, IconShieldAlert, IconLock, IconLockOpen, getIcon, IconDroplets } from '../icons';
import TileWrapper, { TileAccent } from './TileWrapper';
import { fluidIcon, fluidTextXl } from './tileScale';

const SwitchTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { updateDeviceState, requestPin } = useDashboardActions();
    
    const override = tile.displayOverride;
    const rawIsActive = !!device.state;
    const isActive = override?.invertState ? !rawIsActive : rawIsActive;

    // Accent matches the device's on-state color so the active glow lights up
    // in the device's own hue rather than a generic blue.
    let accent: TileAccent = 'light';
    if (override) accent = 'brand';
    else if (device.type === DeviceType.Siren) accent = 'alert';
    else if (device.type === DeviceType.SmartPlug) accent = 'plug';
    else if (device.type === DeviceType.Lock) accent = 'brand';
    else if (device.type === DeviceType.Valve) accent = 'water';

    const handleClick = () => {
        if (isEditor || tile.isLocked) return;
        const action = () => updateDeviceState(device.id, !rawIsActive);
        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    const isUnavailable = device.isOnline === false;

    const renderContent = () => {
        if (override) {
            const iconName = isActive ? override.onIcon || 'CheckCircle' : override.offIcon || 'XCircle';
            const iconColor = isActive ? 'text-green-400' : 'text-red-400';
            const Icon = getIcon(iconName, {
                className: `transition ${iconColor}`,
                style: { ...fluidIcon(2), filter: (isActive && !isUnavailable) ? 'drop-shadow(0 0 6px #34d399)' : undefined },
            });
            const label = isActive ? override.onLabel || 'Active' : override.offLabel || 'Inactive';
            return (
                 <div className="flex-1 flex flex-col justify-center items-center gap-1">
                    {Icon}
                    <p className={`font-bold ${isActive ? 'text-white' : 'text-gray-300'}`} style={fluidTextXl}>
                        {label}
                    </p>
                </div>
            );
        }

        // Default behavior. Lit icons get a soft colored glow matching their
        // state hue; off/idle (or unavailable) stay flat.
        const glow = (color: string) => ({ ...fluidIcon(2), filter: !isUnavailable ? `drop-shadow(0 0 6px ${color})` : undefined });
        const iconProps = {
            className: `transition ${isActive ? 'text-yellow-300' : 'text-gray-400'}`,
            style: isActive ? glow('#fbbf24') : fluidIcon(2),
        };

        let icon;
        if (device.type === DeviceType.Siren) {
            // Siren active = alarming, glows red.
            icon = <IconShieldAlert {...iconProps} className={`transition ${isActive ? 'text-red-400' : 'text-gray-400'}`} style={isActive ? glow('#f87171') : fluidIcon(2)} />;
        } else if (device.type === DeviceType.SmartPlug) {
            // Active plug glows green.
            icon = <IconZap {...iconProps} className={`transition ${isActive ? 'text-green-400' : 'text-gray-400'}`} style={isActive ? glow('#34d399') : fluidIcon(2)} />;
        } else if (device.type === DeviceType.Lock) {
             // isActive = locked (brand blue glow); unlocked = open lock glows red.
             if (isActive) {
                 icon = <IconLock {...iconProps} className={`transition text-brand-blue`} style={glow('#00aaff')} />;
             } else {
                 icon = <IconLockOpen {...iconProps} className={`transition text-red-400`} style={glow('#f87171')} />;
             }
        } else if (device.type === DeviceType.Valve) {
             // Open valve glows water blue.
             const iconColor = isActive ? 'text-blue-400' : 'text-gray-400';
             icon = <IconDroplets {...iconProps} className={`transition ${iconColor}`} style={isActive ? glow('#60a5fa') : fluidIcon(2)} />;
        } else {
            // Lit bulb glows amber.
            icon = isActive ? <IconLightbulb {...iconProps} /> : <IconLightbulbOff {...iconProps} />;
        }

        let statusText = isActive ? 'On' : 'Off';
        if (device.type === DeviceType.Lock) {
            statusText = isActive ? 'Locked' : 'Unlocked';
        } else if (device.type === DeviceType.Valve) {
            statusText = isActive ? 'Open' : 'Closed';
        }

        return (
            <div className="flex-1 flex flex-col justify-center items-center gap-1">
                {icon}
                <p className={`font-bold ${isActive ? 'text-white' : 'text-gray-300'}`} style={fluidTextXl}>
                    {statusText}
                </p>
            </div>
        );
    };

    return (
        <TileWrapper
            label={tile.label || ''}
            isActive={isActive}
            accent={accent}
            isUnavailable={device.isOnline === false}
            isProtected={tile.requirePin}
            isLocked={tile.isLocked}
            onClick={handleClick}
            isEditor={isEditor}
            animation={tile.animation}
            className={cornerClassName}
            batteryLevel={device.battery}
        >
           {renderContent()}
        </TileWrapper>
    );
};

export default SwitchTile;
