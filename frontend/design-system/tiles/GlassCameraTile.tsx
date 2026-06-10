import React, { useEffect, useRef, useState } from 'react';
import { Device, TileConfig } from '../../types';
import * as haClient from '../../services/haClient';
import { IconCamera, IconVideo, IconRefreshCw } from '../../components/icons';
import { fluidIcon, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

declare const Hls: any;

// ---------------------------------------------------------------------------
// GlassCameraTile — liquid-glass 16:9 camera tile with a poster snapshot and a
// "feed unavailable" fallback. Display-only (no actuation).
//
// Live binding: an HA `camera.*` entity resolves its live HLS URL via HA's
// own stream component (`haClient.getCameraStreamUrl`); `entity_picture` (in
// `device.state.entityPicture`) is the poster/snapshot fallback. When the
// stream cannot be obtained the tile shows a calm "feed unavailable" state
// rather than a broken <video>.
// ---------------------------------------------------------------------------

const GlassCameraTile = ({
  device,
  tile,
  isEditor,
  cornerClassName,
}: {
  device: Device;
  tile: TileConfig;
  isEditor?: boolean;
  cornerClassName?: string;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const stateObj = (device.state && typeof device.state === 'object' ? device.state : {}) as Record<string, any>;
  const poster: string | undefined = stateObj.entityPicture;
  const isUnavailable = device.isOnline === false;

  // Resolve the live HLS URL from HA (re-fetched on reload; token is short-lived).
  useEffect(() => {
    let cancelled = false;
    setHlsUrl(null);
    setFailed(false);
    if (isEditor || isUnavailable) return;
    haClient
      .getCameraStreamUrl(device.id)
      .then((url) => {
        if (cancelled) return;
        if (url) setHlsUrl(url);
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [device.id, isEditor, isUnavailable, reloadKey]);

  // Attach HLS.js (or native HLS) once we have a URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.ErrorTypes?.MEDIA_ERROR || 'hlsError', () => {});
      hls.on('hlsError', (_e: any, data: any) => { if (data?.fatal) setFailed(true); });
      return () => { hls.destroy(); hlsRef.current = null; };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
    } else {
      setFailed(true);
    }
  }, [hlsUrl]);

  const showVideo = !isEditor && !isUnavailable && hlsUrl && !failed;
  const showPoster = !showVideo && poster && !isUnavailable;

  return (
    <GlassCard
      label={tile.label || ''}
      accent="security"
      isActive={false}
      isUnavailable={isUnavailable}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{
          aspectRatio: '16 / 9',
          borderRadius: 'clamp(6px, 4cqmin, 12px)',
          background: 'linear-gradient(180deg, rgba(20,26,34,0.95), rgba(12,16,22,0.95))',
          border: '1px solid rgba(var(--bp-accent-security-rgb),0.2)',
        }}
      >
        {showVideo && (
          <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
        )}
        {showPoster && (
          <img src={poster} alt={tile.label || device.name} className="absolute inset-0 w-full h-full object-cover" />
        )}
        {!showVideo && !showPoster && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: 'clamp(0.15rem,2cqmin,0.4rem)' }}>
            <IconVideo style={{ ...fluidIcon(1.6), color: 'var(--bp-text-dim)' }} />
            <p className="bp-meta" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>
              {isEditor ? 'Camera preview' : 'Feed unavailable'}
            </p>
          </div>
        )}

        {/* Live badge + manual reload (not in editor). */}
        {!isEditor && (
          <div className="absolute top-1 left-1 flex items-center" style={{ gap: '0.25rem' }}>
            <span
              style={{
                ...fluidTextXs,
                color: showVideo ? 'var(--bp-accent-security)' : 'var(--bp-text-dim)',
                background: 'rgba(0,0,0,0.45)',
                padding: '0.05rem 0.35rem',
                borderRadius: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.2rem',
              }}
            >
              <IconCamera style={fluidIcon(0.7)} />
              {showVideo ? 'LIVE' : '—'}
            </span>
          </div>
        )}
        {!isEditor && failed && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setReloadKey((k) => k + 1); }}
            className="absolute bottom-1 right-1"
            style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '6px', padding: '0.2rem', color: 'var(--bp-text-secondary)', cursor: 'pointer' }}
            aria-label="Reload camera"
          >
            <IconRefreshCw style={fluidIcon(0.8)} />
          </button>
        )}
      </div>
    </GlassCard>
  );
};

export default GlassCameraTile;
