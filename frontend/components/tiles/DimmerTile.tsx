import React, { useEffect, useMemo, useState } from 'react';
import { Device, DeviceService, TileConfig, ColorTempRange } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import { IconLightbulb } from '../icons';
import TileWrapper from './TileWrapper';
import TileSlider from './TileSlider';
import { fluidIcon, fluidTextXl, fluidTextXs } from './tileScale';
import { kelvinToHex } from '../LightControlModal';

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
    // `device.state` is a plain number for brightness-only lights, but be
    // defensive: a colour-capable light carries an object, and mis-routing it
    // here used to render NaN%.
    const readLevel = (st: Device['state']): number => {
        if (typeof st === 'number') return st;
        if (st && typeof st === 'object' && !Array.isArray(st)) {
            const lvl = (st as Record<string, any>).level;
            return typeof lvl === 'number' ? lvl : 0;
        }
        return st ? 100 : 0;
    };
    const [level, setLevel] = useState(readLevel(device.state));
    const isActive = level > 0;
    const isLocked = !!tile.isLocked;

    useEffect(() => {
        setLevel(readLevel(device.state));
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
const LutronDimmerTile = ({ device, tile, isEditor, cornerClassName, onEnlarge }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string; onEnlarge?: (device: Device) => void }) => {
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

    // Show what the light is actually doing: its colour when in colour mode,
    // otherwise the rendered colour of its current temperature.
    const swatchHex = parsedState.hsColor
        ? colorHex
        : (colorTemp !== undefined ? kelvinToHex(colorTemp) : colorHex);

    // Colour and colour-temperature are mutually exclusive on the wire: a light
    // is in `hs` mode or `color_temp` mode, never both, and the service layer
    // prefers hsColor when it is present. So only ever carry the one the caller
    // is actually setting — a brightness change or a toggle carries neither and
    // lets the light keep whatever colour it already has. Passing both is what
    // made the temperature slider silently do nothing on a light that was in
    // colour mode.
    const buildOutgoingState = (updates: Partial<LutronLightState> = {}) => {
        const out: Record<string, any> = {
            level: updates.level ?? level,
            isOn: updates.isOn ?? (updates.level ?? level) > 0,
            colorTempRange: parsedState.colorTempRange,
            supportsColor: parsedState.supportsColor,
            supportsColorTemp: parsedState.supportsColorTemp,
        };
        if (updates.hsColor !== undefined) {
            out.hsColor = updates.hsColor;
            out.colorTemp = undefined;
        } else if (updates.colorTemp !== undefined) {
            out.colorTemp = updates.colorTemp;
            out.hsColor = undefined;
        }
        return out;
    };

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
                {/* One control, not three: a 1x1 tile cannot hold icon + brightness
                    + colour + a colour-temperature slider without clipping the
                    readout. The swatch opens the full picker (preset whites, fine
                    colour temperature, arbitrary colour) instead. */}
                {(parsedState.supportsColor || parsedState.supportsColorTemp) && (
                    <div className="px-2 pb-1">
                        <button
                            onClick={(e) => { e.stopPropagation(); if (!isEditor && !isLocked) onEnlarge?.(device); }}
                            disabled={isEditor || isLocked}
                            className={`w-full h-8 rounded-control border border-gray-600 flex items-center justify-center gap-2 ${(isEditor || isLocked) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-gray-400'}`}
                        >
                            <span className="w-4 h-4 rounded-full border border-black/40 shrink-0" style={{ backgroundColor: swatchHex }} />
                            <span className="text-gray-300 whitespace-nowrap" style={fluidTextXs}>Colors</span>
                        </button>
                    </div>
                )}
            </div>
        </TileWrapper>
    );
};

// Route on CAPABILITY, not on which integration the device came from.
//
// This used to be `device.service === DeviceService.Lutron`, which meant every
// colour-capable Home Assistant light fell through to SimpleDimmerTile. Those
// lights carry a rich object state, so the simple tile read `device.state as
// number` on an object and showed a bare brightness slider with no colour
// control at all. Any integration that reports colour support now gets the
// full tile.
const DimmerTile = ({ device, tile, isEditor, cornerClassName, onEnlarge }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string; onEnlarge?: (device: Device) => void }) => {
    const st = device.state;
    const stateHasColor =
        st && typeof st === 'object' && !Array.isArray(st)
            ? Boolean((st as Record<string, any>).supportsColor || (st as Record<string, any>).supportsColorTemp)
            : false;
    const isColorCapable =
        Boolean(device.supportsColor) ||
        Boolean(device.supportsColorTemp) ||
        stateHasColor ||
        device.service === DeviceService.Lutron;

    if (isColorCapable) {
        return <LutronDimmerTile device={device} tile={tile} isEditor={isEditor} cornerClassName={cornerClassName} onEnlarge={onEnlarge} />;
    }

    return <SimpleDimmerTile device={device} tile={tile} isEditor={isEditor} cornerClassName={cornerClassName} />;
};

export default DimmerTile;
