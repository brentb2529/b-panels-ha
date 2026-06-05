
import React, { useState, useRef, useEffect } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import { IconAlertOctagon, IconCheckCircle, IconXCircle } from '../icons';
import TileWrapper from './TileWrapper';
import { fluidTextLg, fluidIcon } from './tileScale';

const ARM_DURATION = 3000; // 3 seconds to hold

const PanicTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { triggerPanicAlarm } = useDashboard();
    const [progress, setProgress] = useState(0); // 0 to 1
    const armingTimerRef = useRef<number | null>(null);

    const deviceState = device.state as 'IDLE' | 'TRIGGERED' | 'ERROR';
    const isLocked = !!tile.isLocked;
    const isIdle = deviceState === 'IDLE';
    const isActive = deviceState !== 'IDLE';

    useEffect(() => {
        // If the device state is updated externally (e.g., reset after timeout),
        // ensure local progress is also reset.
        if (deviceState === 'IDLE') {
            setProgress(0);
        }
    }, [deviceState]);


    const startArming = () => {
        if (isEditor || isLocked || !isIdle) return;

        if (armingTimerRef.current) clearInterval(armingTimerRef.current);

        const startTime = Date.now();
        armingTimerRef.current = window.setInterval(() => {
            const elapsed = Date.now() - startTime;
            const currentProgress = Math.min(1, elapsed / ARM_DURATION);
            setProgress(currentProgress);

            if (currentProgress >= 1) {
                if (armingTimerRef.current) clearInterval(armingTimerRef.current);
                triggerPanicAlarm(device.id);
            }
        }, 16); // ~60fps
    };

    const cancelArming = () => {
        if (armingTimerRef.current) {
            clearInterval(armingTimerRef.current);
            armingTimerRef.current = null;
        }
        // Only reset progress if the alarm wasn't fully triggered
        if (progress < 1) {
            setProgress(0);
        }
    };

    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - progress * circumference;

    const renderStateContent = () => {
        switch (deviceState) {
            case 'TRIGGERED':
                return (
                    <>
                        <IconCheckCircle className="text-green-300" style={{ ...fluidIcon(3), filter: 'drop-shadow(0 0 8px #34d399)' }} />
                        <p className="font-black text-white mt-2 uppercase tracking-widest" style={{ ...fluidTextLg, textShadow: '0 1px 3px rgba(0,0,0,0.45)' }}>ALARM SENT</p>
                    </>
                );
            case 'ERROR':
                return (
                    <>
                        <IconXCircle className="text-yellow-200" style={{ ...fluidIcon(3), filter: 'drop-shadow(0 0 8px #facc15)' }} />
                        <p className="font-black text-white mt-2 uppercase tracking-widest" style={{ ...fluidTextLg, textShadow: '0 1px 3px rgba(0,0,0,0.45)' }}>FAILED</p>
                    </>
                );
            case 'IDLE':
            default:
                return (
                    <div
                        className="relative flex items-center justify-center select-none cursor-pointer"
                        style={{ width: 'clamp(5rem, 60cqmin, 8rem)', aspectRatio: '1 / 1' }}
                        onMouseDown={startArming}
                        onMouseUp={cancelArming}
                        onMouseLeave={cancelArming}
                        onTouchStart={startArming}
                        onTouchEnd={cancelArming}
                    >
                        {/* Dimensional pressable disc: domed glass with a red inner
                            glow that intensifies as the hold progresses. */}
                        <div
                            className="absolute rounded-full"
                            style={{
                                inset: '8%',
                                background: `radial-gradient(circle at 38% 30%, color-mix(in srgb, #fca5a5 ${20 + progress * 50}%, transparent), color-mix(in srgb, #ef4444 ${18 + progress * 30}%, transparent) 70%, transparent)`,
                                border: '1px solid rgb(255 255 255 / 0.30)',
                                boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.25), inset 0 -3px 8px rgb(0 0 0 / 0.30), 0 0 ${10 + progress * 26}px ${-4 + progress * 2}px rgba(239,68,68,${0.5 + progress * 0.5})`,
                                transition: progress === 0 ? 'box-shadow 0.2s ease, background 0.2s ease' : undefined,
                            }}
                        />
                        <svg className="absolute w-full h-full" viewBox="0 0 100 100">
                            {/* Track */}
                            <circle cx="50" cy="50" r={radius} stroke="rgba(0, 0, 0, 0.35)" strokeWidth="6" fill="none" />
                            {/* Progress */}
                            <circle
                                cx="50" cy="50" r={radius}
                                stroke="white" strokeWidth="6" strokeLinecap="round" fill="none"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                                transform="rotate(-90 50 50)"
                                style={{ transition: 'stroke-dashoffset 0.05s linear', filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' }}
                            />
                        </svg>
                        <div className="relative text-center">
                            <IconAlertOctagon className="text-white" style={{ ...fluidIcon(2.75), filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.5)) drop-shadow(0 0 ${4 + progress * 6}px rgba(255,255,255,${0.4 + progress * 0.5}))` }} />
                            <p className="font-black uppercase mt-1 tracking-wider text-white" style={{ fontSize: 'clamp(0.5rem, 6cqmin, 0.75rem)', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                                {progress > 0 ? 'HOLDING' : 'HOLD PANIC'}
                            </p>
                        </div>
                    </div>
                );
        }
    };


    return (
        <TileWrapper
            label={tile.label || ''}
            isLocked={isLocked}
            isActive={isActive}
            accent="alert"
            animation={tile.animation}
            // A dimensional red field (deep crimson sheen, top-lit) instead of a
            // flat wash — keeps the bold high-visibility panic color but gives it
            // depth and an inner highlight via Tailwind arbitrary values. The
            // gradient overrides TileWrapper's surface fill; the inset shadows add
            // the bevel.
            className={[
                '!bg-[linear-gradient(160deg,#b91c1c_0%,#7f1d1d_55%,#5b1414_100%)]',
                'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_-4px_10px_rgb(0_0_0/0.30),var(--elev-1)]',
                'border-0',
                !isIdle && !tile.animation?.enabled ? 'animate-pulse' : '',
                cornerClassName || '',
            ].join(' ')}
            isEditor={isEditor}
            batteryLevel={device.battery}
        >
            <div className="flex-1 flex flex-col items-center justify-center text-center">
                {renderStateContent()}
            </div>
        </TileWrapper>
    );
};

export default PanicTile;
