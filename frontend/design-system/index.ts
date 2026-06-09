/**
 * B-Panels Liquid Glass Design System — barrel export
 *
 * Import everything a surface needs from this single entry point:
 *
 *   import {
 *     GlassPanel, GlassCard, GlassButton,
 *     glassMaterial, glassMaterialActive,
 *     spring, radius, elevation, transition, accentVar,
 *   } from '../design-system';
 *
 * The tokens.css file must also be imported ONCE at the app root
 * (index.tsx or App.tsx). It is already wired into index.html for
 * this build, but a future surface in a standalone Storybook or
 * preview harness should import it explicitly:
 *
 *   import '../design-system/tokens.css';
 */

// Components
export { GlassPanel }    from './components/GlassPanel';
export { GlassCard }     from './components/GlassCard';
export { GlassButton }   from './components/GlassButton';

// Animated domain widgets (reusable motion library)
export { AnimatedFan }    from './components/motion/AnimatedFan';
export { BuildBar }       from './components/motion/BuildBar';
export { LivingModeIcon } from './components/motion/LivingModeIcon';

// Reduced-motion hook
export { useReducedMotion } from './useReducedMotion';

// Types
export type { GlassPanelProps } from './components/GlassPanel';
export type { GlassCardProps }  from './components/GlassCard';
export type { GlassButtonProps } from './components/GlassButton';
export type { AnimatedFanProps }    from './components/motion/AnimatedFan';
export type { BuildBarProps }       from './components/motion/BuildBar';
export type { LivingModeIconProps } from './components/motion/LivingModeIcon';

// Token helpers (for inline-style usage)
export {
    glassMaterial,
    glassMaterialActive,
    glassDecor,
    glassBackdrop,
    accentHalo,
    type GlassLevel,
    elevation,
    radius,
    spring,
    duration,
    transition,
    font,
    typeScale,
    weight,
    tracking,
    space,
    accentVar,
} from './theme';
