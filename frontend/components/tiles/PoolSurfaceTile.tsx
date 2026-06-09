/**
 * PoolSurfaceTile — marquee Pool / Spa dashboard surface for B-Panels.
 *
 * Binds to Pentair IntelliCenter entities via the usePoolSurface hook, which
 * resolves them at runtime by matching (domain, device_class, OBJTYPE/OBJNAM).
 * All data/control flows through haClient (getStates / subscribeEntities /
 * callService) — no backend, no polling, optimistic writes, reconcile on push.
 *
 * Surface layout (adaptive by tile size):
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  HEADER — Pool / Spa name badges + freeze alert + stale dot │
 *  ├─────────────────┬───────────────────────────────────────────┤
 *  │  BODY CONTROLS  │  TELEMETRY (pumps + chem + probe temps)   │
 *  │  · body on/off  │  · RPM / W / GPM gauges with sparklines   │
 *  │  · heater mode  │  · Salt / pH / ORP pills                  │
 *  │  · target temp  │  · Probe temps (air / solar / …)          │
 *  ├─────────────────┴───────────────────────────────────────────┤
 *  │  CONTROLS — Lights (+ effect picker) · Water features ·     │
 *  │             SWG output % · Pump speed setpoints             │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * Graceful degradation: if no IntelliCenter entities are present, a friendly
 * "Not detected" placeholder is shown. Individual sub-sections degrade
 * individually when their entities are absent.
 *
 * Light effect picker: light tiles with an effect_list surface a horizontal
 * scrollable chip-row. Tapping a chip calls light.turn_on with the effect.
 * No rgb_color (not supported by the integration).
 *
 * Design language: water-blue accent (#38bdf8 = --accent-water), animated
 * pool-water SVG background, dimensional stat cards, pill badges, fluid sizing.
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
import {
  fluidTextXs, fluidTextSm, fluidTextBase, fluidTextLg, fluidTextXl,
  fluidText2xl, fluidText3xl, fluidGap, fluidPad,
} from './tileScale';

// ── Pool water animated background ───────────────────────────────────────────

const PoolBackground = ({ active }: { active: boolean }) => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="poolDepth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c4a6e" />
          <stop offset="60%" stopColor="#075985" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0e3c56" />
        </linearGradient>
        <radialGradient id="poolGlow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity={active ? '0.18' : '0.07'} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="400" height="200" fill="url(#poolDepth)" />
      <rect width="400" height="200" fill="url(#poolGlow)">
        {active && (
          <animate attributeName="opacity" values="0.6;1;0.6" dur="4s" repeatCount="indefinite" />
        )}
      </rect>
      {/* Lazy caustic ripple lines */}
      <path d="M0 120 Q80 108 160 118 Q240 128 320 116 Q380 108 400 118" fill="none" stroke="#38bdf8" strokeWidth="1.2" opacity="0.12">
        {active && <animate attributeName="d" values="M0 120 Q80 108 160 118 Q240 128 320 116 Q380 108 400 118;M0 124 Q80 114 160 122 Q240 132 320 120 Q380 112 400 122;M0 120 Q80 108 160 118 Q240 128 320 116 Q380 108 400 118" dur="3.5s" repeatCount="indefinite" />}
      </path>
      <path d="M0 140 Q100 128 200 138 Q300 148 400 138" fill="none" stroke="#7dd3fc" strokeWidth="0.8" opacity="0.09">
        {active && <animate attributeName="d" values="M0 140 Q100 128 200 138 Q300 148 400 138;M0 144 Q100 134 200 142 Q300 152 400 142;M0 140 Q100 128 200 138 Q300 148 400 138" dur="4.8s" repeatCount="indefinite" />}
      </path>
    </svg>
  </div>
);

// ── Sub-components ─────────────────────────────────────────────────────────────

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
  const accentMap = {
    blue:  { border: 'border-sky-400/40',   bg: 'rgb(8 51 68 / 0.55)',  text: 'text-sky-200',   glow: '0 0 12px -2px #38bdf8' },
    amber: { border: 'border-amber-400/40', bg: 'rgb(60 36 6 / 0.55)',  text: 'text-amber-200', glow: '0 0 12px -2px #fbbf24' },
    red:   { border: 'border-red-400/40',   bg: 'rgb(60 12 12 / 0.55)', text: 'text-red-200',   glow: '0 0 12px -2px #f87171' },
    green: { border: 'border-emerald-400/40', bg: 'rgb(6 40 20 / 0.55)', text: 'text-emerald-200', glow: '0 0 12px -2px #34d399' },
    gray:  { border: 'border-white/10',     bg: 'rgb(0 0 0 / 0.4)',     text: 'text-white',     glow: 'none' },
  };
  const a = accentMap[accent ?? (highlight ? 'blue' : 'gray')];
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-control flex-1 border backdrop-blur-sm ${a.border} min-w-0`}
      style={{
        background: a.bg,
        boxShadow: a.glow !== 'none'
          ? `inset 0 1px 0 rgb(255 255 255 / 0.1), inset 0 -2px 6px rgb(0 0 0 / 0.4), ${a.glow}`
          : 'inset 0 1px 0 rgb(255 255 255 / 0.06), inset 0 -2px 5px rgb(0 0 0 / 0.4)',
        padding: 'clamp(0.2rem, 2cqmin, 0.5rem) clamp(0.15rem, 1.5cqmin, 0.35rem)',
      }}
    >
      <span className="text-gray-300 uppercase font-bold tracking-wider truncate w-full text-center" style={{ fontSize: 'clamp(0.42rem, 3.8cqmin, 0.6rem)' }}>
        {label}
      </span>
      <span className={`font-bold leading-tight tabular-nums ${a.text}`} style={{ fontSize: 'clamp(0.7rem, 6.5cqmin, 1.05rem)' }}>
        {value ?? '--'}{unit && <span className="font-normal ml-0.5" style={{ fontSize: 'clamp(0.4rem, 3.2cqmin, 0.55rem)' }}>{unit}</span>}
      </span>
      {note && <span className="text-gray-400 truncate w-full text-center" style={{ fontSize: 'clamp(0.38rem, 3cqmin, 0.5rem)' }}>{note}</span>}
    </div>
  );
};

// Compact sparkline using an SVG polyline — no charting library needed.
const Sparkline = ({ data, color = '#38bdf8', height = 28 }: { data: number[]; color?: string; height?: number }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 80;
  const h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 'clamp(14px, 6cqmin, 28px)' }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
};

// Circular arc gauge for RPM / W
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
  const r = 28;
  const cx = 36; const cy = 36;
  const circ = 2 * Math.PI * r;
  const arcLen = pct * circ * 0.75; // 270° arc
  const dashArray = `${arcLen.toFixed(1)} ${circ.toFixed(1)}`;
  // 270° arc starting at 135° (bottom-left)
  const startAngle = 135;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const startX = cx + r * Math.cos(toRad(startAngle));
  const startY = cy + r * Math.sin(toRad(startAngle));

  return (
    <div className="flex flex-col items-center" style={{ minWidth: 0, flex: '0 0 auto' }}>
      <svg viewBox="0 0 72 72" style={{ width: 'clamp(40px, 16cqmin, 72px)', height: 'clamp(40px, 16cqmin, 72px)' }}>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5"
          strokeDasharray={`${(circ * 0.75).toFixed(1)} ${circ.toFixed(1)}`}
          strokeDashoffset={-(circ * 0.125).toFixed(1) as any}
          strokeLinecap="round"
          style={{ transform: `rotate(-90deg)`, transformOrigin: `${cx}px ${cy}px` }}
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
              filter: `drop-shadow(0 0 4px ${color})`,
            }}
          />
        )}
        {/* Value */}
        <text x={cx} y={cy + 5} textAnchor="middle" fill="white"
          style={{ fontSize: 'clamp(8px, 3.5cqmin, 14px)', fontWeight: 700, fontFamily: 'monospace' }}>
          {value !== null ? (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))) : '--'}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" fill="rgba(200,200,200,0.7)"
          style={{ fontSize: 'clamp(5px, 2.2cqmin, 9px)', fontWeight: 600 }}>
          {unit}
        </text>
      </svg>
      <span className="text-gray-300 uppercase font-bold tracking-wider text-center truncate w-full" style={{ fontSize: 'clamp(0.38rem, 3cqmin, 0.55rem)' }}>{label}</span>
    </div>
  );
};

// A toggleable control pill
const ControlPill = ({
  label, isOn, onClick, disabled, accent,
}: {
  label: string;
  isOn: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: 'blue' | 'amber' | 'green';
}) => {
  const colors = {
    blue:  isOn ? 'bg-sky-500/30 border-sky-400/60 text-sky-100' : 'bg-black/30 border-white/10 text-gray-400',
    amber: isOn ? 'bg-amber-500/30 border-amber-400/60 text-amber-100' : 'bg-black/30 border-white/10 text-gray-400',
    green: isOn ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-100' : 'bg-black/30 border-white/10 text-gray-400',
  };
  const c = colors[accent ?? 'blue'];
  return (
    <button
      className={`flex items-center gap-1 rounded-full border px-2 transition-all duration-150 active:scale-95 ${c} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'}`}
      style={{ padding: 'clamp(0.12rem, 1.2cqmin, 0.3rem) clamp(0.4rem, 2.5cqmin, 0.75rem)' }}
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
    >
      <div className={`rounded-full flex-shrink-0 ${isOn ? (accent === 'amber' ? 'bg-amber-400' : accent === 'green' ? 'bg-emerald-400' : 'bg-sky-400') : 'bg-gray-500'}`}
        style={{ width: 'clamp(5px, 1.8cqmin, 8px)', height: 'clamp(5px, 1.8cqmin, 8px)' }} />
      <span className="font-semibold truncate" style={{ fontSize: 'clamp(0.45rem, 3.5cqmin, 0.65rem)' }}>{label}</span>
    </button>
  );
};

// Section header rule
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-1.5 w-full" style={{ marginBottom: 'clamp(0.1rem, 1cqmin, 0.25rem)' }}>
    <span className="text-sky-300/60 uppercase font-bold tracking-widest" style={{ fontSize: 'clamp(0.38rem, 2.8cqmin, 0.5rem)' }}>
      {children}
    </span>
    <div className="flex-1 h-px bg-sky-300/15" />
  </div>
);

// ── Effect-picker modal ──────────────────────────────────────────────────────

const EffectPickerModal = ({
  light,
  onSelect,
  onClose,
}: {
  light: LightState;
  onSelect: (effect: string) => void;
  onClose: () => void;
}) => ReactDOM.createPortal(
  <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onClose}>
    <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-sm overflow-hidden border border-gray-700" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-700">
        <div>
          <h3 className="text-base font-bold text-white">{light.name}</h3>
          <p className="text-xs text-gray-400">Light show / effect</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1.5 rounded-full hover:bg-gray-700 transition-colors">
          <IconX className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 flex flex-wrap gap-2 max-h-72 overflow-y-auto">
        <button
          onClick={() => { onSelect('none'); onClose(); }}
          className="px-3 py-1.5 rounded-full border text-sm font-medium transition-all active:scale-95 bg-black/30 border-white/20 text-gray-300 hover:bg-white/10"
        >
          None / Off
        </button>
        {light.effectList.map(effect => (
          <button
            key={effect}
            onClick={() => { onSelect(effect); onClose(); }}
            className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all active:scale-95 ${
              light.effect === effect
                ? 'bg-sky-500/30 border-sky-400/60 text-sky-100'
                : 'bg-black/30 border-white/15 text-gray-300 hover:bg-sky-500/15 hover:border-sky-400/30'
            }`}
          >
            {effect}
          </button>
        ))}
      </div>
    </div>
  </div>,
  document.body,
);

// ── Body control panel ───────────────────────────────────────────────────────

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
  const accentColor = isPool ? 'text-sky-300' : 'text-purple-300';
  const pillAccent = isPool ? 'blue' : 'blue';

  // Determine heat source label
  const heaterLabel = body.heaterId
    ? (body.heaterIsOn ? 'Heating' : 'Heater Off')
    : (body.climateId ? 'Climate' : null);

  const tempDisplay = body.waterTempC !== null
    ? `${Math.round(body.waterTempC)}°`
    : '--';

  return (
    <div
      className="flex flex-col rounded-control border border-white/10 overflow-hidden"
      style={{
        background: 'rgb(0 0 0 / 0.35)',
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -2px 6px rgb(0 0 0 / 0.4)',
        padding: 'clamp(0.25rem, 2cqmin, 0.5rem)',
        gap: 'clamp(0.15rem, 1.5cqmin, 0.35rem)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Name + temp + run toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconWaves className={`flex-shrink-0 ${accentColor}`} style={{ width: 'clamp(10px, 4cqmin, 16px)', height: 'clamp(10px, 4cqmin, 16px)' }} />
          <span className={`font-bold truncate ${accentColor}`} style={fluidTextSm}>{body.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-white font-bold tabular-nums" style={fluidTextLg}>{tempDisplay}</span>
          <span className="text-gray-400" style={fluidTextXs}>{body.waterTempUnit}</span>
          <ControlPill label={body.isOn ? 'ON' : 'OFF'} isOn={body.isOn} onClick={() => onToggle(!body.isOn)} accent="blue" />
        </div>
      </div>

      {/* Heater / Climate row */}
      {(body.heaterId || body.climateId) && (
        <div className="flex items-center gap-1 flex-wrap">
          {body.heaterId && (
            <>
              <IconFlame className={`flex-shrink-0 ${body.heaterIsOn ? 'text-amber-400' : 'text-gray-500'}`}
                style={{ width: 'clamp(9px, 3.5cqmin, 14px)', height: 'clamp(9px, 3.5cqmin, 14px)' }} />
              <ControlPill
                label={body.heaterIsOn ? `Heat ${body.heaterTarget ?? '--'}°` : 'Heater Off'}
                isOn={body.heaterIsOn}
                onClick={() => onHeaterMode(body.heaterIsOn ? 'off' : 'on')}
                accent="amber"
              />
              {body.heaterIsOn && body.heaterTarget !== null && (
                <span className="text-gray-400" style={fluidTextXs}>
                  → {body.heaterTarget}{body.waterTempUnit}
                </span>
              )}
            </>
          )}
          {!body.heaterId && body.climateId && (
            <>
              <IconSnowflake className={`flex-shrink-0 ${body.climateMode && body.climateMode !== 'off' ? 'text-sky-400' : 'text-gray-500'}`}
                style={{ width: 'clamp(9px, 3.5cqmin, 14px)', height: 'clamp(9px, 3.5cqmin, 14px)' }} />
              <ControlPill
                label={body.climateMode ? `Mode: ${body.climateMode}` : 'Climate Off'}
                isOn={!!(body.climateMode && body.climateMode !== 'off')}
                onClick={() => onClimateMode(body.climateMode === 'off' ? 'heat_cool' : 'off')}
                accent="blue"
              />
            </>
          )}
          {heaterLabel === null && <span className="text-gray-500 italic" style={fluidTextXs}>No heater</span>}
        </div>
      )}
    </div>
  );
};

// ── Pump telemetry section ───────────────────────────────────────────────────

const PumpSection = ({
  pumps,
  speedSetpoints,
  onSetSpeed,
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
            className="flex flex-col rounded-control border border-white/10 overflow-hidden flex-1"
            style={{ background: 'rgb(0 0 0 / 0.35)', minWidth: 'clamp(90px, 30cqw, 160px)', padding: 'clamp(0.2rem, 1.8cqmin, 0.45rem)' }}
          >
            {/* Name + running dot */}
            <div className="flex items-center gap-1 mb-1">
              <div className={`rounded-full flex-shrink-0 ${pump.isRunning ? 'bg-sky-400' : 'bg-gray-600'}`}
                style={{ width: 'clamp(5px, 1.8cqmin, 7px)', height: 'clamp(5px, 1.8cqmin, 7px)' }}>
                {pump.isRunning && (
                  <div className="w-full h-full rounded-full bg-sky-400 animate-ping opacity-60" />
                )}
              </div>
              <span className="font-semibold text-gray-200 truncate" style={fluidTextXs}>{pump.name}</span>
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

// Inline speed setpoint control (tap –/+ or display the value)
const SpeedControl = ({
  setpoint,
  onChange,
}: {
  setpoint: SpeedSetpointState;
  onChange: (v: number) => void;
}) => {
  const [local, setLocal] = useState<number | null>(null);
  const displayed = local ?? setpoint.value;
  const step = setpoint.unit === 'gpm' ? 5 : 50;

  const dec = () => {
    const next = Math.max(setpoint.min, (displayed ?? setpoint.min) - step);
    setLocal(next);
    onChange(next);
  };
  const inc = () => {
    const next = Math.min(setpoint.max, (displayed ?? setpoint.min) + step);
    setLocal(next);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1 rounded-control border border-white/10 flex-1"
      style={{ background: 'rgb(0 0 0 / 0.35)', padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)' }}>
      <span className="text-gray-300 truncate flex-1" style={fluidTextXs}>{setpoint.name}</span>
      <button onClick={dec} className="text-gray-300 hover:text-white w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-lg font-bold leading-none">−</button>
      <span className="text-white font-bold tabular-nums text-center" style={{ ...fluidTextSm, minWidth: 'clamp(2rem, 6cqmin, 3rem)' }}>
        {displayed ?? '--'}<span className="text-gray-400 font-normal ml-0.5" style={fluidTextXs}>{setpoint.unit}</span>
      </span>
      <button onClick={inc} className="text-gray-300 hover:text-white w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-lg font-bold leading-none">+</button>
    </div>
  );
};

// ── Chemistry section ────────────────────────────────────────────────────────

const ChemSection = ({
  chem,
  onSetSwg,
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
      <div className="flex" style={{ gap: 'clamp(0.1rem, 1.2cqmin, 0.3rem)' }}>
        {chem.salt !== null && (
          <StatCard label="Salt" value={Math.round(chem.salt)} unit={chem.saltUnit} highlight accent="blue" />
        )}
        {chem.ph !== null && (
          <StatCard label="pH" value={chem.ph.toFixed(1)} accent={phStatus as any} />
        )}
        {chem.orp !== null && (
          <StatCard label="ORP" value={Math.round(chem.orp)} unit={chem.orpUnit} accent={orpStatus as any} />
        )}
      </div>
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

const SwgControl = ({
  swg,
  onChange,
}: {
  swg: { entityId: string; name: string; value: number | null; bodyLabel: string };
  onChange: (v: number) => void;
}) => {
  const [local, setLocal] = useState<number | null>(null);
  const pct = local ?? swg.value ?? 0;
  const dec = () => { const n = Math.max(0, pct - 5); setLocal(n); onChange(n); };
  const inc = () => { const n = Math.min(100, pct + 5); setLocal(n); onChange(n); };
  return (
    <div className="flex items-center gap-1 rounded-control border border-white/10 flex-1"
      style={{ background: 'rgb(0 0 0 / 0.35)', padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)' }}>
      <span className="text-gray-300 truncate flex-1" style={fluidTextXs}>SWG {swg.bodyLabel}</span>
      <button onClick={dec} className="text-gray-300 hover:text-white w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-lg font-bold leading-none">−</button>
      <span className="text-white font-bold tabular-nums text-center" style={{ ...fluidTextSm, minWidth: 'clamp(2rem, 5cqmin, 2.5rem)' }}>
        {pct}<span className="text-gray-400 font-normal ml-0.5" style={fluidTextXs}>%</span>
      </span>
      <button onClick={inc} className="text-gray-300 hover:text-white w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-lg font-bold leading-none">+</button>
    </div>
  );
};

// ── Lights section ───────────────────────────────────────────────────────────

const LightsSection = ({
  lights,
  onToggle,
  onEffect,
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
          <div key={light.entityId}
            className="flex items-center gap-1.5 rounded-control border border-white/10 flex-1"
            style={{ background: 'rgb(0 0 0 / 0.3)', padding: 'clamp(0.15rem, 1.4cqmin, 0.35rem)', minWidth: 'clamp(80px, 25cqw, 150px)' }}
          >
            <IconLightbulb
              className={`flex-shrink-0 ${light.isOn ? 'text-amber-300' : 'text-gray-500'}`}
              style={{ width: 'clamp(10px, 3.5cqmin, 14px)', height: 'clamp(10px, 3.5cqmin, 14px)', ...(light.isOn ? { filter: 'drop-shadow(0 0 4px #fbbf24)' } : {}) }}
            />
            <span className="text-gray-200 truncate flex-1" style={fluidTextXs}>{light.name}</span>
            <ControlPill label={light.isOn ? 'ON' : 'OFF'} isOn={light.isOn} onClick={() => onToggle(light.entityId, !light.isOn)} accent="amber" />
            {light.effectList.length > 0 && (
              <button
                onClick={() => onEffect(light)}
                className="text-sky-400 hover:text-sky-200 transition-colors rounded px-1 hover:bg-sky-400/10"
                style={fluidTextXs}
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

// ── Water features section ───────────────────────────────────────────────────

const WaterFeaturesSection = ({
  features,
  onToggle,
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

// ── Probe temps section ──────────────────────────────────────────────────────

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
  <div className="flex flex-col items-center justify-center h-full text-center" style={{ gap: 'clamp(0.25rem, 2cqmin, 0.75rem)', padding: 'clamp(0.5rem, 4cqmin, 1.5rem)' }}>
    <IconWaves className="text-sky-400/30" style={{ width: 'clamp(1.5rem, 14cqmin, 3.5rem)', height: 'clamp(1.5rem, 14cqmin, 3.5rem)' }} />
    <span className="font-semibold text-gray-300" style={fluidTextBase}>{label}</span>
    <span className="text-gray-500 max-w-[24ch]" style={fluidTextXs}>
      Install the IntelliCenter integration and configure your Pentair system to see live pool data here.
    </span>
  </div>
);

// ── Main tile ────────────────────────────────────────────────────────────────

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

  // Any body running → tile is "active"
  const anyBodyOn = surface.bodies.some(b => b.isOn);
  const anyHeating = surface.bodies.some(b => b.heaterIsOn);

  // Stale indicator — show if data is older than threshold
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
        <div className="flex flex-col h-full relative">
          {/* Animated pool-water background */}
          <PoolBackground active={anyBodyOn} />

          {/* Content layer */}
          <div
            className="relative z-10 flex flex-col h-full overflow-y-auto"
            style={{ padding: 'clamp(0.35rem, 3cqmin, 0.75rem)', gap: 'clamp(0.2rem, 2cqmin, 0.5rem)' }}
          >
            {/* ── HEADER ──────────────────────────────────────────────────── */}
            <div className="flex items-start justify-between flex-shrink-0">
              <div className="flex items-center" style={{ gap: 'clamp(0.2rem, 1.5cqmin, 0.5rem)' }}>
                <IconWaves className="text-sky-300 flex-shrink-0" style={{ width: 'clamp(12px, 4.5cqmin, 20px)', height: 'clamp(12px, 4.5cqmin, 20px)', filter: anyBodyOn ? 'drop-shadow(0 0 6px #38bdf8)' : undefined }} />
                <h2 className="font-bold text-white leading-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]" style={isLarge ? fluidTextXl : fluidTextLg}>
                  {tile.label ?? device.name ?? 'Pool'}
                </h2>
              </div>
              <div className="flex items-center flex-shrink-0" style={{ gap: 'clamp(0.15rem, 1.2cqmin, 0.3rem)' }}>
                {/* Freeze protection indicator */}
                {surface.freezeActive && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-sky-300/50 bg-sky-900/40">
                    <IconSnowflake className="w-3 h-3 text-sky-300" />
                    <span className="text-sky-200 font-bold uppercase tracking-wide" style={{ fontSize: 'clamp(0.38rem, 2.8cqmin, 0.5rem)' }}>Freeze</span>
                  </div>
                )}
                {/* Stale indicator */}
                {staleIndicator && (
                  <div title="Data may be stale" className="w-2 h-2 rounded-full bg-yellow-400/70 border border-yellow-400/50 flex-shrink-0" />
                )}
                {/* Not detected / absent */}
                {surface.absent && !isEditor && (
                  <span className="text-gray-500" style={fluidTextXs}>Not detected</span>
                )}
              </div>
            </div>

            {/* ── ABSENT PLACEHOLDER ──────────────────────────────────────── */}
            {surface.absent && (
              <AbsentPlaceholder label="IntelliCenter not detected" />
            )}

            {/* ── SURFACE CONTENT ─────────────────────────────────────────── */}
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
