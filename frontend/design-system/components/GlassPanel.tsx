/**
 * GlassPanel — the foundational frosted-glass surface component.
 *
 * Use this as the outer container for any surface or large panel. It
 * applies level-1 glass materiality (the most opaque, base layer) with
 * optional accent vibrancy and a spring-animated mount.
 *
 * PROPS:
 *   level        — glass material level (1=base, 2=elevated, 3=control, 4=deep)
 *   accentVar    — CSS var string, e.g. 'var(--accent-water)'; tints the glass
 *   accentStrength — 0–1, how strongly accent bleeds into the background
 *   active       — if true, uses the active (glowing) glass variant
 *   animate      — if true, plays the glass-mount spring animation on first render
 *   borderRadius — override the default surface radius
 *   className    — additional Tailwind/CSS class names
 *   style        — additional inline styles (merged last, so you can override)
 */

import React from 'react';
import { glassMaterial, glassMaterialActive, type GlassLevel } from '../theme';

export interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
    level?: GlassLevel;
    accentVar?: string;
    accentStrength?: number;
    active?: boolean;
    animate?: boolean;
    borderRadius?: string;
    as?: keyof JSX.IntrinsicElements;
}

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
    (
        {
            level = 1,
            accentVar: accent,
            accentStrength,
            active = false,
            animate = false,
            borderRadius = 'var(--radius-surface)',
            className = '',
            style,
            children,
            ...rest
        },
        ref
    ) => {
        const materialStyle = active && accent
            ? glassMaterialActive(level, accent, { glowStrength: accentStrength })
            : glassMaterial(level, accent ? { accentRgb: undefined, accentStrength } : {});

        const animStyle: React.CSSProperties = animate
            ? { animation: `glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both` }
            : {};

        return (
            <div
                ref={ref}
                className={`relative overflow-hidden ${className}`}
                style={{
                    borderRadius,
                    ...materialStyle,
                    ...animStyle,
                    ...style,
                }}
                {...rest}
            >
                {children}
            </div>
        );
    }
);

GlassPanel.displayName = 'GlassPanel';

export default GlassPanel;
