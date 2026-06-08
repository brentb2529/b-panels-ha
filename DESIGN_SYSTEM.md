# B-Panels Liquid Glass Design System

Inspired by Apple's visionOS / iOS 18 "liquid glass" material language. Every
surface in B-Panels can adopt this system by importing a single barrel and
dropping three CSS custom properties into its markup. The Air Control surface
is the reference implementation.

---

## Concept

The visual language is built on three ideas:

1. **Layered glass materiality** — surfaces are translucent frosted panels that
   let the depth gradient behind them breathe through. Each layer has its own
   blur, saturation, and tint strength. Light and dark modes use different glass
   recipes (white-frosted vs dark-frosted) so the "glass" reads naturally on
   any canvas.

2. **Specular top lighting** — every surface has a subtle highlight gradient
   that simulates a light source above and behind the panel. This gives tiles
   a physical, curved quality rather than a flat rectangle feel.

3. **Spring motion** — state transitions (mode changes, setpoint steps, mount)
   use Apple-style spring easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`) with
   fast-in, elastic-settle timing. No linear or sine easing anywhere.

---

## File Locations

```
frontend/
├─ design-system/
│  ├─ tokens.css           # All CSS custom property tokens (import once at root)
│  ├─ theme.ts             # TypeScript helpers + token references for inline styles
│  ├─ index.ts             # Barrel export — import everything from here
│  └─ components/
│     ├─ GlassPanel.tsx    # Base frosted-glass container (level-1 default)
│     ├─ GlassCard.tsx     # Elevated card (level-2 default, card radius)
│     └─ GlassButton.tsx   # Tactile glass bead button (level-3, accessible <button>)
```

---

## Token Groups

### Glass material levels (`--glass-l{1-4}-*`)

| Level | Use-case | Blur (dark) | Saturation | Brightness | Opacity |
|-------|----------|-------------|------------|------------|---------|
| 1 | Outer surface / panel | 16px | 1.9 | 1.08 | ~60% |
| 2 | Individual zone cards | 22px | 2.1 | 1.10 | ~50% |
| 3 | Control buttons / beads | 10px | 1.8 | 1.12 | ~50% |
| 4 | Cluster wrapper | 30px | 2.3 | 1.04 | ~46% |

Each level exposes these sub-tokens:
- `--glass-lN-blur` — backdrop-filter blur radius
- `--glass-lN-saturate` — backdrop-filter saturate multiplier
- `--glass-lN-brightness` — backdrop-filter brightness (lifts the material so the
  background reads luminously instead of muddy — the key "more life" lever)
- `--glass-lN-bg` — base background RGBA (dark/light/ambient variants)
- `--glass-lN-border` — border color RGBA
- `--glass-lN-tint` — faint inner tint layer (background-image)
- **`--glass-lN-backdrop`** — pre-composed `blur() saturate() brightness()` string.
  **Always use this** for `backdrop-filter` rather than re-composing by hand, so the
  vibrancy recipe stays consistent and tunable in one place.

> Iteration 2 intensified all levels: higher saturation + a brightness lift,
> lower bg opacity (more luminous show-through), and the new sheen + rim layers.

### Specular highlights (`--specular-*`)

| Token | Use |
|-------|-----|
| `--specular-default` | Standard top-lit gradient overlay (background-image layer) |
| `--specular-strong` | Stronger highlight for buttons / beads |
| `--specular-bevel` | Back-compat single bright top edge (box-shadow); prefer `--rim` |

### Sheen sweep (`--sheen-default`)

A narrow diagonal band of light across the surface — the hallmark of real glass
catching a reflection. Layer it ABOVE the specular in `background-image`:

```css
background-image: var(--sheen-default), var(--specular-default), var(--glass-l2-tint);
```

An opt-in `glass-sheen-drift` keyframe slowly travels the sheen across large
hero surfaces (use sparingly).

### Beveled rim (`--rim`, `--rim-light`, `--rim-shade`)

A fine glass edge composed as inset box-shadows: a bright top-left light
(`--rim-light`) + a dark bottom-right shade (`--rim-shade`). `--rim` combines
both. Use it as the first box-shadow layer on any glass surface so the edge
catches light and reads as real material:

```css
box-shadow: var(--rim), var(--elev-2);
```

### Accent glow recipes (`--glow-*`)

Drive the readable warm/cool halo on active cards. The helpers
`glassMaterialActive()` / `accentHalo()` consume these:

| Token | Meaning |
|-------|---------|
| `--glow-soft-spread` / `--glow-strong-spread` | Outer halo blur radius |
| `--glow-soft-strength` / `--glow-strong-strength` | Outer halo color-mix % |
| `--glow-tint-strength` | Inner accent wash strength (into glass bg) |

Heat zones glow warm (amber `--accent-warn`), cool zones glow cool (blue
`--accent-water`); running zones push the halo wider/brighter than idle ones.

### Elevation / shadow scale (`--elev-0` … `--elev-5`)

Multilayer shadows: tight contact + wide diffuse + hairline ring. Iteration 2
strengthened (but kept soft) all levels so cards visibly float above the panel.
Adapts between dark (deep), light (cool-cast soft), and ambient-night (deep warm).

### Border radii (`--radius-*`)

| Token | Value | Use |
|-------|-------|-----|
| `--radius-surface` | 1.25rem | Outer panels / surfaces |
| `--radius-card` | 1.0rem | Zone tiles, cards |
| `--radius-control` | 0.75rem | Buttons, selectors |
| `--radius-chip` | 0.5rem | Badges, role labels |
| `--radius-pill` | 9999px | Fully-rounded pills |
| `--radius-tile` | = card | Back-compat alias |

### Spring easing + durations

```css
/* Easings */
--spring-snappy: cubic-bezier(0.34, 1.56, 0.64, 1);  /* fast-in, elastic settle */
--spring-gentle: cubic-bezier(0.22, 1.0,  0.36, 1);  /* smooth, no overshoot   */
--spring-bounce: cubic-bezier(0.25, 1.8,  0.5,  1);  /* pronounced bounce      */

/* Durations */
--dur-instant:  80ms
--dur-fast:    160ms
--dur-medium:  260ms   /* state transitions */
--dur-slow:    420ms
--dur-enter:   320ms   /* tile mount */
--dur-exit:    200ms
```

### Typography (`--font-*`, `--type-*`, `--weight-*`, `--tracking-*`)

Font stack: `-apple-system, "SF Pro Display", system-ui, sans-serif`
— resolves to SF Pro on macOS/iOS, native system font elsewhere.

Type scale runs from `--type-2xs` (0.56rem) up to `--type-hero`
(fluid clamp 2.5–3.5rem — used for the setpoint digit).

### Spacing (`--space-1` … `--space-12`)

4-point grid: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 px.

---

## Components

### `GlassPanel`

Base glass container. Spread on any outer div.

```tsx
import { GlassPanel } from '../design-system';

<GlassPanel
    level={1}              // 1–4 (default 1)
    animate                // play glass-mount spring on first render
    borderRadius="var(--radius-surface)"
    style={{ height: '100%' }}
>
    ...
</GlassPanel>
```

### `GlassCard`

Same as GlassPanel but defaults to level-2 + card radius.
Use for individual zone tiles, info cards, grouped controls.

```tsx
import { GlassCard } from '../design-system';

<GlassCard active accentVar="var(--accent-water)">
    ...
</GlassCard>
```

`active + accentVar` triggers the vibrancy/glow variant (mode-colored inset
glow + tinted background). The accent color should come from `accentVar.*`
constants in `theme.ts` — never hardcoded hex — so theming stays coherent.

### `GlassButton`

Accessible `<button>` with level-3 glass bead material, spring press scale.

```tsx
import { GlassButton } from '../design-system';

<GlassButton
    accentVar="var(--accent-warn)"
    active={zone.hvacMode === 'heat'}
    onClick={cycleMode}
    disabled={!canControl}
>
    <IconFlame /> Heat
</GlassButton>
```

### Helper functions (from `theme.ts`)

```ts
// Get an inline-style object for any glass level
glassMaterial(2)
glassMaterial(2, { accentRgb: '0 170 255', accentStrength: 0.14 })

// Active/glowing variant
glassMaterialActive(2, 'var(--accent-water)', { glowStrength: 0.22 })
```

---

## Keyframe animations

Defined in `tokens.css`, usable anywhere:

| Name | Effect |
|------|--------|
| `glass-mount` | Spring entry: scale 0.96→1 + translateY 6px→0 + blur 2→0 |
| `glass-pulse-ring` | Expanding ring (use on live dots) |
| `glass-shimmer` | Gradient shimmer sweep |
| `glass-spin-slow` | Gentle 360° rotation (fan icon) |

---

## How to adopt the glass system in another surface

**Minimum viable adoption (3 steps):**

1. **Import CSS tokens** — already done globally in `index.tsx`:
   ```ts
   import './design-system/tokens.css';
   ```
   Nothing to do here for surfaces that build with this app.

2. **Replace outer container** with `GlassPanel`:
   ```tsx
   import { GlassPanel } from '../design-system';
   // Before:
   <div className="rounded-tile bg-gray-700 ..." style={{ border: '...' }}>
   // After:
   <GlassPanel level={1} animate style={{ height: '100%' }}>
   ```

3. **Replace individual cards / tiles** with `GlassCard`:
   ```tsx
   import { GlassCard } from '../design-system';
   // Before:
   <div className="rounded-tile bg-gray-700 transition-all ...">
   // After:
   <GlassCard active={isActive} accentVar={colorVar}>
   ```

4. **Replace control buttons** with `GlassButton`:
   ```tsx
   import { GlassButton } from '../design-system';
   // Before:
   <button className="rounded-control bg-gray-600 ...">
   // After:
   <GlassButton active={!isOff} accentVar={colorVar}>
   ```

5. **Use token references** instead of hardcoded colors/radii:
   ```tsx
   style={{ borderRadius: 'var(--radius-card)', gap: 'var(--space-3)' }}
   // NOT: style={{ borderRadius: '1rem', gap: '0.75rem' }}
   ```

**For transition animations on state changes**, add a `transition` using the
spring easings:
```tsx
transition: 'background-color var(--dur-medium) var(--spring-gentle), border-color var(--dur-medium) var(--spring-gentle)'
```

---

## Light / Dark / Ambient-Night materiality

The glass tokens automatically adapt — you never need to branch on theme in
component code. The `tokens.css` file declares three sets of `--glass-l*-*`
values under `:root`, `body.light-mode`, and `body.ambient-night`.

- **Dark (default)** — the quality bar: deep navy glass with a cool-blue tint,
  high saturation + brightness lift, pronounced specular + sheen, and readable
  warm/cool accent halos. High contrast, gorgeous at room distance.
- **Light** — premium **cool-tinted** glass (NOT flat white): the frosted
  material carries a faint slate/blue cast so it reads as real glass over a cool
  canvas. Genuine layered depth (deeper cool-cast `--elev-*` shadows so cards
  visibly float) + a refined, not-blown-out top-edge specular + background
  showing through (lower bg opacity, high saturation).
- **Ambient-night** — refined **dim-warm charcoal** (NOT brown-washed): a
  near-black neutral charcoal glass with a RESTRAINED warm accent that lives only
  in the rim / specular / a whisper of bg cast — low blue light for night
  viewing. Elegant and dark, matching the navy theme's polish, just warmer/dimmer.

---

## Air Control surface as reference

`AirControlSurface.tsx` + `RoomClimateTile.tsx` are the exemplar implementation.

Key patterns to copy into other surfaces:

- **Surface root**: `glass-l1` + `radius-surface` + `glass-mount` animation
- **Header bar**: `glass-l1` with `rgba(255,255,255,0.025)` overlay to
  separate from scroll content
- **Icon bead**: `glass-l3` + accent tint + glow box-shadow
- **Zone cards**: `glass-l2` + accent-tinted bg/border/inset-glow (active state)
- **Stepper buttons**: `glass-l3` + `specular-strong` + `specular-bevel`
  + `radius-pill` + spring press transform
- **Mode/fan controls**: `glass-l3` + accent bleed when active + spring transitions
- **Status badges**: `radius-pill` + `type-2xs` + accent tint bg + living dot
- **Role chips** (Master/Slave): `radius-chip` + `type-2xs` + accent or muted glass

All `color-mix(in srgb, ...)` calls blend the semantic accent CSS var into the
glass background, so mode/state changes produce a smooth vibrancy shift instead
of a hard color swap.
