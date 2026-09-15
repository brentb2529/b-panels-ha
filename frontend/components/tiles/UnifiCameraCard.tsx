/**
 * UnifiCameraCard — single camera card within the UnifiSecuritySurface grid.
 *
 * GLASS ROLLOUT: Replaced hardcoded noir (#050a0f) backgrounds with design-system
 * tokens so the card is theme-aware:
 *   - Card border/background: glass tokens (var(--glass-l2-bg/border))
 *   - CameraThumb background: var(--glass-l1-bg) instead of hardcoded #050a0f
 *   - RecentEventsTape gradient: token-based overlay
 *   - SmartDetectChips, LiveBadge, StaleIndicator: token colors + glass backdrop
 *   - FloodlightStateBadge: glass-l3 material when off
 * All detection/pulse/doorbell/floodlight visual logic is PRESERVED.
 *
 * SECURITY CONTRACT (hard limits, must not be relaxed):
 *  - Video via HA-proxied HLS only (getCameraStreamUrl). No RTSP/RTSPS creds.
 *  - License plate: boolean indicator only. Plate text is NEVER shown (PII).
 *  - Floodlight: display state only (no control — equipment-gated/deferred).
 *  - No face/biometric UI.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { UnifiCamera, SmartDetectClass, UnifiEvent } from '../../hooks/useUnifiSurface';
import * as haClient from '../../services/haClient';
import { fluidTextXs, fluidTextSm } from './tileScale';

declare const Hls: any;

// ─────────────────────────────────────────────────────────────────────────────
// Detection chip config — each smart-detect class gets a label + color.
// ─────────────────────────────────────────────────────────────────────────────
const DETECT_CHIPS: Record<SmartDetectClass, { label: string; color: string; bg: string }> = {
  person:  { label: 'PERSON',  color: '#f87171', bg: 'rgba(248,113,113,0.18)' },
  vehicle: { label: 'VEHICLE', color: '#fb923c', bg: 'rgba(251,146,60,0.18)' },
  animal:  { label: 'ANIMAL',  color: '#a78bfa', bg: 'rgba(167,139,250,0.18)' },
  package: { label: 'PKG',     color: '#34d399', bg: 'rgba(52,211,153,0.18)' },
};

const EVENT_KIND_LABELS: Record<UnifiEvent['kind'], string> = {
  doorbell: 'RING',
  vehicle: 'VEHICLE',
  nfc: 'NFC',
  fingerprint: 'FINGERPRINT',
  unknown: 'EVENT',
};

function relativeTime(isoStr: string): string {
  if (!isoStr) return '';
  const delta = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MotionPulse — radial ring that breathes when motion/detection is active
// ─────────────────────────────────────────────────────────────────────────────
const MotionPulse = ({ active, color = '#f87171' }: { active: boolean; color?: string }) => (
  <div
    className="absolute inset-0 pointer-events-none rounded-[inherit] overflow-hidden"
    style={{ zIndex: 4 }}
  >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        border: `2px solid ${active ? color : 'transparent'}`,
        boxShadow: active ? `inset 0 0 20px -4px ${color}, 0 0 14px -3px ${color}` : 'none',
        transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
        animation: active ? 'unifi-pulse-ring 1.6s ease-in-out infinite' : 'none',
      }}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// DoorbellRing — full-card amber flash for doorbell presses
// ─────────────────────────────────────────────────────────────────────────────
const DoorbellRing = ({ active }: { active: boolean }) => (
  <div
    className="absolute inset-0 pointer-events-none rounded-[inherit] overflow-hidden"
    style={{ zIndex: 5 }}
  >
    {active && (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.22) 0%, transparent 70%)',
          border: '2px solid rgba(251,191,36,0.9)',
          boxShadow: 'inset 0 0 32px -6px rgba(251,191,36,0.6), 0 0 24px -4px rgba(251,191,36,0.7)',
          animation: 'unifi-doorbell-flash 0.5s ease-in-out infinite alternate',
        }}
      />
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// FloodlightGlow — top edge warm glow when floodlight is on (display only)
// ─────────────────────────────────────────────────────────────────────────────
const FloodlightGlow = ({ isOn }: { isOn: boolean }) => (
  <div
    className="absolute inset-x-0 top-0 pointer-events-none"
    style={{
      height: '30%',
      background: isOn
        ? 'linear-gradient(to bottom, rgba(254,240,138,0.18) 0%, transparent 100%)'
        : 'transparent',
      transition: 'background 0.4s ease',
      zIndex: 3,
      borderRadius: 'inherit',
    }}
  />
);

// ─────────────────────────────────────────────────────────────────────────────
// SmartDetectChips — row of detection classification chips
// ─────────────────────────────────────────────────────────────────────────────
const SmartDetectChips = ({
  detections,
  licensePlateDetected,
  doorbellActive,
}: {
  detections: UnifiCamera['detections'];
  licensePlateDetected: boolean;
  doorbellActive: boolean;
}) => {
  const active: { key: string; label: string; color: string; bg: string }[] = [];

  (Object.keys(DETECT_CHIPS) as SmartDetectClass[]).forEach(k => {
    if (detections[k]) active.push({ key: k, ...DETECT_CHIPS[k] });
  });

  // License plate: boolean only — NEVER show plate text (PII)
  if (licensePlateDetected) {
    active.push({ key: 'lp', label: 'PLATE', color: '#60a5fa', bg: 'rgba(96,165,250,0.18)' });
  }
  if (doorbellActive) {
    active.push({ key: 'bell', label: 'RING', color: '#fbbf24', bg: 'rgba(251,191,36,0.18)' });
  }

  if (active.length === 0) return null;

  return (
    <div
      className="absolute top-2 left-2 flex flex-wrap gap-1 pointer-events-none"
      style={{ zIndex: 8, maxWidth: '80%' }}
    >
      {active.map(chip => (
        <span
          key={chip.key}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem',
            padding: '0.15rem 0.45rem',
            borderRadius: '0.35rem',
            background: chip.bg,
            border: `1px solid ${chip.color}`,
            color: chip.color,
            fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
            fontWeight: 700,
            letterSpacing: '0.04em',
            fontSize: 'clamp(0.45rem, 5cqmin, 0.6rem)',
            backdropFilter: 'var(--glass-l3-backdrop)',
            boxShadow: `0 0 8px -2px ${chip.color}`,
            animation: 'unifi-chip-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) both',
          }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RecentEventsTape — scrolling ticker at the bottom
// ─────────────────────────────────────────────────────────────────────────────
const RecentEventsTape = ({ events }: { events: UnifiEvent[] }) => {
  const [tick, setTick] = useState(0);

  // Refresh relative times every 15s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  if (events.length === 0) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-0 pointer-events-none overflow-hidden"
      style={{
        zIndex: 7,
        background: 'linear-gradient(to top, color-mix(in srgb, var(--glass-l1-bg) 85%, transparent) 0%, color-mix(in srgb, var(--glass-l1-bg) 55%, transparent) 60%, transparent 100%)',
        paddingTop: '1.2rem',
        paddingBottom: '0.35rem',
        paddingLeft: '0.45rem',
        paddingRight: '0.45rem',
      }}
    >
      <div className="flex flex-col gap-0.5">
        {events.slice(0, 3).map((ev, i) => (
          <div
            key={ev.entityId + ev.lastUpdated}
            className="flex items-center gap-1.5"
            style={{
              opacity: 1 - i * 0.28,
              animation: i === 0 ? 'unifi-slide-in 0.3s ease both' : 'none',
            }}
          >
            {/* Colored dot */}
            <span
              style={{
                width: '0.35rem',
                height: '0.35rem',
                borderRadius: '9999px',
                flexShrink: 0,
                background:
                  ev.kind === 'doorbell' ? '#fbbf24'
                  : ev.kind === 'vehicle' ? '#fb923c'
                  : '#60a5fa',
                boxShadow:
                  ev.kind === 'doorbell' ? '0 0 4px #fbbf24'
                  : ev.kind === 'vehicle' ? '0 0 4px #fb923c'
                  : '0 0 4px #60a5fa',
              }}
            />
            <span
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
                fontSize: 'clamp(0.4rem, 4.5cqmin, 0.55rem)',
                color: 'rgba(255,255,255,0.82)',
                letterSpacing: '0.02em',
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {EVENT_KIND_LABELS[ev.kind]}
              {ev.eventType && ev.eventType !== ev.kind ? ` · ${ev.eventType.replace(/_/g, ' ')}` : ''}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
                fontSize: 'clamp(0.38rem, 4cqmin, 0.5rem)',
                color: 'rgba(255,255,255,0.45)',
                letterSpacing: '0.01em',
                flexShrink: 0,
                marginLeft: 'auto',
              }}
            >
              {relativeTime(ev.lastUpdated)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StaleIndicator — amber corner badge when entity hasn't updated in >2 min
// ─────────────────────────────────────────────────────────────────────────────
const StaleIndicator = ({ isStale }: { isStale: boolean }) => {
  if (!isStale) return null;
  return (
    <div
      className="absolute top-2 right-2 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.2rem',
          padding: '0.15rem 0.4rem',
          borderRadius: '0.3rem',
          background: 'rgba(251,146,60,0.22)',
          border: '1px solid rgba(251,146,60,0.7)',
          color: 'rgba(251,191,36,0.9)',
          fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
          fontWeight: 700,
          fontSize: 'clamp(0.4rem, 4cqmin, 0.55rem)',
          letterSpacing: '0.05em',
        }}
      >
        STALE
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LiveBadge — red dot + "LIVE" text
// ─────────────────────────────────────────────────────────────────────────────
const LiveBadge = () => (
  <div
    className="absolute pointer-events-none"
    style={{
      top: '0.45rem',
      right: '0.45rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.3rem',
      zIndex: 9,
      padding: '0.15rem 0.45rem',
      borderRadius: '0.3rem',
      background: 'var(--glass-l3-bg)',
      backdropFilter: 'var(--glass-l3-backdrop)',
      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      border: '1px solid var(--glass-l3-border)',
    }}
  >
    <span
      style={{
        width: '0.45rem',
        height: '0.45rem',
        borderRadius: '9999px',
        background: '#f87171',
        boxShadow: '0 0 6px #f87171',
        animation: 'unifi-live-blink 1.4s ease-in-out infinite',
        flexShrink: 0,
      }}
    />
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontWeight: 700,
        letterSpacing: '0.08em',
        fontSize: 'clamp(0.38rem, 4cqmin, 0.5rem)',
        color: '#fca5a5',
      }}
    >
      LIVE
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Camera thumbnail (HLS stream or snapshot fallback)
// ─────────────────────────────────────────────────────────────────────────────
const CameraThumb = ({
  entityId,
  entityPicture,
  name,
}: {
  entityId: string;
  entityPicture: string | null;
  name: string;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const hasStartedRef = useRef(false);

  // Resolve HA HLS stream. Never expose RTSP creds.
  useEffect(() => {
    let cancelled = false;
    setHlsUrl(null);
    setStreamReady(false);
    setStreamError(false);
    hasStartedRef.current = false;

    haClient.getCameraStreamUrl(entityId)
      .then(url => {
        if (cancelled) return;
        if (url) setHlsUrl(url);
        else setStreamError(true);
      })
      .catch(() => {
        if (!cancelled) setStreamError(true);
      });

    return () => { cancelled = true; };
  }, [entityId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    let hls: any;
    hasStartedRef.current = false;

    const markReady = () => {
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        setStreamReady(true);
        setStreamError(false);
      }
    };

    video.addEventListener('playing', markReady);

    const initTimeout = setTimeout(() => {
      if (!hasStartedRef.current) setStreamError(true);
    }, 18_000);

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 60,
        manifestLoadRetry: 4,
        manifestLoadRetryDelay: 1000,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        markReady();
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) setStreamError(true);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('canplay', () => {
        markReady();
        video.play().catch(() => {});
      });
    } else {
      setStreamError(true);
    }

    return () => {
      clearTimeout(initTimeout);
      video.removeEventListener('playing', markReady);
      if (hls) hls.destroy();
    };
  }, [hlsUrl]);

  const hassUrl = () => {
    const env = (import.meta as any).env?.VITE_HASS_URL;
    return env ?? window.location.origin;
  };

  const snapshotUrl = entityPicture
    ? (entityPicture.startsWith('http') ? entityPicture : `${hassUrl()}${entityPicture}`)
    : null;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--glass-l1-bg)' }}>
      {/* Video element always mounted; hidden until ready */}
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: streamReady ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }}
      />

      {/* Snapshot fallback shown while stream connects or on error */}
      {(!streamReady || streamError) && snapshotUrl && (
        <img
          src={snapshotUrl}
          alt={name}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.75 }}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
        />
      )}

      {/* Scanline texture overlay for the surveillance aesthetic */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 4px)',
          zIndex: 2,
          mixBlendMode: 'multiply',
        }}
      />

      {/* Very subtle vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,0.45) 100%)',
          zIndex: 2,
        }}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Camera name label
// ─────────────────────────────────────────────────────────────────────────────
const CameraLabel = ({ name }: { name: string }) => (
  <div
    className="absolute inset-x-0 bottom-0 pointer-events-none"
    style={{
      zIndex: 6,
      background: 'linear-gradient(to top, color-mix(in srgb, var(--glass-l1-bg) 80%, transparent) 0%, transparent 45%)',
      paddingBottom: '0.4rem',
      paddingTop: '1.5rem',
      paddingLeft: '0.5rem',
      paddingRight: '0.5rem',
    }}
  >
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: 'clamp(0.45rem, 5.5cqmin, 0.65rem)',
        fontWeight: 500,
        color: 'rgba(255,255,255,0.75)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        textShadow: '0 1px 4px rgba(0,0,0,0.9)',
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// FloodlightStateGlow — bottom-right indicator badge (no control)
// ─────────────────────────────────────────────────────────────────────────────
const FloodlightStateBadge = ({ isOn }: { isOn: boolean }) => (
  <div
    className="absolute pointer-events-none"
    style={{
      bottom: '0.45rem',
      right: '0.45rem',
      zIndex: 9,
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.15rem 0.4rem',
      borderRadius: '0.3rem',
      background: isOn ? 'rgba(254,240,138,0.18)' : 'var(--glass-l3-bg)',
      border: `1px solid ${isOn ? 'rgba(254,240,138,0.6)' : 'var(--glass-l3-border)'}`,
      backdropFilter: 'var(--glass-l3-backdrop)',
      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
      transition: 'all 0.3s ease',
    }}
  >
    {/* Simple bulb icon inline SVG — no import needed */}
    <svg
      width="0.6rem"
      height="0.6rem"
      viewBox="0 0 16 16"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="8"
        cy="6"
        r="4"
        stroke={isOn ? '#fef08a' : 'rgba(255,255,255,0.3)'}
        strokeWidth="1.5"
        fill={isOn ? 'rgba(254,240,138,0.5)' : 'none'}
      />
      <path
        d="M6 11.5h4M6.5 13.5h3"
        stroke={isOn ? '#fef08a' : 'rgba(255,255,255,0.3)'}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
    <span
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: 'clamp(0.38rem, 3.5cqmin, 0.5rem)',
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: isOn ? '#fef08a' : 'rgba(255,255,255,0.35)',
        textShadow: isOn ? '0 0 8px rgba(254,240,138,0.8)' : 'none',
      }}
    >
      {isOn ? 'FLOOD' : 'FLOOD'}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
interface UnifiCameraCardProps {
  camera: UnifiCamera;
  /** Whether this camera is "featured" (enlarged in a multi-col layout) */
  featured?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

const UnifiCameraCard: React.FC<UnifiCameraCardProps> = ({ camera, featured, style, className }) => {
  const anyActive = camera.motionActive ||
    camera.doorbellActive ||
    Object.values(camera.detections).some(Boolean) ||
    camera.licensePlateDetected;

  const pulseColor = camera.doorbellActive
    ? '#fbbf24'
    : (camera.detections.person || camera.detections.vehicle)
    ? '#f87171'
    : '#fb923c';

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{
        borderRadius: 'var(--radius-card)',
        // Theme-adaptive base: glass-l2-bg shows the background through
        // (dark navy, light frosted, ambient charcoal) instead of hardcoded black.
        background: 'var(--glass-l2-bg)',
        backdropFilter: 'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        border: anyActive
          ? `1px solid ${pulseColor}`
          : camera.floodlightOn
          ? '1px solid rgba(254,240,138,0.3)'
          : '1px solid var(--glass-l2-border)',
        boxShadow: anyActive
          ? `var(--rim), 0 0 0 1px ${pulseColor}22, 0 2px 16px -4px ${pulseColor}66`
          : 'var(--rim), var(--elev-2)',
        transition: `border-color var(--dur-medium) var(--spring-gentle), box-shadow var(--dur-medium) var(--spring-gentle)`,
        aspectRatio: '16 / 9',
        ...style,
      }}
    >
      {/* Camera video/snapshot layer */}
      <CameraThumb
        entityId={camera.entityId}
        entityPicture={camera.entityPicture}
        name={camera.name}
      />

      {/* Floodlight glow overlay (display only) */}
      <FloodlightGlow isOn={camera.floodlightOn} />

      {/* Motion pulse ring */}
      <MotionPulse active={anyActive} color={pulseColor} />

      {/* Doorbell ring highlight */}
      <DoorbellRing active={camera.doorbellActive} />

      {/* Smart-detect chips — top-left */}
      <SmartDetectChips
        detections={camera.detections}
        licensePlateDetected={camera.licensePlateDetected}
        doorbellActive={camera.doorbellActive}
      />

      {/* LIVE badge — top-right (hidden when stale) */}
      {!camera.isStale && <LiveBadge />}

      {/* Stale indicator (replaces LIVE badge) */}
      <StaleIndicator isStale={camera.isStale} />

      {/* Floodlight state badge — bottom-right (display only, no control) */}
      {camera.floodlightEntityId && (
        <FloodlightStateBadge isOn={camera.floodlightOn} />
      )}

      {/* Recent events tape — bottom */}
      <RecentEventsTape events={camera.recentEvents} />

      {/* Camera name label (above the tape) */}
      <CameraLabel name={camera.name} />
    </div>
  );
};

export default UnifiCameraCard;
