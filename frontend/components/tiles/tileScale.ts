import type { CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// Fluid tile sizing
// ---------------------------------------------------------------------------
// Every tile cell is a CSS *size container* (`container-type: size`, set on
// the grid cell in Dashboard.tsx). These helpers express a tile's inner
// sizes (text, icons, gaps, control padding) in container-query units so the
// content scales with the tile's ACTUAL rendered size and shrinks when fit
// mode compresses the grid rows — instead of staying a fixed pixel size and
// looking oversized in a short cell (the original AlarmTile problem).
//
// Unit choice: `cqmin` = 1% of the SMALLER of the cell's width/height, so
// content never overflows whether a tile is wide-and-short or tall-and-narrow.
// Every value is clamped: the max equals the original Tailwind size (so a
// full-height iPad looks exactly as before) and the min keeps it legible when
// the cell is tiny.
//
// Tuning is centralized here: adjust a coefficient and every tile that uses
// the helper updates together.

/** Font-size that scales with the cell, capped at `maxRem`. */
export const fluidText = (minRem: number, maxRem: number, coeff = 14): CSSProperties => ({
    fontSize: `clamp(${minRem}rem, ${coeff}cqmin, ${maxRem}rem)`,
});

// Named steps matching the Tailwind sizes the tiles already use, so a
// `text-xl` becomes `style={fluidTextXl}` with the same upper bound.
//
// Coefficients are tuned so the text reaches its FULL (max) size at a normal
// kiosk cell (~110-120px min dimension) — i.e. it looks like the original
// fixed size at the wall display — and only shrinks when a cell is smaller
// than that. (The first pass used ~half these and everything bottomed out at
// the min size on short cells.)
export const fluidTextXs = fluidText(0.55, 0.75, 11);    // text-xs   (0.75rem)
export const fluidTextSm = fluidText(0.6, 0.875, 13);    // text-sm   (0.875rem)
export const fluidTextBase = fluidText(0.7, 1, 14);      // text-base (1rem)
export const fluidTextLg = fluidText(0.75, 1.125, 16);   // text-lg   (1.125rem)
export const fluidTextXl = fluidText(0.8, 1.25, 17);     // text-xl   (1.25rem)
export const fluidText2xl = fluidText(0.9, 1.5, 21);     // text-2xl  (1.5rem)
export const fluidText3xl = fluidText(1, 1.875, 26);     // text-3xl  (1.875rem)
export const fluidText4xl = fluidText(1.1, 2.25, 31);    // text-4xl  (2.25rem)

/** Square icon size that scales with the cell, capped at `maxRem`. */
export const fluidIcon = (maxRem: number, coeff = 30): CSSProperties => ({
    width: `clamp(1.1rem, ${coeff}cqmin, ${maxRem}rem)`,
    height: `clamp(1.1rem, ${coeff}cqmin, ${maxRem}rem)`,
});

/** Flex/grid gap that scales with the cell, capped at `maxRem`. */
export const fluidGap = (maxRem: number, coeff = 5): CSSProperties => ({
    gap: `clamp(0.125rem, ${coeff}cqmin, ${maxRem}rem)`,
});

/** Uniform padding that scales with the cell, capped at `maxRem`. */
export const fluidPad = (maxRem: number, coeff = 6): CSSProperties => ({
    padding: `clamp(0.25rem, ${coeff}cqmin, ${maxRem}rem)`,
});

/** Vertical padding only (e.g. for a full-width button), capped at `maxRem`. */
export const fluidPadY = (maxRem: number, coeff = 6): CSSProperties => ({
    paddingTop: `clamp(0.25rem, ${coeff}cqmin, ${maxRem}rem)`,
    paddingBottom: `clamp(0.25rem, ${coeff}cqmin, ${maxRem}rem)`,
});
