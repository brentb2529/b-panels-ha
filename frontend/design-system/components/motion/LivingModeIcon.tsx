/**
 * LivingModeIcon — wraps any icon and gives it a per-mode "life" animation that
 * reflects the real running state, instead of a static glyph.
 *
 * It is icon-agnostic: pass the icon element as children (so each surface keeps
 * its own icon set), and a `mode` + `active` to pick the motion:
 *
 *   heat   → warm shimmer + flame flicker glow underlay
 *   cool   → gentle breeze drift (float + sway)
 *   dry    → rising vapor underlay
 *   fan    → (use <AnimatedFan> instead for the real fan)
 *   auto / heat_cool → soft idle breathe
 *   off / idle / inactive → still
 *
 * The motion only plays when `active` (the equipment is actually running in that
 * mode). Reduced-motion users get the still icon + a faint static glow.
 *
 * PROPS
 *   mode      string   — hvac mode key (heat|cool|dry|fan_only|auto|heat_cool|off)
 *   active    boolean  — is the equipment actually running this mode now
 *   colorVar  string   — accent color var for the glow underlay
 *   children  ReactNode— the icon element to animate
 */

import React from 'react';
import { useReducedMotion } from '../../useReducedMotion';

export interface LivingModeIconProps {
    mode: string;
    active?: boolean;
    colorVar?: string;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

type Motion = { anim?: string; glowAnim?: string };

function motionFor(mode: string, active: boolean, reduced: boolean): Motion {
    if (!active || reduced) return {};
    switch (mode) {
        case 'heat':
            return { anim: 'widget-heat-shimmer 1.6s ease-in-out infinite', glowAnim: 'widget-flame-flicker 0.9s ease-in-out infinite' };
        case 'cool':
            return { anim: 'widget-cool-drift 2.8s ease-in-out infinite' };
        case 'dry':
            return { glowAnim: 'widget-dry-rise 1.8s ease-out infinite' };
        case 'auto':
        case 'heat_cool':
            return { anim: 'widget-idle-breathe 3s ease-in-out infinite' };
        default:
            return {};
    }
}

export const LivingModeIcon = ({
    mode,
    active = false,
    colorVar = 'currentColor',
    children,
    className = '',
    style,
}: LivingModeIconProps) => {
    const reduced = useReducedMotion();
    const { anim, glowAnim } = motionFor(mode, active, reduced);

    // A soft radial glow sits BEHIND the icon for heat/dry, flickering for life.
    const showGlow = (mode === 'heat' || mode === 'dry') && (active || reduced);

    return (
        <span
            className={className}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}
        >
            {showGlow && (
                <span
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        inset: '-40%',
                        borderRadius: '50%',
                        background: `radial-gradient(circle, color-mix(in srgb, ${colorVar} 55%, transparent) 0%, transparent 65%)`,
                        opacity: reduced ? 0.4 : 0.7,
                        animation: glowAnim,
                        pointerEvents: 'none',
                    }}
                />
            )}
            <span
                style={{
                    position: 'relative',
                    display: 'inline-flex',
                    transformOrigin: 'center',
                    animation: anim,
                }}
            >
                {children}
            </span>
        </span>
    );
};

export default LivingModeIcon;
