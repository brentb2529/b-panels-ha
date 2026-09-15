/**
 * PoolSurfaceTile — Liquid Glass marquee Pool / Spa dashboard surface.
 *
 * Visual: Liquid Glass / Apple design system. All data bindings, OBJTYPE
 * detection, hook integration, service calls, and control logic are
 * UNCHANGED from the pre-glass version. Only the visual layer is restyled.
 *
 * Surface layout (adaptive by tile size):
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  HEADER — Pool / Spa name badges + freeze alert + stale dot │
 *  ├─────────────────┬───────────────────────────────────────────┤
 *  │  BODY CONTROLS  │  TELEMETRY (pumps + chem + probe temps)   │
 *  │  · body on/off  │  · RPM / W / GPM gauges (glass ArcGauge)  │
 *  │  · heater mode  │  · Salt / pH / ORP (BuildBar + StatCard)  │
 *  │  · target temp  │  · Probe temps (air / solar / …)          │
 *  ├─────────────────┴───────────────────────────────────────────┤
 *  │  CONTROLS — Lights (+ effect picker) · Water features ·     │
 *  │             SWG output % · Pump speed setpoints             │
 *  └─────────────────────────────────────────────────────────────┘
 */

import React, { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { Device, TileConfig } from '../../types';
import {
  usePoolSurface,
  type BodyState,
  type PumpTelemetry,
  type LightState,
  type WaterFeatureState,
  type ChemState,
  type ProbeTempState,
  type SpeedSetpointState,
} from '../../hooks/usePoolSurface';
import TileWrapper from './TileWrapper';
import {
  IconThermometer, IconFlame, IconSnowflake, IconDroplets, IconZap,
  IconWaves, IconPower, IconAlertTriangle, IconCheck, IconX,
  IconActivity, IconLightbulb, IconSun, IconInfo,
} from '../icons';
import { BuildBar } from '../../design-system';
import {
  fluidTextXs, fluidTextSm, fluidTextBase, fluidTextLg, fluidTextXl,
  fluidText2xl, fluidText3xl, fluidGap, fluidPad,
} from './tileScale';

// ── Water accent CSS var ──────────────────────────────────────────────────────
const WATER = 'var(--accent-water)';
const WARN  = 'var(--accent-warn)';
const ALERT = 'var(--accent-alert)';

// ── Pool water animated background (glass-aware) ─────────────────────────────
const PoolBackground = ({ active }: { active: boolean }) => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="poolDepth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c4a6e" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#075985" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0e3c56" stopOpacity="0.70" />
        </linearGradient>
        <radialGradient id="poolGlow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity={active ? '0.22' : '0.08'} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="400" height="200" fill="url(#poolDepth)" />
      <rect width="400" height="200" fill="url(#poolGlow)">
        {active && (
          <animate attributeName="opacity" values="0.55;1;0.55" dur="4s" repeatCount="indefinite" />
        )}
      </rect>
      {/* Lazy caustic ripple lines */}
      <path d="M0 120 Q80 108 160 118 Q240 128 320 116 Q380 108 400 118" fill="none" stroke="#38bdf8" strokeWidth="1.4" opacity="0.14">
        {active && <animate attributeName="d" values="M0 120 Q80 108 160 118 Q240 128 320 116 Q380 108 400 118;M0 124 Q80 114 160 122 Q240 132 320 120 Q380 112 400 122;M0 120 Q80 108 160 118 Q240 128 320 116 Q380 108 400 118" dur="3.5s" repeatCount="indefinite" />}
      </path>
      <path d="M0 140 Q100 128 200 138 Q300 148 400 138" fill="none" stroke="#7dd3fc" strokeWidth="0.9" opacity="0.10">
        {active && <animate attributeName="d" values="M0 140 Q100 128 200 138 Q300 148 400 138;M0 144 Q100 134 200 142 Q300 152 400 142;M0 140 Q100 128 200 138 Q300 148 400 138" dur="4.8s" repeatCount="indefinite" />}
      </path>
      {/* Subtle surface sheen */}
      <rect x="0" y="0" width="400" height="200"
        fill="none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 60%)',
        }}
        opacity={active ? 0.9 : 0.5}
      />
    </svg>
  </div>
);

// ── Glass stat card (replaces old plain-bg StatCard) ─────────────────────────
const StatCard = ({
  label, value, unit, highlight, accent, note,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  highlight?: boolean;
  accent?: 'blue' | 'amber' | 'red' | 'green' | 'gray';
  note?: string;
}) => {
  const accentColorVar: Record<string, string> = {
    blue:  WATER,
    amber: WARN,
    red:   ALERT,
    green: 'var(--accent-plug)',
    gray:  'rgba(var(--text) / 0.4)',
  };
  const chosen = accent ?? (highlight ? 'blue' : 'gray');
  const colorVar = accentColorVar[chosen];

  return (
    <div
      className="flex flex-col items-center justify-center rounded-control flex-1 min-w-0"
      style={{
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: chosen !== 'gray'
          ? `color-mix(in srgb, ${colorVar} 16%, var(--glass-l3-bg))`
          : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: `1px solid ${chosen !== 'gray'
          ? `color-mix(in srgb, ${colorVar} 45%, var(--glass-l3-border))`
          : 'var(--glass-l3-border)'}`,
        boxShadow: chosen !== 'gray'
          ? `var(--rim), inset 0 0 20px -6px color-mix(in srgb, ${colorVar} 30%, transparent), 0 0 14px -4px color-mix(in srgb, ${colorVar} 38%, transparent)`
          : 'var(--rim), var(--elev-1)',
        padding: 'clamp(0.2rem, 2cqmin, 0.5rem) clamp(0.15rem, 1.5cqmin, 0.35rem)',
        transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), box-shadow var(--dur-medium, 260ms) ease`,
      }}
    >
      <span
        className="uppercase font-bold tracking-wider truncate w-full text-center"
        style={{ fontSize: 'clamp(0.42rem, 3.8cqmin, 0.6rem)', color: 'rgba(var(--text) / 0.5)' }}
      >
        {label}
      </span>
      <span
        className="font-bold leading-tight tabular-nums"
        style={{ fontSize: 'clamp(0.7rem, 6.5cqmin, 1.05rem)', color: chosen !== 'gray' ? colorVar : 'rgb(var(--text))' }}
      >
        {value ?? '--'}
        {unit && (
          <span className="font-normal ml-0.5" style={{ fontSize: 'clamp(0.4rem, 3.2cqmin, 0.55rem)', color: 'rgba(var(--text) / 0.5)' }}>
            {unit}
          </span>
        )}
      </span>
      {note && (
        <span className="truncate w-full text-center" style={{ fontSize: 'clamp(0.38rem, 3cqmin, 0.5rem)', color: 'rgba(var(--text) / 0.4)' }}>
          {note}
        </span>
      )}
    </div>
  );
};

// ── Sparkline ─────────────────────────────────────────────────────────────────
const Sparkline = ({ data, color = '#38bdf8', height = 28 }: { data: number[]; color?: string; height?: number }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 80; const h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 'clamp(14px, 6cqmin, 28px)' }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
    </svg>
  );
};

// ── Glass arc gauge (RPM / W / GPM) ──────────────────────────────────────────
const ArcGauge = ({
  value, max, label, unit, color = '#38bdf8',
}: {
  value: number | null;
  max: number;
  label: string;
  unit: string;
  color?: string;
}) => {
  const pct = value !== null ? Math.min(1, value / max) : 0;
  const r = 28; const cx = 36; const cy = 36;
  const circ = 2 * Math.PI * r;
  const arcLen = pct * circ * 0.75;
  const dashArray = `${arcLen.toFixed(1)} ${circ.toFixed(1)}`;
  const startAngle = 135;

  return (
    <div
      className="flex flex-col items-center"
      style={{
        minWidth: 0,
        flex: '0 0 auto',
        borderRadius: 'var(--radius-control)',
        padding: 'clamp(0.2rem, 1.8cqmin, 0.4rem)',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: `color-mix(in srgb, ${color} 12%, var(--glass-l3-bg))`,
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: `1px solid color-mix(in srgb, ${color} 30%, var(--glass-l3-border))`,
        boxShadow: `var(--rim), inset 0 0 14px -4px color-mix(in srgb, ${color} 22%, transparent), 0 0 10px -3px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <svg viewBox="0 0 72 72" style={{ width: 'clamp(40px, 16cqmin, 72px)', height: 'clamp(40px, 16cqmin, 72px)' }}>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5"
          strokeDasharray={`${(circ * 0.75).toFixed(1)} ${circ.toFixed(1)}`}
          strokeDashoffset={-(circ * 0.125).toFixed(1) as any}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
        />
        {/* Active arc */}
        {value !== null && (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={dashArray}
            strokeDashoffset="0"
            strokeLinecap="round"
            style={{
              transform: `rotate(${startAngle - 90}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              filter: `drop-shadow(0 0 5px ${color})`,
              transition: 'stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1)',
            }}
          />
        )}
        {/* Value */}
        <text x={cx} y={cy + 5} textAnchor="middle" fill="rgb(var(--text))"
          style={{ fontSize: 'clamp(8px, 3.5cqmin, 14px)', fontWeight: 700, fontFamily: 'var(--font-numeric)' }}>
          {value !== null ? (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))) : '--'}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" fill="rgba(var(--text) / 0.45)"
          style={{ fontSize: 'clamp(5px, 2.2cqmin, 9px)', fontWeight: 600 }}>
          {unit}
        </text>
      </svg>
      <span
        className="uppercase font-bold tracking-wider text-center truncate w-full"
        style={{ fontSize: 'clamp(0.38rem, 3cqmin, 0.55rem)', color: 'rgba(var(--text) / 0.5)' }}
      >
        {label}
      </span>
    </div>
  );
};

// ── Glass control pill (toggle button) ────────────────────────────────────────
const ControlPill = ({
  label, isOn, onClick, disabled, accent,
}: {
  label: string;
  isOn: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: 'blue' | 'amber' | 'green';
}) => {
  const colorVar = accent === 'amber' ? WARN : accent === 'green' ? 'var(--accent-plug)' : WATER;
  return (
    <button
      className={`flex items-center gap-1 rounded-full border ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        padding: 'clamp(0.12rem, 1.2cqmin, 0.3rem) clamp(0.4rem, 2.5cqmin, 0.75rem)',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: isOn
          ? `color-mix(in srgb, ${colorVar} 26%, var(--glass-l3-bg))`
          : 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: `1px solid ${isOn
          ? `color-mix(in srgb, ${colorVar} 58%, var(--glass-l3-border))`
          : 'var(--glass-l3-border)'}`,
        boxShadow: isOn
          ? `var(--rim), inset 0 0 12px -3px color-mix(in srgb, ${colorVar} 32%, transparent), 0 0 10px -3px color-mix(in srgb, ${colorVar} 44%, transparent)`
          : 'var(--rim)',
        transition: `all var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))`,
      }}
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      onPointerDown={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >
      <div
        className="rounded-full flex-shrink-0"
        style={{
          width: 'clamp(5px, 1.8cqmin, 8px)',
          height: 'clamp(5px, 1.8cqmin, 8px)',
          background: isOn ? colorVar : 'rgba(var(--text) / 0.3)',
          boxShadow: isOn ? `0 0 5px 1px ${colorVar}` : 'none',
          transition: 'background var(--dur-fast, 160ms) ease, box-shadow var(--dur-fast, 160ms) ease',
        }}
      />
      <span
        className="font-semibold truncate"
        style={{
          fontSize: 'clamp(0.45rem, 3.5cqmin, 0.65rem)',
          color: isOn ? colorVar : 'rgba(var(--text) / 0.6)',
          transition: 'color var(--dur-fast, 160ms) ease',
        }}
      >
        {label}
      </span>
    </button>
  );
};

// ── Section label with accent rule ───────────────────────────────────────────
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-1.5 w-full" style={{ marginBottom: 'clamp(0.1rem, 1cqmin, 0.25rem)' }}>
    <span
      className="uppercase font-bold tracking-widest"
      style={{ fontSize: 'clamp(0.38rem, 2.8cqmin, 0.5rem)', color: `color-mix(in srgb, ${WATER} 65%, rgba(var(--text) / 0.4))` }}
    >
      {children}
    </span>
    <div className="flex-1 h-px" style={{ background: `color-mix(in srgb, ${WATER} 20%, var(--glass-l3-border))` }} />
  </div>
);

// ── Effect-picker modal (glass-styled) ───────────────────────────────────────
const EffectPickerModal = ({
  light, onSelect, onClose,
}: {
  light: LightState;
  onSelect: (effect: string) => void;
  onClose: () => void;
}) => ReactDOM.createPortal(
  <div
    className="fixed inset-0 flex items-center justify-center z-[100] p-4"
    style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    onClick={onClose}
  >
    <div
      className="w-full max-w-sm overflow-hidden"
      style={{
        borderRadius: 'var(--radius-surface)',
        backdropFilter:       'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: 'var(--glass-l2-bg)',
        backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
        border: '1px solid var(--glass-l2-border)',
        boxShadow: 'var(--rim), var(--elev-5)',
        animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--glass-l2-border)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          backgroundColor: 'var(--glass-l2-tint)',
        }}
      >
        <div>
          <h3 className="font-bold" style={{ fontSize: 'var(--type-md)', color: 'rgb(var(--text))' }}>
            {light.name}
          </h3>
          <p style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.45)' }}>Light show / effect</p>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center rounded-full"
          style={{
            width: 32,
            height: 32,
            backdropFilter:       'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)',
            backgroundImage: 'var(--specular-default)',
            border: '1px solid var(--glass-l3-border)',
            boxShadow: 'var(--rim)',
            color: 'rgba(var(--text) / 0.7)',
            transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
          }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
          onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
          onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap max-h-72 overflow-y-auto" style={{ padding: 'var(--space-4)', gap: 'var(--space-2)' }}>
        <button
          onClick={() => { onSelect('none'); onClose(); }}
          style={{
            padding: 'clamp(0.3rem, 1.5cqmin, 0.4rem) clamp(0.6rem, 3cqmin, 0.85rem)',
            borderRadius: 'var(--radius-pill)',
            backdropFilter:       'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: 'var(--glass-l3-bg)',
            backgroundImage: 'var(--specular-default)',
            border: '1px solid var(--glass-l3-border)',
            boxShadow: 'var(--rim)',
            fontSize: 'var(--type-sm)',
            fontWeight: 500,
            color: 'rgb(var(--text))',
            cursor: 'pointer',
            transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
          }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.93)'; }}
          onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
          onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
        >
          None / Off
        </button>
        {light.effectList.map(effect => (
          <button
            key={effect}
            onClick={() => { onSelect(effect); onClose(); }}
            style={{
              padding: 'clamp(0.3rem, 1.5cqmin, 0.4rem) clamp(0.6rem, 3cqmin, 0.85rem)',
              borderRadius: 'var(--radius-pill)',
              backdropFilter:       'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: light.effect === effect
                ? `color-mix(in srgb, ${WATER} 26%, var(--glass-l3-bg))`
                : 'var(--glass-l3-bg)',
              backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
              border: `1px solid ${light.effect === effect
                ? `color-mix(in srgb, ${WATER} 58%, var(--glass-l3-border))`
                : 'var(--glass-l3-border)'}`,
              boxShadow: light.effect === effect
                ? `var(--rim), inset 0 0 12px -3px color-mix(in srgb, ${WATER} 30%, transparent), 0 0 10px -3px color-mix(in srgb, ${WATER} 38%, transparent)`
                : 'var(--rim)',
              fontSize: 'var(--type-sm)',
              fontWeight: 500,
              color: light.effect === effect ? WATER : 'rgb(var(--text))',
              cursor: 'pointer',
              transition: 'all var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
            }}
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.93)'; }}
            onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
            onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
          >
            {effect}
          </button>
        ))}
      </div>
    </div>
  </div>,
  document.body,
);

// ── Body control panel (glass card) ──────────────────────────────────────────
const BodyPanel = ({
  body,
  onToggle,
  onHeaterMode,
  onHeaterTemp,
  onClimateMode,
  onClimateTemp,
}: {
  body: BodyState;
  onToggle: (on: boolean) => void;
  onHeaterMode: (mode: string) => void;
  onHeaterTemp: (t: number) => void;
  onClimateMode: (mode: string) => void;
  onClimateTemp: (t: number) => void;
}) => {
  const isPool = body.name.toLowerCase().includes('pool');
  const bodyColor = isPool ? WATER : 'var(--accent)';
  const isHeating = body.heaterIsOn;

  return (
    <div
      className="flex flex-col rounded-control overflow-hidden"
      style={{
        backdropFilter:       'var(--glass-l2-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
        backgroundColor: body.isOn
          ? `color-mix(in srgb, ${bodyColor} 18%, var(--glass-l2-bg))`
          : 'var(--glass-l2-bg)',
        backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l2-tint)',
        border: `1px solid ${body.isOn
          ? `color-mix(in srgb, ${bodyColor} 48%, var(--glass-l2-border))`
          : 'var(--glass-l2-border)'}`,
        boxShadow: body.isOn
          ? `var(--rim), inset 0 0 28px -8px color-mix(in srgb, ${bodyColor} 28%, transparent), 0 0 18px -4px color-mix(in srgb, ${bodyColor} 36%, transparent), var(--elev-2)`
          : 'var(--rim), var(--elev-1)',
        padding: 'clamp(0.25rem, 2cqmin, 0.5rem)',
        gap: 'clamp(0.15rem, 1.5cqmin, 0.35rem)',
        display: 'flex',
        flexDirection: 'column',
        transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), box-shadow var(--dur-medium, 260ms) ease`,
      }}
    >
      {/* Name + temp + run toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconWaves
            className="flex-shrink-0"
            style={{
              width: 'clamp(10px, 4cqmin, 16px)',
              height: 'clamp(10px, 4cqmin, 16px)',
              color: bodyColor,
              filter: body.isOn ? `drop-shadow(0 0 4px ${bodyColor})` : undefined,
            }}
          />
          <span className="font-bold truncate" style={{ ...fluidTextSm, color: bodyColor }}>{body.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="font-bold tabular-nums" style={{ ...fluidTextLg, color: 'rgb(var(--text))' }}>
            {body.waterTempC !== null ? `${Math.round(body.waterTempC)}°` : '--'}
          </span>
          <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.45)' }}>{body.waterTempUnit}</span>
          <ControlPill label={body.isOn ? 'ON' : 'OFF'} isOn={body.isOn} onClick={() => onToggle(!body.isOn)} accent="blue" />
        </div>
      </div>

      {/* Heater / Climate row */}
      {(body.heaterId || body.climateId) && (
        <div className="flex items-center gap-1 flex-wrap">
          {body.heaterId && (
            <>
              <IconFlame
                className="flex-shrink-0"
                style={{
                  width: 'clamp(9px, 3.5cqmin, 14px)',
                  height: 'clamp(9px, 3.5cqmin, 14px)',
                  color: body.heaterIsOn ? WARN : 'rgba(var(--text) / 0.3)',
                  filter: body.heaterIsOn ? `drop-shadow(0 0 4px ${WARN})` : undefined,
                }}
              />
              <ControlPill
                label={body.heaterIsOn ? `Heat ${body.heaterTarget ?? '--'}°` : 'Heater Off'}
                isOn={body.heaterIsOn}
                onClick={() => onHeaterMode(body.heaterIsOn ? 'off' : 'on')}
                accent="amber"
              />
              {body.heaterIsOn && body.heaterTarget !== null && (
                <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.4)' }}>
                  → {body.heaterTarget}{body.waterTempUnit}
                </span>
              )}
            </>
          )}
          {!body.heaterId && body.climateId && (
            <>
              <IconSnowflake
                className="flex-shrink-0"
                style={{
                  width: 'clamp(9px, 3.5cqmin, 14px)',
                  height: 'clamp(9px, 3.5cqmin, 14px)',
                  color: body.climateMode && body.climateMode !== 'off' ? WATER : 'rgba(var(--text) / 0.3)',
                }}
              />
              <ControlPill
                label={body.climateMode ? `Mode: ${body.climateMode}` : 'Climate Off'}
                isOn={!!(body.climateMode && body.climateMode !== 'off')}
                onClick={() => onClimateMode(body.climateMode === 'off' ? 'heat_cool' : 'off')}
                accent="blue"
              />
            </>
          )}
          {!body.heaterId && !body.climateId && (
            <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.3)', fontStyle: 'italic' }}>No heater</span>
          )}
        </div>
      )}
    </div>
  );
};

// ── Pump telemetry section ────────────────────────────────────────────────────
const PumpSection = ({
  pumps, speedSetpoints, onSetSpeed,
}: {
  pumps: PumpTelemetry[];
  speedSetpoints: SpeedSetpointState[];
  onSetSpeed: (entityId: string, value: number) => void;
}) => {
  if (pumps.length === 0 && speedSetpoints.length === 0) return null;
  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.15rem, 1.2cqmin, 0.3rem)' }}>
      <SectionLabel>Pumps</SectionLabel>
      <div className="flex flex-wrap" style={{ gap: 'clamp(0.15rem, 1.5cqmin, 0.4rem)' }}>
        {pumps.map(pump => (
          <div
            key={pump.entityId}
            className="flex flex-col flex-1 rounded-control overflow-hidden"
            style={{
              backdropFilter:       'var(--glass-l2-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
              backgroundColor: pump.isRunning
                ? `color-mix(in srgb, ${WATER} 14%, var(--glass-l2-bg))`
                : 'var(--glass-l2-bg)',
              backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
              border: `1px solid ${pump.isRunning
                ? `color-mix(in srgb, ${WATER} 38%, var(--glass-l2-border))`
                : 'var(--glass-l2-border)'}`,
              boxShadow: pump.isRunning
                ? `var(--rim), inset 0 0 18px -5px color-mix(in srgb, ${WATER} 22%, transparent), var(--elev-2)`
                : 'var(--rim), var(--elev-1)',
              minWidth: 'clamp(90px, 30cqw, 160px)',
              padding: 'clamp(0.2rem, 1.8cqmin, 0.45rem)',
              transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
            }}
          >
            {/* Name + running dot */}
            <div className="flex items-center gap-1 mb-1">
              <div
                className="rounded-full flex-shrink-0 relative"
                style={{
                  width: 'clamp(5px, 1.8cqmin, 7px)',
                  height: 'clamp(5px, 1.8cqmin, 7px)',
                  background: pump.isRunning ? WATER : 'rgba(var(--text) / 0.25)',
                  boxShadow: pump.isRunning ? `0 0 6px 1px ${WATER}` : 'none',
                }}
              >
                {pump.isRunning && (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: WATER,
                      animation: 'glass-pulse-ring 1.8s ease-out infinite',
                    }}
                  />
                )}
              </div>
              <span className="font-semibold truncate" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.8)' }}>
                {pump.name}
              </span>
            </div>
            {/* Gauges row */}
            <div className="flex items-end justify-center" style={{ gap: 'clamp(0.15rem, 1.5cqmin, 0.4rem)' }}>
              <ArcGauge value={pump.rpm} max={3450} label="RPM" unit="rpm" color="#38bdf8" />
              <ArcGauge value={pump.powerW} max={2500} label="Power" unit="W" color="#fbbf24" />
              {pump.gpm !== null && (
                <ArcGauge value={pump.gpm} max={150} label="Flow" unit="gpm" color="#34d399" />
              )}
            </div>
            {/* Sparkline */}
            {pump.powerHistory.length >= 2 && (
              <div className="mt-1 w-full">
                <Sparkline data={pump.powerHistory} color="#fbbf24" />
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Speed setpoints */}
      {speedSetpoints.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
          {speedSetpoints.map(sp => (
            <SpeedControl key={sp.entityId} setpoint={sp} onChange={v => onSetSpeed(sp.entityId, v)} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Inline speed setpoint control (glass stepper) ────────────────────────────
const SpeedControl = ({
  setpoint, onChange,
}: {
  setpoint: SpeedSetpointState;
  onChange: (v: number) => void;
}) => {
  const [local, setLocal] = useState<number | null>(null);
  const displayed = local ?? setpoint.value;
  const step = setpoint.unit === 'gpm' ? 5 : 50;

  const dec = () => {
    const next = Math.max(setpoint.min, (displayed ?? setpoint.min) - step);
    setLocal(next); onChange(next);
  };
  const inc = () => {
    const next = Math.min(setpoint.max, (displayed ?? setpoint.min) + step);
    setLocal(next); onChange(next);
  };

  const StepBead = ({ symbol, onClick }: { symbol: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        width: 'clamp(20px, 5cqmin, 28px)',
        height: 'clamp(20px, 5cqmin, 28px)',
        borderRadius: 'var(--radius-pill)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)',
        boxShadow: 'var(--rim), var(--elev-1)',
        color: 'rgb(var(--text))',
        fontSize: 'clamp(0.75rem, 3.5cqmin, 1rem)',
        fontWeight: 300, lineHeight: 1,
        cursor: 'pointer',
        transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
      }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.85)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >
      {symbol}
    </button>
  );

  return (
    <div
      className="flex items-center gap-1 flex-1"
      style={{
        borderRadius: 'var(--radius-control)',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)',
        boxShadow: 'var(--rim)',
        padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)',
      }}
    >
      <span className="truncate flex-1" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.65)' }}>{setpoint.name}</span>
      <StepBead symbol="−" onClick={dec} />
      <span className="font-bold tabular-nums text-center" style={{ ...fluidTextSm, minWidth: 'clamp(2rem, 6cqmin, 3rem)', color: 'rgb(var(--text))' }}>
        {displayed ?? '--'}
        <span className="font-normal ml-0.5" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.4)' }}>{setpoint.unit}</span>
      </span>
      <StepBead symbol="+" onClick={inc} />
    </div>
  );
};

// ── Chemistry section ─────────────────────────────────────────────────────────
const ChemSection = ({
  chem, onSetSwg,
}: {
  chem: ChemState;
  onSetSwg: (entityId: string, v: number) => void;
}) => {
  const hasChem = chem.salt !== null || chem.ph !== null || chem.orp !== null || chem.swgOutputs.length > 0;
  if (!hasChem) return null;

  const phStatus = chem.ph !== null
    ? (chem.ph >= 7.2 && chem.ph <= 7.8 ? 'green' : chem.ph < 7.0 || chem.ph > 8.0 ? 'red' : 'amber')
    : 'gray';
  const orpStatus = chem.orp !== null
    ? (chem.orp >= 650 && chem.orp <= 800 ? 'green' : chem.orp < 500 ? 'red' : 'amber')
    : 'gray';

  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.1rem, 1cqmin, 0.25rem)' }}>
      <SectionLabel>Chemistry</SectionLabel>
      {/* Salt BuildBar (level-style reading) */}
      {chem.salt !== null && (
        <div
          className="rounded-control"
          style={{
            backdropFilter:       'var(--glass-l3-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
            backgroundColor: `color-mix(in srgb, ${WATER} 10%, var(--glass-l3-bg))`,
            backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
            border: `1px solid color-mix(in srgb, ${WATER} 28%, var(--glass-l3-border))`,
            boxShadow: 'var(--rim), var(--elev-1)',
            padding: 'clamp(0.2rem, 1.6cqmin, 0.4rem)',
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontSize: 'clamp(0.42rem, 3.5cqmin, 0.58rem)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(var(--text) / 0.5)' }}>
              Salt
            </span>
            <span style={{ fontSize: 'clamp(0.6rem, 5cqmin, 0.88rem)', fontWeight: 700, fontFamily: 'var(--font-numeric)', color: WATER }}>
              {Math.round(chem.salt)} <span style={{ fontSize: '0.7em', fontWeight: 400, color: 'rgba(var(--text) / 0.45)' }}>{chem.saltUnit}</span>
            </span>
          </div>
          <BuildBar
            value={chem.salt}
            min={0}
            max={4500}
            colorVar={WATER}
            active={false}
            height={5}
            label={`Salt ${Math.round(chem.salt)} ${chem.saltUnit}`}
          />
        </div>
      )}
      <div className="flex" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
        {chem.ph !== null && (
          <StatCard label="pH" value={chem.ph.toFixed(1)} accent={phStatus as any} />
        )}
        {chem.orp !== null && (
          <StatCard label="ORP" value={Math.round(chem.orp)} unit={chem.orpUnit} accent={orpStatus as any} />
        )}
      </div>
      {/* SWG output (%) with BuildBar */}
      {chem.swgOutputs.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
          {chem.swgOutputs.map(swg => (
            <SwgControl key={swg.entityId} swg={swg} onChange={v => onSetSwg(swg.entityId, v)} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── SWG Output control with BuildBar ─────────────────────────────────────────
const SwgControl = ({
  swg, onChange,
}: {
  swg: { entityId: string; name: string; value: number | null; bodyLabel: string };
  onChange: (v: number) => void;
}) => {
  const [local, setLocal] = useState<number | null>(null);
  const pct = local ?? swg.value ?? 0;
  const dec = () => { const n = Math.max(0, pct - 5); setLocal(n); onChange(n); };
  const inc = () => { const n = Math.min(100, pct + 5); setLocal(n); onChange(n); };

  const StepBead = ({ symbol, onClick }: { symbol: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        width: 'clamp(20px, 5cqmin, 28px)',
        height: 'clamp(20px, 5cqmin, 28px)',
        borderRadius: 'var(--radius-pill)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-strong), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)',
        boxShadow: 'var(--rim)',
        color: 'rgb(var(--text))',
        fontSize: 'clamp(0.75rem, 3.5cqmin, 1rem)',
        fontWeight: 300, lineHeight: 1,
        cursor: 'pointer',
        transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
      }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.85)'; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
    >
      {symbol}
    </button>
  );

  return (
    <div
      className="flex flex-col flex-1"
      style={{
        borderRadius: 'var(--radius-control)',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: `color-mix(in srgb, var(--accent-plug) 10%, var(--glass-l3-bg))`,
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: '1px solid color-mix(in srgb, var(--accent-plug) 28%, var(--glass-l3-border))',
        boxShadow: 'var(--rim), var(--elev-1)',
        padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)',
        gap: 'clamp(0.08rem, 0.8cqmin, 0.2rem)',
      }}
    >
      <div className="flex items-center gap-1">
        <span className="truncate flex-1" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.65)' }}>
          SWG {swg.bodyLabel}
        </span>
        <StepBead symbol="−" onClick={dec} />
        <span className="font-bold tabular-nums text-center" style={{ ...fluidTextSm, minWidth: 'clamp(1.8rem, 5cqmin, 2.5rem)', color: 'rgb(var(--text))' }}>
          {pct}<span className="font-normal ml-0.5" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.4)' }}>%</span>
        </span>
        <StepBead symbol="+" onClick={inc} />
      </div>
      <BuildBar
        value={pct}
        min={0}
        max={100}
        colorVar="var(--accent-plug)"
        active={pct > 0}
        height={4}
        label={`SWG ${swg.bodyLabel} ${pct}%`}
      />
    </div>
  );
};

// ── Lights section ────────────────────────────────────────────────────────────
const LightsSection = ({
  lights, onToggle, onEffect,
}: {
  lights: LightState[];
  onToggle: (entityId: string, on: boolean) => void;
  onEffect: (light: LightState) => void;
}) => {
  if (lights.length === 0) return null;
  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.1rem, 1cqmin, 0.25rem)' }}>
      <SectionLabel>Lights</SectionLabel>
      <div className="flex flex-wrap" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
        {lights.map(light => (
          <div
            key={light.entityId}
            className="flex items-center gap-1.5 flex-1"
            style={{
              borderRadius: 'var(--radius-control)',
              backdropFilter:       'var(--glass-l3-backdrop)',
              WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
              backgroundColor: light.isOn
                ? `color-mix(in srgb, ${WARN} 16%, var(--glass-l3-bg))`
                : 'var(--glass-l3-bg)',
              backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
              border: `1px solid ${light.isOn
                ? `color-mix(in srgb, ${WARN} 40%, var(--glass-l3-border))`
                : 'var(--glass-l3-border)'}`,
              boxShadow: light.isOn
                ? `var(--rim), inset 0 0 14px -4px color-mix(in srgb, ${WARN} 28%, transparent), 0 0 12px -3px color-mix(in srgb, ${WARN} 36%, transparent)`
                : 'var(--rim)',
              padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)',
              minWidth: 'clamp(80px, 25cqw, 150px)',
              transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
            }}
          >
            <IconLightbulb
              className="flex-shrink-0"
              style={{
                width: 'clamp(10px, 3.5cqmin, 14px)',
                height: 'clamp(10px, 3.5cqmin, 14px)',
                color: light.isOn ? WARN : 'rgba(var(--text) / 0.3)',
                filter: light.isOn ? `drop-shadow(0 0 4px ${WARN})` : undefined,
              }}
            />
            <span className="truncate flex-1" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.8)' }}>{light.name}</span>
            <ControlPill label={light.isOn ? 'ON' : 'OFF'} isOn={light.isOn} onClick={() => onToggle(light.entityId, !light.isOn)} accent="amber" />
            {light.effectList.length > 0 && (
              <button
                onClick={() => onEffect(light)}
                className="flex-shrink-0 rounded"
                style={{
                  ...fluidTextXs,
                  padding: '2px 5px',
                  borderRadius: 'var(--radius-chip)',
                  backdropFilter:       'var(--glass-l3-backdrop)',
                  WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                  backgroundColor: `color-mix(in srgb, ${WATER} 18%, var(--glass-l3-bg))`,
                  border: `1px solid color-mix(in srgb, ${WATER} 38%, var(--glass-l3-border))`,
                  color: WATER,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'transform var(--dur-fast, 160ms) var(--spring-snappy, cubic-bezier(0.34,1.56,0.64,1))',
                }}
                onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
                onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                title="Choose effect"
              >
                FX
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Water features section ────────────────────────────────────────────────────
const WaterFeaturesSection = ({
  features, onToggle,
}: {
  features: WaterFeatureState[];
  onToggle: (entityId: string, on: boolean) => void;
}) => {
  if (features.length === 0) return null;
  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.1rem, 1cqmin, 0.25rem)' }}>
      <SectionLabel>Water Features</SectionLabel>
      <div className="flex flex-wrap" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
        {features.map(feat => (
          <ControlPill
            key={feat.entityId}
            label={feat.name}
            isOn={feat.isOn}
            onClick={() => onToggle(feat.entityId, !feat.isOn)}
            accent="blue"
          />
        ))}
      </div>
    </div>
  );
};

// ── Probe temps section ───────────────────────────────────────────────────────
const ProbeTempsSection = ({ probes }: { probes: ProbeTempState[] }) => {
  if (probes.length === 0) return null;
  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.1rem, 1cqmin, 0.25rem)' }}>
      <SectionLabel>Sensors</SectionLabel>
      <div className="flex flex-wrap" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
        {probes.map(p => (
          <StatCard
            key={p.entityId}
            label={p.name.replace(/temperature/i, 'Temp').replace(/_/g, ' ')}
            value={p.value !== null ? Math.round(p.value) : null}
            unit={p.unit}
            accent="blue"
          />
        ))}
      </div>
    </div>
  );
};

// ── Absent / loading placeholder ─────────────────────────────────────────────
const AbsentPlaceholder = ({ label }: { label: string }) => (
  <div
    className="flex flex-col items-center justify-center h-full text-center"
    style={{ gap: 'clamp(0.25rem, 2cqmin, 0.75rem)', padding: 'clamp(0.5rem, 4cqmin, 1.5rem)' }}
  >
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 'var(--radius-card)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter:       'var(--glass-l3-backdrop)',
        WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
        backgroundColor: 'var(--glass-l3-bg)',
        backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
        border: '1px solid var(--glass-l3-border)',
        boxShadow: 'var(--rim), var(--elev-2)',
      }}
    >
      <IconWaves style={{ width: 24, height: 24, color: `color-mix(in srgb, ${WATER} 40%, transparent)` }} />
    </div>
    <span className="font-semibold" style={{ ...fluidTextBase, color: 'rgba(var(--text) / 0.6)' }}>{label}</span>
    <span className="max-w-[24ch]" style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.35)' }}>
      Install the IntelliCenter integration and configure your Pentair system to see live pool data here.
    </span>
  </div>
);

// ── Main tile ─────────────────────────────────────────────────────────────────
interface PoolSurfaceTileProps {
  device: Device;
  tile: TileConfig;
  isEditor?: boolean;
  cornerClassName?: string;
}

const PoolSurfaceTile: React.FC<PoolSurfaceTileProps> = ({
  tile,
  device,
  isEditor,
  cornerClassName,
}) => {
  const {
    surface,
    toggleBody,
    toggleLight,
    setLightEffect,
    toggleWaterFeature,
    setWaterHeaterMode,
    setWaterHeaterTemp,
    setClimateMode,
    setClimateTemp,
    setNumberValue,
  } = usePoolSurface();

  const [effectTarget, setEffectTarget] = useState<LightState | null>(null);

  const isLocked = !!tile.isLocked;
  const tileW = tile.width ?? 1;
  const tileH = tile.height ?? 1;
  const isLarge = tileW >= 3 || (tileW >= 2 && tileH >= 2);

  const anyBodyOn    = surface.bodies.some(b => b.isOn);
  const anyHeating   = surface.bodies.some(b => b.heaterIsOn);
  const staleIndicator = surface.detected && surface.stale;

  const handleEffectSelect = useCallback((effect: string) => {
    if (!effectTarget) return;
    setLightEffect(effectTarget.entityId, effect);
  }, [effectTarget, setLightEffect]);

  const handleBody = useCallback((eid: string, on: boolean) => {
    toggleBody(eid, on);
  }, [toggleBody]);

  const handleHeaterMode = useCallback((body: BodyState, mode: string) => {
    if (body.heaterId) setWaterHeaterMode(body.heaterId, mode);
    else if (body.climateId) setClimateMode(body.climateId, mode);
  }, [setWaterHeaterMode, setClimateMode]);

  return (
    <>
      <TileWrapper
        label=""
        isLocked={isLocked}
        isEditor={isEditor}
        isActive={anyBodyOn}
        accent="water"
        className={`!p-0 !block overflow-hidden border ${anyBodyOn ? 'border-sky-400/30' : 'border-white/8'} ${cornerClassName ?? ''}`}
        animation={anyHeating ? { enabled: true, effect: 'pulse', color: '#fbbf24' } : tile.animation}
      >
        <div
          className="flex flex-col h-full relative"
          style={{
            borderRadius: 'var(--radius-surface)',
            overflow: 'hidden',
            // Level-1 glass: luminous backdrop + sheen + rim
            backdropFilter:       'var(--glass-l1-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
            backgroundColor: anyBodyOn
              ? `color-mix(in srgb, ${WATER} 14%, var(--glass-l1-bg))`
              : 'var(--glass-l1-bg)',
            backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l1-tint)',
            border: `1px solid ${anyBodyOn
              ? `color-mix(in srgb, ${WATER} 32%, var(--glass-l1-border))`
              : 'var(--glass-l1-border)'}`,
            boxShadow: anyBodyOn
              ? `var(--rim), inset 0 0 40px -10px color-mix(in srgb, ${WATER} 20%, transparent), var(--elev-4)`
              : 'var(--rim), var(--elev-4)',
            animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
            transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), box-shadow var(--dur-medium, 260ms) ease`,
          }}
        >
          {/* Animated pool-water background */}
          <PoolBackground active={anyBodyOn} />

          {/* Content layer */}
          <div
            className="relative z-10 flex flex-col h-full overflow-y-auto"
            style={{
              containerType: 'inline-size',
              padding: 'clamp(0.35rem, 3cqmin, 0.75rem)',
              gap: 'clamp(0.2rem, 2cqmin, 0.5rem)',
            }}
          >
            {/* ── HEADER ─────────────────────────────────────────────────── */}
            <div
              className="flex items-start justify-between flex-shrink-0"
              style={{
                paddingBottom: 'clamp(0.2rem, 1.5cqmin, 0.4rem)',
                borderBottom: `1px solid color-mix(in srgb, ${WATER} 18%, var(--glass-l1-border))`,
              }}
            >
              <div className="flex items-center" style={{ gap: 'clamp(0.2rem, 1.5cqmin, 0.5rem)' }}>
                {/* Icon bead */}
                <div
                  style={{
                    width: 'clamp(24px, 8cqmin, 36px)',
                    height: 'clamp(24px, 8cqmin, 36px)',
                    borderRadius: 'var(--radius-control)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter:       'var(--glass-l3-backdrop)',
                    WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                    backgroundColor: `color-mix(in srgb, ${WATER} 22%, var(--glass-l3-bg))`,
                    backgroundImage: 'var(--specular-strong)',
                    border: `1px solid color-mix(in srgb, ${WATER} 48%, var(--glass-l3-border))`,
                    boxShadow: `var(--rim-light), inset 0 0 14px -4px color-mix(in srgb, ${WATER} 40%, transparent), 0 0 16px -3px color-mix(in srgb, ${WATER} 55%, transparent)`,
                  }}
                >
                  <IconWaves
                    style={{
                      width: 'clamp(12px, 4cqmin, 18px)',
                      height: 'clamp(12px, 4cqmin, 18px)',
                      color: WATER,
                      filter: anyBodyOn ? `drop-shadow(0 0 6px ${WATER})` : undefined,
                    }}
                  />
                </div>
                <div className="flex flex-col" style={{ gap: 1 }}>
                  <h2
                    className="font-bold leading-none"
                    style={{
                      ...fluidTextXl,
                      fontFamily: 'var(--font-display)',
                      letterSpacing: 'var(--tracking-tight)',
                      color: 'rgb(var(--text))',
                    }}
                  >
                    {tile.label ?? device.name ?? 'Pool'}
                  </h2>
                  {surface.bodies.length > 0 && (
                    <span style={{ fontSize: 'clamp(0.42rem, 3cqmin, 0.6rem)', color: 'rgba(var(--text) / 0.45)' }}>
                      {surface.bodies.length} {surface.bodies.length === 1 ? 'body' : 'bodies'}
                      {surface.pumps.length > 0 && ` · ${surface.pumps.length} pump${surface.pumps.length > 1 ? 's' : ''}`}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center flex-shrink-0" style={{ gap: 'clamp(0.15rem, 1.2cqmin, 0.3rem)' }}>
                {/* Freeze protection indicator */}
                {surface.freezeActive && (
                  <div
                    className="flex items-center gap-1"
                    style={{
                      padding: 'clamp(0.1rem, 1cqmin, 0.2rem) clamp(0.3rem, 2cqmin, 0.5rem)',
                      borderRadius: 'var(--radius-pill)',
                      backdropFilter:       'var(--glass-l3-backdrop)',
                      WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                      backgroundColor: `color-mix(in srgb, ${WATER} 18%, var(--glass-l3-bg))`,
                      border: `1px solid color-mix(in srgb, ${WATER} 50%, var(--glass-l3-border))`,
                      boxShadow: `var(--rim), 0 0 10px -2px color-mix(in srgb, ${WATER} 40%, transparent)`,
                    }}
                  >
                    <IconSnowflake className="w-3 h-3 flex-shrink-0" style={{ color: WATER }} />
                    <span className="font-bold uppercase tracking-wide" style={{ fontSize: 'clamp(0.38rem, 2.8cqmin, 0.5rem)', color: WATER }}>Freeze</span>
                  </div>
                )}
                {/* Stale indicator */}
                {staleIndicator && (
                  <div
                    title="Data may be stale"
                    className="rounded-full flex-shrink-0"
                    style={{
                      width: 8, height: 8,
                      background: WARN,
                      boxShadow: `0 0 6px 1px ${WARN}`,
                    }}
                  />
                )}
                {/* Not detected indicator */}
                {surface.absent && !isEditor && (
                  <span style={{ ...fluidTextXs, color: 'rgba(var(--text) / 0.35)' }}>Not detected</span>
                )}
              </div>
            </div>

            {/* ── ABSENT PLACEHOLDER ─────────────────────────────────────── */}
            {surface.absent && (
              <AbsentPlaceholder label="IntelliCenter not detected" />
            )}

            {/* ── SURFACE CONTENT ────────────────────────────────────────── */}
            {!surface.absent && (
              <>
                {/* Body panels */}
                {surface.bodies.length > 0 && (
                  <div className="flex flex-col flex-shrink-0" style={{ gap: 'clamp(0.15rem, 1.5cqmin, 0.35rem)' }}>
                    <SectionLabel>Bodies</SectionLabel>
                    {surface.bodies.map(body => (
                      <BodyPanel
                        key={body.entityId}
                        body={body}
                        onToggle={on => handleBody(body.entityId, on)}
                        onHeaterMode={mode => handleHeaterMode(body, mode)}
                        onHeaterTemp={t => body.heaterId && setWaterHeaterTemp(body.heaterId, t)}
                        onClimateMode={mode => body.climateId && setClimateMode(body.climateId, mode)}
                        onClimateTemp={t => body.climateId && setClimateTemp(body.climateId, t)}
                      />
                    ))}
                  </div>
                )}

                {/* Probe temps */}
                {surface.probeTemps.length > 0 && (
                  <ProbeTempsSection probes={surface.probeTemps} />
                )}

                {/* Pump telemetry */}
                {(surface.pumps.length > 0 || surface.speedSetpoints.length > 0) && (
                  <PumpSection
                    pumps={surface.pumps}
                    speedSetpoints={surface.speedSetpoints}
                    onSetSpeed={(eid, v) => setNumberValue(eid, v)}
                  />
                )}

                {/* Chemistry */}
                <ChemSection
                  chem={surface.chem}
                  onSetSwg={(eid, v) => setNumberValue(eid, v)}
                />

                {/* Lights */}
                {surface.lights.length > 0 && (
                  <LightsSection
                    lights={surface.lights}
                    onToggle={(eid, on) => toggleLight(eid, on)}
                    onEffect={light => setEffectTarget(light)}
                  />
                )}

                {/* Water features */}
                {surface.waterFeatures.length > 0 && (
                  <WaterFeaturesSection
                    features={surface.waterFeatures}
                    onToggle={(eid, on) => toggleWaterFeature(eid, on)}
                  />
                )}

                {/* Bottom spacer */}
                <div className="flex-shrink-0 h-1" />
              </>
            )}
          </div>
        </div>
      </TileWrapper>

      {/* Effect picker modal (portal) */}
      {effectTarget && (
        <EffectPickerModal
          light={effectTarget}
          onSelect={handleEffectSelect}
          onClose={() => setEffectTarget(null)}
        />
      )}
    </>
  );
};

export default PoolSurfaceTile;
