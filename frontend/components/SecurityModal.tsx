/**
 * SecurityModal — full-screen security overview overlay.
 *
 * Opens on demand (tapping the global SecurityStatusIndicator) and
 * AUTO-SURFACES when the alert level transitions to 'active' (active
 * detection or doorbell ring).
 *
 * DISPLAY-ONLY contract (mirrors SecurityCompilationTile):
 *   - Camera thumbnails (HA-proxied snapshots — no RTSP)
 *   - Live detection chips
 *   - Recent-events timeline across all cameras
 *   - Doorbell / floodlight STATE (no control)
 *   - Door/lock sensor state (no control)
 *
 * NOT PRESENT (deferred / equipment-gated):
 *   - Arm / disarm / siren / recording mode — these require a dedicated alarm
 *     panel integration and explicit human confirmation. This modal has no
 *     alarm_control_panel wired yet. No state is fabricated.
 *   - Floodlight on/off button — equipment-gated.
 *
 * SECURITY CONTRACT:
 *   - License plate: boolean only. Plate text = PII, never shown.
 *   - No face/biometric data.
 *   - No RTSP creds — snapshots via HA entity_picture proxy only.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUnifiSurface } from '../hooks/useUnifiSurface';
import type { UnifiCamera, UnifiEvent } from '../hooks/useUnifiSurface';
import type { SecurityAlertLevel, SecurityIndicatorState } from '../hooks/useSecurityIndicator';
import { glassMaterial } from '../design-system';
import {
  IconX,
  IconShieldAlert,
  IconShieldCheck,
  IconActivity,
  IconCamera,
  IconDoorOpen,
  IconAlertTriangle,
  IconLock,
} from './icons';

// ── Animation keyframes (injected once) ────────────────────────────────────────
const MODAL_STYLE_ID = 'sec-modal-anims';
if (typeof document !== 'undefined' && !document.getElementById(MODAL_STYLE_ID)) {
  const s = document.createElement('style');
  s.id = MODAL_STYLE_ID;
  s.textContent = `
@keyframes sec-modal-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes sec-modal-sheet-in {
  from { opacity: 0; transform: scale(0.965) translateY(12px); }
  to   { opacity: 1; transform: scale(1)     translateY(0);    }
}
@keyframes sec-modal-alert-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 3px var(--sec-modal-accent-glow); }
  50%       { opacity: 0.78; box-shadow: 0 0 0 6px var(--sec-modal-accent-glow); }
}
@keyframes sec-modal-ring-flash {
  0%, 100% { background-color: rgba(251,191,36,0.20); }
  50%       { background-color: rgba(251,191,36,0.42); }
}
@keyframes sec-modal-live-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}
@keyframes sec-modal-chip-pop {
  0%   { transform: scale(0.55); opacity: 0; }
  100% { transform: scale(1);    opacity: 1; }
}
@keyframes sec-modal-scan {
  0%   { transform: translateY(-100%); opacity: 0.08; }
  100% { transform: translateY(100vh);  opacity: 0.02; }
}
/* Light-mode override: modal is always a dark surface */
body.light-mode .sec-modal-root {
  --text: 220 232 248;
  --glass-l1-bg: rgba(14, 20, 34, 0.96);
  --glass-l2-bg: rgba(22, 30, 48, 0.92);
  --glass-l3-bg: rgba(32, 42, 62, 0.88);
  --glass-l1-border: rgba(255,255,255,0.12);
  --glass-l2-border: rgba(255,255,255,0.14);
  --glass-l3-border: rgba(255,255,255,0.12);
  --glass-l1-tint: rgba(255,255,255,0.04);
  --glass-l2-tint: rgba(255,255,255,0.05);
  --glass-l3-tint: rgba(255,255,255,0.05);
  --glass-l1-backdrop: blur(24px) saturate(1.9) brightness(1.06);
  --glass-l2-backdrop: blur(22px) saturate(2.1) brightness(1.08);
  --glass-l3-backdrop: blur(10px) saturate(1.8) brightness(1.10);
  --rim: inset 0 1px 0 0 rgba(255,255,255,0.09), inset 0 -1px 0 0 rgba(0,0,0,0.28);
}
  `;
  document.head.appendChild(s);
}

// ── Color constants ────────────────────────────────────────────────────────────
const LEVEL_COLORS: Record<SecurityAlertLevel, { accent: string; glow: string; bg: string; label: string }> = {
  clear:  { accent: 'rgb(52 211 153)',   glow: 'rgba(52,211,153,0.35)',   bg: 'rgba(52,211,153,0.10)',  label: 'ALL CLEAR' },
  recent: { accent: 'rgb(251 146 60)',   glow: 'rgba(251,146,60,0.35)',   bg: 'rgba(251,146,60,0.10)',  label: 'RECENT ACTIVITY' },
  active: { accent: 'rgb(239 68 68)',    glow: 'rgba(239,68,68,0.40)',    bg: 'rgba(239,68,68,0.14)',   label: 'DETECTION ACTIVE' },
};

const MONO = '"JetBrains Mono", "Fira Code", "Courier New", monospace';

// ── Relative time helper ───────────────────────────────────────────────────────
function relativeTime(isoStr: string): string {
  if (!isoStr) return '';
  const delta = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (delta < 5)    return 'just now';
  if (delta < 60)   return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

// ── Camera thumbnail ───────────────────────────────────────────────────────────
const CameraThumb: React.FC<{
  camera: UnifiCamera;
  accent: string;
}> = ({ camera, accent }) => {
  const isActive = camera.motionActive || camera.doorbellActive ||
    Object.values(camera.detections).some(Boolean) || camera.licensePlateDetected;

  const detectionLabels: string[] = [];
  if (camera.doorbellActive)       detectionLabels.push('RING');
  if (camera.detections.person)    detectionLabels.push('PERSON');
  if (camera.detections.vehicle)   detectionLabels.push('VEHICLE');
  if (camera.detections.animal)    detectionLabels.push('ANIMAL');
  if (camera.detections.package)   detectionLabels.push('PKG');
  if (camera.motionActive && detectionLabels.length === 0) detectionLabels.push('MOTION');
  if (camera.licensePlateDetected) detectionLabels.push('PLATE');

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        aspectRatio: '16/9',
        backgroundColor: 'rgba(8, 12, 20, 0.92)',
        border: `1px solid ${isActive ? `color-mix(in srgb, ${accent} 55%, rgba(255,255,255,0.1))` : 'var(--glass-l3-border)'}`,
        boxShadow: isActive ? `0 0 16px -4px color-mix(in srgb, ${accent} 50%, transparent)` : 'none',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
        flexShrink: 0,
      }}
    >
      {/* Snapshot */}
      {camera.entityPicture ? (
        <img
          src={camera.entityPicture}
          alt={camera.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconCamera style={{ width: 28, height: 28, color: 'rgba(255,255,255,0.18)' }} />
        </div>
      )}

      {/* Active border pulse */}
      {isActive && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          border: `2px solid ${accent}`,
          animation: 'sec-modal-alert-pulse 1.8s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Detection chips */}
      {detectionLabels.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          display: 'flex', flexWrap: 'wrap', gap: 3, padding: '5px 6px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)',
        }}>
          {detectionLabels.map(lbl => (
            <span
              key={lbl}
              style={{
                fontFamily: MONO, fontSize: '0.48rem', fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '2px 5px', borderRadius: 3,
                backgroundColor: lbl === 'RING' ? 'rgba(251,191,36,0.88)' : 'rgba(239,68,68,0.82)',
                color: lbl === 'RING' ? '#1a0a00' : '#fff',
                animation: 'sec-modal-chip-pop 0.22s cubic-bezier(0.34,1.56,0.64,1) both',
              }}
            >{lbl}</span>
          ))}
        </div>
      )}

      {/* Camera name */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '4px 6px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)',
      }}>
        <span style={{
          fontFamily: MONO, fontSize: '0.5rem', fontWeight: 600,
          color: 'rgba(255,255,255,0.85)', letterSpacing: '0.04em',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}>{camera.name}</span>
      </div>

      {/* STALE badge */}
      {camera.isStale && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700,
          color: 'rgba(255,255,255,0.55)', letterSpacing: '0.05em',
          backgroundColor: 'rgba(0,0,0,0.55)', padding: '3px 7px', borderRadius: 4,
        }}>STALE</div>
      )}
    </div>
  );
};

// ── Event timeline row ─────────────────────────────────────────────────────────
const EVENT_META: Record<UnifiEvent['kind'], { label: string; color: string }> = {
  doorbell:    { label: 'RING',    color: 'rgb(251 191 36)' },
  vehicle:     { label: 'VEHICLE', color: 'rgb(251 146 60)' },
  nfc:         { label: 'NFC',     color: 'rgb(96 165 250)' },
  fingerprint: { label: 'FPRINT',  color: 'rgb(167 139 250)' },
  unknown:     { label: 'EVENT',   color: 'rgba(var(--text) / 0.45)' },
};

interface FlatEvent { cam: UnifiCamera; ev: UnifiEvent }

const EventRow: React.FC<{ fe: FlatEvent; idx: number }> = ({ fe, idx }) => {
  const meta = EVENT_META[fe.ev.kind];
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px',
        borderRadius: 'var(--radius-control)',
        backdropFilter: 'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)',
        boxShadow: 'var(--rim)',
        opacity: Math.max(0.45, 1 - idx * 0.06),
        animation: idx < 3 ? 'sec-modal-chip-pop 0.28s ease both' : 'none',
        animationDelay: `${idx * 30}ms`,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: meta.color, boxShadow: `0 0 5px ${meta.color}` }} />
      <span style={{ fontFamily: MONO, fontSize: '0.56rem', fontWeight: 700, color: meta.color, minWidth: '3.6rem', letterSpacing: '0.04em' }}>{meta.label}</span>
      <span style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'rgba(255,255,255,0.6)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fe.cam.name}</span>
      <span style={{ fontFamily: MONO, fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{relativeTime(fe.ev.lastUpdated)}</span>
    </div>
  );
};

// ── Floodlight row ─────────────────────────────────────────────────────────────
const FloodlightRow: React.FC<{ name: string; isOn: boolean }> = ({ name, isOn }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 10px', borderRadius: 'var(--radius-control)',
    backgroundColor: 'var(--glass-l3-bg)', border: '1px solid var(--glass-l3-border)',
    backdropFilter: 'var(--glass-l3-backdrop)', WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
  }}>
    <span style={{
      width: 7, height: 7, borderRadius: 999, flexShrink: 0,
      background: isOn ? 'rgb(254 240 138)' : 'rgba(var(--text) / 0.2)',
      boxShadow: isOn ? '0 0 6px rgb(254 240 138)' : 'none',
    }} />
    <span style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'rgba(var(--text) / 0.7)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    <span style={{ fontFamily: MONO, fontSize: '0.52rem', fontWeight: 700, color: isOn ? 'rgb(254 240 138)' : 'rgba(var(--text) / 0.3)', letterSpacing: '0.04em' }}>{isOn ? 'ON' : 'OFF'}</span>
    {/* DISPLAY ONLY — no control wired. Floodlight control is equipment-gated. */}
  </div>
);

// ── Main export ────────────────────────────────────────────────────────────────

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  indicatorState: SecurityIndicatorState;
}

const SecurityModal: React.FC<SecurityModalProps> = ({ isOpen, onClose, indicatorState }) => {
  const navigate = useNavigate();
  const { cameras, floodlights } = useUnifiSurface();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  // Tick every 15s for relative-time freshness
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  // Click-outside to close
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const { level, summary, doorbellActive, activeCameraCount } = indicatorState;
  const colors = LEVEL_COLORS[level];

  // Flatten events newest-first
  const allEvents: FlatEvent[] = cameras
    .flatMap(cam => cam.recentEvents.map(ev => ({ cam, ev })))
    .sort((a, b) => b.ev.lastUpdated.localeCompare(a.ev.lastUpdated))
    .slice(0, 16);

  // Camera grid columns
  const camCols = cameras.length <= 2 ? cameras.length : cameras.length <= 4 ? 2 : cameras.length <= 6 ? 3 : 4;

  const headerIcon = level === 'active'
    ? <IconAlertTriangle style={{ width: 22, height: 22, color: colors.accent, filter: `drop-shadow(0 0 6px ${colors.accent})` }} />
    : level === 'recent'
    ? <IconShieldAlert style={{ width: 22, height: 22, color: colors.accent }} />
    : <IconShieldCheck style={{ width: 22, height: 22, color: colors.accent }} />;

  return (
    <div
      className="sec-modal-root"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'sec-modal-backdrop-in 200ms ease both',
        // --sec-modal-accent-glow is consumed by the pulse animation
        ['--sec-modal-accent-glow' as any]: colors.glow,
      }}
      onClick={handleBackdropClick}
    >
      {/* Blurred backdrop — deep security-dark */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundColor: 'rgba(6, 8, 16, 0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }} />

      {/* Subtle moving scan line behind sheet */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 2, pointerEvents: 'none',
        background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${colors.accent} 7%, transparent) 50%, transparent 100%)`,
        animation: 'sec-modal-scan 10s linear infinite',
        zIndex: 1,
      }} />

      {/* Alert bloom when active */}
      {level === 'active' && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(110% 60% at 50% 100%, rgba(220,38,38,0.18), transparent 65%)`,
          mixBlendMode: 'screen',
          animation: 'sec-modal-alert-pulse 2.4s ease-in-out infinite',
          zIndex: 1,
        }} />
      )}

      {/* Sheet */}
      <div
        ref={sheetRef}
        style={{
          position: 'relative', zIndex: 2,
          width: 'min(96vw, 1200px)',
          maxHeight: '90vh',
          borderRadius: 'var(--radius-surface)',
          ...glassMaterial(1),
          backgroundColor: 'rgba(10, 14, 24, 0.94)',
          border: `1px solid color-mix(in srgb, ${colors.accent} ${level === 'active' ? 42 : level === 'recent' ? 26 : 16}%, var(--glass-l1-border))`,
          boxShadow: [
            'var(--rim)',
            `0 0 60px -10px color-mix(in srgb, ${colors.accent} ${level === 'active' ? 45 : 20}%, transparent)`,
            'var(--elev-5)',
          ].join(', '),
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'sec-modal-sheet-in 280ms cubic-bezier(0.22,1,0.36,1) both',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header bar ────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid color-mix(in srgb, ${colors.accent} 22%, var(--glass-l2-border))`,
          backgroundColor: colors.bg,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {headerIcon}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{
                fontFamily: MONO, fontSize: '0.9rem', fontWeight: 800,
                letterSpacing: '-0.01em', color: 'rgb(225 235 248)',
                textShadow: '0 1px 8px rgba(0,0,0,0.5)',
              }}>Security Overview</span>

              {/* Status chip */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700,
                letterSpacing: '0.07em',
                color: colors.accent,
                backgroundColor: colors.bg,
                border: `1px solid color-mix(in srgb, ${colors.accent} 42%, transparent)`,
                width: 'fit-content',
                animation: level === 'active' ? 'sec-modal-alert-pulse 1.8s ease-in-out infinite' : 'none',
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: 999,
                  background: colors.accent, boxShadow: `0 0 5px ${colors.accent}`,
                  flexShrink: 0,
                  animation: 'sec-modal-live-blink 1.4s ease-in-out infinite',
                }} />
                {summary}
              </span>
            </div>

            {/* Active detection beads */}
            {activeCameraCount > 0 && (
              <div style={{
                padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700,
                color: colors.accent,
                backgroundColor: `color-mix(in srgb, ${colors.accent} 16%, rgba(0,0,0,0.5))`,
                border: `1px solid color-mix(in srgb, ${colors.accent} 40%, transparent)`,
                animation: 'sec-modal-alert-pulse 2s ease-in-out infinite',
                letterSpacing: '0.04em',
              }}>
                {activeCameraCount} ACTIVE
              </div>
            )}

            {/* Doorbell bead */}
            {doorbellActive && (
              <div style={{
                padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700,
                color: '#1a0a00', backgroundColor: 'rgb(251 191 36)',
                animation: 'sec-modal-ring-flash 0.8s ease-in-out infinite',
                letterSpacing: '0.04em',
              }}>
                DOORBELL
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* NOTE: No arm/disarm button. No alarm panel integrated yet.
                Display-only. Equipment-gated control is deferred. */}

            {/* Open full Security area */}
            <button
              onClick={() => { onClose(); navigate('/area/security'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 'var(--radius-control)',
                backdropFilter: 'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: `color-mix(in srgb, ${colors.accent} 14%, var(--glass-l3-bg))`,
                border: `1px solid color-mix(in srgb, ${colors.accent} 40%, var(--glass-l3-border))`,
                color: colors.accent, cursor: 'pointer',
                fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
                transition: 'all 160ms ease',
              }}
              title="Open full Security view"
            >
              <IconCamera style={{ width: 13, height: 13 }} />
              Full View
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: 999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: 'var(--glass-l3-bg)',
                border: '1px solid var(--glass-l3-border)',
                cursor: 'pointer', color: 'rgba(var(--text) / 0.7)',
              }}
              aria-label="Close security overview"
            >
              <IconX style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {/* ── Body: two-column layout ────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: allEvents.length > 0 || floodlights.length > 0 ? '1fr 320px' : '1fr',
          gap: 0,
          flex: 1, overflow: 'hidden',
        }}>
          {/* LEFT: camera grid */}
          <div style={{ overflowY: 'auto', padding: '16px 20px', borderRight: allEvents.length > 0 || floodlights.length > 0 ? '1px solid var(--glass-l2-border)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <IconCamera style={{ width: 13, height: 13, color: colors.accent }} />
              <span style={{ fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: `color-mix(in srgb, ${colors.accent} 80%, rgba(var(--text) / 0.4))`, textTransform: 'uppercase' }}>
                Cameras · {cameras.length}
              </span>
              <div style={{ flex: 1, height: '1px', background: `color-mix(in srgb, ${colors.accent} 20%, var(--glass-l2-border))` }} />
            </div>

            {cameras.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: 120, gap: 8,
              }}>
                <IconCamera style={{ width: 32, height: 32, color: 'rgba(var(--text) / 0.18)' }} />
                <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'rgba(var(--text) / 0.3)', letterSpacing: '0.05em', textAlign: 'center' }}>
                  No UniFi Protect cameras found in Home Assistant
                </span>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${camCols}, 1fr)`,
                gap: 8,
              }}>
                {cameras.map(cam => (
                  <CameraThumb key={cam.entityId} camera={cam} accent={colors.accent} />
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: events + floodlights */}
          {(allEvents.length > 0 || floodlights.length > 0) && (
            <div style={{ overflowY: 'auto', padding: '16px 16px' }}>
              {/* Events */}
              {allEvents.length > 0 && (
                <div style={{ marginBottom: floodlights.length > 0 ? 16 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <IconActivity style={{ width: 13, height: 13, color: colors.accent }} />
                    <span style={{ fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: `color-mix(in srgb, ${colors.accent} 80%, rgba(var(--text) / 0.4))`, textTransform: 'uppercase' }}>Recent Events</span>
                    <div style={{ flex: 1, height: '1px', background: `color-mix(in srgb, ${colors.accent} 20%, var(--glass-l2-border))` }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {allEvents.map((fe, i) => (
                      <EventRow key={`${fe.ev.entityId}-${fe.ev.lastUpdated}`} fe={fe} idx={i} />
                    ))}
                  </div>
                </div>
              )}

              {/* Floodlights — DISPLAY ONLY, no control */}
              {floodlights.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: 'rgba(var(--text) / 0.45)', textTransform: 'uppercase' }}>Floodlights</span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--glass-l2-border)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {floodlights.map(fl => (
                      <FloodlightRow key={fl.entityId} name={fl.name} isOn={fl.isOn} />
                    ))}
                  </div>
                  {/* Equipment-gated note */}
                  <span style={{ fontFamily: MONO, fontSize: '0.48rem', color: 'rgba(var(--text) / 0.28)', letterSpacing: '0.04em', display: 'block', marginTop: 6 }}>
                    DISPLAY ONLY · control deferred (equipment-gated)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px',
          borderTop: '1px solid var(--glass-l2-border)',
          backgroundColor: 'rgba(0,0,0,0.25)',
          flexShrink: 0,
        }}>
          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: '0.42rem', height: '0.42rem', borderRadius: 999,
              background: 'rgb(52 211 153)', boxShadow: '0 0 5px rgb(52 211 153)',
              animation: 'sec-modal-live-blink 1.8s ease-in-out infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'rgb(52 211 153)', fontWeight: 700, letterSpacing: '0.05em' }}>LIVE</span>
          </div>

          {/* Display-only / no-arm disclaimer */}
          <span style={{ fontFamily: MONO, fontSize: '0.5rem', color: 'rgba(var(--text) / 0.28)', letterSpacing: '0.04em', textAlign: 'right' }}>
            Display only · No arm/disarm control (no alarm panel integrated) · Tap outside to close
          </span>
        </div>
      </div>
    </div>
  );
};

export default SecurityModal;
