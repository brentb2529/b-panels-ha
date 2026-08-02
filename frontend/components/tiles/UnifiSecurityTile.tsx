/**
 * UnifiSecurityTile — Surface 5: Security / Cameras
 *
 * A full-tile "security wall" that renders all UniFi Protect cameras discovered
 * from Home Assistant in an adaptive grid. Clicking the tile in normal mode
 * opens the spotlight view (handled by the parent via onEnlarge); in standalone
 * placement the tile IS the surface.
 *
 * SECURITY CONTRACT (hard limits — must not be relaxed):
 *  - No RTSP/RTSPS creds handed to the browser. Streams via HA proxy only.
 *  - License plate: boolean indicator only. Plate text = PII, never shown.
 *  - Floodlight: display state only. Control is equipment-gated/deferred.
 *  - No face/biometric data, labels, or UI.
 *
 * Aesthetic: surveillance-noir.
 *  Font: JetBrains Mono / Fira Code (monospace system fallback).
 *  Canvas: near-black (#050a0f) with cool slate grid lines, warm amber/red
 *  threat accents, green secure state.
 *  Motion: purposeful — detection pulses, doorbell flashes, chip pop-ins.
 */

import React, { useMemo } from 'react';
import type { Device, TileConfig } from '../../types';
import { useUnifiSurface } from '../../hooks/useUnifiSurface';
import UnifiCameraCard from './UnifiCameraCard';
import TileWrapper from './TileWrapper';
import { fluidTextXs, fluidTextSm, fluidIcon } from './tileScale';

// ─────────────────────────────────────────────────────────────────────────────
// Inline keyframe animations injected once into <head> (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
const STYLE_ID = 'unifi-surface-anims';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes unifi-pulse-ring {
      0%   { opacity: 0.9; }
      50%  { opacity: 0.35; }
      100% { opacity: 0.9; }
    }
    @keyframes unifi-doorbell-flash {
      0%   { opacity: 0.5; }
      100% { opacity: 1; }
    }
    @keyframes unifi-live-blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.3; }
    }
    @keyframes unifi-chip-pop {
      0%   { transform: scale(0.6); opacity: 0; }
      100% { transform: scale(1);   opacity: 1; }
    }
    @keyframes unifi-slide-in {
      0%   { opacity: 0; transform: translateY(-4px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes unifi-grid-scan {
      0%   { transform: translateY(-100%); opacity: 0.12; }
      100% { transform: translateY(100vh); opacity: 0.04; }
    }
    @keyframes unifi-spinner {
      to { transform: rotate(360deg); }
    }
    @keyframes unifi-status-glow {
      0%, 100% { box-shadow: 0 0 6px 1px currentColor; }
      50%       { box-shadow: 0 0 14px 3px currentColor; }
    }
  `;
  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status bar — system-level summary line at the top of the surface
// ─────────────────────────────────────────────────────────────────────────────
const StatusBar = ({
  cameraCount,
  activeCount,
  hasAnyActivity,
}: {
  cameraCount: number;
  activeCount: number;
  hasAnyActivity: boolean;
}) => {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const statusColor = hasAnyActivity ? '#f87171' : '#4ade80';
  const statusLabel = hasAnyActivity ? 'MOTION DETECTED' : 'ALL CLEAR';

  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        padding: '0.35rem 0.75rem',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        gap: '0.75rem',
      }}
    >
      {/* Left: system label */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Shield icon inline SVG */}
        <svg width="0.9rem" height="0.9rem" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
          <path
            d="M10 2L3 5v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V5L10 2Z"
            stroke={statusColor}
            strokeWidth="1.5"
            fill={hasAnyActivity ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.12)'}
            style={{ transition: 'all 0.3s ease', animation: hasAnyActivity ? 'unifi-status-glow 1.2s ease-in-out infinite' : 'none' }}
          />
          {!hasAnyActivity && (
            <path d="M7 10.5l2 2 4-4" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>

        <span
          style={{
            fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
            fontWeight: 700,
            letterSpacing: '0.06em',
            fontSize: 'clamp(0.5rem, 5cqmin, 0.65rem)',
            color: statusColor,
            textShadow: hasAnyActivity ? '0 0 10px rgba(248,113,113,0.6)' : 'none',
            transition: 'color 0.3s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Center: camera count */}
      <div
        className="flex items-center gap-1"
        style={{ flexShrink: 0 }}
      >
        {/* Camera icon */}
        <svg width="0.75rem" height="0.75rem" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="5" width="12" height="10" rx="1.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" />
          <path d="M14 8.5l4-2v7l-4-2V8.5Z" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span
          style={{
            fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
            fontSize: 'clamp(0.45rem, 4.5cqmin, 0.58rem)',
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.03em',
          }}
        >
          {cameraCount} CAM{cameraCount !== 1 ? 'S' : ''}
          {activeCount > 0 && (
            <span style={{ color: '#f87171', marginLeft: '0.35rem' }}>
              {activeCount} ACTIVE
            </span>
          )}
        </span>
      </div>

      {/* Right: clock */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          style={{
            fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
            fontSize: 'clamp(0.42rem, 4cqmin, 0.55rem)',
            color: 'rgba(255,255,255,0.35)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {dateStr} · {timeStr}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Clock ticker (status bar time needs to re-render every second)
// ─────────────────────────────────────────────────────────────────────────────
const useClockTick = () => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
};

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────
const LoadingSkeleton = () => (
  <div
    className="flex flex-col items-center justify-center w-full h-full"
    style={{ gap: '0.75rem' }}
  >
    <div
      style={{
        width: '2rem',
        height: '2rem',
        borderRadius: '9999px',
        border: '2px solid rgba(255,255,255,0.08)',
        borderTopColor: '#f87171',
        animation: 'unifi-spinner 0.9s linear infinite',
      }}
    />
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: '0.6rem',
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      Connecting…
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
const EmptyState = () => (
  <div
    className="flex flex-col items-center justify-center w-full h-full"
    style={{ gap: '0.6rem', padding: '1.5rem' }}
  >
    <svg width="2.5rem" height="2.5rem" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 7c0-.6.4-1 1-1h12c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V7Z"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1.5"
      />
      <path d="M17 9.5l4-2v7l-4-2V9.5Z" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="2" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
    </svg>
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: '0.65rem',
        color: 'rgba(255,255,255,0.25)',
        letterSpacing: '0.06em',
        textAlign: 'center',
        lineHeight: 1.6,
      }}
    >
      No UniFi Protect cameras<br />found in Home Assistant
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Grid layout helper — choose columns based on camera count + tile size
// ─────────────────────────────────────────────────────────────────────────────
function gridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// UnifiSecurityTile — main export
// ─────────────────────────────────────────────────────────────────────────────
interface UnifiSecurityTileProps {
  device: Device;
  tile: TileConfig;
  onEnlarge?: (device: Device) => void;
  isEditor?: boolean;
  cornerClassName?: string;
}

const UnifiSecurityTile: React.FC<UnifiSecurityTileProps> = ({
  device,
  tile,
  onEnlarge,
  isEditor,
  cornerClassName,
}) => {
  useClockTick();
  const { cameras, isLoading, isEmpty, hasAnyActivity } = useUnifiSurface();

  const activeCount = useMemo(
    () => cameras.filter(
      c => c.motionActive || c.doorbellActive || Object.values(c.detections).some(Boolean) || c.licensePlateDetected
    ).length,
    [cameras]
  );

  const cols = gridCols(cameras.length);
  const canEnlarge = !isEditor && !tile.isLocked && !!onEnlarge;

  return (
    <TileWrapper
      label=""
      className={`!p-0 overflow-hidden !bg-[#050a0f] ${cornerClassName || ''}`}
      isLocked={tile.isLocked}
      isEditor={isEditor}
      onClick={canEnlarge ? () => onEnlarge!(device) : undefined}
      accent="alert"
      isActive={hasAnyActivity}
    >
      {/* Ambient scanline effect over the whole tile */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,20,0,0.04) 3px, rgba(0,20,0,0.04) 4px)',
          zIndex: 20,
        }}
      />

      {/* Moving scan line (subtle, surveillance feel) */}
      {!isEditor && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            height: '2px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,255,100,0.06) 50%, transparent 100%)',
            animation: 'unifi-grid-scan 8s linear infinite',
            zIndex: 21,
          }}
        />
      )}

      <div className="relative flex flex-col w-full h-full" style={{ zIndex: 1 }}>
        {/* Status bar */}
        <StatusBar
          cameraCount={cameras.length}
          activeCount={activeCount}
          hasAnyActivity={hasAnyActivity}
        />

        {/* Camera grid */}
        <div className="flex-1 relative overflow-hidden">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isEmpty ? (
            <EmptyState />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: '2px',
                padding: '2px',
                width: '100%',
                height: '100%',
              }}
            >
              {cameras.map((cam, i) => {
                // First camera spans 2 rows when there are multiple cameras
                const featured = i === 0 && cameras.length > 1 && cameras.length <= 4;
                return (
                  <UnifiCameraCard
                    key={cam.entityId}
                    camera={cam}
                    featured={featured}
                    style={
                      featured
                        ? { gridRow: 'span 2', gridColumn: '1 / 2' }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Tile label */}
        {tile.label && (
          <div
            className="shrink-0 text-center"
            style={{
              padding: '0.2rem 0.5rem 0.3rem',
              background: 'rgba(0,0,0,0.6)',
              borderTop: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
                fontSize: 'clamp(0.45rem, 5cqmin, 0.65rem)',
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'rgba(255,255,255,0.6)',
                textTransform: 'uppercase',
              }}
            >
              {tile.label}
            </span>
          </div>
        )}
      </div>
    </TileWrapper>
  );
};

export default UnifiSecurityTile;
