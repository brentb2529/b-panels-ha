import React, { useState, useEffect } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import * as haClient from '../../services/haClient';
import { IconMusic, IconPlay, IconPause, IconSkipBack, IconSkipForward, IconVolume2 } from '../icons';
import TileWrapper from './TileWrapper';
import { fluidIcon, fluidTextSm, fluidTextBase, fluidTextXs, fluidGap } from './tileScale';

interface SonosPlayerTileProps {
    device: Device;
    tile: TileConfig;
    onEnlarge?: (device: Device) => void;
    isEditor?: boolean;
    cornerClassName?: string;
}

// Media-player tile (Sonos and any HA media_player speaker). Original B-Panels
// design: album art + track + transport + volume. Commands route to HA
// media_player services; album art uses HA's media_player_proxy URL (relative,
// same-origin in the panel).
const SonosPlayerTile = ({ device, tile, onEnlarge, isEditor, cornerClassName }: SonosPlayerTileProps) => {
    const { requestPin } = useDashboardActions();

    const state = device.state as any;
    const isPlaying = state.playbackState === 'PLAYING';
    const isLocked = !!tile.isLocked;

    const [localVolume, setLocalVolume] = useState(state.volume || 0);
    useEffect(() => { setLocalVolume(state.volume || 0); }, [state.volume]);

    const handleClick = () => {
        if (!isEditor && !isLocked && onEnlarge) onEnlarge(device);
    };

    const sendCommand = async (command: 'play' | 'pause' | 'next' | 'previous' | 'volume', value?: number) => {
        const svc = command === 'play' ? 'media_play'
            : command === 'pause' ? 'media_pause'
            : command === 'next' ? 'media_next_track'
            : command === 'previous' ? 'media_previous_track'
            : 'volume_set';
        const data: Record<string, any> = { entity_id: device.id };
        if (command === 'volume') data.volume_level = Math.min(1, Math.max(0, (value ?? 0) / 100));
        await haClient.callService('media_player', svc, data);
    };

    const handleTransport = (e: React.MouseEvent, command: 'play' | 'pause' | 'next' | 'previous') => {
        e.stopPropagation();
        if (isEditor || isLocked) return;
        const action = () => sendCommand(command);
        if (tile.requirePin) requestPin(action); else action();
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (isEditor || isLocked) return;
        setLocalVolume(parseInt(e.target.value, 10));
    };

    const handleVolumeSet = (e: React.MouseEvent | React.TouchEvent) => {
        e.stopPropagation();
        if (isEditor || isLocked) return;
        const action = () => sendCommand('volume', localVolume);
        if (tile.requirePin) requestPin(action); else action();
    };

    const track = state.currentTrack;
    const hasTrack = track && track.title;
    const albumArtUrl = track?.albumArtURI; // HA media_player_proxy URL (relative, same-origin)

    return (
        <TileWrapper
            label={tile.label || ''}
            isProtected={tile.requirePin}
            isLocked={isLocked}
            isEditor={isEditor}
            isActive={isPlaying}
            isUnavailable={device.isOnline === false}
            onClick={handleClick}
            className={cornerClassName}
        >
             <div className="w-full h-full flex flex-col justify-between p-1" style={fluidGap(0.5)}>
                <div className="flex-1 flex items-center min-h-0 gap-2">
                    <div
                        className="relative shrink-0 overflow-hidden rounded-control"
                        style={{
                            width: 'clamp(2.75rem, 30cqmin, 5rem)',
                            aspectRatio: '1 / 1',
                            background: 'radial-gradient(circle at 35% 28%, #2a3340, #11151c 75%)',
                            boxShadow: isPlaying
                                ? 'inset 0 1px 0 rgb(255 255 255 / 0.18), 0 4px 12px -2px rgb(0 0 0 / 0.6), 0 0 18px -2px rgb(var(--accent))'
                                : 'inset 0 1px 0 rgb(255 255 255 / 0.14), inset 0 -2px 6px rgb(0 0 0 / 0.4), 0 4px 10px -3px rgb(0 0 0 / 0.55)',
                            border: '1px solid rgb(255 255 255 / 0.12)',
                        }}
                    >
                        {hasTrack && albumArtUrl ? (
                            <img src={albumArtUrl} alt={track.title} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <IconMusic className="text-gray-400" style={fluidIcon(2.25)} />
                            </div>
                        )}
                        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg, rgb(255 255 255 / 0.16), transparent 45%)' }} />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                        <p className="font-bold text-white truncate leading-tight" style={fluidTextBase} title={track?.title || 'No track playing'}>{track?.title || 'No track playing'}</p>
                        <p className="text-gray-300 truncate leading-tight" style={fluidTextSm} title={track?.artist}>{track?.artist || '—'}</p>
                    </div>
                </div>

                <div className="w-full">
                    <div className="flex justify-center items-center" style={fluidGap(0.75)}>
                        <button onClick={(e) => handleTransport(e, 'previous')} disabled={isEditor || isLocked} className="text-gray-200 p-2 rounded-full hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"><IconSkipBack style={fluidIcon(1.15)} /></button>
                        <button
                            onClick={(e) => handleTransport(e, isPlaying ? 'pause' : 'play')}
                            disabled={isEditor || isLocked}
                            className="relative flex items-center justify-center rounded-full text-white disabled:opacity-50 transition-transform active:scale-95"
                            style={{
                                width: 'clamp(2rem, 18cqmin, 3rem)',
                                aspectRatio: '1 / 1',
                                background: isPlaying
                                    ? 'radial-gradient(circle at 38% 30%, color-mix(in srgb, rgb(var(--accent)) 70%, white 0%), color-mix(in srgb, rgb(var(--accent)) 30%, transparent) 72%, transparent)'
                                    : 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.16), rgb(255 255 255 / 0.04) 70%, transparent)',
                                border: `1px solid ${isPlaying ? 'rgb(var(--accent) / 0.75)' : 'rgb(255 255 255 / 0.16)'}`,
                                boxShadow: isPlaying
                                    ? 'inset 0 1px 0 rgb(255 255 255 / 0.22), 0 0 18px -2px rgb(var(--accent))'
                                    : 'inset 0 1px 0 rgb(255 255 255 / 0.16), inset 0 -2px 6px rgb(0 0 0 / 0.3)',
                            }}
                        >
                            {isPlaying ? <IconPause style={fluidIcon(1.5)} /> : <IconPlay style={fluidIcon(1.5)} />}
                        </button>
                        <button onClick={(e) => handleTransport(e, 'next')} disabled={isEditor || isLocked} className="text-gray-200 p-2 rounded-full hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"><IconSkipForward style={fluidIcon(1.15)} /></button>
                    </div>
                    <div className="flex items-center gap-2 px-1 mt-1">
                        <IconVolume2 className="text-gray-400 shrink-0" style={fluidIcon(1)} />
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={localVolume}
                            onClick={(e) => e.stopPropagation()}
                            onChange={handleVolumeChange}
                            onMouseUp={handleVolumeSet}
                            onTouchEnd={handleVolumeSet}
                            disabled={isEditor || isLocked}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-blue bg-black/40 disabled:opacity-50"
                            style={{ boxShadow: 'inset 0 1px 2px rgb(0 0 0 / 0.5)' }}
                        />
                        <span className="w-9 text-right tabular-nums text-gray-300 shrink-0" style={fluidTextXs}>{localVolume}%</span>
                    </div>
                </div>
            </div>
        </TileWrapper>
    );
};

export default SonosPlayerTile;
