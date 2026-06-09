/**
 * SecurityModal — quick-access security status overlay, triggered from the
 * ArmingStatusIndicator in the Header.
 *
 * BUG FIX: The Header uses `backdropFilter` (for its frosted-glass look).
 * In Chromium, any `position: fixed` child inside a `backdrop-filter` ancestor
 * is contained by that ancestor rather than the viewport — so the overlay would
 * be clipped to the 64px header bar.
 *
 * FIX: Render via `ReactDOM.createPortal(..., document.body)` to escape the
 * transformed/filtered ancestor and cover the full viewport.
 *
 * Behaviour:
 *   - Auto-surfaces from ArmingStatusIndicator when tapped in the header.
 *   - Tap backdrop (outside panel) → close.
 *   - "Full View" button → navigates to /area/security and closes.
 *   - Escape key → close.
 *   - Shows current alarm arm state, zone readiness, and active detections.
 *   - Display-only: no arm/disarm controls here (those remain in the
 *     EntryDelayModal / IntrusionModal / AlarmTile flows).
 */

import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { glassMaterial } from '../design-system/theme';
import { useReducedMotion } from '../design-system/useReducedMotion';
import {
  IconX,
  IconShieldCheck,
  IconShieldAlert,
  IconShieldOff,
  IconShield,
  IconAlertTriangle,
  IconCamera,
  IconChevronRight,
} from './icons';

// ── SecurityModal ─────────────────────────────────────────────────────────────

interface SecurityModalProps {
  onClose: () => void;
}

const SecurityModal: React.FC<SecurityModalProps> = ({ onClose }) => {
  const { alarmState, armingState } = useDashboard();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);

  // Enter animation.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  const handleFullView = useCallback(() => {
    close();
    // Small delay so the close animation starts before navigation.
    window.setTimeout(() => navigate('/area/security'), 100);
  }, [close, navigate]);

  // Escape to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close]);

  // ── Derive display state ──────────────────────────────────────────────────

  const isViolation = alarmState?.securityState === 'VIOLATION';
  const armState = alarmState?.armState ?? 'disarmed';

  const { icon: stateIcon, label: stateLabel, color: stateColor } = (() => {
    if (isViolation) {
      return {
        icon: <IconAlertTriangle className="w-6 h-6" />,
        label: 'Intrusion Detected',
        color: 'rgb(var(--accent-alert))',
      };
    }
    if (armState === 'armedAway') {
      return {
        icon: <IconShieldAlert className="w-6 h-6" />,
        label: 'Armed Away',
        color: 'rgb(var(--accent-warn))',
      };
    }
    if (armState === 'armedStay') {
      return {
        icon: <IconShield className="w-6 h-6" />,
        label: 'Armed Stay',
        color: 'rgb(var(--accent-warn))',
      };
    }
    return {
      icon: <IconShieldCheck className="w-6 h-6" />,
      label: 'Disarmed',
      color: 'rgb(52,211,153)',
    };
  })();

  const readinessLabel = (() => {
    if (armState !== 'disarmed') return null;
    if (armingState === 'ready') return { text: 'All zones ready', ok: true };
    if (armingState === 'not_ready') return { text: 'Zone not ready', ok: false };
    return null;
  })();

  return ReactDOM.createPortal(
    // Backdrop — tap to close. Portal into document.body escapes the Header's
    // backdrop-filter so position:fixed covers the full viewport.
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9100,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        paddingTop: 72, // below the 64px header
        paddingRight: 24,
        opacity: visible ? 1 : 0,
        transition: 'opacity 180ms ease',
      }}
    >
      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...glassMaterial(2),
          borderRadius: 'var(--radius-card)',
          padding: '20px 20px 16px',
          width: 280,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          transform: visible
            ? 'translateY(0) scale(1)'
            : 'translateY(-10px) scale(0.97)',
          opacity: visible ? 1 : 0,
          transition: reducedMotion
            ? 'opacity 180ms ease'
            : 'opacity 200ms ease, transform 220ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: `color-mix(in srgb, ${stateColor} 15%, transparent)`,
                border: `1px solid color-mix(in srgb, ${stateColor} 30%, transparent)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: stateColor,
              }}
            >
              {stateIcon}
            </div>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'rgb(var(--text))',
                  letterSpacing: '-0.01em',
                }}
              >
                Security
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: stateColor,
                }}
              >
                {stateLabel}
              </div>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={close}
            aria-label="Close security overview"
            style={{
              padding: 6,
              borderRadius: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgb(var(--text) / 0.4)',
              display: 'flex',
            }}
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {/* Zone readiness (only while disarmed) */}
        {readinessLabel && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 8,
              backgroundColor: readinessLabel.ok
                ? 'rgba(52,211,153,0.10)'
                : 'rgb(var(--accent-warn) / 0.10)',
              border: `1px solid ${readinessLabel.ok ? 'rgba(52,211,153,0.25)' : 'rgb(var(--accent-warn) / 0.25)'}`,
            }}
          >
            {readinessLabel.ok
              ? <IconShieldCheck className="w-4 h-4" style={{ color: 'rgb(52,211,153)', flexShrink: 0 }} />
              : <IconShieldOff className="w-4 h-4" style={{ color: 'rgb(var(--accent-warn))', flexShrink: 0 }} />
            }
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: readinessLabel.ok ? 'rgb(52,211,153)' : 'rgb(var(--accent-warn))',
              }}
            >
              {readinessLabel.text}
            </span>
          </div>
        )}

        {/* Camera indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            backgroundColor: 'rgb(var(--surface) / 0.5)',
            border: '1px solid rgb(var(--text) / 0.08)',
          }}
        >
          <IconCamera className="w-4 h-4" style={{ color: 'rgb(var(--text) / 0.45)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--text) / 0.55)' }}>
            Camera & sensor feed
          </span>
        </div>

        {/* Full View button */}
        <button
          onClick={handleFullView}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            backgroundColor: 'rgb(var(--accent) / 0.12)',
            border: '1px solid rgb(var(--accent) / 0.25)',
            cursor: 'pointer',
            color: 'rgb(var(--accent))',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.01em',
            width: '100%',
            transition: reducedMotion ? 'none' : 'background-color 120ms ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--accent) / 0.2)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--accent) / 0.12)';
          }}
        >
          <span>Full View</span>
          <IconChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>,
    document.body
  );
};

export default SecurityModal;
