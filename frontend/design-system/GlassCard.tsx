import React from 'react';
import { IconLock, IconWifiOff } from '../components/icons';
import { fluidTextSm } from '../components/tiles/tileScale';

// ---------------------------------------------------------------------------
// GlassCard — the shared liquid-glass tile shell for the NEW design-language
// tiles. It is the design-system analogue of the legacy `TileWrapper`: same
// prop shape (label / isActive / isUnavailable / accent / onClick / isEditor /
// isLocked / isProtected), so porting a tile is a near-1:1 swap of the wrapper.
//
// Visuals come from `tokens.css` (the `.bp-glass-card` material + `.bp-*`
// helpers), scoped under `.bp-glass-scope` which this component always applies
// to its root. Legacy tiles never carry that class and are therefore never
// restyled — the whole design system is additive/non-breaking by scope.
// ---------------------------------------------------------------------------

// The locked cool area-accent family + state semantics, as token names. A tile
// passes the accent matching its area/semantic; GlassCard maps it to the
// `--bp-accent-rgb` triplet the material reads for the active glow.
export type GlassAccent =
  | 'pool'
  | 'climate'
  | 'security'
  | 'lights'
  | 'positive'
  | 'warning'
  | 'critical'
  | 'heat';

const ACCENT_VAR: Record<GlassAccent, string> = {
  pool: 'var(--bp-accent-pool-rgb)',
  climate: 'var(--bp-accent-climate-rgb)',
  security: 'var(--bp-accent-security-rgb)',
  lights: 'var(--bp-accent-lights-rgb)',
  positive: 'var(--bp-positive-rgb)',
  warning: 'var(--bp-warning-rgb)',
  critical: 'var(--bp-critical-rgb)',
  heat: 'var(--bp-accent-heat-rgb)',
};

export interface GlassCardProps {
  label?: string;
  isActive?: boolean;
  isUnavailable?: boolean;
  isLocked?: boolean;
  isProtected?: boolean;
  isEditor?: boolean;
  accent?: GlassAccent;
  onClick?: () => void;
  className?: string;
  /** Suppress the page-load fade-in (e.g. when rendered in the editor grid). */
  noFadeIn?: boolean;
}

const GlassCard = ({
  label,
  isActive,
  isUnavailable,
  isLocked,
  isProtected,
  isEditor,
  accent = 'lights',
  onClick,
  className = '',
  noFadeIn,
  children,
}: React.PropsWithChildren<GlassCardProps>) => {
  const isInteractive = !!onClick && !isEditor && !isLocked;

  const classes = [
    'bp-glass-scope',
    'bp-glass-card',
    !noFadeIn ? 'bp-fade-in' : '',
    isActive && !isUnavailable ? 'is-active' : '',
    isInteractive ? 'is-interactive' : '',
    isUnavailable ? 'is-unavailable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{
        // Per-tile accent the material's glow/rim read from.
        ['--bp-accent-rgb' as any]: ACCENT_VAR[accent],
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 'clamp(0.5rem, 7cqmin, 1rem)',
      }}
      onClick={isInteractive ? onClick : undefined}
    >
      {/* Top-right: offline badge (precedence) or lock glyph. */}
      {isUnavailable ? (
        <IconWifiOff className="absolute top-2 right-2 w-4 h-4 z-20" style={{ color: 'var(--bp-text-dim)' }} />
      ) : (
        (isProtected || isLocked) && (
          <IconLock className="absolute top-2 right-2 w-4 h-4 z-10" style={{ color: 'var(--bp-text-dim)' }} />
        )
      )}

      {isLocked && !isEditor && (
        <div className="absolute inset-0 pointer-events-none z-10" style={{ background: 'rgba(0,0,0,0.25)' }} />
      )}

      <div className="flex-1 w-full flex flex-col justify-center items-center text-center overflow-hidden min-h-0 relative z-0">
        {children}
      </div>

      {label && (
        <p
          className="bp-card-title w-full text-center truncate shrink-0 relative z-10"
          style={{ ...fluidTextSm, paddingTop: 'clamp(0.125rem, 2cqmin, 0.5rem)', lineHeight: 1.25 }}
        >
          {label}
        </p>
      )}
    </div>
  );
};

export default GlassCard;
