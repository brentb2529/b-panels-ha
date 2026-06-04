import React, { useState, useEffect } from 'react';
import { Device, TileConfig } from '../../types';
import TileWrapper from './TileWrapper'; // Import TileWrapper
import { IconRefreshCw, IconLink } from '../icons';
import { fluidIcon, fluidTextXs } from './tileScale';

const WebFrameTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    // Robust backward compatibility: state can be a string (old) or an object (new)
    const url = typeof device.state === 'string'
        ? device.state
        : (device.state && typeof device.state === 'object' && (device.state as any).url) || null;

    const refresh = (device.state && typeof device.state === 'object' && (device.state as any).refresh) || 900; // Default to 15 mins if not set

    const [iframeKey, setIframeKey] = useState(Date.now());
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (isEditor) return; // Do not refresh in editor mode

        if (refresh && refresh > 0) {
            const interval = setInterval(() => {
                setIsLoaded(false);
                setIframeKey(Date.now());
            }, refresh * 1000);
            return () => clearInterval(interval);
        }
    }, [refresh, isEditor]);

    return (
        <TileWrapper label="" isLocked={tile.isLocked} isEditor={isEditor} className={`!bg-black ${cornerClassName || ''}`}>
            <div className="w-full flex-1 relative">
                {url ? (
                    <iframe
                        key={iframeKey}
                        title={tile.label || device.name}
                        src={url}
                        onLoad={() => setIsLoaded(true)}
                        className="w-full h-full border-0 rounded-control absolute inset-0"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-gray-300" style={{ background: 'radial-gradient(circle at 50% 45%, rgb(0 0 0 / 0.4), rgb(0 0 0 / 0.7))' }}>
                        <IconLink style={fluidIcon(2)} />
                        <p className="font-semibold" style={fluidTextXs}>No URL configured</p>
                    </div>
                )}

                {/* Crisp, dimensional loading overlay until the frame paints */}
                {url && !isLoaded && (
                    <div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 z-10 pointer-events-none"
                        style={{ background: 'radial-gradient(circle at 50% 45%, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.75))' }}
                    >
                        <div
                            className="flex items-center justify-center rounded-full"
                            style={{
                                width: 'clamp(2.25rem, 30cqmin, 4rem)',
                                aspectRatio: '1 / 1',
                                background: 'radial-gradient(circle at 38% 30%, rgb(59 130 246 / 0.30), rgb(59 130 246 / 0.06) 70%, transparent)',
                                border: '1px solid rgb(59 130 246 / 0.5)',
                                boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 18px -4px #3b82f6',
                            }}
                        >
                            <IconRefreshCw className="text-blue-300 animate-spin" style={fluidIcon(1.75)} />
                        </div>
                        <p className="font-semibold text-blue-200" style={{ ...fluidTextXs, textShadow: '0 1px 2px rgb(0 0 0 / 0.8)' }}>Loading…</p>
                    </div>
                )}

                {/* Name label over a readable bottom scrim */}
                {tile.label && (
                    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none px-2 pb-1.5 pt-5" style={{ background: 'linear-gradient(to top, rgb(0 0 0 / 0.7), transparent)' }}>
                        <span className="text-white font-semibold truncate block" style={{ ...fluidTextXs, textShadow: '0 1px 3px rgb(0 0 0 / 0.9)' }}>{tile.label}</span>
                    </div>
                )}
            </div>
        </TileWrapper>
    );
};

export default WebFrameTile;
