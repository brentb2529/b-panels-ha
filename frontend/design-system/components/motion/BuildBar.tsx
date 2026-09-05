/**
 * BuildBar — an animated value meter whose fill builds (animates) from its
 * previous width to the new target on mount and on every value change, with a
 * subtle traveling glint to convey "live".
 *
 * Use for humidity level, current-temp-toward-setpoint progress, fan level,
 * any 0..max scalar. The fill is a glass-friendly gradient tinted by `colorVar`.
 *
 * BEHAVIOR
 *   mount        → fill animates 0 → value (spring-eased)
 *   value change → fill springs to the new width
 *   reduced-motion → fill jumps to the target width (no transition / no glint)
 *
 * PROPS
 *   value     number   — current value
 *   max       number   — scale max (default 100)
 *   min       number   — scale min (default 0)
 *   colorVar  string   — CSS color var for the fill (default var(--accent))
 *   height    number   — px track height (default 5)
 *   glint     boolean  — show the traveling highlight (default true when active)
 *   active    boolean  — drives the glint + a touch more fill luminosity
 *   trackBg   string   — track background (default a faint glass well)
 *   label     string   — a11y label
 */

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../useReducedMotion';

export interface BuildBarProps {
    value: number;
    max?: number;
    min?: number;
    colorVar?: string;
    height?: number;
    glint?: boolean;
    active?: boolean;
    trackBg?: string;
    label?: string;
    className?: string;
    style?: React.CSSProperties;
}

function pct(value: number, min: number, max: number): number {
    if (max <= min) return 0;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export const BuildBar = ({
    value,
    max = 100,
    min = 0,
    colorVar = 'var(--accent)',
    height = 5,
    glint = true,
    active = false,
    trackBg,
    label,
    className = '',
    style,
}: BuildBarProps) => {
    const reduced = useReducedMotion();
    const target = pct(value, min, max);

    // Start at 0 width on mount so the fill visibly BUILDS to its value; then
    // track subsequent value changes. Under reduced motion, start AT target.
    const [width, setWidth] = useState<number>(reduced ? target : 0);
    const mounted = useRef(false);

    useEffect(() => {
        if (reduced) {
            setWidth(target);
            return;
        }
        // On mount, defer one frame so the 0 → target transition actually plays.
        if (!mounted.current) {
            mounted.current = true;
            const id = requestAnimationFrame(() => setWidth(target));
            return () => cancelAnimationFrame(id);
        }
        setWidth(target);
    }, [target, reduced]);

    const showGlint = glint && active && !reduced && target > 4;

    return (
        <div
            className={className}
            role="meter"
            aria-valuenow={Math.round(value)}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-label={label}
            style={{
                position: 'relative',
                width: '100%',
                height,
                borderRadius: 'var(--radius-pill)',
                overflow: 'hidden',
                background: trackBg ?? 'color-mix(in srgb, rgb(var(--text)) 8%, transparent)',
                boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.18)',
                ...style,
            }}
        >
            {/* Fill */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${width}%`,
                    borderRadius: 'var(--radius-pill)',
                    background: `linear-gradient(90deg,
                        color-mix(in srgb, ${colorVar} 55%, transparent) 0%,
                        ${colorVar} 100%)`,
                    boxShadow: active
                        ? `0 0 8px -1px color-mix(in srgb, ${colorVar} 60%, transparent)`
                        : undefined,
                    // Spring-eased build/change
                    transition: reduced
                        ? 'none'
                        : `width var(--dur-slow, 420ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))`,
                }}
            >
                {/* Traveling glint */}
                {showGlint && (
                    <span
                        style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            width: '40%',
                            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
                            animation: 'widget-bar-glint 2.4s ease-in-out infinite',
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export default BuildBar;
