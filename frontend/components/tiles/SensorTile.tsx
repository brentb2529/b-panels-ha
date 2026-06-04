


import React from 'react';
import { Device, TileConfig, DeviceType } from '../../types';
import { IconThermometer, IconPersonStanding, IconDoorOpen, IconDoorClosed, IconDroplets, IconFlame, IconAlertTriangle } from '../icons';
import TileWrapper, { TileAccent } from './TileWrapper';
import { fluidIcon, fluidTextXs, fluidTextXl, fluidText2xl, fluidGap } from './tileScale';

// A dimensional disc behind the sensor icon: a soft glass puck when idle, and a
// glowing, accent-tinted halo when the sensor is triggered. Turns each sensor's
// glyph into a real focal point instead of a dim icon floating in space.
const SensorHalo = ({ color, active, children }: { color: string; active: boolean; children: React.ReactNode }) => (
    <div
        className="relative flex items-center justify-center rounded-full"
        style={{
            width: 'clamp(2.75rem, 38cqmin, 5.5rem)',
            aspectRatio: '1 / 1',
            background: active
                ? `radial-gradient(circle at 38% 30%, color-mix(in srgb, ${color} 55%, transparent), color-mix(in srgb, ${color} 16%, transparent) 68%, transparent)`
                : 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.10), rgb(255 255 255 / 0.02) 70%, transparent)',
            border: `1px solid ${active ? `color-mix(in srgb, ${color} 55%, transparent)` : 'rgb(255 255 255 / 0.10)'}`,
            boxShadow: active
                ? `inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 24px -4px ${color}`
                : 'inset 0 1px 0 rgb(255 255 255 / 0.10), inset 0 -2px 6px rgb(0 0 0 / 0.22)',
            transition: 'background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
        }}
    >
        {children}
    </div>
);

const SensorTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {

    const isUnavailable = device.isOnline === false;
    // Soft colored glow on the icon itself when triggered; flat when idle/offline.
    const glow = (on: boolean, color: string) => ({ filter: (on && !isUnavailable) ? `drop-shadow(0 0 5px ${color})` : undefined });
    const iconSize = fluidIcon(1.7);

    const renderContent = () => {
        switch (device.type) {
            case DeviceType.TemperatureSensor:
                const temp = Number(device.state).toFixed(1);
                return (
                    <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
                        <SensorHalo color="#fb923c" active={false}>
                            <IconThermometer className="text-orange-300" style={iconSize} />
                        </SensorHalo>
                        <p className="font-bold tabular-nums text-white" style={fluidText2xl}>{temp}°C</p>
                    </div>
                );
            case DeviceType.MotionSensor:
            case DeviceType.OccupancySensor:
                const isOccupied = !!device.state;
                const text = device.type === DeviceType.MotionSensor ? (isOccupied ? 'Motion' : 'Clear') : (isOccupied ? 'Occupied' : 'Clear');
                return (
                    <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
                        <SensorHalo color="#34d399" active={isOccupied && !isUnavailable}>
                            <IconPersonStanding className={`transition ${isOccupied ? 'text-green-300' : 'text-gray-400'}`} style={{ ...iconSize, ...glow(isOccupied, '#34d399') }} />
                        </SensorHalo>
                        <p className={`font-bold ${isOccupied ? 'text-white' : 'text-gray-300'}`} style={fluidTextXl}>{text}</p>
                    </div>
                );
            case DeviceType.ContactSensor:
                 const isOpen = !!device.state;
                 return (
                    <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
                        <SensorHalo color="#facc15" active={isOpen && !isUnavailable}>
                            {isOpen
                                ? <IconDoorOpen className="text-yellow-300" style={{ ...iconSize, ...glow(true, '#facc15') }} />
                                : <IconDoorClosed className="text-gray-400" style={iconSize} />}
                        </SensorHalo>
                        <p className={`font-bold ${isOpen ? 'text-white' : 'text-gray-300'}`} style={fluidTextXl}>{isOpen ? 'Open' : 'Closed'}</p>
                    </div>
                 );
            case DeviceType.WaterSensor:
                 const state = device.state as { leak: boolean, temperature?: number };
                 const isWet = state.leak;
                 return (
                    <div className="flex flex-col items-center justify-center" style={fluidGap(0.5)}>
                        <SensorHalo color="#38bdf8" active={isWet && !isUnavailable}>
                            <IconDroplets
                                className={isWet ? 'animate-bounce' : ''}
                                style={{ ...iconSize, color: isWet ? '#38bdf8' : '#7dd3fc', ...glow(isWet, '#38bdf8') }}
                            />
                        </SensorHalo>
                        <p className={`font-bold ${isWet ? 'text-sky-300' : 'text-white'}`} style={fluidTextXl}>{isWet ? 'WET' : 'Dry'}</p>
                        {state.temperature !== undefined && state.temperature !== null && (
                            <p className="text-gray-400 tabular-nums" style={fluidTextXs}>{state.temperature}°</p>
                        )}
                    </div>
                 );
            case DeviceType.SmokeDetector:
                const isSmoke = !!device.state;
                return (
                    <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
                        <SensorHalo color="#ef4444" active={isSmoke && !isUnavailable}>
                            <IconFlame className={`transition ${isSmoke ? 'text-red-400 animate-pulse' : 'text-gray-400'}`} style={{ ...iconSize, ...glow(isSmoke, '#ef4444') }} />
                        </SensorHalo>
                        <p className={`font-bold ${isSmoke ? 'text-red-400' : 'text-white'}`} style={fluidTextXl}>{isSmoke ? 'SMOKE' : 'Clear'}</p>
                    </div>
                );
            case DeviceType.CarbonMonoxideDetector:
                const isCO = !!device.state;
                return (
                    <div className="flex flex-col items-center justify-center" style={fluidGap(0.6)}>
                        <SensorHalo color="#f97316" active={isCO && !isUnavailable}>
                            <IconAlertTriangle className={`transition ${isCO ? 'text-orange-400 animate-pulse' : 'text-gray-400'}`} style={{ ...iconSize, ...glow(isCO, '#f97316') }} />
                        </SensorHalo>
                        <p className={`font-bold ${isCO ? 'text-orange-400' : 'text-white'}`} style={fluidTextXl}>{isCO ? 'CO' : 'Clear'}</p>
                    </div>
                );
            default:
                return <p>{String(device.state)}</p>
        }
    }
    
    const isActive = device.type === DeviceType.WaterSensor
        ? (device.state as any).leak
        : (device.type !== DeviceType.TemperatureSensor ? !!device.state : false);

    // Accent reflects the sensor's semantic meaning so the active glow lights up
    // in the device's own hue rather than a generic blue.
    let accent: TileAccent = 'brand';
    switch (device.type) {
        case DeviceType.TemperatureSensor: accent = 'warn'; break;
        case DeviceType.MotionSensor:
        case DeviceType.OccupancySensor: accent = 'plug'; break;
        case DeviceType.ContactSensor: accent = 'warn'; break;
        case DeviceType.WaterSensor: accent = 'water'; break;
        case DeviceType.SmokeDetector: accent = 'alert'; break;
        case DeviceType.CarbonMonoxideDetector: accent = 'alert'; break;
    }

    return (
        <TileWrapper
            label={tile.label || ''}
            isActive={isActive}
            accent={accent}
            isUnavailable={device.isOnline === false}
            isLocked={tile.isLocked}
            isEditor={isEditor} 
            animation={tile.animation} 
            className={cornerClassName}
            batteryLevel={device.battery}
        >
            {renderContent()}
        </TileWrapper>
    );
};

export default SensorTile;