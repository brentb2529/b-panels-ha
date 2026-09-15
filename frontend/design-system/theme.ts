/**
 * B-Panels Liquid Glass Design System — TypeScript Theme Module
 *
 * This is the TS counterpart to tokens.css. Use these constants when you
 * need to reference token values in JS (inline-style calculations, motion
 * libraries, canvas drawing). For everything rendereable via CSS just use
 * the --var() custom properties directly.
 *
 * USAGE IN A SURFACE:
 *   import { glass, spring, radius, elevation } from '../design-system/theme';
 *   style={{ borderRadius: radius.card, transition: spring.transitionFast }}
 */

// ── Glass material helper ────────────────────────────────────────────────
export type GlassLevel = 1 | 2 | 3 | 4;

/**
 * Returns an object of inline style properties for a glass surface at
 * the given level. Accent (RGB triplet string like "0 170 255") and
 * accentStrength (0–1) let the glass bleed a mode-color vibrancy.
 *
 * Designed to be spread directly into a React `style` prop.
 */
export function glassMaterial(
    level: GlassLevel = 1,
    opts: { accentRgb?: string; accentStrength?: number } = {}
): React.CSSProperties {
    const backdrop = `var(--glass-l${level}-backdrop)`;
    const bg      = opts.accentRgb
        ? `color-mix(in srgb, rgb(${opts.accentRgb}) ${Math.round((opts.accentStrength ?? 0.12) * 100)}%, var(--glass-l${level}-bg))`
        : `var(--glass-l${level}-bg)`;

    return {
        backdropFilter:       backdrop,
        WebkitBackdropFilter: backdrop,
        backgroundColor:      bg,
        // Layered: sheen sweep ABOVE the top-lit specular ABOVE the base tint.
        backgroundImage:      `var(--sheen-default), var(--specular-default), var(--glass-l${level}-tint)`,
        border:               `1px solid var(--glass-l${level}-border)`,
        // Beveled rim (bright top + dark bottom edge) + float shadow.
        boxShadow:            `var(--rim), var(--elev-${level + 1})`,
    };
}

/**
 * Like glassMaterial, but with a readable accent halo — used for tiles in
 * active/on states. The card glows in its mode color (warm for heat, cool for
 * cool) with a soft luminous outer halo + an inner accent wash + the beveled rim.
 *
 *   glowStrength  — inner wash + tint intensity (0–1, default --glow-tint-strength)
 *   haloSpread    — outer glow blur radius (CSS length, default --glow-soft-spread)
 *   haloStrength  — outer glow color-mix % (0–1, default --glow-soft-strength)
 */
export function glassMaterialActive(
    level: GlassLevel = 1,
    accentVar: string,          // CSS var string, e.g. 'var(--accent-water)'
    opts: { glowStrength?: number; haloSpread?: string; haloStrength?: number } = {}
): React.CSSProperties {
    const tintPct  = Math.round((opts.glowStrength ?? 0.22) * 100);
    const spread   = opts.haloSpread ?? 'var(--glow-soft-spread)';
    const haloPct  = Math.round((opts.haloStrength ?? 0.4) * 100);
    return {
        ...glassMaterial(level),
        backgroundColor: `color-mix(in srgb, ${accentVar} ${tintPct}%, var(--glass-l${level}-bg))`,
        border:          `1px solid color-mix(in srgb, ${accentVar} 60%, var(--glass-l${level}-border))`,
        boxShadow: [
            `var(--rim)`,
            // Inner accent wash — luminous from within the glass
            `inset 0 0 34px -6px color-mix(in srgb, ${accentVar} 42%, transparent)`,
            // Crisp accent edge
            `0 0 0 1px color-mix(in srgb, ${accentVar} 45%, transparent)`,
            // Soft luminous outer halo
            `0 0 ${spread} -2px color-mix(in srgb, ${accentVar} ${haloPct}%, transparent)`,
            `var(--elev-${level + 1})`,
        ].join(', '),
    };
}

// ── Glass material surface decoration tokens ───────────────────────────────
// Reference these when composing a glass surface by hand (not via the helpers).
export const glassDecor = {
    sheen:    'var(--sheen-default)',     // diagonal sheen sweep
    specular: 'var(--specular-default)',  // top-lit specular highlight
    specularStrong: 'var(--specular-strong)',
    rim:      'var(--rim)',               // beveled rim (top light + bottom shade)
    rimLight: 'var(--rim-light)',
    rimShade: 'var(--rim-shade)',
    bevel:    'var(--specular-bevel)',    // back-compat single bright top edge
} as const;

/** Pre-composed backdrop-filter strings (blur + saturate + brightness). */
export const glassBackdrop = {
    1: 'var(--glass-l1-backdrop)',
    2: 'var(--glass-l2-backdrop)',
    3: 'var(--glass-l3-backdrop)',
    4: 'var(--glass-l4-backdrop)',
} as const;

/**
 * Build a readable accent halo box-shadow fragment for an active card/control.
 * Compose with your own rim/elevation. `accentVar` is a CSS var string.
 */
export function accentHalo(
    accentVar: string,
    opts: { spread?: string; strength?: number } = {}
): string {
    const spread = opts.spread ?? 'var(--glow-soft-spread)';
    const pct    = Math.round((opts.strength ?? 0.4) * 100);
    return [
        `inset 0 0 34px -6px color-mix(in srgb, ${accentVar} 42%, transparent)`,
        `0 0 0 1px color-mix(in srgb, ${accentVar} 45%, transparent)`,
        `0 0 ${spread} -2px color-mix(in srgb, ${accentVar} ${pct}%, transparent)`,
    ].join(', ');
}

// ── Elevation ────────────────────────────────────────────────────────────
export const elevation = {
    0: 'var(--elev-0)',
    1: 'var(--elev-1)',
    2: 'var(--elev-2)',
    3: 'var(--elev-3)',
    4: 'var(--elev-4)',
    5: 'var(--elev-5)',
} as const;

// ── Border radii ─────────────────────────────────────────────────────────
export const radius = {
    surface: 'var(--radius-surface)',
    card:    'var(--radius-card)',
    control: 'var(--radius-control)',
    chip:    'var(--radius-chip)',
    pill:    'var(--radius-pill)',
    // back-compat
    tile:    'var(--radius-card)',
} as const;

// ── Springs / easing ─────────────────────────────────────────────────────
export const spring = {
    snappy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    gentle: 'cubic-bezier(0.22, 1.0,  0.36, 1)',
    bounce: 'cubic-bezier(0.25, 1.8,  0.5,  1)',
} as const;

export const duration = {
    instant: '80ms',
    fast:    '160ms',
    medium:  '260ms',
    slow:    '420ms',
    enter:   '320ms',
    exit:    '200ms',
} as const;

/** Pre-built CSS transition shorthand strings */
export const transition = {
    fast:    `all ${duration.fast} ${spring.gentle}`,
    medium:  `all ${duration.medium} ${spring.gentle}`,
    snappy:  `all ${duration.fast} ${spring.snappy}`,
    spring:  `all ${duration.medium} ${spring.snappy}`,
    slow:    `all ${duration.slow} ${spring.gentle}`,
} as const;

// ── Typography ────────────────────────────────────────────────────────────
export const font = {
    display: `var(--font-display)`,
    body:    `var(--font-body)`,
    numeric: `var(--font-numeric)`,
} as const;

export const typeScale = {
    hero: 'var(--type-hero)',
    xl:   'var(--type-xl)',
    lg:   'var(--type-lg)',
    md:   'var(--type-md)',
    sm:   'var(--type-sm)',
    xs:   'var(--type-xs)',
    '2xs': 'var(--type-2xs)',
} as const;

export const weight = {
    regular:  400,
    medium:   500,
    semibold: 600,
    bold:     700,
    heavy:    800,
} as const;

export const tracking = {
    tight:   '-0.025em',
    default: '-0.01em',
    loose:   '0.04em',
    caps:    '0.08em',
} as const;

// ── Spacing ────────────────────────────────────────────────────────────────
export const space = {
    1:  'var(--space-1)',
    2:  'var(--space-2)',
    3:  'var(--space-3)',
    4:  'var(--space-4)',
    5:  'var(--space-5)',
    6:  'var(--space-6)',
    8:  'var(--space-8)',
    10: 'var(--space-10)',
    12: 'var(--space-12)',
} as const;

// ── Semantic accent CSS vars ───────────────────────────────────────────────
// Use these in glassMaterialActive, not raw hex, so themes work.
export const accentVar = {
    brand: 'var(--accent)',
    light: 'var(--accent-light)',
    plug:  'var(--accent-plug)',
    water: 'var(--accent-water)',
    alert: 'var(--accent-alert)',
    warn:  'var(--accent-warn)',
} as const;
