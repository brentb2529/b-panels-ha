import React, { useEffect, useMemo, useState } from 'react';
import { Device, DeviceService, TileConfig, ColorTempRange } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconLightbulb } from '../icons';
import TileWrapper from './TileWrapper';
import TileSlider from './TileSlider';
import { fluidIcon, fluidTextXl, fluidTextXs } from './tileScale';

type LutronLightState = {
    level: number;
    isOn: boolean;
    hsColor?: [number, number];
    colorTemp?: number;
    colorTempRange?: ColorTempRange;
    supportsColor: boolean;
    supportsColorTemp: boolean;
    colorHex: string;
};

const hsToHex = (hs: [number, number]) => {
    const [h, s] = hs;
    const l = 0.5;
    const a = (s / 100) * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color)
            .toString(16)
            .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
};

const hexToHs = (hex: string): [number, number] => {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }

    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return [h, Math.round(s * 100)];
};

const DEFAULT_COLOR_TEMP_RANGE: ColorTempRange = { min: 2000, max: 6500 };

const parseLutronState = (device: Device): LutronLightState => {
    const defaultHex = '#ffffff';

    // Read device-level capability hints (now properly typed)
    const supportsColorHint = device.supportsColor;
    const supportsColorTempHint = device.supportsColorTemp;
    const colorTempRangeHint = device.colorTempRange;
    const controlType = device.controlType;
    const controlTypeLower = controlType?.toLowerCase() || '';

    // Determine if this device supports color temperature based on control type
    // ColorTune, WhiteTune, WarmDim all support color temperature
    const isColorTempControlType =
        controlTypeLower.includes('tune') ||
        controlTypeLower.includes('warmdim');

    // Determine if this device supports full RGB color based on control type
    // ColorTune supports BOTH full RGB color AND color temperature
    // WhiteTune/WarmDim support only color temperature (tunable white)
    const isColorControlType =
        controlTypeLower.includes('rgb') ||
        controlTypeLower.includes('color');

    const base: LutronLightState = {
        level: 0,
        isOn: false,
        supportsColor: Boolean(supportsColorHint) || isColorControlType,
        supportsColorTemp: Boolean(supportsColorTempHint) || isColorTempControlType,
        colorHex: defaultHex,
    };

    // Set colorTempRange early if we know this device supports color temperature
    if (base.supportsColorTemp) {
        base.colorTempRange = colorTempRangeHint || DEFAULT_COLOR_TEMP_RANGE;
    }

    const state = device.state;

    if (typeof state === 'number') {
        base.level = state;
        base.isOn = state > 0;
    } else if (state && typeof state === 'object' && !Array.isArray(state)) {
        const obj = state as Record<string, any>;
        base.level = typeof obj.level === 'number' ? obj.level : 0;
        base.isOn = obj.isOn ?? base.level > 0;
        if (Array.isArray(obj.hsColor)) base.hsColor = obj.hsColor as [number, number];
        if (typeof obj.colorTemp === 'number') base.colorTemp = obj.colorTemp;

        // Override colorTempRange from state if available
        if (obj.colorTempRange && typeof obj.colorTempRange === 'object') {
            base.colorTempRange = {
                min: typeof obj.colorTempRange.min === 'number' ? obj.colorTempRange.min : DEFAULT_COLOR_TEMP_RANGE.min,
                max: typeof obj.colorTempRange.max === 'number' ? obj.colorTempRange.max : DEFAULT_COLOR_TEMP_RANGE.max,
            };
        }

        // Merge state-level capability flags
        if (obj.supportsColor) base.supportsColor = true;
        if (obj.supportsColorTemp) {
            base.supportsColorTemp = true;
            // Ensure colorTempRange is set when supportsColorTemp is true
            if (!base.colorTempRange) {
                base.colorTempRange = colorTempRangeHint || DEFAULT_COLOR_TEMP_RANGE;
            }
        }
    }

    // Final fallback: ensure colorTempRange is set if supportsColorTemp is true
    if (base.supportsColorTemp && !base.colorTempRange) {
        base.colorTempRange = colorTempRangeHint || DEFAULT_COLOR_TEMP_RANGE;
    }

    base.colorHex = base.hsColor ? hsToHex(base.hsColor) : base.colorHex;
    return base;
};

// Simple dimmer tile for non-Lutron devices
const SimpleDimmerTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { updateDeviceState, requestPin } = useDashboardActions();
    const [level, setLevel] = useState(device.state as number);
    const isActive = level > 0;
    const isLocked = !!tile.isLocked;

    useEffect(() => {
        setLevel(device.state as number);
    }, [device.state]);

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isEditor || isLocked) return;
        const newLevel = parseInt(e.target.value, 10);
        setLevel(newLevel);
    };

    const handleInteractionEnd = () => {
        if (isEditor || isLocked) return;
        const action = () => updateDeviceState(device.id, level);
        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    const toggleState = (e: React.MouseEvent) => {
        if (isEditor || isLocked) return;
        e.stopPropagation();
        const newLevel = isActive ? 0 : 100;
        const action = () => {
            setLevel(newLevel);
            updateDeviceState(device.id, newLevel);
        };

        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    return (
        <TileWrapper
            label={tile.label || ''}
            isActive={isActive}
            accent="light"
            isUnavailable={device.isOnline === false}
            isProtected={tile.requirePin}
            isLocked={isLocked}
            isEditor={isEditor}
            animation={tile.animation}
            className={cornerClassName}
            batteryLevel={device.battery}
        >
            <div className="w-full h-full flex flex-col">
                <div className="flex-1 flex flex-col justify-center items-center gap-1 w-full" onClick={toggleState}>
                    <IconLightbulb className={`transition ${isActive ? 'text-yellow-300' : 'text-gray-400'}`} style={{ ...fluidIcon(2), filter: (isActive && device.isOnline !== false) ? 'drop-shadow(0 0 6px #fbbf24)' : undefined }} />
                    <p className={`font-bold tabular-nums ${isActive ? 'text-white' : 'text-gray-300'}`} style={fluidTextXl}>{isActive ? `${level}%` : 'Off'}</p>
                </div>
                <div className="w-full px-2 pb-1">
                     <TileSlider
                        value={level}
                        accentColor="rgb(var(--accent-light))"
                        onChange={handleSliderChange}
                        onCommit={handleInteractionEnd}
                        disabled={isEditor || isLocked}
                    />
                </div>
            </div>
        </TileWrapper>
    );
};

// Lutron dimmer tile with color and color temperature support
const LutronDimmerTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { updateDeviceState, requestPin } = useDashboardActions();
    const parsedState = useMemo(() => parseLutronState(device), [device]);

    const [level, setLevel] = useState(parsedState.level);
    const [colorHex, setColorHex] = useState(parsedState.colorHex);
    const [colorTemp, setColorTemp] = useState<number | undefined>(parsedState.colorTemp);
    const isActive = parsedState.isOn ?? level > 0;
    const isLocked = !!tile.isLocked;

    useEffect(() => {
        setLevel(parsedState.level);
        setColorHex(parsedState.colorHex);
        setColorTemp(parsedState.colorTemp);
    }, [parsedState]);

    const buildOutgoingState = (updates: Partial<LutronLightState> = {}) => ({
        level: updates.level ?? level,
        isOn: updates.isOn ?? (updates.level ?? level) > 0,
        hsColor: updates.hsColor ?? parsedState.hsColor,
        colorTemp: updates.colorTemp ?? colorTemp,
        colorTempRange: parsedState.colorTempRange,
        supportsColor: parsedState.supportsColor,
        supportsColorTemp: parsedState.supportsColorTemp,
    });

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isEditor || isLocked) return;
        const newLevel = parseInt(e.target.value, 10);
        setLevel(newLevel);
    };

    const handleInteractionEnd = () => {
        if (isEditor || isLocked) return;
        const action = () => updateDeviceState(device.id, buildOutgoingState({ level, isOn: level > 0 }));
        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    const toggleState = (e: React.MouseEvent) => {
        if (isEditor || isLocked) return;
        e.stopPropagation();
        const newLevel = isActive ? 0 : (level || 100);
        const action = () => {
            setLevel(newLevel);
            updateDeviceState(device.id, buildOutgoingState({ level: newLevel, isOn: !isActive }));
        };

        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isEditor || isLocked) return;
        const nextHex = e.target.value;
        const hsColor = hexToHs(nextHex);
        const desiredLevel = level > 0 ? level : 100;
        setColorHex(nextHex);
        setLevel(desiredLevel);
        updateDeviceState(device.id, buildOutgoingState({ level: desiredLevel, hsColor, isOn: true }));
    };

    const handleColorTempCommit = () => {
        if (isEditor || isLocked || colorTemp === undefined) return;
        const desiredLevel = level > 0 ? level : 100;
        updateDeviceState(device.id, buildOutgoingState({ colorTemp, level: desiredLevel, isOn: true }));
    };

    return (
        <TileWrapper
            label={tile.label || ''}
            isActive={isActive}
            accent="light"
            isUnavailable={device.isOnline === false}
            isProtected={tile.requirePin}
            isLocked={isLocked}
            isEditor={isEditor}
            animation={tile.animation}
            className={cornerClassName}
            batteryLevel={device.battery}
        >
            <div className="w-full h-full flex flex-col gap-1">
                <div className="flex-1 flex flex-col justify-center items-center gap-1 w-full min-h-0" onClick={toggleState}>
                    <IconLightbulb className={`transition ${isActive ? 'text-yellow-300' : 'text-gray-400'}`} style={{ ...fluidIcon(2), filter: (isActive && device.isOnline !== false) ? 'drop-shadow(0 0 6px #fbbf24)' : undefined }} />
                    <p className={`font-bold tabular-nums ${isActive ? 'text-white' : 'text-gray-300'}`} style={fluidTextXl}>{isActive ? `${level}%` : 'Off'}</p>
                </div>
                <div className="w-full px-2 pb-1">
                     <TileSlider
                        value={level}
                        accentColor="rgb(var(--accent-light))"
                        onChange={handleSliderChange}
                        onCommit={handleInteractionEnd}
                        disabled={isEditor || isLocked}
                    />
                </div>
                {parsedState.supportsColor && (
                    <div className="px-2 pb-1 flex items-center gap-2">
                        <input
                            type="color"
                            value={colorHex}
                            onChange={handleColorChange}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isEditor || isLocked}
                            className={`h-8 w-full rounded-control border border-gray-600 bg-transparent p-0 ${(isEditor || isLocked) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        />
                        <span className="text-gray-300 whitespace-nowrap" style={fluidTextXs}>Color</span>
                    </div>
                )}
                {parsedState.supportsColorTemp && parsedState.colorTempRange && (
                    <div className="px-2 pb-1">
                        <div className="flex justify-between text-gray-400 mb-0.5" style={fluidTextXs}>
                            <span>Warm</span>
                            <span className="font-mono tabular-nums">{colorTemp ?? parsedState.colorTempRange.min}K</span>
                            <span>Cool</span>
                        </div>
                        <TileSlider
                            value={colorTemp ?? parsedState.colorTempRange.min}
                            min={parsedState.colorTempRange.min}
                            max={parsedState.colorTempRange.max}
                            accentColor="#f8fafc"
                            trackBackground="linear-gradient(to right, #f59e0b, #ffffff, #7dd3fc)"
                            onChange={(e) => setColorTemp(parseInt(e.target.value, 10))}
                            onCommit={handleColorTempCommit}
                            disabled={isEditor || isLocked}
                        />
                    </div>
                )}
            </div>
        </TileWrapper>
    );
};

// Main DimmerTile component that routes to the appropriate implementation
const DimmerTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const isLutron = device.service === DeviceService.Lutron;

    if (isLutron) {
        return <LutronDimmerTile device={device} tile={tile} isEditor={isEditor} cornerClassName={cornerClassName} />;
    }

    return <SimpleDimmerTile device={device} tile={tile} isEditor={isEditor} cornerClassName={cornerClassName} />;
};

export default DimmerTile;
