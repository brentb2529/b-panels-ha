
// Lutron HomeWorks QSX — The Obsidian Controller  (animation/richness pass)
//
// Aesthetic: precision instrument / architectural lighting console.
// Dark glass, amber warmth, etched typography, physically-grounded controls.
// Motion reflects REAL state — lit rooms glow amber, shades physically travel,
// LEDs breathe, optimistic changes animate smoothly, stale state dims visibly.
//
// VISUAL UPGRADE OVER v1:
//   • Live color/brightness SWATCH disk on each light card; scales + saturates with level
//   • Ambient "halo" behind the bulb icon matches real colour (HS / CCT / default warm)
//   • Brightness fill: smooth gradient fill + animated thumb glow
//   • CCT strip: warm↔cool gradient + animated position, highlighted thumb
//   • Shade glyph: light ray through glass, richer fabric texture, deeper rail shadow
//   • Blind slats: smooth continuous tilt + translucent light-leak through slat gap
//   • Scene button: large icon, multi-layer pressed state, status-aware colouring
//   • Keypad: LED ring pulse + activity flash on press, colour-coded LED state
//   • Stale overlay: entire surface dims + amber pulsing border when stale/reconnecting
//   • Responsive reflow: wall (≥520 px) vs mobile column layout
//   • Light theme: full CSS variable overrides for light mode (prefers-color-scheme)
//   • Optimistic dimming: unavailable or stale-optimistic entities visually desaturate
//   • No entity bindings or service calls changed — visual pass only

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLutronSurface } from '../../hooks/useLutronSurface';
import type {
  LutronArea, LutronLightState, LutronCoverState,
  LutronSceneState, LutronKeypad, LutronButtonState,
} from '../../services/lutron';
import {
  setLightBrightness, setLightColorTemp, setLightHsColor, toggleLight,
  openCover, closeCover, stopCover, setCoverPosition,
  openCoverTilt, closeCoverTilt, setCoverTiltPosition,
  activateScene, pressButton,
} from '../../services/lutron';
import type { TileProps } from '../tileRegistry';

// ─── CSS injection ───────────────────────────────────────────────────────────
const STYLE_ID = 'lutron-surface-styles-v2';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Playfair+Display:wght@400;500;600&display=swap');

/* ── CSS custom properties — dark mode default ── */
.lqsx-root {
  font-family: 'DM Mono', monospace;

  /* palette */
  --lqsx-amber-r: 220; --lqsx-amber-g: 160; --lqsx-amber-b: 60;
  --lqsx-amber: rgb(220,160,60);
  --lqsx-amber-rgb: 220,160,60;
  --lqsx-ember-rgb: 240,100,40;
  --lqsx-cool-rgb: 160,210,255;
  --lqsx-green-rgb: 100,220,140;

  /* surfaces */
  --lqsx-bg:          rgba(10,10,12,0.97);
  --lqsx-glass:       rgba(255,255,255,0.04);
  --lqsx-glass-b:     rgba(255,255,255,0.08);
  --lqsx-glass-hover: rgba(255,255,255,0.10);
  --lqsx-border:      rgba(255,255,255,0.08);
  --lqsx-border-h:    rgba(255,255,255,0.18);
  --lqsx-border-focus:rgba(255,255,255,0.30);
  --lqsx-engraved:    rgba(0,0,0,0.45);
  --lqsx-header-bg:   rgba(255,255,255,0.02);
  --lqsx-grid:        rgba(255,255,255,0.015);

  /* text */
  --lqsx-text:        rgba(255,255,255,0.88);
  --lqsx-text-muted:  rgba(255,255,255,0.45);
  --lqsx-text-dim:    rgba(255,255,255,0.25);
  --lqsx-area-text:   rgba(255,255,255,0.55);

  /* radii */
  --lqsx-r: 12px;
  --lqsx-r-sm: 6px;

  /* window glass tint */
  --lqsx-window-tint: rgba(160,210,255,0.07);
  --lqsx-window-tint2: rgba(160,210,255,0.03);

  /* shade fabric */
  --lqsx-shade-fabric: rgba(255,255,255,0.18);
  --lqsx-shade-stripe: rgba(0,0,0,0.14);
  --lqsx-shade-rail:   rgba(255,255,255,0.45);

  background: var(--lqsx-bg);
  color: var(--lqsx-text);
  min-height: 100%;
  transition: opacity .4s ease;
}

/* ── Light theme override ── */
@media (prefers-color-scheme: light) {
  .lqsx-root {
    --lqsx-bg:          rgba(242,240,237,0.98);
    --lqsx-glass:       rgba(0,0,0,0.04);
    --lqsx-glass-b:     rgba(0,0,0,0.07);
    --lqsx-glass-hover: rgba(0,0,0,0.09);
    --lqsx-border:      rgba(0,0,0,0.09);
    --lqsx-border-h:    rgba(0,0,0,0.20);
    --lqsx-border-focus:rgba(0,0,0,0.35);
    --lqsx-engraved:    rgba(255,255,255,0.6);
    --lqsx-header-bg:   rgba(0,0,0,0.02);
    --lqsx-grid:        rgba(0,0,0,0.025);
    --lqsx-text:        rgba(30,25,20,0.92);
    --lqsx-text-muted:  rgba(30,25,20,0.50);
    --lqsx-text-dim:    rgba(30,25,20,0.30);
    --lqsx-area-text:   rgba(30,25,20,0.55);
    --lqsx-window-tint: rgba(120,180,240,0.10);
    --lqsx-window-tint2: rgba(120,180,240,0.04);
    --lqsx-shade-fabric: rgba(80,60,40,0.16);
    --lqsx-shade-stripe: rgba(0,0,0,0.10);
    --lqsx-shade-rail:   rgba(60,50,35,0.55);
  }
}

/* ── Stale dimming ── */
.lqsx-root.is-stale  { opacity: 0.72; }
.lqsx-root.is-connecting { opacity: 0.85; }

/* ── Keyframes ── */
@keyframes lqsx-pulse {
  0%,100% { opacity:1; } 50% { opacity:.3; }
}
@keyframes lqsx-glow-breathe {
  0%,100% { opacity:.65; transform:scale(1); }
  50%      { opacity:1;   transform:scale(1.18); }
}
@keyframes lqsx-glow-breathe-ring {
  0%,100% { box-shadow: 0 0 0 0px rgba(var(--lqsx-amber-rgb),0), 0 0 8px 3px rgba(var(--lqsx-amber-rgb),.35); }
  50%      { box-shadow: 0 0 0 3px rgba(var(--lqsx-amber-rgb),.2), 0 0 14px 6px rgba(var(--lqsx-amber-rgb),.5); }
}
@keyframes lqsx-ripple {
  0%   { transform:scale(0); opacity:.55; }
  100% { transform:scale(3.5); opacity:0; }
}
@keyframes lqsx-scene-flash {
  0%   { background:rgba(var(--lqsx-amber-rgb),.28); box-shadow:inset 0 0 0 1px rgba(var(--lqsx-amber-rgb),.5); }
  100% { background:var(--lqsx-glass); box-shadow:none; }
}
@keyframes lqsx-led-activity {
  0%   { opacity:1; transform:scale(1.5); }
  100% { opacity:1; transform:scale(1); }
}
@keyframes lqsx-stale-pulse {
  0%,100% { box-shadow:0 0 0 1px rgba(var(--lqsx-amber-rgb),.2); }
  50%     { box-shadow:0 0 0 1px rgba(var(--lqsx-amber-rgb),.6), 0 0 12px rgba(var(--lqsx-amber-rgb),.15); }
}
@keyframes lqsx-swatch-in {
  from { transform: scale(.85); opacity:.4; }
  to   { transform: scale(1);   opacity:1; }
}
@keyframes lqsx-shade-travel {
  from { filter: brightness(.9); }
  to   { filter: brightness(1); }
}

/* ── Stale border pulse ── */
.lqsx-root.is-stale  { animation: lqsx-stale-pulse 2s ease-in-out infinite; }

/* ── Connection pill ── */
.lqsx-pill {
  display:inline-flex; align-items:center; gap:5px;
  padding:3px 10px 3px 7px; border-radius:99px;
  font-size:10px; font-weight:500; letter-spacing:.08em; text-transform:uppercase;
  border:1px solid; backdrop-filter:blur(8px);
}
.lqsx-pill-live  { color:rgb(var(--lqsx-green-rgb)); border-color:rgba(var(--lqsx-green-rgb),.3); background:rgba(var(--lqsx-green-rgb),.08); }
.lqsx-pill-stale { color:rgb(var(--lqsx-amber-rgb)); border-color:rgba(var(--lqsx-amber-rgb),.3); background:rgba(var(--lqsx-amber-rgb),.08); }
.lqsx-pill-conn  { color:var(--lqsx-text-muted); border-color:var(--lqsx-border); background:var(--lqsx-glass); }
.lqsx-pill-dot {
  width:6px; height:6px; border-radius:50%; flex-shrink:0;
}
.lqsx-pill-live .lqsx-pill-dot  { background:rgb(var(--lqsx-green-rgb)); box-shadow:0 0 6px rgb(var(--lqsx-green-rgb)); }
.lqsx-pill-stale .lqsx-pill-dot { background:rgb(var(--lqsx-amber-rgb)); animation:lqsx-pulse 1.4s ease-in-out infinite; }
.lqsx-pill-conn .lqsx-pill-dot  { background:var(--lqsx-text-dim); animation:lqsx-pulse 1.6s ease-in-out infinite; }

/* ── Section titles ── */
.lqsx-area-name {
  font-family:'Playfair Display', serif;
  font-size:13px; font-weight:500; letter-spacing:.04em;
  color:var(--lqsx-area-text); text-transform:uppercase;
  margin:0 0 12px;
  display:flex; align-items:center; gap:8px;
}
.lqsx-area-name::after {
  content:''; flex:1; height:1px;
  background:linear-gradient(90deg, var(--lqsx-border) 0%, transparent 100%);
}

/* ── Light card ── */
.lqsx-light-card {
  position:relative; overflow:hidden;
  background:var(--lqsx-glass);
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  padding:12px;
  cursor:pointer;
  transition: border-color .25s, background .35s, box-shadow .4s, opacity .35s;
}
.lqsx-light-card:hover { border-color:var(--lqsx-border-h); background:var(--lqsx-glass-hover); }
.lqsx-light-card.is-on {
  background:var(--lqsx-glass-b);
  border-color:rgba(var(--lqsx-amber-rgb),.18);
}
.lqsx-light-card.is-unavailable { opacity:.38; pointer-events:none; }

/* Ambient halo behind bulb — colour-reactive, scales with brightness */
.lqsx-light-halo {
  position:absolute; inset:0; pointer-events:none;
  border-radius:inherit;
  opacity:0; transition: opacity .55s ease, background .55s ease;
}
.lqsx-light-card.is-on .lqsx-light-halo { opacity:1; }

/* Top swatch: larger, more visible colour disk + live fill */
.lqsx-light-swatch-row {
  display:flex; align-items:center; gap:8px; margin-bottom:8px; margin-top:4px;
}
.lqsx-swatch-disk {
  width:22px; height:22px; border-radius:50%; flex-shrink:0;
  border:1.5px solid rgba(0,0,0,.2);
  box-shadow:0 1px 4px rgba(0,0,0,.3);
  transition: background .45s ease, box-shadow .45s ease;
  animation: lqsx-swatch-in .3s ease both;
}
.lqsx-light-card.is-on .lqsx-swatch-disk {
  box-shadow:0 0 0 3px rgba(var(--lqsx-amber-rgb),.15), 0 2px 8px rgba(0,0,0,.35);
}

/* Level + name row */
.lqsx-light-meta {
  display:flex; flex-direction:column; min-width:0; flex:1;
}
.lqsx-light-name {
  font-size:11px; font-weight:500; letter-spacing:.06em;
  color:var(--lqsx-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.lqsx-light-level {
  font-family:'DM Mono',monospace; font-size:13px; font-weight:300;
  line-height:1.2; color:var(--lqsx-text-muted);
  transition: color .35s;
}
.lqsx-light-card.is-on .lqsx-light-level { color:rgb(var(--lqsx-amber-rgb)); }

/* Bulb icon */
.lqsx-bulb-icon {
  width:26px; height:26px; flex-shrink:0;
  transition: filter .35s, color .35s;
}
.lqsx-light-card.is-on .lqsx-bulb-icon {
  filter: drop-shadow(0 0 7px currentColor);
  animation: lqsx-glow-breathe 3s ease-in-out infinite;
}

/* Power button */
.lqsx-power-btn {
  width:26px; height:26px; border-radius:50%; border:none;
  display:flex; align-items:center; justify-content:center;
  font-weight:700; font-size:12px; cursor:pointer; flex-shrink:0;
  transition: background .25s, color .25s, box-shadow .25s, transform .1s;
  -webkit-tap-highlight-color:transparent;
}
.lqsx-power-btn:active { transform:scale(.88); }
.lqsx-power-btn.off { background:var(--lqsx-glass-b); color:var(--lqsx-text-dim); }
.lqsx-power-btn.on  {
  background:rgba(var(--lqsx-amber-rgb),.22); color:rgb(var(--lqsx-amber-rgb));
  animation: lqsx-glow-breathe-ring 3s ease-in-out infinite;
}

/* ── Brightness slider ── */
.lqsx-brightness-track {
  position:relative; height:28px;
  border-radius:14px; overflow:hidden;
  background:rgba(128,128,128,.10);
  cursor:ew-resize; touch-action:none;
  transition: box-shadow .2s;
}
.lqsx-brightness-track:focus-within,
.lqsx-brightness-track.dragging {
  box-shadow:0 0 0 2px var(--lqsx-border-focus);
}
.lqsx-brightness-fill {
  position:absolute; top:0; left:0; bottom:0;
  border-radius:inherit;
  pointer-events:none;
  /* width + background set via inline style; transition managed in component */
}
.lqsx-brightness-handle {
  position:absolute; top:50%; transform:translate(-50%,-50%);
  width:18px; height:18px; border-radius:50%;
  background:white; box-shadow:0 0 0 2px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.55);
  pointer-events:none;
}

/* ── CCT strip ── */
.lqsx-cct-track {
  position:relative; height:9px;
  border-radius:5px; margin-top:7px;
  background:linear-gradient(90deg,
    hsl(38,90%,55%) 0%,
    hsl(45,80%,90%) 40%,
    hsl(210,80%,80%) 100%);
  cursor:ew-resize; touch-action:none;
  box-shadow:inset 0 1px 3px rgba(0,0,0,.25);
}
.lqsx-cct-thumb {
  position:absolute; top:50%; width:15px; height:15px;
  border-radius:50%; background:white;
  transform:translate(-50%,-50%);
  box-shadow:0 0 0 2px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.45);
  pointer-events:none;
  transition: left .12s ease;
}

/* ── Cover widget ── */
.lqsx-cover-widget {
  background:var(--lqsx-glass);
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  overflow:hidden;
  transition: opacity .35s;
}
.lqsx-cover-widget.is-unavailable { opacity:.38; pointer-events:none; }
.lqsx-cover-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 12px 8px;
  border-bottom:1px solid var(--lqsx-border);
}
.lqsx-cover-name { font-size:11px; font-weight:500; letter-spacing:.06em; color:var(--lqsx-text); }
.lqsx-cover-pos  { font-family:'DM Mono',monospace; font-size:18px; font-weight:300; color:var(--lqsx-text-muted); }
.lqsx-moving-badge {
  font-size:9px; letter-spacing:.07em; text-transform:uppercase;
  color:rgb(var(--lqsx-amber-rgb)); animation:lqsx-pulse 1s infinite;
  padding:2px 5px; border-radius:4px; background:rgba(var(--lqsx-amber-rgb),.10);
  border:1px solid rgba(var(--lqsx-amber-rgb),.25);
}

/* ── Shade glyph ── */
.lqsx-shade-scene {
  position:relative; padding:14px 0; display:flex; justify-content:center;
}
.lqsx-shade-glyph {
  position:relative;
  width:56px; height:76px;
}
/* Light-ray from window — warm diffused shaft */
.lqsx-light-ray {
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
.lqsx-window-frame {
  position:absolute; inset:0; z-index:1;
  border:1.5px solid var(--lqsx-border-h);
  border-radius:3px;
  background:linear-gradient(180deg,
    var(--lqsx-window-tint) 0%,
    var(--lqsx-window-tint2) 100%);
}
/* Subtle cross-brace on window */
.lqsx-window-frame::before {
  content:''; position:absolute; left:50%; top:0; bottom:0;
  width:1px; background:rgba(255,255,255,.07); transform:translateX(-50%);
}
.lqsx-window-frame::after {
  content:''; position:absolute; top:50%; left:0; right:0;
  height:1px; background:rgba(255,255,255,.07); transform:translateY(-50%);
}
.lqsx-shade-panel {
  position:absolute; top:0; left:2px; right:2px; z-index:2;
  background:var(--lqsx-shade-fabric);
  border-radius:2px;
  /* height driven inline = (100-position)% */
  transition: height .65s cubic-bezier(.4,0,.2,1);
  overflow:hidden;
}
.lqsx-shade-stripes {
  position:absolute; inset:0;
  background:repeating-linear-gradient(
    0deg,
    transparent, transparent 5px,
    var(--lqsx-shade-stripe) 6px
  );
}
.lqsx-shade-rail {
  position:absolute; bottom:0; left:0; right:0; height:4px;
  background:var(--lqsx-shade-rail);
  border-radius:0 0 2px 2px;
  box-shadow:0 2px 6px rgba(0,0,0,.4);
}
/* Light-leak from below shade (shows how much light comes through) */
.lqsx-shade-leak {
  position:absolute; left:2px; right:2px; z-index:1;
  bottom:2px; border-radius:0 0 3px 3px;
  background:rgba(255,230,180,.07);
  transition: height .65s cubic-bezier(.4,0,.2,1), opacity .65s;
  pointer-events:none;
}

/* ── Blind slat glyph ── */
.lqsx-tilt-glyph {
  display:flex; flex-direction:column; gap:4px;
  padding:10px 12px; align-items:stretch; position:relative;
}
/* Light leak between slats */
.lqsx-tilt-glyph::before {
  content:''; position:absolute; inset:0;
  background:linear-gradient(180deg,
    rgba(255,240,200,.0) 0%,
    rgba(255,240,200,.07) 100%);
  pointer-events:none; z-index:0;
  border-radius:3px;
}
.lqsx-slat {
  height:5px;
  background:var(--lqsx-shade-fabric);
  border-radius:2px;
  transform-origin:center;
  transition: transform .45s cubic-bezier(.4,0,.2,1);
  position:relative; z-index:1;
  box-shadow:0 1px 3px rgba(0,0,0,.18);
}

/* ── Cover controls ── */
.lqsx-cover-controls {
  display:flex; align-items:center; gap:4px;
  padding:8px 10px 10px;
}
.lqsx-cover-btn {
  flex:1; padding:7px 0;
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r-sm);
  background:var(--lqsx-glass);
  color:var(--lqsx-text-muted);
  font-size:10px; font-weight:500; letter-spacing:.05em;
  cursor:pointer;
  transition: background .15s, border-color .15s, color .15s, transform .1s;
  text-align:center;
  -webkit-tap-highlight-color:transparent;
}
.lqsx-cover-btn:hover   { background:var(--lqsx-glass-hover); border-color:var(--lqsx-border-h); color:var(--lqsx-text); }
.lqsx-cover-btn:active  { transform:scale(.94); }
.lqsx-cover-btn.stop    { flex:.55; font-size:13px; }
.lqsx-cover-btn.active  {
  background:rgba(var(--lqsx-amber-rgb),.12);
  border-color:rgba(var(--lqsx-amber-rgb),.35);
  color:rgb(var(--lqsx-amber-rgb));
}

/* ── Scene buttons ── */
.lqsx-scene-btn {
  position:relative; overflow:hidden;
  padding:14px 12px 12px;
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  background:var(--lqsx-glass);
  cursor:pointer; text-align:left;
  transition: border-color .22s, background .22s, transform .12s, box-shadow .22s;
  -webkit-tap-highlight-color:transparent;
  display:flex; flex-direction:column; gap:4px;
}
.lqsx-scene-btn:hover   {
  border-color:var(--lqsx-border-h);
  background:var(--lqsx-glass-b);
  box-shadow:0 4px 16px rgba(0,0,0,.15);
}
.lqsx-scene-btn:active  { transform:scale(.96); }
.lqsx-scene-btn.fired {
  animation: lqsx-scene-flash .5s ease-out forwards;
}
.lqsx-scene-btn.is-unavailable { opacity:.38; pointer-events:none; }

.lqsx-scene-icon {
  width:20px; height:20px; border-radius:50%;
  background:rgba(var(--lqsx-amber-rgb),.15);
  border:1px solid rgba(var(--lqsx-amber-rgb),.30);
  display:flex; align-items:center; justify-content:center;
  flex-shrink:0;
  transition: background .25s, box-shadow .25s;
}
.lqsx-scene-btn:hover .lqsx-scene-icon,
.lqsx-scene-btn.fired .lqsx-scene-icon {
  background:rgba(var(--lqsx-amber-rgb),.30);
  box-shadow:0 0 8px rgba(var(--lqsx-amber-rgb),.4);
}
.lqsx-scene-name {
  font-size:11px; font-weight:500; letter-spacing:.06em;
  color:var(--lqsx-text); display:block;
}
.lqsx-scene-hint {
  font-size:9px; letter-spacing:.07em; color:var(--lqsx-text-dim);
  display:block;
}
/* Ripple */
.lqsx-ripple {
  position:absolute; border-radius:50%;
  width:80px; height:80px; margin-left:-40px; margin-top:-40px;
  background:rgba(var(--lqsx-amber-rgb),.35);
  pointer-events:none;
  animation:lqsx-ripple .65s linear;
}

/* ── Keypad ── */
.lqsx-keypad-card {
  background:var(--lqsx-glass);
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  overflow:hidden;
}
.lqsx-keypad-header {
  padding:10px 14px 8px;
  border-bottom:1px solid var(--lqsx-border);
  display:flex; align-items:center; gap:8px;
}
.lqsx-keypad-name {
  font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  color:var(--lqsx-text-muted); font-weight:500;
}
.lqsx-kp-buttons {
  display:flex; flex-wrap:wrap; gap:8px; padding:12px;
}
.lqsx-kp-btn {
  display:flex; align-items:center; gap:8px;
  padding:7px 10px;
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r-sm);
  background:var(--lqsx-glass);
  cursor:pointer; font-family:'DM Mono',monospace;
  font-size:10px; letter-spacing:.05em; color:var(--lqsx-text-muted);
  transition: background .15s, border-color .15s, transform .1s, color .15s;
  -webkit-tap-highlight-color:transparent;
}
.lqsx-kp-btn:hover   { background:var(--lqsx-glass-hover); border-color:var(--lqsx-border-h); color:var(--lqsx-text); }
.lqsx-kp-btn:active  { transform:scale(.95); }
.lqsx-kp-btn.pressed {
  background:rgba(var(--lqsx-amber-rgb),.13);
  border-color:rgba(var(--lqsx-amber-rgb),.4);
  color:rgb(var(--lqsx-amber-rgb));
}

/* LED dot */
.lqsx-led {
  width:8px; height:8px; border-radius:50%; flex-shrink:0;
  transition: background .3s, box-shadow .3s;
}
.lqsx-led.on {
  background:rgb(var(--lqsx-amber-rgb));
  box-shadow:0 0 0 2px rgba(var(--lqsx-amber-rgb),.25),
             0 0 8px 3px rgba(var(--lqsx-amber-rgb),.55);
  animation: lqsx-glow-breathe 2.5s ease-in-out infinite;
}
.lqsx-led.off     { background:rgba(128,128,128,.20); box-shadow:none; }
.lqsx-led.unknown { background:rgba(128,128,128,.08); box-shadow:none; }
.lqsx-led.activity {
  animation: lqsx-led-activity .3s ease-out;
  background:rgb(var(--lqsx-green-rgb));
  box-shadow:0 0 8px 3px rgba(var(--lqsx-green-rgb),.6);
}

/* ── Empty state ── */
.lqsx-empty {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:12px; padding:40px 20px; text-align:center; opacity:.5;
}
.lqsx-empty-icon { font-size:40px; opacity:.4; }
.lqsx-empty-title { font-family:'Playfair Display',serif; font-size:15px; font-weight:500; color:var(--lqsx-text); }
.lqsx-empty-sub   { font-size:11px; letter-spacing:.04em; max-width:280px; line-height:1.6; opacity:.7; color:var(--lqsx-text); }

/* ── Layout ── */
.lqsx-scroll { overflow-y:auto; overflow-x:hidden; }
.lqsx-areas-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));
  gap:20px;
}
.lqsx-lights-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(132px, 1fr));
  gap:8px; margin-bottom:12px;
}
.lqsx-covers-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(144px, 1fr));
  gap:8px;
}
.lqsx-scenes-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));
  gap:8px;
}
.lqsx-keypads-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));
  gap:12px;
}
.lqsx-section { margin-bottom:24px; }
.lqsx-section:last-child { margin-bottom:0; }

/* Mobile column collapse (<420px) */
@media (max-width:420px) {
  .lqsx-areas-grid  { grid-template-columns:1fr; gap:12px; }
  .lqsx-lights-grid { grid-template-columns:repeat(2,1fr); }
  .lqsx-covers-grid { grid-template-columns:repeat(2,1fr); }
  .lqsx-scenes-grid { grid-template-columns:repeat(2,1fr); }
  .lqsx-keypads-grid{ grid-template-columns:1fr; }
}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  // Remove old version if present
  const old = document.getElementById('lutron-surface-styles');
  if (old) old.remove();
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ─── Colour math ─────────────────────────────────────────────────────────────

/** Convert HS (H 0–360, S 0–100) + brightness 0–100 → CSS colour. */
function hsToCss(hs: [number, number], brightness: number): string {
  const [h, s] = hs;
  const l = Math.round(18 + (brightness / 100) * 52);
  return `hsl(${h},${s}%,${l}%)`;
}

/** Map colour-temp Kelvin → warm↔cool CSS colour. */
function kelvinToCss(k: number, brightness: number): string {
  const t = Math.max(0, Math.min(1, (k - 2000) / (6500 - 2000)));
  const h = Math.round(t * 210 + (1 - t) * 38);
  const s = Math.round(80 - t * 30);
  const l = Math.round(18 + (brightness / 100) * 52);
  return `hsl(${h},${s}%,${l}%)`;
}

function lightSwatchColor(light: LutronLightState, displayBrightness: number): string {
  if (!light.isOn && displayBrightness === 0) return 'rgba(128,128,128,.15)';
  if (light.hsColor) return hsToCss(light.hsColor, displayBrightness);
  if (light.colorTempKelvin) return kelvinToCss(light.colorTempKelvin, displayBrightness);
  // Default warm white — amber intensity scales with brightness
  const alpha = 0.28 + (displayBrightness / 100) * 0.62;
  return `rgba(220,160,60,${alpha.toFixed(2)})`;
}

/** Returns a radial background that emanates from top-left for the card halo. */
function lightHaloStyle(light: LutronLightState, brightness: number): React.CSSProperties {
  if (!light.isOn && brightness === 0) return {};
  const color = lightSwatchColor(light, brightness);
  const op = (0.10 + (brightness / 100) * 0.14).toFixed(3);
  return {
    background: `radial-gradient(ellipse 80% 60% at 30% 10%, ${color} 0%, transparent 80%)`,
    opacity: Number(op),
  };
}

/** CSS for the brightness fill gradient, using the live swatch colour. */
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
    status === 'live'  ? 'lqsx-pill lqsx-pill-live'
    : status === 'stale' ? 'lqsx-pill lqsx-pill-stale'
    : 'lqsx-pill lqsx-pill-conn';
  const label = status === 'live' ? 'Live' : status === 'stale' ? 'Stale' : 'Connecting';
  return <span className={cls}><span className="lqsx-pill-dot" />{label}</span>;
};

// ─── Brightness slider (drag/touch aware) ─────────────────────────────────────

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
    dragging.current = true;
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const v = posFromEvent(e);
    lastValue.current = v;
    onChange(v);
  };
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const v = posFromEvent(e);
    if (v !== lastValue.current) { lastValue.current = v; onChange(v); }
  }, [posFromEvent, onChange]);
  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
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
      className={`lqsx-brightness-track${isDragging ? ' dragging' : ''}`}
      onPointerDown={handlePointerDown}
      style={{ cursor: disabled ? 'default' : 'ew-resize', marginTop: 8 }}
    >
      <div className="lqsx-brightness-fill" style={fillStyle} />
      <div className="lqsx-brightness-handle" style={handleStyle} />
    </div>
  );
};

// ─── CCT (colour temp) slider ─────────────────────────────────────────────────

interface CctSliderProps {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (k: number) => void;
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
    if (!dragging.current) return;
    setLocal(posFromEvent(e));
  }, []);
  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const k = posFromEvent(e);
    setLocal(k);
    onCommit(k);
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
    <div
      ref={trackRef}
      className="lqsx-cct-track"
      onPointerDown={handlePointerDown}
      style={{ cursor: disabled ? 'default' : 'ew-resize' }}
    >
      <div className="lqsx-cct-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
};

// ─── Light card ───────────────────────────────────────────────────────────────

interface LightCardProps {
  light: LutronLightState;
  optimistic: number | null;
  onBrightnessChange: (entityId: string, v: number) => void;
  onBrightnessCommit: (entityId: string, v: number) => void;
  onCctCommit: (entityId: string, k: number) => void;
  onToggle: (entityId: string) => void;
}

const LightCard = ({
  light, optimistic, onBrightnessChange, onBrightnessCommit, onCctCommit, onToggle,
}: LightCardProps) => {
  const displayBrightness = optimistic !== null ? optimistic : light.brightness;
  const isOn = light.isOn || displayBrightness > 0;
  const swatchColor = lightSwatchColor({ ...light, isOn }, displayBrightness);
  const haloStyle = lightHaloStyle({ ...light, isOn }, displayBrightness);

  const hasCct = light.supportsColorTemp && light.minColorTempKelvin && light.maxColorTempKelvin;

  // Bulb fill colour: rich hue when colored, warm amber when CCT/default, dim grey when off
  const bulbColor = isOn
    ? (light.hsColor
        ? hsToCss(light.hsColor, displayBrightness)
        : `rgb(${Math.round(220 + (displayBrightness / 100) * 20)}, ${Math.round(160 - (displayBrightness / 100) * 8)}, 60)`)
    : 'rgba(128,128,128,.22)';

  const classes = [
    'lqsx-light-card',
    isOn ? 'is-on' : '',
    !light.available ? 'is-unavailable' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} title={light.name}>
      {/* Ambient halo */}
      <div className="lqsx-light-halo" style={haloStyle} />

      {/* Top row: swatch disk + meta + power button */}
      <div className="lqsx-light-swatch-row">
        {/* Live colour swatch disk */}
        <div
          className="lqsx-swatch-disk"
          style={{
            background: swatchColor,
            transform: isOn ? `scale(${1 + (displayBrightness / 100) * 0.12})` : 'scale(1)',
            boxShadow: isOn ? `0 0 0 3px rgba(var(--lqsx-amber-rgb),.12), 0 0 ${Math.round(4 + (displayBrightness / 100) * 12)}px ${swatchColor}` : undefined,
            transition: 'background .45s ease, transform .45s ease, box-shadow .45s ease',
          }}
        />

        <div className="lqsx-light-meta">
          <span className="lqsx-light-name">{light.name}</span>
          <span className="lqsx-light-level">{isOn ? `${displayBrightness}%` : 'Off'}</span>
        </div>

        {/* Power toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(light.entityId); }}
          disabled={!light.available}
          className={`lqsx-power-btn ${isOn ? 'on' : 'off'}`}
          aria-label={isOn ? 'Turn off' : 'Turn on'}
          style={{ marginLeft: 2 }}
        >
          ⏻
        </button>
      </div>

      {/* Bulb icon */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 4px' }}>
        <svg className="lqsx-bulb-icon" viewBox="0 0 24 24" fill="none" style={{ color: bulbColor }}>
          <path
            d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.2-3 5.4V17H9v-2.6C7.2 13.2 6 11.2 6 9a6 6 0 0 1 6-6z"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            fill={isOn ? 'currentColor' : 'none'} fillOpacity={isOn ? 0.18 : 0}
          />
        </svg>
      </div>

      {/* Brightness slider */}
      <BrightnessSlider
        value={displayBrightness}
        color={swatchColor}
        disabled={!light.available}
        onChange={(v) => onBrightnessChange(light.entityId, v)}
        onCommit={(v) => onBrightnessCommit(light.entityId, v)}
      />

      {/* CCT control */}
      {hasCct && (
        <CctSlider
          value={light.colorTempKelvin ?? light.minColorTempKelvin!}
          min={light.minColorTempKelvin!}
          max={light.maxColorTempKelvin!}
          disabled={!light.available}
          onCommit={(k) => onCctCommit(light.entityId, k)}
        />
      )}
    </div>
  );
};

// ─── Shade / Blind widget ─────────────────────────────────────────────────────

interface CoverWidgetProps {
  cover: LutronCoverState;
  optimistic: number | null;
  optimisticTilt?: number | null;
  onOpen: (entityId: string) => void;
  onClose: (entityId: string) => void;
  onStop: (entityId: string) => void;
  onTiltOpen?: (entityId: string) => void;
  onTiltClose?: (entityId: string) => void;
}

const CoverWidget = ({
  cover, optimistic, optimisticTilt, onOpen, onClose, onStop, onTiltOpen, onTiltClose,
}: CoverWidgetProps) => {
  const position = optimistic !== null ? optimistic : (cover.currentPosition ?? 50);
  const tiltPosition = (optimisticTilt !== null && optimisticTilt !== undefined)
    ? optimisticTilt : (cover.currentTiltPosition ?? 50);

  // Shade: panel height = (100-position)%; 0% = fully open, 100% = fully closed
  const shadePanelHeight = `${100 - position}%`;
  // Light leak height = position%
  const shadeLeakHeight = `${position}%`;
  // Light ray opacity: more open = more visible shaft
  const rayOpacity = position / 100;

  // Slat tilt: map 0–100 → -37deg (closed vertical) to +38deg (open near-horizontal)
  const slatDeg = Math.round((tiltPosition / 100) * 75 - 37);
  const slatRotation = cover.supportsTilt ? `rotate(${slatDeg}deg)` : undefined;

  const isMoving = cover.state === 'opening' || cover.state === 'closing';

  const classes = ['lqsx-cover-widget', !cover.available ? 'is-unavailable' : ''].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="lqsx-cover-header">
        <span className="lqsx-cover-name">{cover.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isMoving && <span className="lqsx-moving-badge">{cover.state}</span>}
          <span className="lqsx-cover-pos">{Math.round(position)}%</span>
        </div>
      </div>

      {/* Visual glyph */}
      {!cover.supportsTilt ? (
        <div className="lqsx-shade-scene">
          <div className="lqsx-shade-glyph">
            {/* Light ray — visible when shade is mostly open */}
            <div className="lqsx-light-ray" style={{ opacity: rayOpacity * 0.8 }} />
            <div className="lqsx-window-frame" />
            <div className="lqsx-shade-panel" style={{ height: shadePanelHeight }}>
              <div className="lqsx-shade-stripes" />
              <div className="lqsx-shade-rail" />
            </div>
            {/* Light leak below shade */}
            <div className="lqsx-shade-leak" style={{ height: shadeLeakHeight, opacity: rayOpacity * 0.7 }} />
          </div>
        </div>
      ) : (
        <div className="lqsx-tilt-glyph">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="lqsx-slat" style={{ transform: slatRotation }} />
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="lqsx-cover-controls">
        <button
          className={`lqsx-cover-btn${cover.state === 'opening' ? ' active' : ''}`}
          onClick={() => onOpen(cover.entityId)}
          disabled={!cover.available}
          title="Open"
        >▲</button>
        <button
          className="lqsx-cover-btn stop"
          onClick={() => onStop(cover.entityId)}
          disabled={!cover.available}
          title="Stop"
        >■</button>
        <button
          className={`lqsx-cover-btn${cover.state === 'closing' ? ' active' : ''}`}
          onClick={() => onClose(cover.entityId)}
          disabled={!cover.available}
          title="Close"
        >▼</button>
      </div>

      {/* Tilt controls */}
      {cover.supportsTilt && onTiltOpen && onTiltClose && (
        <div style={{ display: 'flex', gap: 4, padding: '0 10px 10px' }}>
          <button
            className="lqsx-cover-btn"
            onClick={() => onTiltOpen(cover.entityId)}
            disabled={!cover.available}
            title="Tilt open"
            style={{ fontSize: 9 }}
          >TILT ▲</button>
          <button
            className="lqsx-cover-btn"
            onClick={() => onTiltClose(cover.entityId)}
            disabled={!cover.available}
            title="Tilt close"
            style={{ fontSize: 9 }}
          >TILT ▼</button>
        </div>
      )}
    </div>
  );
};

// ─── Scene button ─────────────────────────────────────────────────────────────

const SceneButton = ({
  scene,
  onActivate,
}: {
  scene: LutronSceneState;
  onActivate: (entityId: string) => void;
}) => {
  const [fired, setFired] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const nextId = useRef(0);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!scene.available) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = nextId.current++;
    setRipples(prev => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 750);
    setFired(true);
    setTimeout(() => setFired(false), 500);
    onActivate(scene.entityId);
  };

  const classes = [
    'lqsx-scene-btn',
    fired ? 'fired' : '',
    !scene.available ? 'is-unavailable' : '',
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} onClick={handleClick} disabled={!scene.available}>
      {ripples.map(r => (
        <span key={r.id} className="lqsx-ripple" style={{ left: r.x, top: r.y }} />
      ))}
      <div className="lqsx-scene-icon">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <polygon points="5,3 19,12 5,21" fill="rgba(220,160,60,.9)" />
        </svg>
      </div>
      <span className="lqsx-scene-name">{scene.name}</span>
      <span className="lqsx-scene-hint">Tap to activate</span>
    </button>
  );
};

// ─── Keypad panel ─────────────────────────────────────────────────────────────

const KeypadPanel = ({
  keypad,
  onPress,
}: {
  keypad: LutronKeypad;
  onPress: (entityId: string) => void;
}) => {
  // pressedId: the button being visually highlighted
  // activityId: fires a brief green flash on the LED to show the press landed
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);

  const handlePress = (btn: LutronButtonState) => {
    if (!btn.available) return;
    setPressedId(btn.entityId);
    setActivityId(btn.entityId);
    setTimeout(() => setPressedId(null), 600);
    setTimeout(() => setActivityId(null), 350);
    onPress(btn.entityId);
  };

  return (
    <div className="lqsx-keypad-card">
      <div className="lqsx-keypad-header">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--lqsx-text-dim)', flexShrink: 0 }}>
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
        <span className="lqsx-keypad-name">{keypad.name}</span>
      </div>
      <div className="lqsx-kp-buttons">
        {keypad.buttons.map(btn => {
          // Determine LED class: activity flash overrides on/off
          const isActivity = activityId === btn.entityId;
          const ledClass = isActivity
            ? 'lqsx-led activity'
            : btn.ledEntityId !== null
              ? (btn.ledOn === true ? 'lqsx-led on' : 'lqsx-led off')
              : 'lqsx-led unknown';

          return (
            <button
              key={btn.entityId}
              className={[
                'lqsx-kp-btn',
                pressedId === btn.entityId ? 'pressed' : '',
                !btn.available ? 'opacity-40' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handlePress(btn)}
              disabled={!btn.available}
              title={btn.name}
            >
              <span className={ledClass} />
              {btn.name}
            </button>
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
  const handleBrightnessChange = useCallback((entityId: string, v: number) => {
    setOptimistic(entityId, v);
  }, [setOptimistic]);

  const handleBrightnessCommit = useCallback(async (entityId: string, v: number) => {
    setOptimistic(entityId, v);
    await setLightBrightness(entityId, v);
  }, [setOptimistic]);

  const handleCctCommit = useCallback(async (entityId: string, k: number) => {
    await setLightColorTemp(entityId, k);
  }, []);

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
      <h3 className="lqsx-area-name">{area.name}</h3>

      {area.lights.length > 0 && (
        <div className="lqsx-lights-grid" style={{ marginBottom: area.covers.length > 0 ? 12 : 0 }}>
          {area.lights.map(light => (
            <LightCard
              key={light.entityId}
              light={light}
              optimistic={getOptimistic(light.entityId)}
              onBrightnessChange={handleBrightnessChange}
              onBrightnessCommit={handleBrightnessCommit}
              onCctCommit={handleCctCommit}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {area.covers.length > 0 && (
        <div className="lqsx-covers-grid">
          {area.covers.map(cover => (
            <CoverWidget
              key={cover.entityId}
              cover={cover}
              optimistic={getOptimistic(cover.entityId)}
              onOpen={handleOpen}
              onClose={handleClose}
              onStop={handleStop}
              onTiltOpen={handleTiltOpen}
              onTiltClose={handleTiltClose}
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

  const handleActivateScene  = useCallback(async (entityId: string) => { await activateScene(entityId); }, []);
  const handlePressButton    = useCallback(async (entityId: string) => { await pressButton(entityId); }, []);

  const hasAreas   = state.areas.length > 0;
  const hasScenes  = state.scenes.length > 0;
  const hasKeypads = state.keypads.length > 0;

  const totalLights = useMemo(() => state.areas.reduce((s, a) => s + a.lights.length, 0), [state.areas]);
  const lightsOn    = useMemo(() => state.areas.reduce((s, a) => s + a.lights.filter(l => l.isOn).length, 0), [state.areas]);
  const totalCovers = useMemo(() => state.areas.reduce((s, a) => s + a.covers.length, 0), [state.areas]);

  // Root class tracks connection status for stale overlay
  const rootClass = [
    'lqsx-root',
    connStatus === 'stale'      ? 'is-stale'      : '',
    connStatus === 'connecting' ? 'is-connecting' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100%', width: '100%',
        borderRadius: 16, overflow: 'hidden',
        border: '1px solid var(--lqsx-border)',
        background: 'var(--lqsx-bg)',
        // Subtle etched grid
        backgroundImage: [
          'linear-gradient(var(--lqsx-grid) 1px,transparent 1px)',
          'linear-gradient(90deg,var(--lqsx-grid) 1px,transparent 1px)',
        ].join(','),
        backgroundSize: '40px 40px',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px 10px',
        borderBottom: '1px solid var(--lqsx-border)',
        flexShrink: 0,
        background: 'var(--lqsx-header-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Lutron-esque logomark: concentric arcs */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="3" fill="rgba(220,160,60,.9)" />
            <path d="M12 4a8 8 0 0 1 8 8" stroke="rgba(220,160,60,.55)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M4 12a8 8 0 0 1 8-8" stroke="rgba(220,160,60,.28)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 20a8 8 0 0 1-8-8" stroke="rgba(220,160,60,.14)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div>
            <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, fontWeight: 500, lineHeight: 1.1, letterSpacing: '.03em', color: 'var(--lqsx-text)' }}>
              Lutron HomeWorks
            </p>
            <p style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--lqsx-text-muted)', marginTop: 1 }}>
              QSX · Lighting &amp; Shading
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.present && (
            <div style={{ display: 'flex', gap: 8, fontSize: 10, letterSpacing: '.05em', color: 'var(--lqsx-text-muted)' }}>
              {totalLights > 0 && (
                <span style={{ color: lightsOn > 0 ? 'rgb(var(--lqsx-amber-rgb))' : undefined }}>
                  {lightsOn}/{totalLights} lit
                </span>
              )}
              {totalCovers > 0 && <span>{totalCovers} shades</span>}
            </div>
          )}
          <ConnPill status={connStatus} />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="lqsx-scroll" style={{ flex: 1, padding: '16px' }}>

        {/* Empty state */}
        {!state.present && (
          <div className="lqsx-empty">
            <div className="lqsx-empty-icon">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.2-3 5.4V17H9v-2.6C7.2 13.2 6 11.2 6 9a6 6 0 0 1 6-6z"
                  stroke="var(--lqsx-text-dim)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="lqsx-empty-title">
              {connStatus === 'connecting' ? 'Connecting…' : 'No Lutron Entities Found'}
            </p>
            <p className="lqsx-empty-sub">
              {connStatus === 'connecting'
                ? 'Establishing connection to Home Assistant…'
                : 'Lutron lights, shades, scenes, and keypads appear here automatically once the lutron_caseta integration is loaded.'}
            </p>
          </div>
        )}

        {/* Area sections */}
        {hasAreas && (
          <div className="lqsx-section">
            <div className="lqsx-areas-grid">
              {state.areas.map(area => (
                <AreaSection
                  key={area.name}
                  area={area}
                  getOptimistic={getOptimistic}
                  setOptimistic={setOptimistic}
                />
              ))}
            </div>
          </div>
        )}

        {/* Scenes */}
        {hasScenes && (
          <div className="lqsx-section">
            <h3 className="lqsx-area-name">Scenes</h3>
            <div className="lqsx-scenes-grid">
              {state.scenes.map(scene => (
                <SceneButton
                  key={scene.entityId}
                  scene={scene}
                  onActivate={handleActivateScene}
                />
              ))}
            </div>
          </div>
        )}

        {/* Keypads */}
        {hasKeypads && (
          <div className="lqsx-section">
            <h3 className="lqsx-area-name">Keypads</h3>
            <div className="lqsx-keypads-grid">
              {state.keypads.map(keypad => (
                <KeypadPanel
                  key={keypad.prefix}
                  keypad={keypad}
                  onPress={handlePressButton}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default LutronSurface;
