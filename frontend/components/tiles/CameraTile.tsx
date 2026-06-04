import React, { useEffect, useRef, useState } from 'react';
import { Device, TileConfig, DeviceService } from '../../types';
import UnknownTile from './UnknownTile';
import { IconShieldAlert, IconExpand, IconRefreshCw } from '../icons';
import TileWrapper from './TileWrapper';
import { useDashboard } from '../../hooks/useDashboard';
import * as haClient from '../../services/haClient';
import { fluidIcon, fluidTextXs } from './tileScale';

declare const Hls: any;

interface CameraTileProps {
    device: Device;
    tile: TileConfig;
    onEnlarge?: (device: Device) => void;
    isEditor?: boolean;
    cornerClassName?: string;
}

const CameraTile = ({ device, tile, onEnlarge, isEditor, cornerClassName }: CameraTileProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(Date.now());
    // Ref so the startup-timeout closure sees the latest "has the stream
    // actually started" value rather than a stale isLoading snapshot. Before
    // this fix, tiles frequently showed "Stream timed out" over a stream that
    // was genuinely playing — the timer fired a hair before MANIFEST_PARSED
    // finished and the stale closure overrode the success path.
    const hasStartedRef = useRef(false);
    const { connections } = useDashboard();
    
    // Robust backward compatibility: state can be a string, or an object with 'rtspStreamUrl' or legacy 'url'
    const rtspStreamUrl = typeof device.state === 'string' 
        ? device.state 
        : (device.state && typeof device.state === 'object') 
            ? ((device.state as any).rtspStreamUrl || (device.state as any).url) 
            : null;

    const isLocked = !!tile.isLocked;
    // Home Assistant `camera` entities resolve their stream via HA directly.
    const isHaCamera = device.service === DeviceService.HomeAssistant;

    const [hlsUrl, setHlsUrl] = useState<string | null>(null);

    useEffect(() => {
        // HA camera: ask HA's stream component for a live HLS URL (re-fetched on
        // reload since the token is short-lived). No relay involved.
        if (isHaCamera) {
            let cancelled = false;
            setHlsUrl(null);
            haClient.getCameraStreamUrl(device.id)
                .then(url => {
                    if (cancelled) return;
                    if (url) { setHlsUrl(url); }
                    else { setError('No stream available for this camera.'); setIsLoading(false); }
                })
                .catch(err => {
                    if (cancelled) return;
                    console.warn(`[Camera] HA stream failed for ${device.id}:`, err);
                    setError('Stream unavailable.');
                    setIsLoading(false);
                });
            return () => { cancelled = true; };
        }

        // Legacy RTSP relay path (non-HA cameras).
        const rtspConnection = connections.find(c => c.id === DeviceService.RTSP && c.enabled);
        if (rtspConnection && rtspConnection.cloudEndpoint && rtspStreamUrl) {
            try {
                const relayUrl = rtspConnection.cloudEndpoint.replace(/\/+$/, '');
                const pathKey = device.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
                const generatedHlsUrl = `${relayUrl}/cam-${pathKey}/index.m3u8`;
                setHlsUrl(generatedHlsUrl);
            } catch (e) {
                console.error("Invalid RTSP URL:", rtspStreamUrl, e);
                setError("Invalid RTSP URL format.");
                setHlsUrl(null);
            }
        } else {
             setHlsUrl((device.state as any)?.streamUrl || rtspStreamUrl);
        }
    }, [isHaCamera, device.id, connections, rtspStreamUrl, device.name, device.state, reloadKey]);


    const canEnlarge = !isEditor && !isLocked && tile.cameraEnlargeOnClick && onEnlarge;

    const handleClick = () => {
        if (canEnlarge) {
            onEnlarge(device);
        }
    };
    
    const handleReload = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setError(null);
        setIsLoading(true);
        setReloadKey(Date.now());
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !hlsUrl) return;

        if (isEditor) {
            video.src = '';
            setError('Stream preview disabled in editor mode.');
            setIsLoading(false);
            return;
        }

        setError(null);
        setIsLoading(true);
        hasStartedRef.current = false;

        let hls: any;
        let initialErrorTimeout: ReturnType<typeof setTimeout>;

        const markStarted = () => {
            hasStartedRef.current = true;
            clearTimeout(initialErrorTimeout);
            setError(null);
            setIsLoading(false);
        };

        // Native video `playing` event = stream is genuinely live. This is the
        // safety net for the stale-timeout case: even if the timer fired and
        // stamped "Stream timed out" moments before the first frame rendered,
        // `playing` clears the error as soon as the video actually plays.
        const onPlaying = () => markStarted();
        video.addEventListener('playing', onPlaying);

        const onCanPlay = () => {
            markStarted();
            video.play().catch(() => {});
            video.removeEventListener('canplay', onCanPlay);
        };

        const initPlayer = () => {
            if (Hls.isSupported()) {
                hls = new Hls({
                    lowLatencyMode: true,
                    backBufferLength: 90,
                    manifestLoadRetry: 5,
                    manifestLoadRetryDelay: 1000,
                    fragLoadRetry: 5,
                    fragLoadRetryDelay: 1000,
                });

                hls.loadSource(hlsUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    markStarted();
                    video.play().catch(() => {});
                });

                hls.on(Hls.Events.ERROR, (event: any, data: any) => {
                    if (data.fatal) {
                        console.warn(`HLS fatal error for ${device.name}:`, data.details);
                        setError(`Stream Error: ${data.details}`);
                        setIsLoading(false);
                        hls.destroy();
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = hlsUrl;
                video.addEventListener('canplay', onCanPlay);
                video.addEventListener('error', () => {
                     setError('Native HLS playback failed.');
                     setIsLoading(false);
                });
            } else {
                setError('HLS not supported');
                setIsLoading(false);
            }
        };

        initPlayer();

        initialErrorTimeout = setTimeout(() => {
            // Check the ref, not the captured state variable — closure-safe.
            if (!hasStartedRef.current) {
                setError('Stream timed out.');
                setIsLoading(false);
                if (hls) hls.destroy();
            }
        }, 15000);


        return () => {
            if (hls) hls.destroy();
            clearTimeout(initialErrorTimeout);
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('canplay', onCanPlay);
        };
    }, [hlsUrl, isEditor, device.name, reloadKey]);

    if (!isHaCamera && !rtspStreamUrl) {
        return <UnknownTile tile={tile} device={device} isEditor={isEditor} cornerClassName={cornerClassName} />;
    }

    const isLive = !isLoading && !error;

    return (
         <TileWrapper label="" className={`!bg-black ${cornerClassName || ''}`} isLocked={isLocked} isEditor={isEditor}>
            <div
                className={`w-full flex-1 relative ${canEnlarge ? 'cursor-pointer' : ''}`}
                onClick={handleClick}
            >
                 <video
                    ref={videoRef}
                    muted
                    autoPlay
                    playsInline
                    className="w-full h-full border-0 rounded-control absolute inset-0 object-cover"
                />
                 {(isLoading || error) && (
                    <div
                        className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 gap-1.5 z-10"
                        style={{ background: 'radial-gradient(circle at 50% 45%, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.82))' }}
                    >
                        {/* Dimensional status disc — spinner while connecting, alert glyph on error */}
                        <div
                            className="flex items-center justify-center rounded-full"
                            style={{
                                width: 'clamp(2.25rem, 30cqmin, 4rem)',
                                aspectRatio: '1 / 1',
                                background: isLoading
                                    ? 'radial-gradient(circle at 38% 30%, rgb(59 130 246 / 0.32), rgb(59 130 246 / 0.08) 70%, transparent)'
                                    : 'radial-gradient(circle at 38% 30%, rgb(248 113 113 / 0.34), rgb(248 113 113 / 0.08) 70%, transparent)',
                                border: `1px solid ${isLoading ? 'rgb(59 130 246 / 0.5)' : 'rgb(248 113 113 / 0.5)'}`,
                                boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 18px -4px ${isLoading ? '#3b82f6' : '#f87171'}`,
                            }}
                        >
                            {isLoading ? (
                                 <IconRefreshCw className="text-blue-300 animate-spin" style={fluidIcon(1.75)} />
                            ) : (
                                 <IconShieldAlert className="text-red-300" style={fluidIcon(1.75)} />
                            )}
                        </div>
                        <p className={`font-semibold ${isLoading ? 'text-blue-200' : 'text-red-200'}`} style={{ ...fluidTextXs, textShadow: '0 1px 2px rgb(0 0 0 / 0.8)' }}>
                            {isLoading ? 'Connecting…' : error}
                        </p>
                        {error && !isLoading && (
                            <button
                                onClick={handleReload}
                                className="mt-1 px-3 py-1 bg-white/10 text-white font-semibold rounded-control hover:bg-white/20 transition-colors flex items-center gap-1 border border-white/15"
                                style={fluidTextXs}
                            >
                                <IconRefreshCw className="w-3 h-3" />
                                Reload
                            </button>
                        )}
                    </div>
                )}
                {/* LIVE name label over a readable bottom scrim */}
                {isLive && tile.label && (
                    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none flex items-end justify-between gap-2 px-2 pb-1.5 pt-5" style={{ background: 'linear-gradient(to top, rgb(0 0 0 / 0.72), transparent)' }}>
                        <span className="text-white font-semibold truncate" style={{ ...fluidTextXs, textShadow: '0 1px 3px rgb(0 0 0 / 0.9)' }}>{tile.label}</span>
                        <span className="flex items-center gap-1 shrink-0">
                            <span className="rounded-full" style={{ width: '0.4rem', height: '0.4rem', background: '#f87171', boxShadow: '0 0 5px #f87171' }} />
                            <span className="text-red-200 font-bold uppercase tracking-wider" style={{ fontSize: 'clamp(0.4rem, 4cqmin, 0.6rem)', textShadow: '0 1px 2px rgb(0 0 0 / 0.9)' }}>Live</span>
                        </span>
                    </div>
                )}
                {canEnlarge && isLive && (
                    <div className="absolute top-1 right-1 bg-black/55 p-1 rounded-full pointer-events-none z-10 border border-white/15">
                        <IconExpand className="w-4 h-4 text-white" />
                    </div>
                )}
            </div>
        </TileWrapper>
    );
};

export default CameraTile;