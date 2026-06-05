
import React from 'react';
import { IconLock, IconWifiOff } from '../icons';
import { TileAnimationConfig } from '../../types';
import BatteryIndicator from '../BatteryIndicator';
import { fluidTextSm, fluidPad } from './tileScale';

// Semantic accent keys -> the CSS-variable triplets defined in index.html.
// A tile passes the accent matching its device's meaning (a light glows amber,
// a plug green, a lock/alarm red, water blue) so the active state lights up in
// the device's own color instead of a single hardcoded electric blue.
export type TileAccent = 'brand' | 'light' | 'plug' | 'water' | 'alert' | 'warn';

const ACCENT_TRIPLET: Record<TileAccent, string> = {
  brand: 'var(--accent)',
  light: 'var(--accent-light)',
  plug: 'var(--accent-plug)',
  water: 'var(--accent-water)',
  alert: 'var(--accent-alert)',
  warn: 'var(--accent-warn)',
};

type TileWrapperProps = {
  label: string;
  isActive?: boolean;
  isProtected?: boolean;
  isLocked?: boolean;
  isUnavailable?: boolean;
  accent?: TileAccent;
  className?: string;
  onClick?: () => void;
  isEditor?: boolean;
  animation?: TileAnimationConfig;
  batteryLevel?: number;
  batteryPosition?: 'top-left' | 'bottom';
};

const TileWrapper = ({
    label,
    isActive,
    isProtected,
    isLocked,
    isUnavailable,
    accent = 'brand',
    children,
    className = '',
    onClick,
    isEditor,
    animation,
    batteryLevel,
    batteryPosition = 'top-left'
}: React.PropsWithChildren<TileWrapperProps>) => {
  const isInteractive = !!onClick && !isEditor && !isLocked;

  const showAnimation = !isEditor && isActive && animation?.enabled;
  const animationEffectClasses: Record<string, string> = {
    pulse: 'animate-pulse',
    bounce: 'animate-bounce',
  };
  const effectClass = showAnimation ? animationEffectClasses[animation.effect || 'pulse'] : '';

  let animationStyle = {};
  if (showAnimation && animation.color) {
      animationStyle = { backgroundColor: animation.color };
  }

  // The active treatment is derived from the device's semantic accent: a tinted
  // glass surface plus a ring + soft glow in that color (replaces the former
  // one-size-fits-all cyan ring). When `isUnavailable`, the active glow is
  // suppressed and the whole tile is desaturated/dimmed.
  const triplet = ACCENT_TRIPLET[accent];
  const accentColor = `rgb(${triplet})`;
  const restBg = `rgb(var(--surface) / var(--tile-alpha))`;
  const activeGlow = isActive && !showAnimation && !isUnavailable;

  const containerStyle: React.CSSProperties = {
    ...fluidPad(0.625),
    // Active tiles are tinted toward their accent and ringed/glowed in it. The
    // tint % and ring opacity are deliberately higher now that the surface is
    // near-opaque (--tile-alpha ~0.94): a low-% mix barely registered against
    // the solid fill, so the active state was hard to read at a glance across
    // the room. 24% tint + a fully-opaque accent ring + an INSET accent glow
    // make "on" unmistakable without washing out the content. The glow is inset
    // (not an outer 0 0 26px shadow) so the highlight stays within the tile's
    // rounded border instead of bleeding a halo past the edges.
    backgroundColor: activeGlow
      ? `color-mix(in srgb, ${accentColor} 24%, ${restBg})`
      : restBg,
    // A top-lit sheen over the fill gives every tile a subtly curved, physical
    // surface instead of a flat rectangle — light at the top, shading toward
    // the bottom. Paired with the bevel insets below (bright top edge + inner
    // bottom shadow) and the elevation drop-shadow, the tile reads as a lifted,
    // dimensional card.
    backgroundImage: 'linear-gradient(180deg, rgb(255 255 255 / 0.06) 0%, rgb(255 255 255 / 0) 40%, rgb(0 0 0 / 0.13) 100%)',
    border: `1px solid ${activeGlow ? `rgb(${triplet} / 0.85)` : 'var(--tile-border)'}`,
    backdropFilter: 'blur(var(--tile-blur))',
    WebkitBackdropFilter: 'blur(var(--tile-blur))',
    boxShadow: activeGlow
      ? `inset 0 1px 0 rgb(255 255 255 / 0.16), inset 0 -3px 7px rgb(0 0 0 / 0.22), inset 0 0 18px -2px ${accentColor}, var(--elev-1)`
      : `inset 0 1px 0 rgb(255 255 255 / 0.13), inset 0 -3px 7px rgb(0 0 0 / 0.22), var(--elev-1)`,
  };

  // `bg-gray-700` is retained for the `.tile-borders` toggle and light-mode
  // selectors that target it; the inline backgroundColor above supersedes its
  // fill with the frosted-glass surface.
  // Always apply the default tile radius UNLESS the caller's className already
  // specifies a rounding (e.g. grouped-tile corner classes). This keeps tiles
  // that pass a background override (CameraTile `!bg-black`, AlarmTile colors)
  // from rendering square.
  const callerSetsRadius = /\brounded(-|\b)/.test(className);
  const containerClasses = [
    'bg-gray-700 flex flex-col justify-between items-center transition-all duration-200 ease-in-out relative h-full overflow-hidden',
    callerSetsRadius ? '' : 'rounded-tile',
    className,
    isInteractive ? 'cursor-pointer hover:brightness-110 active:scale-[0.97]' : 'cursor-default',
    isUnavailable ? 'grayscale opacity-60' : '',
  ].join(' ');

  return (
    <div className={containerClasses} style={containerStyle} onClick={isInteractive ? onClick : undefined}>
      {showAnimation && (
        <div
            className={`absolute inset-0 opacity-20 pointer-events-none ${effectClass}`}
            style={animationStyle}
        />
      )}

      {/* Top Left: Battery Indicator (Default) */}
      {typeof batteryLevel === 'number' && batteryPosition === 'top-left' && (
          <div className="absolute top-2 left-2 z-30 pointer-events-none">
              <BatteryIndicator level={batteryLevel} />
          </div>
      )}

      {/* Top Right: Offline badge (takes precedence) or Lock Icon */}
      {isUnavailable ? (
          <IconWifiOff className="absolute top-2 right-2 w-4 h-4 text-gray-400 z-20" />
      ) : (
          (isProtected || isLocked) && <IconLock className="absolute top-2 right-2 w-4 h-4 text-gray-400/80 z-10" />
      )}

      {isLocked && !isEditor && <div className="absolute inset-0 bg-black/25 pointer-events-none z-10"></div>}

      <div className="flex-1 w-full flex flex-col justify-center items-center text-center overflow-hidden min-h-0 relative z-0">
        {children}
      </div>

      {label && <p className="text-gray-100 w-full text-center truncate font-medium shrink-0 relative z-10" style={{ ...fluidTextSm, paddingTop: 'clamp(0.125rem, 2cqmin, 0.5rem)', lineHeight: 1.25 }}>{label}</p>}

      {/* Bottom: Battery Indicator (Optional) */}
      {typeof batteryLevel === 'number' && batteryPosition === 'bottom' && (
          <div className="relative z-10 -mt-1 pb-1 w-full flex justify-center">
              <BatteryIndicator level={batteryLevel} />
          </div>
      )}
    </div>
  );
};

export default TileWrapper;
