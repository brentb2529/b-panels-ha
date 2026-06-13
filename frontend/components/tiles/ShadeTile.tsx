
import React from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconArrowUp, IconArrowDown } from '../icons';
import { fluidGap, fluidTextXs } from './tileScale';

// Helper to safely get a numeric value from the device state
const getNumericValue = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const parsed = parseFloat(String(val));
    return isNaN(parsed) ? 0 : parsed;
};

const ShadeTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { updateDeviceState, requestPin } = useDashboardActions();
    const level = getNumericValue(device.state);
    const isLocked = !!tile.isLocked;

    // TILT (additive): only covers that advertise the `tilt` capability render a
    // tilt control; position-only covers are completely unchanged. The tilt
    // value lives in capabilityData (state stays the position number).
    const supportsTilt = Array.isArray(device.capabilities) && device.capabilities.includes('tilt');
    const tiltLevel = getNumericValue(device.capabilityData?.tiltPosition);

    // Local drag value so the slider tracks the finger smoothly and only
    // commits on release (avoids flooding HA with set_cover_tilt_position).
    const [tiltDrag, setTiltDrag] = React.useState<number | null>(null);
    const tiltDisplay = tiltDrag ?? Math.round(tiltLevel);

    const handleUpdate = (newLevel: number) => {
        if (isEditor || isLocked) return;

        // Clamp the value between 0 and 100
        const clampedLevel = Math.max(0, Math.min(100, newLevel));
        const action = () => updateDeviceState(device.id, clampedLevel);

        if (tile.requirePin) {
            requestPin(action);
        } else {
            action();
        }
    };

    const handleTilt = (newTilt: number) => {
        if (isEditor || isLocked) return;
        const clamped = Math.max(0, Math.min(100, Math.round(newTilt)));
        const action = () => updateDeviceState(device.id, { tilt: clamped });
        if (tile.requirePin) requestPin(action);
        else action();
    };

    const getStatusText = () => {
        const roundedLevel = Math.round(level);
        if (roundedLevel >= 98) return 'Open';
        if (roundedLevel <= 2) return 'Closed';
        return `${roundedLevel}%`;
    };

    const statusText = getStatusText();
    
    // State checks for active styling
    const isFullyOpen = Math.round(level) >= 98;
    const isFullyClosed = Math.round(level) <= 2;
    const isAt50 = Math.round(level) >= 45 && Math.round(level) <= 55;

    // Base styles for the control grid buttons
    const btnBase = "flex items-center justify-center rounded-control font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed w-full h-full";
    const btnInactive = "bg-gray-600 text-gray-200 hover:bg-gray-500 hover:text-white";
    const btnActive = "bg-brand-blue text-white shadow-[0_0_10px_rgba(0,170,255,0.4)]";
    
    // Separate styles for Nudge buttons (usually smaller or visually distinct)
    const btnNudge = "bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white";

    return (
        <TileWrapper
            label={tile.label || device.name}
            isActive={level > 0}
            accent="brand"
            isUnavailable={device.isOnline === false}
            isProtected={tile.requirePin}
            isLocked={isLocked}
            isEditor={isEditor}
            animation={tile.animation}
            className={cornerClassName}
            batteryLevel={device.battery}
            batteryPosition="bottom"
        >
            <div className="flex w-full h-full p-1" style={fluidGap(0.5)}>
                
                {/* LEFT: Visualizer (40% width) */}
                <div 
                    className="w-2/5 h-full relative bg-gray-800 rounded-control overflow-hidden border border-gray-600 cursor-pointer group"
                    onClick={() => handleUpdate(level > 50 ? 0 : 100)}
                    title="Tap to Toggle Open/Close"
                >
                    {/* Window Glass / Sky Background */}
                    <div className="absolute inset-1 bg-gradient-to-b from-sky-400 to-sky-200 opacity-20 rounded-sm" />
                    
                    {/* The Shade itself */}
                    <div 
                        className="absolute top-1 left-1 right-1 bg-gray-500 transition-all duration-500 ease-in-out border-b-4 border-gray-400 shadow-lg z-10"
                        style={{ 
                            height: `${100 - level}%`,
                            maxHeight: 'calc(100% - 8px)' // Prevent overlapping bottom padding
                        }}
                    >
                         {/* Texture lines on shade */}
                         <div className="w-full h-full opacity-10 bg-[repeating-linear-gradient(0deg,transparent,transparent_9px,#000_10px)]" />
                    </div>

                    {/* Status Text Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center z-20">
                        <span className="bg-black/60 px-1.5 py-0.5 rounded text-white text-xs font-bold backdrop-blur-sm pointer-events-none tabular-nums">
                            {statusText}
                        </span>
                    </div>
                </div>

                {/* RIGHT: Control Grid (60% width) */}
                <div className="w-3/5 h-full flex flex-col gap-1">
                  <div className="flex-1 grid grid-cols-2 grid-rows-3 gap-1 min-h-0">

                    {/* Row 1: Open & Up */}
                    <button
                        onClick={() => handleUpdate(100)}
                        disabled={isEditor || isLocked}
                        className={`${btnBase} ${isFullyOpen ? btnActive : btnInactive}`}
                        style={fluidTextXs}
                        title="Open Fully"
                    >
                        Open
                    </button>
                    <button
                        onClick={() => handleUpdate(level + 10)}
                        disabled={isEditor || isLocked || level >= 100}
                        className={`${btnBase} ${btnNudge}`}
                        title="Raise (10%)"
                    >
                        <IconArrowUp className="w-4 h-4" />
                    </button>

                    {/* Row 2: 50% (Col 1) & Spacer (Col 2) */}
                    <button
                        onClick={() => handleUpdate(50)}
                        disabled={isEditor || isLocked}
                        className={`${btnBase} ${isAt50 ? btnActive : btnInactive}`}
                        style={fluidTextXs}
                        title="Move to 50%"
                    >
                        50%
                    </button>
                    <div /> {/* Empty spacer for layout alignment */}

                    {/* Row 3: Close & Down */}
                    <button
                        onClick={() => handleUpdate(0)}
                        disabled={isEditor || isLocked}
                        className={`${btnBase} ${isFullyClosed ? btnActive : btnInactive}`}
                        style={fluidTextXs}
                        title="Close Fully"
                    >
                        Close
                    </button>
                    <button
                        onClick={() => handleUpdate(level - 10)}
                        disabled={isEditor || isLocked || level <= 0}
                        className={`${btnBase} ${btnNudge}`}
                        title="Lower (10%)"
                    >
                        <IconArrowDown className="w-4 h-4" />
                    </button>

                  </div>

                  {/* TILT (additive): only for covers advertising the `tilt`
                      capability. Slats slider — does not affect the position
                      visualizer/controls above. */}
                  {supportsTilt && (
                    <div
                        className="shrink-0 flex items-center gap-1.5 px-0.5"
                        data-testid="shade-tilt"
                        title="Tilt slats"
                    >
                        <span className="text-gray-400 tabular-nums" style={fluidTextXs}>Tilt</span>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={tiltDisplay}
                            disabled={isEditor || isLocked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setTiltDrag(Number(e.target.value))}
                            onMouseUp={() => { if (tiltDrag !== null) { handleTilt(tiltDrag); setTiltDrag(null); } }}
                            onTouchEnd={() => { if (tiltDrag !== null) { handleTilt(tiltDrag); setTiltDrag(null); } }}
                            aria-label={`${tile.label || device.name} tilt`}
                            className={`tp-range flex-1 ${(isEditor || isLocked) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        />
                        <span className="text-gray-300 tabular-nums w-7 text-right" style={fluidTextXs}>{tiltDisplay}%</span>
                    </div>
                  )}
                </div>
            </div>
        </TileWrapper>
    );
};

export default ShadeTile;
