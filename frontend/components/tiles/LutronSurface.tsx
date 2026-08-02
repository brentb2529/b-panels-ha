
// Lutron HomeWorks QSX — The Obsidian Controller
//
// Aesthetic: precision instrument / architectural lighting console.
// Dark glass, amber warmth, etched typography, physically-grounded controls.
// Motion reflects real state — lit rooms glow amber, shades physically travel.

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useLutronSurface } from '../../hooks/useLutronSurface';
import type { LutronArea, LutronLightState, LutronCoverState, LutronSceneState, LutronKeypad, LutronButtonState } from '../../services/lutron';
import {
  setLightBrightness, setLightColorTemp, setLightHsColor, toggleLight,
  openCover, closeCover, stopCover, setCoverPosition,
  openCoverTilt, closeCoverTilt, setCoverTiltPosition,
  activateScene, pressButton,
} from '../../services/lutron';
import type { TileProps } from '../tileRegistry';

// ─── CSS injection ───────────────────────────────────────────────────────────
const STYLE_ID = 'lutron-surface-styles';
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Playfair+Display:wght@400;500;600&display=swap');

.lqsx-root {
  font-family: 'DM Mono', monospace;
  --lqsx-amber:   220, 160, 60;
  --lqsx-ember:   240, 100, 40;
  --lqsx-cool:    160, 210, 255;
  --lqsx-glass:   rgba(255,255,255,0.04);
  --lqsx-glass-b: rgba(255,255,255,0.08);
  --lqsx-border:  rgba(255,255,255,0.08);
  --lqsx-border-h:rgba(255,255,255,0.18);
  --lqsx-engraved:rgba(0,0,0,0.45);
  --lqsx-r: 12px;
  --lqsx-r-sm: 6px;
  background: rgb(var(--surface, 18 18 18));
  color: rgba(255,255,255,0.88);
  min-height: 100%;
}

/* ── Connection pill ── */
.lqsx-pill {
  display:inline-flex; align-items:center; gap:5px;
  padding:3px 10px 3px 7px; border-radius:99px;
  font-size:10px; font-weight:500; letter-spacing:.08em; text-transform:uppercase;
  border:1px solid; backdrop-filter:blur(8px);
}
.lqsx-pill-live   { color:rgb(100,220,140); border-color:rgba(100,220,140,.3); background:rgba(100,220,140,.08); }
.lqsx-pill-stale  { color:rgb(var(--lqsx-amber)); border-color:rgba(var(--lqsx-amber),.3); background:rgba(var(--lqsx-amber),.08); }
.lqsx-pill-conn   { color:rgba(255,255,255,.45); border-color:rgba(255,255,255,.12); background:rgba(255,255,255,.04); }
.lqsx-pill-dot {
  width:6px; height:6px; border-radius:50%; flex-shrink:0;
}
.lqsx-pill-live .lqsx-pill-dot   { background:rgb(100,220,140); box-shadow:0 0 6px rgb(100,220,140); }
.lqsx-pill-stale .lqsx-pill-dot  { background:rgb(var(--lqsx-amber)); animation:lqsx-pulse 1.4s ease-in-out infinite; }
.lqsx-pill-conn .lqsx-pill-dot   { background:rgba(255,255,255,.3); animation:lqsx-pulse 1.6s ease-in-out infinite; }

@keyframes lqsx-pulse {
  0%,100% { opacity:1; } 50% { opacity:.3; }
}
@keyframes lqsx-glow-breathe {
  0%,100% { opacity:.7; transform:scale(1); }
  50%      { opacity:1;  transform:scale(1.15); }
}
@keyframes lqsx-ripple {
  0%   { transform:scale(0); opacity:.5; }
  100% { transform:scale(3); opacity:0; }
}
@keyframes lqsx-scene-flash {
  0%   { background:rgba(var(--lqsx-amber),.35); }
  100% { background:transparent; }
}

/* ── Section titles ── */
.lqsx-area-name {
  font-family:'Playfair Display', serif;
  font-size:13px; font-weight:500; letter-spacing:.04em;
  color:rgba(255,255,255,.55); text-transform:uppercase;
  margin:0 0 12px;
  display:flex; align-items:center; gap:8px;
}
.lqsx-area-name::after {
  content:''; flex:1; height:1px;
  background:linear-gradient(90deg, rgba(255,255,255,.1) 0%, transparent 100%);
}

/* ── Light card ── */
.lqsx-light-card {
  position:relative; overflow:hidden;
  background:var(--lqsx-glass);
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  padding:12px;
  cursor:pointer;
  transition: border-color .2s, background .3s, box-shadow .3s;
}
.lqsx-light-card:hover { border-color:var(--lqsx-border-h); }
.lqsx-light-card.is-on {
  background:var(--lqsx-glass-b);
}
/* Warm glow overlay when light is on — reflects the actual color temp */
.lqsx-light-glow {
  position:absolute; inset:0; pointer-events:none;
  border-radius:inherit;
  opacity:0; transition: opacity .5s ease;
}
.lqsx-light-card.is-on .lqsx-light-glow { opacity:1; }

/* Color swatch strip at top of card */
.lqsx-light-swatch {
  position:absolute; top:0; left:0; right:0;
  height:3px; border-radius:var(--lqsx-r) var(--lqsx-r) 0 0;
  transition: background .4s ease;
}

.lqsx-bulb-icon {
  width:28px; height:28px;
  transition: filter .3s, color .3s;
}
.lqsx-light-card.is-on .lqsx-bulb-icon {
  filter: drop-shadow(0 0 8px currentColor);
  animation: lqsx-glow-breathe 3s ease-in-out infinite;
}
.lqsx-light-name {
  font-size:11px; font-weight:500; letter-spacing:.06em;
  margin:6px 0 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.lqsx-light-level {
  font-family:'DM Mono',monospace; font-size:22px; font-weight:300;
  line-height:1; margin-bottom:8px;
  transition: color .3s;
}
.lqsx-light-card.is-on .lqsx-light-level { color:rgb(var(--lqsx-amber)); }

/* Brightness slider */
.lqsx-brightness-track {
  position:relative; height:28px;
  border-radius:14px; overflow:hidden;
  background:rgba(255,255,255,.06);
  cursor:pointer; touch-action:none;
}
.lqsx-brightness-fill {
  position:absolute; top:0; left:0; bottom:0;
  border-radius:inherit;
  transition: width .15s ease;
  pointer-events:none;
}
.lqsx-brightness-handle {
  position:absolute; top:50%; transform:translate(-50%,-50%);
  width:18px; height:18px; border-radius:50%;
  background:white; box-shadow:0 0 0 2px rgba(0,0,0,.4), 0 2px 8px rgba(0,0,0,.6);
  pointer-events:none;
  transition: left .15s ease;
}

/* CCT strip */
.lqsx-cct-track {
  position:relative; height:8px;
  border-radius:4px; margin-top:6px;
  background:linear-gradient(90deg, #f59e0b 0%, #fffbeb 40%, #bfdbfe 100%);
  cursor:pointer; touch-action:none;
}
.lqsx-cct-thumb {
  position:absolute; top:50%; width:14px; height:14px;
  border-radius:50%; background:white;
  transform:translate(-50%,-50%);
  box-shadow:0 0 0 2px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.5);
  pointer-events:none;
  transition: left .1s ease;
}

/* ── Shade/Blind widget ── */
.lqsx-cover-widget {
  background:var(--lqsx-glass);
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  overflow:hidden;
}
.lqsx-cover-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 12px 8px;
  border-bottom:1px solid var(--lqsx-border);
}
.lqsx-cover-name { font-size:11px; font-weight:500; letter-spacing:.06em; }
.lqsx-cover-pos  { font-family:'DM Mono',monospace; font-size:18px; font-weight:300; color:rgba(255,255,255,.6); }

/* Animated shade glyph */
.lqsx-shade-glyph {
  position:relative; margin:12px auto;
  width:52px; height:72px;
}
.lqsx-window-frame {
  position:absolute; inset:0;
  border:1.5px solid rgba(255,255,255,.2);
  border-radius:3px;
  background:linear-gradient(180deg, rgba(160,210,255,.08) 0%, rgba(160,210,255,.04) 100%);
}
.lqsx-shade-panel {
  position:absolute; top:0; left:0; right:0;
  background:rgba(255,255,255,.18);
  border-radius:2px;
  /* height driven by inline style = (100-position)% */
  transition: height .6s cubic-bezier(.4,0,.2,1);
  overflow:hidden;
}
.lqsx-shade-stripes {
  position:absolute; inset:0;
  background:repeating-linear-gradient(0deg, transparent, transparent 5px, rgba(0,0,0,.12) 6px);
}
.lqsx-shade-rail {
  position:absolute; bottom:0; left:0; right:0; height:3px;
  background:rgba(255,255,255,.4); border-radius:0 0 2px 2px;
}

/* Tilt visualizer (for blinds) */
.lqsx-tilt-glyph {
  display:flex; flex-direction:column; gap:3px;
  padding:8px 10px; align-items:stretch;
}
.lqsx-slat {
  height:4px; background:rgba(255,255,255,.3);
  border-radius:2px;
  transform-origin:center;
  transition:transform .4s ease;
}

/* Cover control bar */
.lqsx-cover-controls {
  display:flex; align-items:center; gap:4px;
  padding:8px 10px 10px;
}
.lqsx-cover-btn {
  flex:1; padding:6px 0;
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r-sm);
  background:rgba(255,255,255,.04);
  color:rgba(255,255,255,.7);
  font-size:10px; font-weight:500; letter-spacing:.05em;
  cursor:pointer; transition: background .15s, border-color .15s, transform .1s;
  text-align:center;
}
.lqsx-cover-btn:hover   { background:rgba(255,255,255,.1); border-color:var(--lqsx-border-h); }
.lqsx-cover-btn:active  { transform:scale(.96); }
.lqsx-cover-btn.stop    { flex:.6; font-size:14px; }

/* ── Scene buttons ── */
.lqsx-scene-btn {
  position:relative; overflow:hidden;
  padding:10px 12px;
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r);
  background:var(--lqsx-glass);
  cursor:pointer; text-align:left;
  transition: border-color .2s, background .2s, transform .1s, box-shadow .2s;
  -webkit-tap-highlight-color:transparent;
}
.lqsx-scene-btn:hover   { border-color:var(--lqsx-border-h); background:var(--lqsx-glass-b); }
.lqsx-scene-btn:active  { transform:scale(.97); }
.lqsx-scene-btn.fired {
  animation: lqsx-scene-flash .4s ease-out;
}
.lqsx-scene-name {
  font-size:11px; font-weight:500; letter-spacing:.06em;
  color:rgba(255,255,255,.8); display:block;
}
.lqsx-scene-hint {
  font-size:9px; letter-spacing:.07em; color:rgba(255,255,255,.35);
  margin-top:2px; display:block;
}
/* Ripple */
.lqsx-ripple {
  position:absolute; border-radius:50%;
  width:80px; height:80px; margin-left:-40px; margin-top:-40px;
  background:rgba(var(--lqsx-amber),.4);
  pointer-events:none;
  animation:lqsx-ripple .6s linear;
}

/* ── Keypad section ── */
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
  color:rgba(255,255,255,.5); font-weight:500;
}
.lqsx-kp-buttons {
  display:flex; flex-wrap:wrap; gap:8px; padding:12px;
}
.lqsx-kp-btn {
  display:flex; align-items:center; gap:8px;
  padding:7px 10px;
  border:1px solid var(--lqsx-border);
  border-radius:var(--lqsx-r-sm);
  background:rgba(255,255,255,.03);
  cursor:pointer; font-family:'DM Mono',monospace;
  font-size:10px; letter-spacing:.05em; color:rgba(255,255,255,.7);
  transition: background .15s, border-color .15s, transform .1s;
  -webkit-tap-highlight-color:transparent;
}
.lqsx-kp-btn:hover   { background:rgba(255,255,255,.07); border-color:var(--lqsx-border-h); }
.lqsx-kp-btn:active  { transform:scale(.96); }
.lqsx-kp-btn.pressed { background:rgba(var(--lqsx-amber),.15); border-color:rgba(var(--lqsx-amber),.4); }

/* LED dot */
.lqsx-led {
  width:8px; height:8px; border-radius:50%; flex-shrink:0;
  transition: background .3s, box-shadow .3s;
}
.lqsx-led.on  {
  background:rgb(var(--lqsx-amber));
  box-shadow:0 0 6px 2px rgba(var(--lqsx-amber),.7);
  animation: lqsx-glow-breathe 2.5s ease-in-out infinite;
}
.lqsx-led.off { background:rgba(255,255,255,.15); box-shadow:none; }
.lqsx-led.unknown { background:rgba(255,255,255,.06); box-shadow:none; }

/* ── Empty state ── */
.lqsx-empty {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:12px; padding:40px 20px; text-align:center; opacity:.5;
}
.lqsx-empty-icon { font-size:40px; opacity:.4; }
.lqsx-empty-title { font-family:'Playfair Display',serif; font-size:15px; font-weight:500; }
.lqsx-empty-sub   { font-size:11px; letter-spacing:.04em; max-width:280px; line-height:1.6; opacity:.7; }

/* ── Layout helpers ── */
.lqsx-scroll { overflow-y:auto; overflow-x:hidden; }
.lqsx-areas-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));
  gap:20px;
}
.lqsx-lights-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));
  gap:8px; margin-bottom:12px;
}
.lqsx-covers-grid {
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));
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
`;

function injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
}

// ─── Colour math ─────────────────────────────────────────────────────────────

/** Convert HS (H in 0-360, S in 0-100) to CSS colour string. */
function hsToCss(hs: [number, number], brightness: number): string {
    const [h, s] = hs;
    return `hsl(${h}, ${s}%, ${Math.round(20 + (brightness / 100) * 55)}%)`;
}

/** Map colour-temp in Kelvin to a warm↔cool CSS colour. */
function kelvinToCss(k: number, brightness: number): string {
    // 2000K → deep amber, 4000K → neutral white, 6500K → icy blue
    const t = Math.max(0, Math.min(1, (k - 2000) / (6500 - 2000)));
    const r = Math.round(255 - t * 95);
    const g = Math.round(220 - t * 20 + t * 10);
    const b = Math.round(140 + t * 115);
    const l = Math.round(10 + (brightness / 100) * 55);
    return `hsl(${Math.round(t * 210 + (1 - t) * 38)}, ${Math.round(80 - t * 30)}%, ${l}%)`;
}

function lightSwatchColor(light: LutronLightState): string {
    if (!light.isOn) return 'rgba(255,255,255,.06)';
    if (light.hsColor) return hsToCss(light.hsColor, light.brightness);
    if (light.colorTempKelvin) return kelvinToCss(light.colorTempKelvin, light.brightness);
    // default warm white when on
    return `rgba(220,160,60,${0.3 + (light.brightness / 100) * 0.6})`;
}

function lightGlowStyle(light: LutronLightState): React.CSSProperties {
    if (!light.isOn) return {};
    const color = lightSwatchColor(light);
    return { background: `radial-gradient(ellipse at 50% 0%, ${color} 0%, transparent 70%)`, opacity: 0.18 + (light.brightness / 100) * 0.15 };
}

// ─── Connection pill ──────────────────────────────────────────────────────────

const ConnPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
    const cls = status === 'live' ? 'lqsx-pill lqsx-pill-live'
        : status === 'stale' ? 'lqsx-pill lqsx-pill-stale'
        : 'lqsx-pill lqsx-pill-conn';
    const label = status === 'live' ? 'Live' : status === 'stale' ? 'Stale' : 'Connecting';
    return <span className={cls}><span className="lqsx-pill-dot" />{label}</span>;
};

// ─── Brightness slider (drag/touch aware) ─────────────────────────────────────

interface BrightnessSliderProps {
    value: number;          // 0-100
    color: string;          // CSS color for the fill
    disabled?: boolean;
    onChange: (v: number) => void;
    onCommit: (v: number) => void;
}

const BrightnessSlider = ({ value, color, disabled, onChange, onCommit }: BrightnessSliderProps) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
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

    const fillStyle: React.CSSProperties = {
        width: `${value}%`,
        background: `linear-gradient(90deg, ${color}55 0%, ${color} 100%)`,
    };
    const handleStyle: React.CSSProperties = { left: `${value}%` };

    return (
        <div
            ref={trackRef}
            className="lqsx-brightness-track"
            onPointerDown={handlePointerDown}
            style={{ cursor: disabled ? 'default' : 'ew-resize' }}
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

const LightCard = ({ light, optimistic, onBrightnessChange, onBrightnessCommit, onCctCommit, onToggle }: LightCardProps) => {
    const displayBrightness = optimistic !== null ? optimistic : light.brightness;
    const swatchColor = lightSwatchColor({ ...light, brightness: displayBrightness });
    const glowStyle = lightGlowStyle({ ...light, brightness: displayBrightness });
    const isOn = light.isOn || displayBrightness > 0;

    const hasCct = light.supportsColorTemp && light.minColorTempKelvin && light.maxColorTempKelvin;

    const bulbColor = isOn
        ? (light.hsColor ? hsToCss(light.hsColor, displayBrightness) : `rgb(${220 + displayBrightness / 100 * 20}, ${160 - displayBrightness / 100 * 10}, 60)`)
        : 'rgba(255,255,255,.25)';

    return (
        <div
            className={`lqsx-light-card${isOn ? ' is-on' : ''}${!light.available ? ' opacity-40' : ''}`}
            title={light.name}
        >
            {/* Warm glow overlay */}
            <div className="lqsx-light-glow" style={glowStyle} />
            {/* Swatch strip */}
            <div className="lqsx-light-swatch" style={{ background: swatchColor }} />

            {/* Top row: bulb + name + toggle */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    {/* Bulb SVG */}
                    <svg className="lqsx-bulb-icon" viewBox="0 0 24 24" fill="none" style={{ color: bulbColor }}>
                        <path d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.2-3 5.4V17H9v-2.6C7.2 13.2 6 11.2 6 9a6 6 0 0 1 6-6z"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill={isOn ? 'currentColor' : 'none'} fillOpacity={isOn ? .18 : 0} />
                    </svg>
                    <p className="lqsx-light-name">{light.name}</p>
                </div>
                {/* Power toggle */}
                <button
                    onClick={(e) => { e.stopPropagation(); onToggle(light.entityId); }}
                    disabled={!light.available}
                    style={{
                        width: 24, height: 24, borderRadius: '50%', border: 'none',
                        background: isOn ? `rgba(var(--lqsx-amber), .25)` : 'rgba(255,255,255,.08)',
                        color: isOn ? `rgb(var(--lqsx-amber))` : 'rgba(255,255,255,.4)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'background .2s, color .2s',
                        fontWeight: 700, fontSize: 12,
                    }}
                    aria-label={isOn ? 'Turn off' : 'Turn on'}
                >
                    ⏻
                </button>
            </div>

            {/* Level */}
            <div className="lqsx-light-level">{isOn ? `${displayBrightness}%` : 'Off'}</div>

            {/* Brightness slider */}
            <BrightnessSlider
                value={displayBrightness}
                color={swatchColor === 'rgba(255,255,255,.06)' ? 'rgba(255,255,255,.5)' : swatchColor}
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

const CoverWidget = ({ cover, optimistic, optimisticTilt, onOpen, onClose, onStop, onTiltOpen, onTiltClose }: CoverWidgetProps) => {
    const position = optimistic !== null ? optimistic : (cover.currentPosition ?? 50);
    const tiltPosition = optimisticTilt !== null && optimisticTilt !== undefined
        ? optimisticTilt : (cover.currentTiltPosition ?? 50);

    // Shade glyph: shade panel height = (100 - position) % of window
    const shadePanelHeight = `${100 - position}%`;

    // Tilt: slat rotation in degrees, 0 = closed (horizontal), 90 = open
    const slatRotation = cover.supportsTilt
        ? `rotate(${Math.round((tiltPosition / 100) * 75 - 37)}deg)`
        : undefined;

    const isMoving = cover.state === 'opening' || cover.state === 'closing';

    return (
        <div className={`lqsx-cover-widget${!cover.available ? ' opacity-40' : ''}`}>
            <div className="lqsx-cover-header">
                <span className="lqsx-cover-name">{cover.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isMoving && (
                        <span style={{ fontSize: 9, letterSpacing: '.07em', textTransform: 'uppercase', color: 'rgb(var(--lqsx-amber))', animation: 'lqsx-pulse 1s infinite' }}>
                            {cover.state}
                        </span>
                    )}
                    <span className="lqsx-cover-pos">{Math.round(position)}%</span>
                </div>
            </div>

            {/* Visual glyph */}
            {!cover.supportsTilt ? (
                // Shade (positional)
                <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'center' }}>
                    <div className="lqsx-shade-glyph">
                        <div className="lqsx-window-frame" />
                        <div className="lqsx-shade-panel" style={{ height: shadePanelHeight }}>
                            <div className="lqsx-shade-stripes" />
                            <div className="lqsx-shade-rail" />
                        </div>
                    </div>
                </div>
            ) : (
                // Blind (tilt) — slats
                <div className="lqsx-tilt-glyph">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="lqsx-slat" style={{ transform: slatRotation }} />
                    ))}
                </div>
            )}

            {/* Controls */}
            <div className="lqsx-cover-controls">
                <button className="lqsx-cover-btn" onClick={() => onOpen(cover.entityId)} disabled={!cover.available} title="Open">
                    ▲
                </button>
                <button className="lqsx-cover-btn stop" onClick={() => onStop(cover.entityId)} disabled={!cover.available} title="Stop">
                    ■
                </button>
                <button className="lqsx-cover-btn" onClick={() => onClose(cover.entityId)} disabled={!cover.available} title="Close">
                    ▼
                </button>
            </div>

            {/* Tilt controls */}
            {cover.supportsTilt && onTiltOpen && onTiltClose && (
                <div style={{ display: 'flex', gap: 4, padding: '0 10px 10px' }}>
                    <button className="lqsx-cover-btn" onClick={() => onTiltOpen(cover.entityId)} disabled={!cover.available} title="Tilt open" style={{ fontSize: 9 }}>
                        TILT ▲
                    </button>
                    <button className="lqsx-cover-btn" onClick={() => onTiltClose(cover.entityId)} disabled={!cover.available} title="Tilt close" style={{ fontSize: 9 }}>
                        TILT ▼
                    </button>
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
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const id = nextId.current++;
        setRipples(prev => [...prev, { id, x, y }]);
        setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 700);
        setFired(true);
        setTimeout(() => setFired(false), 450);
        onActivate(scene.entityId);
    };

    return (
        <button
            className={`lqsx-scene-btn${fired ? ' fired' : ''}${!scene.available ? ' opacity-40' : ''}`}
            onClick={handleClick}
            disabled={!scene.available}
        >
            {ripples.map(r => (
                <span key={r.id} className="lqsx-ripple" style={{ left: r.x, top: r.y }} />
            ))}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'rgba(220,160,60,.8)', display: 'block', marginBottom: 5 }}>
                <polygon points="5,3 19,12 5,21" fill="currentColor" />
            </svg>
            <span className="lqsx-scene-name">{scene.name}</span>
            <span className="lqsx-scene-hint">Tap to activate</span>
        </button>
    );
};

// ─── Keypad panel ─────────────────────────────────────────────────────────────

const KeypadPanel = ({ keypad, onPress }: { keypad: LutronKeypad; onPress: (entityId: string) => void }) => {
    const [pressedId, setPressedId] = useState<string | null>(null);

    const handlePress = (btn: LutronButtonState) => {
        if (!btn.available) return;
        setPressedId(btn.entityId);
        setTimeout(() => setPressedId(null), 600);
        onPress(btn.entityId);
    };

    return (
        <div className="lqsx-keypad-card">
            <div className="lqsx-keypad-header">
                {/* Keypad icon */}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: 'rgba(255,255,255,.35)', flexShrink: 0 }}>
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
                {keypad.buttons.map(btn => (
                    <button
                        key={btn.entityId}
                        className={`lqsx-kp-btn${pressedId === btn.entityId ? ' pressed' : ''}${!btn.available ? ' opacity-40' : ''}`}
                        onClick={() => handlePress(btn)}
                        disabled={!btn.available}
                        title={btn.name}
                    >
                        {/* LED indicator */}
                        <span className={`lqsx-led ${btn.ledEntityId !== null ? (btn.ledOn === true ? 'on' : 'off') : 'unknown'}`} />
                        {btn.name}
                    </button>
                ))}
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

    const handleOpen = useCallback(async (entityId: string) => { await openCover(entityId); }, []);
    const handleClose = useCallback(async (entityId: string) => { await closeCover(entityId); }, []);
    const handleStop = useCallback(async (entityId: string) => { await stopCover(entityId); }, []);
    const handleTiltOpen = useCallback(async (entityId: string) => { await openCoverTilt(entityId); }, []);
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

    const handleActivateScene = useCallback(async (entityId: string) => {
        await activateScene(entityId);
    }, []);

    const handlePressButton = useCallback(async (entityId: string) => {
        await pressButton(entityId);
    }, []);

    const hasAreas = state.areas.length > 0;
    const hasScenes = state.scenes.length > 0;
    const hasKeypads = state.keypads.length > 0;

    // Header metrics
    const totalLights = useMemo(() => state.areas.reduce((s, a) => s + a.lights.length, 0), [state.areas]);
    const lightsOn    = useMemo(() => state.areas.reduce((s, a) => s + a.lights.filter(l => l.isOn).length, 0), [state.areas]);
    const totalCovers = useMemo(() => state.areas.reduce((s, a) => s + a.covers.length, 0), [state.areas]);

    return (
        <div className="lqsx-root" style={{
            display: 'flex', flexDirection: 'column',
            height: '100%', width: '100%',
            borderRadius: 16, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.08)',
            background: 'rgba(10,10,12,0.97)',
            /* subtle etched grid */
            backgroundImage: 'linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px)',
            backgroundSize: '40px 40px',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px 10px',
                borderBottom: '1px solid rgba(255,255,255,.07)',
                flexShrink: 0,
                background: 'rgba(255,255,255,.02)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Lutron-esque logo mark: concentric arcs */}
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="3" fill="rgba(220,160,60,.9)" />
                        <path d="M12 4a8 8 0 0 1 8 8" stroke="rgba(220,160,60,.5)" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M4 12a8 8 0 0 1 8-8" stroke="rgba(220,160,60,.25)" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M12 20a8 8 0 0 1-8-8" stroke="rgba(220,160,60,.15)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <div>
                        <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, fontWeight: 500, lineHeight: 1.1, letterSpacing: '.03em' }}>
                            Lutron HomeWorks
                        </p>
                        <p style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)', marginTop: 1 }}>
                            QSX · Lighting &amp; Shading
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {state.present && (
                        <div style={{ display: 'flex', gap: 8, fontSize: 10, letterSpacing: '.05em', color: 'rgba(255,255,255,.4)' }}>
                            {totalLights > 0 && (
                                <span style={{ color: lightsOn > 0 ? 'rgb(220,160,60)' : undefined }}>
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
            <div className="lqsx-scroll" style={{ flex: 1, padding: '16px' }}>

                {/* Empty state */}
                {!state.present && (
                    <div className="lqsx-empty">
                        <div className="lqsx-empty-icon">
                            <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                                <path d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.2-1.2 4.2-3 5.4V17H9v-2.6C7.2 13.2 6 11.2 6 9a6 6 0 0 1 6-6z"
                                      stroke="rgba(255,255,255,.3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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

                {/* Area sections (lights + covers) */}
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
