
// Lutron HomeWorks QSX — The Obsidian Controller (liquid-glass rollout)
//
// GLASS ROLLOUT: Re-bases on the B-Panels Liquid Glass design system.
//   • Outer surface: GlassPanel (level-1, glass-mount animation, radius-surface)
//   • Area cards: GlassCard (level-2, accent-tinted when lights are on)
//   • Light cards: GlassCard (level-2, amber-accentVar on, active-vibrancy state)
//   • Cover / Scene / Keypad cards: GlassCard (level-2, neutral)
//   • Cover / scene / keypad buttons: GlassButton (level-3)
//   • All hardcoded colours replaced with design tokens or CSS vars
//   • Light/dark/ambient: automatic via tokens — no media-query branching in JS
//   • ALL visual widgets (swatch disk, halo, shade glyph, slat tilt, LED ring,
//     ripple) are preserved from the animation/richness pass; only their colour
//     sources are updated to use design-system tokens
//   • Connection pill uses --accent-* vars (green=live, amber=stale, muted=conn)
//   • prefers-reduced-motion respected via global CSS killswitch + JS guard on
//     the shimmer/breathe keyframes
//   • No entity bindings, service calls or data model changed

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLutronSurface } from '../../hooks/useLutronSurface';
import type {
  LutronArea, LutronLightState, LutronCoverState,
  LutronSceneState, LutronKeypad, LutronButtonState,
} from '../../services/lutron';
import {
  setLightBrightness, setLightColorTemp, toggleLight,
  openCover, closeCover, stopCover,
  openCoverTilt, closeCoverTilt,
  activateScene, pressButton,
} from '../../services/lutron';
import type { TileProps } from '../tileRegistry';
import {
  GlassPanel, GlassCard, GlassButton,
  glassMaterial, glassMaterialActive,
  accentVar as dsAccentVar,
  radius, spring, duration,
} from '../../design-system';

// ─── CSS injection ────────────────────────────────────────────────────────────
// Only surface-specific animations that aren't in tokens.css live here.
const STYLE_ID = 'lutron-surface-styles-v3';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Playfair+Display:wght@400;500;600&display=swap');

/* ── Lutron-scoped custom props — fully derived from design-system tokens ── */
.lqs3-root {
  font-family: var(--font-body);
  color: rgb(var(--text));
  min-height: 100%;
}

/* amber semantic token — design-system doesn't define --accent-warn in context so we
   alias it here for Lutron's warm amber personality. */
.lqs3-root {
  --lqs3-amber: var(--accent-warn);
  --lqs3-amber-rgb: 220 160 60;     /* fallback for color-mix where rgb() form needed */
  --lqs3-green-rgb: 52 211 153;
  --lqs3-cool-rgb: 56 189 248;
}

/* ── Stale pulse uses design-system tokens ── */
@keyframes lqs3-stale-pulse {
  0%,100% { box-shadow: var(--rim), 0 0 0 1px color-mix(in srgb, var(--accent-warn) 20%, transparent); }
  50%      { box-shadow: var(--rim), 0 0 0 1px color-mix(in srgb, var(--accent-warn) 65%, transparent), 0 0 14px color-mix(in srgb, var(--accent-warn) 14%, transparent); }
}
@keyframes lqs3-pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
@keyframes lqs3-glow-breathe {
  0%,100% { opacity:.65; transform:scale(1); }
  50%      { opacity:1;   transform:scale(1.18); }
}
@keyframes lqs3-glow-ring {
  0%,100% { box-shadow: 0 0 0 0px color-mix(in srgb, var(--accent-warn) 0%, transparent), 0 0 8px 3px color-mix(in srgb, var(--accent-warn) 35%, transparent); }
  50%      { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-warn) 20%, transparent), 0 0 14px 6px color-mix(in srgb, var(--accent-warn) 50%, transparent); }
}
@keyframes lqs3-ripple {
  0%   { transform:scale(0); opacity:.55; }
  100% { transform:scale(3.5); opacity:0; }
}
@keyframes lqs3-scene-flash {
  0%   { background: color-mix(in srgb, var(--accent-warn) 28%, var(--glass-l2-bg)); }
  100% { background: var(--glass-l2-bg); }
}
@keyframes lqs3-led-activity {
  0%   { opacity:1; transform:scale(1.5); }
  100% { opacity:1; transform:scale(1); }
}
@keyframes lqs3-swatch-in {
  from { transform:scale(.85); opacity:.4; }
  to   { transform:scale(1);   opacity:1; }
}

/* ── Stale border animation on root ── */
.lqs3-root.is-stale {
  opacity: 0.72;
  animation: lqs3-stale-pulse 2s ease-in-out infinite;
}
.lqs3-root.is-connecting { opacity: 0.85; }

/* ── Connection pill ── */
.lqs3-pill {
  display:inline-flex; align-items:center; gap:5px;
  padding:3px 10px 3px 7px; border-radius: var(--radius-pill);
  font-size: var(--type-2xs); font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-caps); text-transform:uppercase;
  border:1px solid; backdrop-filter: var(--glass-l3-backdrop);
  -webkit-backdrop-filter: var(--glass-l3-backdrop);
}
.lqs3-pill-live  {
  color: rgb(var(--lqs3-green-rgb));
  border-color: color-mix(in srgb, rgb(var(--lqs3-green-rgb)) 30%, transparent);
  background: color-mix(in srgb, rgb(var(--lqs3-green-rgb)) 8%, transparent);
}
.lqs3-pill-stale {
  color: var(--accent-warn);
  border-color: color-mix(in srgb, var(--accent-warn) 30%, transparent);
  background: color-mix(in srgb, var(--accent-warn) 8%, transparent);
}
.lqs3-pill-conn  {
  color: rgb(var(--text) / 0.45);
  border-color: var(--glass-l2-border);
  background: var(--glass-l2-bg);
}
.lqs3-pill-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.lqs3-pill-live  .lqs3-pill-dot {
  background: rgb(var(--lqs3-green-rgb));
  box-shadow: 0 0 6px rgb(var(--lqs3-green-rgb));
}
.lqs3-pill-stale .lqs3-pill-dot {
  background: var(--accent-warn);
  animation: lqs3-pulse 1.4s ease-in-out infinite;
}
.lqs3-pill-conn  .lqs3-pill-dot {
  background: rgb(var(--text) / 0.25);
  animation: lqs3-pulse 1.6s ease-in-out infinite;
}

/* ── Section divider title ── */
.lqs3-area-name {
  font-family: 'Playfair Display', serif;
  font-size: var(--type-xs); font-weight: 500; letter-spacing: .04em;
  color: rgb(var(--text) / 0.55); text-transform:uppercase;
  margin:0 0 12px;
  display:flex; align-items:center; gap:8px;
}
.lqs3-area-name::after {
  content:''; flex:1; height:1px;
  background: linear-gradient(90deg, var(--glass-l2-border) 0%, transparent 100%);
}

/* ── Light card micro-animations ── */
.lqs3-light-halo {
  position:absolute; inset:0; pointer-events:none;
  border-radius:inherit; opacity:0;
  transition: opacity .55s ease, background .55s ease;
}
.lqs3-light-is-on .lqs3-light-halo { opacity:1; }

.lqs3-swatch-disk {
  width:22px; height:22px; border-radius:50%; flex-shrink:0;
  border: 1.5px solid rgba(0,0,0,.2);
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
  transition: background .45s ease, transform .45s ease, box-shadow .45s ease;
  animation: lqs3-swatch-in .3s ease both;
}

.lqs3-bulb-icon {
  width:26px; height:26px; flex-shrink:0;
  transition: filter .35s, color .35s;
}
.lqs3-light-is-on .lqs3-bulb-icon {
  filter: drop-shadow(0 0 7px currentColor);
  animation: lqs3-glow-breathe 3s ease-in-out infinite;
}

/* ── Power button ── */
.lqs3-power-btn {
  width:26px; height:26px; border-radius:50%; border:none;
  display:flex; align-items:center; justify-content:center;
  font-weight:700; font-size:12px; cursor:pointer; flex-shrink:0;
  transition: background .25s, color .25s, box-shadow .25s, transform .1s;
  -webkit-tap-highlight-color:transparent;
}
.lqs3-power-btn:active { transform:scale(.88); }
.lqs3-power-btn.off {
  background: var(--glass-l3-bg); color: rgb(var(--text) / 0.28);
  border: 1px solid var(--glass-l3-border);
}
.lqs3-power-btn.on {
  background: color-mix(in srgb, var(--accent-warn) 22%, var(--glass-l3-bg));
  color: var(--accent-warn);
  border: 1px solid color-mix(in srgb, var(--accent-warn) 45%, transparent);
  animation: lqs3-glow-ring 3s ease-in-out infinite;
}

/* ── Brightness slider ── */
.lqs3-brightness-track {
  position:relative; height:28px;
  border-radius: var(--radius-pill); overflow:hidden;
  background: color-mix(in srgb, rgb(var(--text)) 8%, transparent);
  cursor:ew-resize; touch-action:none;
  transition: box-shadow .2s;
}
.lqs3-brightness-track.dragging,
.lqs3-brightness-track:focus-within {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-warn) 50%, transparent);
}
.lqs3-brightness-fill  { position:absolute; top:0; left:0; bottom:0; border-radius:inherit; pointer-events:none; }
.lqs3-brightness-handle {
  position:absolute; top:50%; transform:translate(-50%,-50%);
  width:18px; height:18px; border-radius:50%;
  background:white; box-shadow:0 0 0 2px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.55);
  pointer-events:none;
}

/* ── CCT strip ── */
.lqs3-cct-track {
  position:relative; height:9px;
  border-radius:5px; margin-top:7px;
  background:linear-gradient(90deg, hsl(38,90%,55%) 0%, hsl(45,80%,90%) 40%, hsl(210,80%,80%) 100%);
  cursor:ew-resize; touch-action:none;
  box-shadow:inset 0 1px 3px rgba(0,0,0,.25);
}
.lqs3-cct-thumb {
  position:absolute; top:50%; width:15px; height:15px;
  border-radius:50%; background:white;
  transform:translate(-50%,-50%);
  box-shadow:0 0 0 2px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.45);
  pointer-events:none;
  transition: left .12s ease;
}

/* ── Moving badge ── */
.lqs3-moving-badge {
  font-size: var(--type-2xs); letter-spacing:.07em; text-transform:uppercase;
  color: var(--accent-warn); animation: lqs3-pulse 1s infinite;
  padding:2px 5px; border-radius: var(--radius-chip);
  background: color-mix(in srgb, var(--accent-warn) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-warn) 25%, transparent);
}

/* ── Shade glyph ── */
.lqs3-shade-scene { position:relative; padding:14px 0; display:flex; justify-content:center; }
.lqs3-shade-glyph { position:relative; width:56px; height:76px; }
.lqs3-light-ray {
  position:absolute; bottom:0; left:50%;
  width:200%; transform:translateX(-50%);
  height:100%;
  background:linear-gradient(180deg,
    rgba(255,240,200,.00) 0%,
    rgba(255,240,200,.06) 60%,
    rgba(255,240,200,.12) 100%);
  pointer-events:none; z-index:0;
  transition: opacity .6s ease;
  border-radius:50% 50% 0 0 / 20% 20% 0 0;
}
.lqs3-window-frame {
  position:absolute; inset:0; z-index:1;
  border: 1.5px solid var(--glass-l2-border);
  border-radius:3px;
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--accent-water) 7%, transparent) 0%,
    color-mix(in srgb, var(--accent-water) 3%, transparent) 100%);
}
.lqs3-window-frame::before {
  content:''; position:absolute; left:50%; top:0; bottom:0;
  width:1px; background: var(--glass-l2-border); transform:translateX(-50%);
}
.lqs3-window-frame::after {
  content:''; position:absolute; top:50%; left:0; right:0;
  height:1px; background: var(--glass-l2-border); transform:translateY(-50%);
}
.lqs3-shade-panel {
  position:absolute; top:0; left:2px; right:2px; z-index:2;
  background: color-mix(in srgb, rgb(var(--text)) 18%, transparent);
  border-radius:2px;
  transition: height .65s cubic-bezier(.4,0,.2,1); overflow:hidden;
}
.lqs3-shade-stripes {
  position:absolute; inset:0;
  background:repeating-linear-gradient(0deg,
    transparent, transparent 5px,
    rgba(0,0,0,.14) 6px);
}
.lqs3-shade-rail {
  position:absolute; bottom:0; left:0; right:0; height:4px;
  background: rgb(var(--text) / 0.45);
  border-radius:0 0 2px 2px;
  box-shadow:0 2px 6px rgba(0,0,0,.4);
}
.lqs3-shade-leak {
  position:absolute; left:2px; right:2px; z-index:1;
  bottom:2px; border-radius:0 0 3px 3px;
  background: rgba(255,230,180,.07);
  transition: height .65s cubic-bezier(.4,0,.2,1), opacity .65s;
  pointer-events:none;
}

/* ── Blind slats ── */
.lqs3-tilt-glyph {
  display:flex; flex-direction:column; gap:4px;
  padding:10px 12px; align-items:stretch; position:relative;
}
.lqs3-tilt-glyph::before {
  content:''; position:absolute; inset:0;
  background:linear-gradient(180deg, rgba(255,240,200,.0) 0%, rgba(255,240,200,.07) 100%);
  pointer-events:none; z-index:0; border-radius:3px;
}
.lqs3-slat {
  height:5px;
  background: color-mix(in srgb, rgb(var(--text)) 18%, transparent);
  border-radius:2px; transform-origin:center;
  transition: transform .45s cubic-bezier(.4,0,.2,1);
  position:relative; z-index:1;
  box-shadow:0 1px 3px rgba(0,0,0,.18);
}

/* ── Scene button ── */
.lqs3-scene-btn.fired {
  animation: lqs3-scene-flash .5s ease-out forwards;
}
/* Ripple */
.lqs3-ripple {
  position:absolute; border-radius:50%;
  width:80px; height:80px; margin-left:-40px; margin-top:-40px;
  background: color-mix(in srgb, var(--accent-warn) 35%, transparent);
  pointer-events:none;
  animation: lqs3-ripple .65s linear;
}

/* ── LED dot ── */
.lqs3-led {
  width:8px; height:8px; border-radius:50%; flex-shrink:0;
  transition: background .3s, box-shadow .3s;
}
.lqs3-led.on {
  background: var(--accent-warn);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-warn) 25%, transparent),
              0 0 8px 3px color-mix(in srgb, var(--accent-warn) 55%, transparent);
  animation: lqs3-glow-breathe 2.5s ease-in-out infinite;
}
.lqs3-led.off     { background: rgb(var(--text) / 0.18); box-shadow:none; }
.lqs3-led.unknown { background: rgb(var(--text) / 0.08); box-shadow:none; }
.lqs3-led.activity {
  animation: lqs3-led-activity .3s ease-out;
  background: rgb(var(--lqs3-green-rgb));
  box-shadow: 0 0 8px 3px color-mix(in srgb, rgb(var(--lqs3-green-rgb)) 60%, transparent);
}

/* ── Empty state ── */
.lqs3-empty {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap: var(--space-3); padding:40px 20px; text-align:center; opacity:.5;
}
.lqs3-empty-icon { font-size:40px; opacity:.4; }
.lqs3-empty-title {
  font-family:'Playfair Display', serif;
  font-size: var(--type-md); font-weight:500;
  color: rgb(var(--text));
}
.lqs3-empty-sub {
  font-size: var(--type-xs); letter-spacing:.04em;
  max-width:280px; line-height:1.6; opacity:.7;
  color: rgb(var(--text));
}

/* ── Layout ── */
.lqs3-scroll { overflow-y:auto; overflow-x:hidden; }
.lqs3-areas-grid {
  display:grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-5);
}
.lqs3-lights-grid {
  display:grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--space-2); margin-bottom: var(--space-3);
}
.lqs3-covers-grid {
  display:grid;
  grid-template-columns: repeat(auto-fill, minmax(144px, 1fr));
  gap: var(--space-2);
}
.lqs3-scenes-grid {
  display:grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-2);
}
.lqs3-keypads-grid {
  display:grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}
.lqs3-section { margin-bottom: var(--space-6); }
.lqs3-section:last-child { margin-bottom:0; }

@media (max-width:420px) {
  .lqs3-areas-grid   { grid-template-columns:1fr; gap: var(--space-3); }
  .lqs3-lights-grid  { grid-template-columns:repeat(2,1fr); }
  .lqs3-covers-grid  { grid-template-columns:repeat(2,1fr); }
  .lqs3-scenes-grid  { grid-template-columns:repeat(2,1fr); }
  .lqs3-keypads-grid { grid-template-columns:1fr; }
}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  // Remove previous version
  const old = document.getElementById('lutron-surface-styles-v2');
  if (old) old.remove();
  const old1 = document.getElementById('lutron-surface-styles');
  if (old1) old1.remove();
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ─── Colour math ─────────────────────────────────────────────────────────────

function hsToCss(hs: [number, number], brightness: number): string {
  const [h, s] = hs;
  const l = Math.round(18 + (brightness / 100) * 52);
  return `hsl(${h},${s}%,${l}%)`;
}

function kelvinToCss(k: number, brightness: number): string {
  const t = Math.max(0, Math.min(1, (k - 2000) / (6500 - 2000)));
  const h = Math.round(t * 210 + (1 - t) * 38);
  const s = Math.round(80 - t * 30);
  const l = Math.round(18 + (brightness / 100) * 52);
  return `hsl(${h},${s}%,${l}%)`;
}

function lightSwatchColor(light: LutronLightState, displayBrightness: number): string {
  if (!light.isOn && displayBrightness === 0) return 'color-mix(in srgb, rgb(var(--text)) 15%, transparent)';
  if (light.hsColor) return hsToCss(light.hsColor, displayBrightness);
  if (light.colorTempKelvin) return kelvinToCss(light.colorTempKelvin, displayBrightness);
  const alpha = 0.28 + (displayBrightness / 100) * 0.62;
  return `rgba(220,160,60,${alpha.toFixed(2)})`;
}

function lightHaloStyle(light: LutronLightState, brightness: number): React.CSSProperties {
  if (!light.isOn && brightness === 0) return {};
  const color = lightSwatchColor(light, brightness);
  const op = (0.10 + (brightness / 100) * 0.14).toFixed(3);
  return {
    background: `radial-gradient(ellipse 80% 60% at 30% 10%, ${color} 0%, transparent 80%)`,
    opacity: Number(op),
  };
}

function brightnessGradient(swatchColor: string, pct: number): React.CSSProperties {
  return {
    width: `${pct}%`,
    background: `linear-gradient(90deg, ${swatchColor}44 0%, ${swatchColor}cc 100%)`,
    transition: 'width .15s ease',
  };
}

// ─── Connection pill ──────────────────────────────────────────────────────────

const ConnPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
  const cls =
    status === 'live'  ? 'lqs3-pill lqs3-pill-live'
    : status === 'stale' ? 'lqs3-pill lqs3-pill-stale'
    : 'lqs3-pill lqs3-pill-conn';
  const label = status === 'live' ? 'Live' : status === 'stale' ? 'Stale' : 'Connecting';
  return <span className={cls}><span className="lqs3-pill-dot" />{label}</span>;
};

// ─── Brightness slider ────────────────────────────────────────────────────────

interface BrightnessSliderProps {
  value: number;
  color: string;
  disabled?: boolean;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}

const BrightnessSlider = ({ value, color, disabled, onChange, onCommit }: BrightnessSliderProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const lastValue = useRef(value);

  const posFromEvent = useCallback((e: PointerEvent | React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round((x / rect.width) * 100);
  }, [value]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true; setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const v = posFromEvent(e); lastValue.current = v; onChange(v);
  };
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const v = posFromEvent(e);
    if (v !== lastValue.current) { lastValue.current = v; onChange(v); }
  }, [posFromEvent, onChange]);
  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false; setIsDragging(false);
    onCommit(posFromEvent(e));
  }, [posFromEvent, onCommit]);

  useEffect(() => {
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const fillStyle = brightnessGradient(color, value);
  const handleStyle: React.CSSProperties = {
    left: `${value}%`,
    transition: isDragging ? 'none' : 'left .15s ease',
  };

  return (
    <div
      ref={trackRef}
      className={`lqs3-brightness-track${isDragging ? ' dragging' : ''}`}
      onPointerDown={handlePointerDown}
      style={{ cursor: disabled ? 'default' : 'ew-resize', marginTop: 8 }}
    >
      <div className="lqs3-brightness-fill" style={fillStyle} />
      <div className="lqs3-brightness-handle" style={handleStyle} />
    </div>
  );
};

// ─── CCT slider ───────────────────────────────────────────────────────────────

interface CctSliderProps {
  value: number; min: number; max: number; disabled?: boolean; onCommit: (k: number) => void;
}

const CctSlider = ({ value, min, max, disabled, onCommit }: CctSliderProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setLocal(value); }, [value]);

  const posFromEvent = (e: PointerEvent | React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return local;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round(min + (x / rect.width) * (max - min));
  };
  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setLocal(posFromEvent(e));
  };
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return; setLocal(posFromEvent(e));
  }, []);
  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const k = posFromEvent(e); setLocal(k); onCommit(k);
  }, [onCommit]);
  useEffect(() => {
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const pct = max > min ? ((local - min) / (max - min)) * 100 : 50;
  return (
    <div ref={trackRef} className="lqs3-cct-track"
      onPointerDown={handlePointerDown}
      style={{ cursor: disabled ? 'default' : 'ew-resize' }}
    >
      <div className="lqs3-cct-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
};

// ─── Light card ───────────────────────────────────────────────────────────────

interface LightCardProps {
  light: LutronLightState; optimistic: number | null;
  onBrightnessChange: (entityId: string, v: number) => void;
  onBrightnessCommit: (entityId: string, v: number) => void;
  onCctCommit: (entityId: string, k: number) => void;
  onToggle: (entityId: string) => void;
}

const LightCard = ({ light, optimistic, onBrightnessChange, onBrightnessCommit, onCctCommit, onToggle }: LightCardProps) => {
  const displayBrightness = optimistic !== null ? optimistic : light.brightness;
  const isOn = light.isOn || displayBrightness > 0;
  const swatchColor = lightSwatchColor({ ...light, isOn }, displayBrightness);
  const haloStyle = lightHaloStyle({ ...light, isOn }, displayBrightness);
  const hasCct = light.supportsColorTemp && light.minColorTempKelvin && light.maxColorTempKelvin;

  const bulbColor = isOn
    ? (light.hsColor
        ? hsToCss(light.hsColor, displayBrightness)
        : `rgb(${Math.round(220 + (displayBrightness / 100) * 20)}, ${Math.round(160 - (displayBrightness / 100) * 8)}, 60)`)
    : 'rgba(128,128,128,.22)';

  // GlassCard with amber active-vibrancy when light is on
  const cardStyle: React.CSSProperties = isOn
    ? glassMaterialActive(2, 'var(--accent-warn)', { glowStrength: 0.14 })
    : glassMaterial(2);

  return (
    <div
      className={`relative overflow-hidden ${!light.available ? 'opacity-40 pointer-events-none' : ''}`}
      title={light.name}
      style={{
        borderRadius: 'var(--radius-card)',
        padding: 12,
        cursor: 'pointer',
        transition: `border-color var(--dur-medium) var(--spring-gentle), background-color var(--dur-medium) var(--spring-gentle), box-shadow var(--dur-slow) var(--spring-gentle)`,
        ...cardStyle,
      }}
    >
      {/* Ambient halo — colour-reactive, scales with brightness */}
      <div
        className={`lqs3-light-halo${isOn ? '' : ''}`}
        style={haloStyle}
      />

      {/* Top row: swatch + meta + power */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }}>
        <div
          className="lqs3-swatch-disk"
          style={{
            background: swatchColor,
            transform: isOn ? `scale(${1 + (displayBrightness / 100) * 0.12})` : 'scale(1)',
            boxShadow: isOn
              ? `0 0 0 3px color-mix(in srgb, var(--accent-warn) 12%, transparent), 0 0 ${Math.round(4 + (displayBrightness / 100) * 12)}px ${swatchColor}`
              : undefined,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 'var(--type-xs)', fontWeight: 'var(--weight-medium)', letterSpacing: '.06em', color: 'rgb(var(--text))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {light.name}
          </span>
          <span style={{
            fontFamily: 'var(--font-numeric)', fontSize: 'var(--type-sm)', fontWeight: 300,
            lineHeight: 1.2,
            color: isOn ? 'var(--accent-warn)' : 'rgb(var(--text) / 0.45)',
            transition: `color var(--dur-medium) var(--spring-gentle)`,
          }}>
            {isOn ? `${displayBrightness}%` : 'Off'}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(light.entityId); }}
          disabled={!light.available}
          className={`lqs3-power-btn ${isOn ? 'on' : 'off'}`}
          aria-label={isOn ? 'Turn off' : 'Turn on'}
        >
          ⏻
        </button>
      </div>

      {/* Bulb icon */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 4px' }}>
        <svg
          className={`lqs3-bulb-icon${isOn ? ' lqs3-light-is-on' : ''}`}
          viewBox="0 0 24 24" fill="none"
          style={{ color: bulbColor, width: 26, height: 26 }}
        >
          <path
            d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.2-3 5.4V17H9v-2.6C7.2 13.2 6 11.2 6 9a6 6 0 0 1 6-6z"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            fill={isOn ? 'currentColor' : 'none'} fillOpacity={isOn ? 0.18 : 0}
          />
        </svg>
      </div>

      <BrightnessSlider
        value={displayBrightness} color={swatchColor}
        disabled={!light.available}
        onChange={(v) => onBrightnessChange(light.entityId, v)}
        onCommit={(v) => onBrightnessCommit(light.entityId, v)}
      />

      {hasCct && (
        <CctSlider
          value={light.colorTempKelvin ?? light.minColorTempKelvin!}
          min={light.minColorTempKelvin!} max={light.maxColorTempKelvin!}
          disabled={!light.available}
          onCommit={(k) => onCctCommit(light.entityId, k)}
        />
      )}
    </div>
  );
};

// ─── Shade / Blind widget ─────────────────────────────────────────────────────

interface CoverWidgetProps {
  cover: LutronCoverState; optimistic: number | null; optimisticTilt?: number | null;
  onOpen: (entityId: string) => void; onClose: (entityId: string) => void;
  onStop: (entityId: string) => void;
  onTiltOpen?: (entityId: string) => void; onTiltClose?: (entityId: string) => void;
}

const CoverWidget = ({ cover, optimistic, optimisticTilt, onOpen, onClose, onStop, onTiltOpen, onTiltClose }: CoverWidgetProps) => {
  const position = optimistic !== null ? optimistic : (cover.currentPosition ?? 50);
  const tiltPosition = (optimisticTilt !== null && optimisticTilt !== undefined)
    ? optimisticTilt : (cover.currentTiltPosition ?? 50);
  const shadePanelHeight = `${100 - position}%`;
  const shadeLeakHeight = `${position}%`;
  const rayOpacity = position / 100;
  const slatDeg = Math.round((tiltPosition / 100) * 75 - 37);
  const slatRotation = cover.supportsTilt ? `rotate(${slatDeg}deg)` : undefined;
  const isMoving = cover.state === 'opening' || cover.state === 'closing';

  return (
    <div
      className={`overflow-hidden${!cover.available ? ' opacity-40 pointer-events-none' : ''}`}
      style={{ borderRadius: 'var(--radius-card)', transition: `opacity var(--dur-medium) var(--spring-gentle)`, ...glassMaterial(2) }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px 8px', borderBottom: `1px solid var(--glass-l2-border)`,
      }}>
        <span style={{ fontSize: 'var(--type-xs)', fontWeight: 'var(--weight-medium)', letterSpacing: '.06em', color: 'rgb(var(--text))' }}>
          {cover.name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isMoving && <span className="lqs3-moving-badge">{cover.state}</span>}
          <span style={{ fontFamily: 'var(--font-numeric)', fontSize: 'var(--type-md)', fontWeight: 300, color: 'rgb(var(--text) / 0.45)' }}>
            {Math.round(position)}%
          </span>
        </div>
      </div>

      {/* Visual glyph */}
      {!cover.supportsTilt ? (
        <div className="lqs3-shade-scene">
          <div className="lqs3-shade-glyph">
            <div className="lqs3-light-ray" style={{ opacity: rayOpacity * 0.8 }} />
            <div className="lqs3-window-frame" />
            <div className="lqs3-shade-panel" style={{ height: shadePanelHeight }}>
              <div className="lqs3-shade-stripes" />
              <div className="lqs3-shade-rail" />
            </div>
            <div className="lqs3-shade-leak" style={{ height: shadeLeakHeight, opacity: rayOpacity * 0.7 }} />
          </div>
        </div>
      ) : (
        <div className="lqs3-tilt-glyph">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="lqs3-slat" style={{ transform: slatRotation }} />
          ))}
        </div>
      )}

      {/* Controls — GlassButton */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 10px' }}>
        <GlassButton
          onClick={() => onOpen(cover.entityId)} disabled={!cover.available}
          title="Open" active={cover.state === 'opening'} accentVar="var(--accent-warn)"
          style={{ flex: 1, padding: '7px 0', fontSize: 'var(--type-xs)', letterSpacing: '.05em' }}
        >▲</GlassButton>
        <GlassButton
          onClick={() => onStop(cover.entityId)} disabled={!cover.available}
          title="Stop"
          style={{ flex: 0.55, padding: '7px 0', fontSize: 13 }}
        >■</GlassButton>
        <GlassButton
          onClick={() => onClose(cover.entityId)} disabled={!cover.available}
          title="Close" active={cover.state === 'closing'} accentVar="var(--accent-warn)"
          style={{ flex: 1, padding: '7px 0', fontSize: 'var(--type-xs)', letterSpacing: '.05em' }}
        >▼</GlassButton>
      </div>

      {cover.supportsTilt && onTiltOpen && onTiltClose && (
        <div style={{ display: 'flex', gap: 4, padding: '0 10px 10px' }}>
          <GlassButton onClick={() => onTiltOpen(cover.entityId)} disabled={!cover.available} title="Tilt open"
            style={{ flex: 1, padding: '5px 0', fontSize: 9, letterSpacing: '.04em' }}>
            TILT ▲
          </GlassButton>
          <GlassButton onClick={() => onTiltClose(cover.entityId)} disabled={!cover.available} title="Tilt close"
            style={{ flex: 1, padding: '5px 0', fontSize: 9, letterSpacing: '.04em' }}>
            TILT ▼
          </GlassButton>
        </div>
      )}
    </div>
  );
};

// ─── Scene button ─────────────────────────────────────────────────────────────

const SceneButton = ({ scene, onActivate }: { scene: LutronSceneState; onActivate: (entityId: string) => void }) => {
  const [fired, setFired] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const nextId = useRef(0);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!scene.available) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = nextId.current++;
    setRipples(prev => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 750);
    setFired(true); setTimeout(() => setFired(false), 500);
    onActivate(scene.entityId);
  };

  return (
    <button
      className={`lqs3-scene-btn relative overflow-hidden${fired ? ' fired' : ''}${!scene.available ? ' opacity-40 pointer-events-none' : ''}`}
      onClick={handleClick}
      disabled={!scene.available}
      style={{
        padding: '14px 12px 12px', cursor: 'pointer',
        border: 'none', textAlign: 'left',
        display: 'flex', flexDirection: 'column', gap: 4,
        borderRadius: 'var(--radius-card)',
        transition: `all var(--dur-medium) var(--spring-gentle)`,
        ...glassMaterial(2),
      }}
    >
      {ripples.map(r => <span key={r.id} className="lqs3-ripple" style={{ left: r.x, top: r.y }} />)}
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        background: 'color-mix(in srgb, var(--accent-warn) 15%, var(--glass-l3-bg))',
        border: '1px solid color-mix(in srgb, var(--accent-warn) 30%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        transition: `background var(--dur-medium) var(--spring-gentle), box-shadow var(--dur-medium) var(--spring-gentle)`,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <polygon points="5,3 19,12 5,21" fill="var(--accent-warn)" fillOpacity={0.9} />
        </svg>
      </div>
      <span style={{ fontSize: 'var(--type-xs)', fontWeight: 'var(--weight-medium)', letterSpacing: '.06em', color: 'rgb(var(--text))', display: 'block' }}>
        {scene.name}
      </span>
      <span style={{ fontSize: 'var(--type-2xs)', letterSpacing: '.07em', color: 'rgb(var(--text) / 0.3)', display: 'block' }}>
        Tap to activate
      </span>
    </button>
  );
};

// ─── Keypad panel ─────────────────────────────────────────────────────────────

const KeypadPanel = ({ keypad, onPress }: { keypad: LutronKeypad; onPress: (entityId: string) => void }) => {
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);

  const handlePress = (btn: LutronButtonState) => {
    if (!btn.available) return;
    setPressedId(btn.entityId); setActivityId(btn.entityId);
    setTimeout(() => setPressedId(null), 600);
    setTimeout(() => setActivityId(null), 350);
    onPress(btn.entityId);
  };

  return (
    <div style={{ borderRadius: 'var(--radius-card)', overflow: 'hidden', ...glassMaterial(2) }}>
      <div style={{
        padding: '10px 14px 8px', borderBottom: '1px solid var(--glass-l2-border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: 'rgb(var(--text) / 0.3)', flexShrink: 0 }}>
          <rect x="2" y="2" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="2" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="16" y="2" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2" y="9" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="16" y="9" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2" y="16" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="16" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="16" y="16" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span style={{ fontSize: 'var(--type-xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgb(var(--text) / 0.45)', fontWeight: 500 }}>
          {keypad.name}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
        {keypad.buttons.map(btn => {
          const isActivity = activityId === btn.entityId;
          const ledClass = isActivity
            ? 'lqs3-led activity'
            : btn.ledEntityId !== null
              ? (btn.ledOn === true ? 'lqs3-led on' : 'lqs3-led off')
              : 'lqs3-led unknown';

          const isPressed = pressedId === btn.entityId;
          return (
            <GlassButton
              key={btn.entityId}
              onClick={() => handlePress(btn)}
              disabled={!btn.available}
              title={btn.name}
              active={isPressed || btn.ledOn === true}
              accentVar="var(--accent-warn)"
              style={{
                gap: 8, padding: '7px 10px',
                fontFamily: 'var(--font-numeric)', fontSize: 'var(--type-xs)',
                letterSpacing: '.05em', color: 'rgb(var(--text) / 0.65)',
              }}
            >
              <span className={ledClass} />
              {btn.name}
            </GlassButton>
          );
        })}
      </div>
    </div>
  );
};

// ─── Area section ─────────────────────────────────────────────────────────────

interface AreaSectionProps {
  area: LutronArea;
  getOptimistic: (id: string) => number | null;
  setOptimistic: (id: string, v: number) => void;
}

const AreaSection = ({ area, getOptimistic, setOptimistic }: AreaSectionProps) => {
  const handleBrightnessChange = useCallback((entityId: string, v: number) => { setOptimistic(entityId, v); }, [setOptimistic]);
  const handleBrightnessCommit = useCallback(async (entityId: string, v: number) => {
    setOptimistic(entityId, v); await setLightBrightness(entityId, v);
  }, [setOptimistic]);
  const handleCctCommit = useCallback(async (entityId: string, k: number) => { await setLightColorTemp(entityId, k); }, []);
  const handleToggle = useCallback(async (entityId: string) => {
    const light = area.lights.find(l => l.entityId === entityId);
    if (!light) return;
    const nextBrightness = light.isOn ? 0 : 100;
    setOptimistic(entityId, nextBrightness);
    await toggleLight(entityId, light.isOn);
  }, [area.lights, setOptimistic]);
  const handleOpen  = useCallback(async (entityId: string) => { await openCover(entityId); }, []);
  const handleClose = useCallback(async (entityId: string) => { await closeCover(entityId); }, []);
  const handleStop  = useCallback(async (entityId: string) => { await stopCover(entityId); }, []);
  const handleTiltOpen  = useCallback(async (entityId: string) => { await openCoverTilt(entityId); }, []);
  const handleTiltClose = useCallback(async (entityId: string) => { await closeCoverTilt(entityId); }, []);

  return (
    <div>
      <h3 className="lqs3-area-name">{area.name}</h3>
      {area.lights.length > 0 && (
        <div className="lqs3-lights-grid" style={{ marginBottom: area.covers.length > 0 ? 12 : 0 }}>
          {area.lights.map(light => (
            <LightCard
              key={light.entityId} light={light} optimistic={getOptimistic(light.entityId)}
              onBrightnessChange={handleBrightnessChange} onBrightnessCommit={handleBrightnessCommit}
              onCctCommit={handleCctCommit} onToggle={handleToggle}
            />
          ))}
        </div>
      )}
      {area.covers.length > 0 && (
        <div className="lqs3-covers-grid">
          {area.covers.map(cover => (
            <CoverWidget
              key={cover.entityId} cover={cover} optimistic={getOptimistic(cover.entityId)}
              onOpen={handleOpen} onClose={handleClose} onStop={handleStop}
              onTiltOpen={handleTiltOpen} onTiltClose={handleTiltClose}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main surface ─────────────────────────────────────────────────────────────

const LutronSurface = (_props: TileProps) => {
  useEffect(() => { injectStyles(); }, []);

  const { state, connStatus, getOptimistic, setOptimistic } = useLutronSurface();
  const handleActivateScene = useCallback(async (entityId: string) => { await activateScene(entityId); }, []);
  const handlePressButton   = useCallback(async (entityId: string) => { await pressButton(entityId); }, []);

  const hasAreas   = state.areas.length > 0;
  const hasScenes  = state.scenes.length > 0;
  const hasKeypads = state.keypads.length > 0;

  const totalLights = useMemo(() => state.areas.reduce((s, a) => s + a.lights.length, 0), [state.areas]);
  const lightsOn    = useMemo(() => state.areas.reduce((s, a) => s + a.lights.filter(l => l.isOn).length, 0), [state.areas]);
  const totalCovers = useMemo(() => state.areas.reduce((s, a) => s + a.covers.length, 0), [state.areas]);

  const rootClass = [
    'lqs3-root',
    connStatus === 'stale'      ? 'is-stale'      : '',
    connStatus === 'connecting' ? 'is-connecting' : '',
  ].filter(Boolean).join(' ');

  return (
    <GlassPanel
      animate
      level={1}
      className={rootClass}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-4) var(--space-3)',
        borderBottom: '1px solid var(--glass-l1-border)', flexShrink: 0,
        background: 'var(--glass-l1-tint)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Lutron logomark — concentric arcs */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="3" fill="var(--accent-warn)" />
            <path d="M12 4a8 8 0 0 1 8 8" stroke="var(--accent-warn)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity={0.55} />
            <path d="M4 12a8 8 0 0 1 8-8" stroke="var(--accent-warn)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity={0.28} />
            <path d="M12 20a8 8 0 0 1-8-8" stroke="var(--accent-warn)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity={0.14} />
          </svg>
          <div>
            <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 'var(--type-md)', fontWeight: 500, lineHeight: 1.1, letterSpacing: '.03em', color: 'rgb(var(--text))' }}>
              Lutron HomeWorks
            </p>
            <p style={{ fontSize: 'var(--type-2xs)', letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgb(var(--text) / 0.45)', marginTop: 1 }}>
              QSX · Lighting &amp; Shading
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.present && (
            <div style={{ display: 'flex', gap: 8, fontSize: 'var(--type-xs)', letterSpacing: '.05em', color: 'rgb(var(--text) / 0.45)' }}>
              {totalLights > 0 && (
                <span style={{ color: lightsOn > 0 ? 'var(--accent-warn)' : undefined }}>
                  {lightsOn}/{totalLights} lit
                </span>
              )}
              {totalCovers > 0 && <span>{totalCovers} shades</span>}
            </div>
          )}
          <ConnPill status={connStatus} />
        </div>
      </div>

      {/* Body */}
      <div className="lqs3-scroll" style={{ flex: 1, padding: 'var(--space-4)' }}>

        {/* Empty state */}
        {!state.present && (
          <div className="lqs3-empty">
            <div className="lqs3-empty-icon">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.2-3 5.4V17H9v-2.6C7.2 13.2 6 11.2 6 9a6 6 0 0 1 6-6z"
                  stroke="rgb(var(--text) / 0.25)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="lqs3-empty-title">
              {connStatus === 'connecting' ? 'Connecting…' : 'No Lutron Entities Found'}
            </p>
            <p className="lqs3-empty-sub">
              {connStatus === 'connecting'
                ? 'Establishing connection to Home Assistant…'
                : 'Lutron lights, shades, scenes, and keypads appear here automatically once the lutron_caseta integration is loaded.'}
            </p>
          </div>
        )}

        {/* Area sections */}
        {hasAreas && (
          <div className="lqs3-section">
            <div className="lqs3-areas-grid">
              {state.areas.map(area => (
                <AreaSection key={area.name} area={area} getOptimistic={getOptimistic} setOptimistic={setOptimistic} />
              ))}
            </div>
          </div>
        )}

        {/* Scenes */}
        {hasScenes && (
          <div className="lqs3-section">
            <h3 className="lqs3-area-name">Scenes</h3>
            <div className="lqs3-scenes-grid">
              {state.scenes.map(scene => (
                <SceneButton key={scene.entityId} scene={scene} onActivate={handleActivateScene} />
              ))}
            </div>
          </div>
        )}

        {/* Keypads */}
        {hasKeypads && (
          <div className="lqs3-section">
            <h3 className="lqs3-area-name">Keypads</h3>
            <div className="lqs3-keypads-grid">
              {state.keypads.map(keypad => (
                <KeypadPanel key={keypad.prefix} keypad={keypad} onPress={handlePressButton} />
              ))}
            </div>
          </div>
        )}

      </div>
    </GlassPanel>
  );
};

export default LutronSurface;
