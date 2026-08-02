/**
 * UnifiSecurityTile — Surface 5: Security / Cameras  (liquid-glass rollout)
 *
 * GLASS ROLLOUT: Replaced hardcoded noir palette (#050a0f) with design-system
 * tokens so the surface is correctly THEME-AWARE across dark / light / ambient:
 *   - Outer TileWrapper surface uses glass-l1 material via design tokens
 *   - StatusBar: glass-l2 material (from glassMaterial) + token colors
 *   - LoadingSkeleton / EmptyState: token text/border colors
 *   - Tile label footer: glass-l1 tint
 *   - All hardcoded rgba(0,0,0,...) backgrounds replaced with token equivalents
 * The UnifiCameraCard handles per-card glass adaptation (see UnifiCameraCard.tsx).
 *
 * Detection pulses, doorbell flash, and floodlight glow are PRESERVED.
 * Spring animation keyframes are PRESERVED (unifi-* names unchanged).
 *
 * SECURITY CONTRACT (hard limits — must not be relaxed):
 *  - No RTSP/RTSPS creds handed to the browser. Streams via HA proxy only.
 *  - License plate: boolean indicator only. Plate text = PII, never shown.
 *  - Floodlight: display state only. Control is equipment-gated/deferred.
 *  - No face/biometric data, labels, or UI.
 */

import React, { useMemo } from 'react';
import type { Device, TileConfig } from '../../types';
import { useUnifiSurface } from '../../hooks/useUnifiSurface';
import UnifiCameraCard from './UnifiCameraCard';
import TileWrapper from './TileWrapper';
import { glassMaterial } from '../../design-system';

// ─────────────────────────────────────────────────────────────────────────────
// Inline keyframe animations injected once into <head> (idempotent)
// These names are intentionally stable so UnifiCameraCard can reference them.
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
// Now uses design-system glassMaterial(2) so it adapts to all themes.
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

  // Use semantic accent vars from design system instead of hardcoded hex
  const statusColor = hasAnyActivity ? 'var(--accent-alert)' : 'rgb(52 211 153)';
  const statusLabel = hasAnyActivity ? 'MOTION DETECTED' : 'ALL CLEAR';

  // Glass-material backdrop for the status bar — theme-adaptive
  const barMaterial = glassMaterial(2);

  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        padding: '0.35rem 0.75rem',
        ...barMaterial,
        borderBottom: '1px solid var(--glass-l2-border)',
        borderRadius: 0,
        gap: '0.75rem',
      }}
    >
      {/* Left: system label */}
      <div className="flex items-center gap-2 min-w-0">
        <svg width="0.9rem" height="0.9rem" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
          <path
            d="M10 2L3 5v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V5L10 2Z"
            stroke={hasAnyActivity ? 'var(--accent-alert)' : 'rgb(52 211 153)'}
            strokeWidth="1.5"
            fill={hasAnyActivity ? 'color-mix(in srgb, var(--accent-alert) 15%, transparent)' : 'rgba(52,211,153,0.12)'}
            style={{ transition: 'all 0.3s ease', animation: hasAnyActivity ? 'unifi-status-glow 1.2s ease-in-out infinite' : 'none' }}
          />
          {!hasAnyActivity && (
            <path d="M7 10.5l2 2 4-4" stroke="rgb(52 211 153)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>

        <span
          style={{
            fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
            fontWeight: 700,
            letterSpacing: '0.06em',
            fontSize: 'clamp(0.5rem, 5cqmin, 0.65rem)',
            color: statusColor,
            textShadow: hasAnyActivity ? '0 0 10px color-mix(in srgb, var(--accent-alert) 60%, transparent)' : 'none',
            transition: 'color 0.3s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Center: camera count */}
      <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
        <svg width="0.75rem" height="0.75rem" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="5" width="12" height="10" rx="1.5" stroke="rgb(var(--text) / 0.45)" strokeWidth="1.4" />
          <path d="M14 8.5l4-2v7l-4-2V8.5Z" stroke="rgb(var(--text) / 0.45)" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span
          style={{
            fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
            fontSize: 'clamp(0.45rem, 4.5cqmin, 0.58rem)',
            color: 'rgb(var(--text) / 0.5)',
            letterSpacing: '0.03em',
          }}
        >
          {cameraCount} CAM{cameraCount !== 1 ? 'S' : ''}
          {activeCount > 0 && (
            <span style={{ color: 'var(--accent-alert)', marginLeft: '0.35rem' }}>
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
            color: 'rgb(var(--text) / 0.35)',
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
// Clock ticker — status bar time re-renders every second
// ─────────────────────────────────────────────────────────────────────────────
const useClockTick = () => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
};

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton — uses glass tokens (not hardcoded #050a0f)
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
        border: '2px solid var(--glass-l2-border)',
        borderTopColor: 'var(--accent-alert)',
        animation: 'unifi-spinner 0.9s linear infinite',
      }}
    />
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: '0.6rem',
        color: 'rgb(var(--text) / 0.3)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      Connecting…
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — uses glass tokens
// ─────────────────────────────────────────────────────────────────────────────
const EmptyState = () => (
  <div
    className="flex flex-col items-center justify-center w-full h-full"
    style={{ gap: '0.6rem', padding: '1.5rem' }}
  >
    <svg width="2.5rem" height="2.5rem" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 7c0-.6.4-1 1-1h12c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V7Z"
        stroke="rgb(var(--text) / 0.2)"
        strokeWidth="1.5"
      />
      <path d="M17 9.5l4-2v7l-4-2V9.5Z" stroke="rgb(var(--text) / 0.2)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="2" stroke="rgb(var(--text) / 0.15)" strokeWidth="1" />
    </svg>
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: '0.65rem',
        color: 'rgb(var(--text) / 0.25)',
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
// Grid layout — unchanged
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

  // Surface background: glass-l1 material applied via TileWrapper's className.
  // We pass !p-0 + overflow-hidden as before, but remove the hardcoded !bg-[#050a0f]
  // so the glass material shows through correctly in all themes.
  return (
    <TileWrapper
      label=""
      className={`!p-0 overflow-hidden ${cornerClassName || ''}`}
      isLocked={tile.isLocked}
      isEditor={isEditor}
      onClick={canEnlarge ? () => onEnlarge!(device) : undefined}
      accent="alert"
      isActive={hasAnyActivity}
    >
      {/* Ambient scanline effect — uses a dark-neutral blending that reads on
          all themes (multiply blend mode cancels out on light backgrounds) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)',
          mixBlendMode: 'multiply',
          zIndex: 20,
        }}
      />

      {/* Moving scan line (surveillance feel) */}
      {!isEditor && (
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            height: '2px',
            background: 'linear-gradient(90deg, transparent 0%, color-mix(in srgb, rgb(52 211 153) 6%, transparent) 50%, transparent 100%)',
            animation: 'unifi-grid-scan 8s linear infinite',
            zIndex: 21,
          }}
        />
      )}

      <div className="relative flex flex-col w-full h-full" style={{ zIndex: 1 }}>
        {/* Status bar — glass-aware now */}
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
              background: 'var(--glass-l1-tint)',
              borderTop: '1px solid var(--glass-l1-border)',
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
                fontSize: 'clamp(0.45rem, 5cqmin, 0.65rem)',
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'rgb(var(--text) / 0.6)',
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
