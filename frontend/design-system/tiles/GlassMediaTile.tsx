import React, { useEffect, useState } from 'react';
import { Device, TileConfig } from '../../types';
import { useDashboardActions } from '../../hooks/useDashboard';
import * as haClient from '../../services/haClient';
import { IconMusic, IconPlay, IconPause, IconSkipBack, IconSkipForward, IconVolume2 } from '../../components/icons';
import { fluidIcon, fluidTextSm, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassMediaTile — liquid-glass media-player (Sonos / any HA speaker) tile:
// album art + now-playing + transport + volume.
//
// Live binding: `device.state` for a speaker `media_player.*` is shaped by
// `mapHaEntityToInternalDevice` (playbackState / volume / currentTrack). Album
// art uses HA's media_player_proxy URL (relative, same-origin in the panel).
// Transport + volume route to `media_player.*` services via haClient.callService
// — the same path the legacy SonosPlayerTile uses. PIN/lock gating honored.
// ---------------------------------------------------------------------------

interface MediaState {
  playbackState?: string;
  volume?: number;
  currentTrack?: { title?: string; artist?: string; albumArtURI?: string };
}

const iconBtnStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
  color,
  background: 'none',
  border: 'none',
  padding: '0.15rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

const GlassMediaTile = ({
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
  const { requestPin } = useDashboardActions();
  const state = (device.state || {}) as MediaState;
  const isPlaying = state.playbackState === 'PLAYING';
  const isLocked = !!tile.isLocked;
  const isUnavailable = device.isOnline === false;

  const [localVolume, setLocalVolume] = useState(state.volume || 0);
  useEffect(() => { setLocalVolume(state.volume || 0); }, [state.volume]);

  const send = async (command: 'play' | 'pause' | 'next' | 'previous' | 'volume', value?: number) => {
    const svc =
      command === 'play' ? 'media_play'
        : command === 'pause' ? 'media_pause'
          : command === 'next' ? 'media_next_track'
            : command === 'previous' ? 'media_previous_track'
              : 'volume_set';
    const data: Record<string, any> = { entity_id: device.id };
    if (command === 'volume') data.volume_level = Math.min(1, Math.max(0, (value ?? 0) / 100));
    await haClient.callService('media_player', svc, data);
  };

  const transport = (e: React.MouseEvent, command: 'play' | 'pause' | 'next' | 'previous') => {
    e.stopPropagation();
    if (isEditor || isLocked) return;
    const action = () => send(command);
    if (tile.requirePin) requestPin(action); else action();
  };

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (isEditor || isLocked) return;
    setLocalVolume(parseInt(e.target.value, 10));
  };
  const commitVolume = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (isEditor || isLocked) return;
    const action = () => send('volume', localVolume);
    if (tile.requirePin) requestPin(action); else action();
  };

  const track = state.currentTrack;
  const albumArtUrl = track?.albumArtURI;

  return (
    <GlassCard
      label={tile.label || ''}
      accent="lights"
      isActive={isPlaying}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isProtected={tile.requirePin}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col justify-between" style={{ gap: 'clamp(0.2rem, 2cqmin, 0.45rem)' }}>
        <div className="flex-1 flex items-center min-h-0" style={{ gap: 'clamp(0.3rem, 3cqmin, 0.6rem)' }}>
          <div
            className="relative shrink-0 overflow-hidden"
            style={{
              width: 'clamp(2.5rem, 28cqmin, 4.5rem)',
              aspectRatio: '1 / 1',
              borderRadius: 'clamp(6px, 4cqmin, 12px)',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'radial-gradient(circle at 35% 28%, rgba(var(--bp-accent-lights-rgb),0.25), rgba(15,20,28,0.9) 75%)',
            }}
          >
            {track?.title && albumArtUrl ? (
              <img src={albumArtUrl} alt={track.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <IconMusic style={{ ...fluidIcon(1.8), color: 'var(--bp-text-dim)' }} />
              </div>
            )}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="bp-readout truncate" style={{ ...fluidTextSm, fontWeight: 600, color: 'var(--bp-text-primary)' }} title={track?.title || 'Nothing playing'}>
              {isUnavailable ? '—' : track?.title || 'Nothing playing'}
            </p>
            <p className="bp-meta truncate" style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)' }} title={track?.artist}>
              {track?.artist || '—'}
            </p>
          </div>
        </div>

        <div className="w-full">
          <div className="flex justify-center items-center" style={{ gap: 'clamp(0.4rem, 5cqmin, 0.9rem)' }}>
            <button onClick={(e) => transport(e, 'previous')} disabled={isEditor || isLocked} style={iconBtnStyle('var(--bp-text-secondary)', isEditor || isLocked)} aria-label="Previous">
              <IconSkipBack style={fluidIcon(1.0)} />
            </button>
            <button
              onClick={(e) => transport(e, isPlaying ? 'pause' : 'play')}
              disabled={isEditor || isLocked}
              style={iconBtnStyle(isPlaying ? 'var(--bp-accent-lights)' : 'var(--bp-text-primary)', isEditor || isLocked)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <IconPause style={fluidIcon(1.4)} /> : <IconPlay style={fluidIcon(1.4)} />}
            </button>
            <button onClick={(e) => transport(e, 'next')} disabled={isEditor || isLocked} style={iconBtnStyle('var(--bp-text-secondary)', isEditor || isLocked)} aria-label="Next">
              <IconSkipForward style={fluidIcon(1.0)} />
            </button>
          </div>
          <div className="flex items-center" style={{ gap: 'clamp(0.25rem, 2cqmin, 0.5rem)', marginTop: 'clamp(0.15rem,1.5cqmin,0.35rem)' }}>
            <IconVolume2 className="shrink-0" style={{ ...fluidIcon(0.85), color: 'var(--bp-text-dim)' }} />
            <div className="bp-track flex-1" style={{ height: 'clamp(5px, 4cqmin, 8px)' }}>
              <div className="bp-track-fill" style={{ width: `${localVolume}%`, background: 'linear-gradient(90deg, rgba(var(--bp-accent-lights-rgb),0.65), rgba(var(--bp-accent-lights-rgb),1))' }} />
              <input
                type="range"
                className="bp-range"
                min={0}
                max={100}
                value={localVolume}
                onChange={onVolume}
                onMouseUp={commitVolume}
                onTouchEnd={commitVolume}
                onClick={(e) => e.stopPropagation()}
                disabled={isEditor || isLocked}
                aria-label={`${tile.label || device.name} volume`}
              />
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassMediaTile;
