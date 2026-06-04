
import React, { useEffect, useRef, useState } from 'react';
import { IconShieldAlert, IconRefreshCw } from './icons';

declare const Hls: any;

interface VideoStreamProps {
    streamUrl: string;
}

const VideoStream = ({ streamUrl }: VideoStreamProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(Date.now());
    // Tracked via ref (not state) so the timeout callback below always sees
    // the current value rather than a stale one captured at effect-run time.
    // That stale closure was the reason "Stream timed out" used to persist
    // over an already-playing stream.
    const hasStartedRef = useRef(false);

    const handleReload = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setError(null);
        setIsLoading(true);
        setReloadKey(Date.now());
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !streamUrl) return;

        setError(null);
        setIsLoading(true);
        hasStartedRef.current = false;

        let hls: any;
        let timeoutId: ReturnType<typeof setTimeout>;

        // Declared up here so the native-HLS `loadedmetadata` path can reference it too.
        const markStarted = () => {
            hasStartedRef.current = true;
            clearTimeout(timeoutId);
            setIsLoading(false);
            setError(null);
        };

        // If the video element itself fires `playing`, we are definitely live —
        // clear any lingering error overlay. This is the safety net for the
        // case where the startup-timeout already fired but the stream recovered
        // immediately afterward (common on slower RTSP→HLS relays).
        const onPlaying = () => markStarted();
        video.addEventListener('playing', onPlaying);

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
                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    markStarted();
                    video.play().catch(() => {});
                });

                hls.on(Hls.Events.ERROR, (event: any, data: any) => {
                    if (data.fatal) {
                        setError(data.details === 'manifestLoadError' ? 'Stream offline or invalid URL.' : `Error: ${data.details}`);
                        setIsLoading(false);
                        hls.destroy();
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streamUrl;
                video.addEventListener('loadedmetadata', () => {
                    markStarted();
                    video.play().catch(() => {});
                });
                video.addEventListener('error', () => {
                    setError('Could not load video stream.');
                    setIsLoading(false);
                });
            } else {
                setError('HLS not supported on this browser.');
                setIsLoading(false);
            }
        };

        initPlayer();

        timeoutId = setTimeout(() => {
            // Use the ref so we see the latest value, not the closure's stale
            // snapshot of isLoading from when the effect first ran.
            if (!hasStartedRef.current) {
                setError('Stream timed out.');
                setIsLoading(false);
                if (hls) hls.destroy();
            }
        }, 20000);

        return () => {
            if (hls) hls.destroy();
            clearTimeout(timeoutId);
            video.removeEventListener('playing', onPlaying);
        };
    }, [streamUrl, reloadKey]);

    return (
        <div className="w-full h-full relative bg-black rounded-lg overflow-hidden">
            <video
                ref={videoRef}
                muted
                autoPlay
                playsInline
                controls={!isLoading && !error} // Show controls only when playing
                className="w-full h-full object-contain"
            />
            {(isLoading || error) && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-2 gap-1">
                    {isLoading ? (
                        <IconRefreshCw className="w-6 h-6 text-brand-blue animate-spin" />
                    ) : (
                        <IconShieldAlert className="w-6 h-6 text-red-400" />
                    )}
                    <p className="text-sm font-semibold">{isLoading ? 'Loading Stream...' : 'Stream Error'}</p>
                    {error && <p className="text-xs text-gray-300">{error}</p>}
                    {error && !isLoading && (
                        <button
                            onClick={handleReload}
                            className="mt-2 px-3 py-1 bg-gray-600 text-white text-xs font-semibold rounded-md hover:bg-gray-500 flex items-center gap-1"
                        >
                            <IconRefreshCw className="w-3 h-3" />
                            Reload
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default VideoStream;
