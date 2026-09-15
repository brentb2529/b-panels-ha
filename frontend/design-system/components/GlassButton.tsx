/**
 * GlassButton — a tactile, level-3 glass control button.
 *
 * Used for mode selectors, fan controls, and any tappable chip.
 * Renders a <button> (not a div) for accessibility. Applies active/hover
 * spring transforms and a specular highlight for the "bead" quality.
 *
 * PROPS:
 *   accentVar    — CSS var string for tinting the active/pressed state
 *   active       — if true, applies active glass vibrancy
 *   disabled     — standard disabled semantics + dimmed appearance
 *   fullWidth    — stretches to fill container width
 *   pill         — uses pill radius instead of control radius
 */

import React from 'react';
import { glassMaterial, glassMaterialActive } from '../theme';

export interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    accentVar?: string;
    active?: boolean;
    fullWidth?: boolean;
    pill?: boolean;
}

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
    (
        {
            accentVar: accent,
            active = false,
            disabled = false,
            fullWidth = false,
            pill = false,
            className = '',
            style,
            children,
            ...rest
        },
        ref
    ) => {
        const radius = pill ? 'var(--radius-pill)' : 'var(--radius-control)';
        const materialStyle = active && accent
            ? glassMaterialActive(3, accent, { glowStrength: 0.18 })
            : glassMaterial(3);

        return (
            <button
                ref={ref}
                disabled={disabled}
                className={[
                    'relative overflow-hidden flex items-center justify-center gap-1.5',
                    'select-none cursor-pointer',
                    fullWidth ? 'w-full' : '',
                    // Spring active-press scale
                    'transition-[transform,opacity] active:scale-[0.94]',
                    disabled ? 'opacity-40 cursor-not-allowed' : 'hover:brightness-110',
                    className,
                ].join(' ')}
                style={{
                    borderRadius: radius,
                    // Only apply spring-snappy to transform; let material do the rest
                    transitionTimingFunction: 'var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
                    transitionDuration: 'var(--dur-fast, 160ms)',
                    ...materialStyle,
                    ...style,
                }}
                {...rest}
            >
                {children}
            </button>
        );
    }
);

GlassButton.displayName = 'GlassButton';

export default GlassButton;
