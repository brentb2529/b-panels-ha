/**
 * SecurityStatusIndicator — global always-visible security state pill.
 *
 * Placed in the Header (right-side chrome) and used by the NavRail to tint
 * the Security nav item. Drives the SecurityModal:
 *
 *   - Tap / click → opens SecurityModal immediately.
 *   - AUTO-SURFACES the modal when level transitions to 'active' (active
 *     detection or doorbell ring). Auto-surfaces only once per transition —
 *     it won't keep reopening on every re-render while already active.
 *
 * COLOR LOGIC (from real UniFi data via useSecurityIndicator):
 *   'clear'  → green   (calm, silent)
 *   'recent' → amber   (yellow-orange, activity within last 3 min)
 *   'active' → RED, pulsing — impossible to miss
 *
 * NO arm/disarm state is shown here. The existing ArmingStatusIndicator
 * handles that if/when an alarm_control_panel is wired.
 *
 * SECURITY CONTRACT: read-only, display only. No HA writes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSecurityIndicator } from '../hooks/useSecurityIndicator';
import type { SecurityAlertLevel } from '../hooks/useSecurityIndicator';
import SecurityModal from './SecurityModal';
import { IconShieldAlert, IconShieldCheck, IconAlertTriangle } from './icons';

// ── Animation keyframes ───────────────────────────────────────────────────────
const PILL_STYLE_ID = 'sec-pill-anims';
if (typeof document !== 'undefined' && !document.getElementById(PILL_STYLE_ID)) {
  const s = document.createElement('style');
  s.id = PILL_STYLE_ID;
  s.textContent = `
@keyframes sec-pill-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.82; transform: scale(0.97); }
}
@keyframes sec-pill-dot-blink {
  0%, 100% { opacity: 1; box-shadow: 0 0 5px currentColor; }
  50%       { opacity: 0.3; box-shadow: 0 0 2px currentColor; }
}
@keyframes sec-pill-ring-out {
  0%   { transform: scale(1);    opacity: 0.6; }
  100% { transform: scale(2.4);  opacity: 0; }
}
  `;
  document.head.appendChild(s);
}

// ── Level → visual config ─────────────────────────────────────────────────────
export interface SecurityLevelConfig {
  accent: string;
  bg: string;
  border: string;
  label: string;
  pulse: boolean;
}

export const SECURITY_LEVEL_CONFIG: Record<SecurityAlertLevel, SecurityLevelConfig> = {
  clear: {
    accent: 'rgb(52 211 153)',
    bg:     'rgba(52, 211, 153, 0.12)',
    border: 'rgba(52, 211, 153, 0.32)',
    label:  'CLEAR',
    pulse:  false,
  },
  recent: {
    accent: 'rgb(251 146 60)',
    bg:     'rgba(251, 146, 60, 0.14)',
    border: 'rgba(251, 146, 60, 0.40)',
    label:  'ACTIVITY',
    pulse:  false,
  },
  active: {
    accent: 'rgb(239 68 68)',
    bg:     'rgba(239, 68, 68, 0.18)',
    border: 'rgba(239, 68, 68, 0.55)',
    label:  'ALERT',
    pulse:  true,
  },
};

// ── Pill icon per level ───────────────────────────────────────────────────────
const LevelIcon: React.FC<{ level: SecurityAlertLevel; size?: number; color: string }> = ({ level, size = 14, color }) => {
  const props = { style: { width: size, height: size, color, flexShrink: 0 as const } };
  if (level === 'active') return <IconAlertTriangle {...props} />;
  if (level === 'recent') return <IconShieldAlert {...props} />;
  return <IconShieldCheck {...props} />;
};

// ── Main pill component ───────────────────────────────────────────────────────

interface SecurityStatusIndicatorProps {
  /** 'pill' renders the full labeled badge (for Header). 'compact' renders just icon+dot (for NavRail badge). */
  variant?: 'pill' | 'compact';
  className?: string;
}

const SecurityStatusIndicator: React.FC<SecurityStatusIndicatorProps> = ({
  variant = 'pill',
  className,
}) => {
  const indicatorState = useSecurityIndicator();
  const { level, summary, isLoading } = indicatorState;

  const [modalOpen, setModalOpen] = useState(false);
  const lastLevelRef = useRef<SecurityAlertLevel | null>(null);
  const autoOpenedRef = useRef(false);

  // AUTO-SURFACE the modal when transitioning into 'active' state.
  // Only fires once per transition into 'active'; resets when level falls back.
  useEffect(() => {
    if (isLoading) return;
    const prevLevel = lastLevelRef.current;
    lastLevelRef.current = level;

    if (level === 'active' && prevLevel !== 'active' && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setModalOpen(true);
    } else if (level !== 'active') {
      autoOpenedRef.current = false;
    }
  }, [level, isLoading]);

  const handleOpen  = useCallback(() => setModalOpen(true),  []);
  const handleClose = useCallback(() => setModalOpen(false), []);

  if (isLoading) return null;

  const cfg = SECURITY_LEVEL_CONFIG[level];
  const MONO = '"JetBrains Mono", "Fira Code", "Courier New", monospace';

  if (variant === 'compact') {
    // Just the icon + a colored dot — used by NavRail
    return (
      <>
        <span
          onClick={handleOpen}
          style={{
            position: 'relative', display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer',
          }}
          title={`Security: ${summary}`}
          aria-label={`Security status: ${summary}`}
        >
          <LevelIcon level={level} color={cfg.accent} />
          {/* Badge dot */}
          <span style={{
            position: 'absolute', top: -2, right: -3,
            width: 7, height: 7, borderRadius: 999,
            background: cfg.accent,
            border: '1.5px solid var(--glass-l2-bg, #1a2233)',
            animation: cfg.pulse ? 'sec-pill-dot-blink 1.2s ease-in-out infinite' : 'none',
          }} />
        </span>

        <SecurityModal
          isOpen={modalOpen}
          onClose={handleClose}
          indicatorState={indicatorState}
        />
      </>
    );
  }

  // Pill variant (Header)
  return (
    <>
      <button
        onClick={handleOpen}
        className={className}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 11px',
          borderRadius: 'var(--radius-pill, 9999px)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          backgroundColor: cfg.bg,
          border: `1px solid ${cfg.border}`,
          cursor: 'pointer',
          transition: 'all 260ms cubic-bezier(0.22,1,0.36,1)',
          animation: cfg.pulse ? 'sec-pill-pulse 1.5s ease-in-out infinite' : 'none',
          // Outer glow ring for ACTIVE state
          boxShadow: level === 'active'
            ? `0 0 0 1px ${cfg.border}, 0 0 18px -4px ${cfg.accent}88`
            : 'none',
        }}
        title={summary}
        aria-label={`Security status: ${summary}. Tap to open security overview.`}
      >
        {/* Expanding ring for ACTIVE state */}
        {level === 'active' && (
          <span style={{
            position: 'absolute', inset: 0, borderRadius: 'inherit',
            border: `2px solid ${cfg.accent}`,
            animation: 'sec-pill-ring-out 1.8s ease-out infinite',
            pointerEvents: 'none',
          }} />
        )}

        {/* Icon */}
        <LevelIcon level={level} color={cfg.accent} size={14} />

        {/* Status dot — blinks on active */}
        <span style={{
          width: 6, height: 6, borderRadius: 999,
          background: cfg.accent,
          color: cfg.accent,
          boxShadow: `0 0 5px ${cfg.accent}`,
          flexShrink: 0,
          animation: cfg.pulse
            ? 'sec-pill-dot-blink 1.2s ease-in-out infinite'
            : 'none',
        }} />

        {/* Label */}
        <span style={{
          fontFamily: MONO,
          fontSize: '0.64rem',
          fontWeight: 700,
          letterSpacing: '0.07em',
          color: cfg.accent,
          textShadow: level === 'active' ? `0 0 8px ${cfg.accent}88` : 'none',
          whiteSpace: 'nowrap',
        }}>
          {cfg.label}
        </span>
      </button>

      <SecurityModal
        isOpen={modalOpen}
        onClose={handleClose}
        indicatorState={indicatorState}
      />
    </>
  );
};

export default SecurityStatusIndicator;
