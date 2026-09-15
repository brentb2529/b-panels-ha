/**
 * AnimatedFan — the headline domain widget: a fan with spinning blades and
 * airflow arcs emanating outward when a zone is actively moving air.
 *
 * Pure SVG + CSS keyframes (widget-fan-spin / widget-airflow in tokens.css).
 * Inherits color from `colorVar` (a CSS var string) so it tints to the zone's
 * mode accent (cool=blue, fan=brand, etc.).
 *
 * BEHAVIOR
 *   active=false        → blades still, no airflow (the system isn't moving air)
 *   active=true         → blades spin; airflow arcs pulse outward ("blowing")
 *   rpmLevel (0..1)     → maps to spin speed: higher = faster (shorter duration)
 *   reduced-motion      → blades render STILL at a pleasing angle + airflow arcs
 *                         shown faint-but-static, so it still reads as a fan
 *
 * PROPS
 *   active      boolean   — is the fan actually moving air right now
 *   rpmLevel    number    — 0..1 normalized fan speed (default 0.6)
 *   size        number    — px (default 22)
 *   colorVar    string    — CSS color var (default currentColor)
 *   showAirflow boolean   — render the emanating airflow arcs (default true)
 *   title       string    — a11y label
 */

import React from 'react';
import { useReducedMotion } from '../../useReducedMotion';

export interface AnimatedFanProps {
    active?: boolean;
    rpmLevel?: number;
    size?: number;
    colorVar?: string;
    showAirflow?: boolean;
    title?: string;
    className?: string;
    style?: React.CSSProperties;
}

// Map a 0..1 fan level to a spin duration. Fast (0.55s) at full, lazy (2.4s) low.
function spinDuration(rpmLevel: number): string {
    const clamped = Math.max(0, Math.min(1, rpmLevel));
    const secs = 2.4 - clamped * 1.85; // 1 → 0.55s, 0 → 2.4s
    return `${secs.toFixed(2)}s`;
}

export const AnimatedFan = ({
    active = false,
    rpmLevel = 0.6,
    size = 22,
    colorVar = 'currentColor',
    showAirflow = true,
    title = 'Fan',
    className = '',
    style,
}: AnimatedFanProps) => {
    const reduced = useReducedMotion();
    const spinning = active && !reduced;
    const dur = spinDuration(rpmLevel);

    // Four curved blades around a central hub, drawn once and rotated as a group.
    // A teardrop blade path gives a real fan silhouette (vs. a generic pinwheel).
    const blade = (
        <path
            d="M12 12 C 12 7.5, 14.5 4.5, 12 2.2 C 9.8 4.7, 9.2 8.2, 12 12 Z"
            fill={colorVar}
            opacity={0.92}
        />
    );

    return (
        <span
            className={className}
            style={{ display: 'inline-flex', position: 'relative', width: size, height: size, ...style }}
            role="img"
            aria-label={title}
        >
            {/* Airflow arcs: three concentric arcs emanating from the hub. Each
                pulses outward on a staggered delay so it reads as continuous
                "blowing". Hidden when not active; faint-static under reduced motion. */}
            {showAirflow && (active || reduced) && (
                <svg
                    viewBox="0 0 24 24"
                    width={size}
                    height={size}
                    style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
                    aria-hidden="true"
                >
                    {[0, 1, 2].map((i) => (
                        <path
                            key={i}
                            // A short arc on the upper-right, the "downwind" side.
                            d="M16.5 6.5 a 7 7 0 0 1 2.4 5"
                            fill="none"
                            stroke={colorVar}
                            strokeWidth={1.4}
                            strokeLinecap="round"
                            opacity={reduced ? 0.28 : 0}
                            style={{
                                transformOrigin: '12px 12px',
                                animation: spinning
                                    ? `widget-airflow 1.4s ease-out ${i * 0.42}s infinite`
                                    : undefined,
                            }}
                        />
                    ))}
                </svg>
            )}

            {/* Fan body: blade group rotates; hub stays put. */}
            <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                style={{ position: 'relative', overflow: 'visible' }}
                aria-hidden="true"
            >
                <g
                    style={{
                        transformOrigin: '12px 12px',
                        // Reduced-motion / idle: park the blades at a pleasant angle.
                        transform: spinning ? undefined : 'rotate(18deg)',
                        animation: spinning
                            ? `widget-fan-spin ${dur} linear infinite`
                            : undefined,
                    }}
                >
                    {blade}
                    <g transform="rotate(90 12 12)">{blade}</g>
                    <g transform="rotate(180 12 12)">{blade}</g>
                    <g transform="rotate(270 12 12)">{blade}</g>
                </g>
                {/* Hub */}
                <circle cx="12" cy="12" r="2.1" fill={colorVar} />
                <circle cx="12" cy="12" r="0.9" fill="rgb(var(--surface) / 0.9)" />
            </svg>
        </span>
    );
};

export default AnimatedFan;
