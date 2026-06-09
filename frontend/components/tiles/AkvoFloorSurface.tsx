// AKVO Movable Floor — the safety-critical surface.
//
// MONITOR-FIRST. The large left/top region is an unambiguous, at-a-glance status
// display (positions, motion, active configuration, system status, motor
// currents, faults). The command region is secondary, heavily guarded, and only
// ever issues ONE thing: a configuration REQUEST via select.select_option, which
// the AKVO controller validates and acts on. There is NO raw motion/stop/reset
// control anywhere in this file, by design.
//
// Self-driven surface (DeviceType.AkvoFloor): owns its subscription via
// useAkvoFloor; all transport is through services/haClient.ts.
//
// SAFETY: evaluateGate, press-and-hold confirm, requestConfiguration, and the
// single select.select_option write are UNCHANGED from the original. Only the
// monitor/visualization region has been enhanced. The safety gate logic,
// HoldToRequest press-and-hold duration, and onComplete handler are identical
// to the original implementation.

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useAkvoFloor } from '../../hooks/useAkvoFloor';
import type { AkvoState, AkvoFault } from '../../services/akvo';
import {
    IconWaves, IconLoader2, IconWifiOff, IconShieldAlert, IconShieldCheck,
    IconAlertOctagon, IconAlertTriangle, IconActivity, IconGauge, IconMoveVertical,
    IconHand, IconCheckCircle, IconLayers,
} from '../icons';
import type { TileProps } from '../tileRegistry';

const HOLD_MS = 2000; // press-and-hold duration to issue a request — DO NOT CHANGE

// ── CSS animation keyframes injected once ─────────────────────────────────────
// We avoid a build-time CSS import by injecting into the document head once.
// This keeps the component self-contained without new asset dependencies.
let _animsInjected = false;
function ensureAnims() {
    if (_animsInjected || typeof document === 'undefined') return;
    _animsInjected = true;
    const style = document.createElement('style');
    style.textContent = `
@keyframes akvo-pulse-alert {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.38; }
}
@keyframes akvo-ripple {
    0%   { transform: scale(1);   opacity: 0.7; }
    100% { transform: scale(2.4); opacity: 0; }
}
@keyframes akvo-sparkle-flow {
    0%   { stroke-dashoffset: 24; }
    100% { stroke-dashoffset: 0;  }
}
@keyframes akvo-water-drift {
    0%   { transform: translateX(0);   }
    100% { transform: translateX(-64px); }
}
@keyframes akvo-live-dot {
    0%, 100% { r: 3; opacity: 1;   }
    50%       { r: 5; opacity: 0.5; }
}
@keyframes akvo-caret-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
}
`;
    document.head.appendChild(style);
}

// ── Connection status pill ─────────────────────────────────────────────────────
const StatusPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
    if (status === 'live') {
        return (
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                <svg width="8" height="8" viewBox="0 0 8 8" style={{ overflow: 'visible' }}>
                    <circle cx="4" cy="4" r="3" fill="rgb(52 211 153)" />
                    <circle cx="4" cy="4" r="3" fill="rgb(52 211 153)"
                        style={{ animation: 'akvo-ripple 1.8s ease-out infinite' }} />
                </svg>
                Live
            </span>
        );
    }
    if (status === 'connecting') {
        return (
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <IconLoader2 className="w-3.5 h-3.5 animate-spin" /> Connecting
            </span>
        );
    }
    return (
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
            <IconWifiOff className="w-3.5 h-3.5" /> Stale — reconnecting
        </span>
    );
};

// ── Overall system status ──────────────────────────────────────────────────────
type Overall = { label: string; rgb: string; Icon: React.ComponentType<any> };
function overallStatus(s: AkvoState): Overall {
    if (!s.anyAvailable) return { label: 'OFFLINE', rgb: 'var(--surface-control)', Icon: IconWifiOff };
    if (s.emergencyStop === true) return { label: 'EMERGENCY STOP', rgb: 'var(--accent-alert)', Icon: IconAlertOctagon };
    if (s.systemFault === true) return { label: 'FAULT', rgb: 'var(--accent-alert)', Icon: IconShieldAlert };
    if (s.badModbusComm === true) return { label: 'COMMS FAULT', rgb: 'var(--accent-alert)', Icon: IconAlertTriangle };
    if (s.floorsMoving === true) return { label: 'MOVING', rgb: 'var(--accent-warn)', Icon: IconMoveVertical };
    if (s.systemReady === true || s.readyForExternalCommands === true) return { label: 'READY', rgb: 'var(--accent-plug)', Icon: IconShieldCheck };
    return { label: 'STANDBY', rgb: 'var(--accent)', Icon: IconActivity };
}

// ── Depth color by state ───────────────────────────────────────────────────────
function floorColor(s: AkvoState): { plate: string; glow: string } {
    if (s.emergencyStop === true || s.systemFault === true) {
        return { plate: 'rgb(248 113 113)', glow: 'rgb(248 113 113 / 0.45)' };
    }
    if (s.badModbusComm === true) {
        return { plate: 'rgb(251 146 60)', glow: 'rgb(251 146 60 / 0.35)' };
    }
    if (s.floorsMoving === true) {
        return { plate: 'rgb(251 191 36)', glow: 'rgb(251 191 36 / 0.40)' };
    }
    if (s.systemReady === true || s.readyForExternalCommands === true) {
        return { plate: 'rgb(52 211 153)', glow: 'rgb(52 211 153 / 0.30)' };
    }
    return { plate: 'rgb(148 163 184)', glow: 'rgb(148 163 184 / 0.20)' };
}

// ── SVG Cross-Section visualization ───────────────────────────────────────────
// Renders a vertical cross-section: sky above deck, water column, movable floor plate.
// coordinate system: deck is at y=0, positive y goes DOWN (into water).
// mainFloorPosition: negative = above deck (raised), positive = below (submerged).
// Visual scale: ±3 m maps to ±100 px from deck line in the SVG (svgH=260, deckY=80).
const SVG_W = 220;
const SVG_H = 260;
const DECK_Y = 80;         // px from top where the deck line sits
const PX_PER_M = 44;       // px per metre of depth; 3 m = 132 px (well inside SVG_H-DECK_Y)
const PLATE_H = 10;        // height of floor plate rect
const PLATE_W = 140;
const BAJA_W = 90;
const BAJA_H = 7;

function positionToPx(m: number | null): number {
    // Null → midpoint guess (no data). Positive (below deck) → larger y.
    const val = m ?? 0;
    return DECK_Y + val * PX_PER_M;
}

interface CrossSectionProps {
    state: AkvoState;
    isMoving: boolean;
}

const CrossSection: React.FC<CrossSectionProps> = ({ state, isMoving }) => {
    const { plate: plateColor, glow: glowColor } = floorColor(state);
    const isFault = state.emergencyStop === true || state.systemFault === true;

    const mainY = positionToPx(state.mainFloorPosition);
    const bajaY = state.bajaPosition != null ? positionToPx(state.bajaPosition) : null;

    // Water column fills from deck down to the bottom of the SVG
    // (we always show it; the floor plate clips/interrupts it visually)
    const waterFillY = DECK_Y;
    const waterFillH = SVG_H - DECK_Y;

    // Moving dashes on the plate edge while isMoving
    const motionArrow = isMoving
        ? (state.mainFloorPosition != null && state.mainFloorPosition < 0
            ? 'up' : 'down')
        : null;

    return (
        <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ display: 'block', overflow: 'visible' }}
            aria-label="Pool cross-section: animated floor position visualization"
        >
            <defs>
                {/* Water gradient */}
                <linearGradient id="akvo-water-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="rgb(14 116 144)" stopOpacity="0.75" />
                </linearGradient>
                {/* Pool wall gradient */}
                <linearGradient id="akvo-wall-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="rgb(100 116 139)" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="rgb(71 85 105)" stopOpacity="0.9" />
                </linearGradient>
                {/* Plate glow filter */}
                <filter id="akvo-plate-glow" x="-30%" y="-100%" width="160%" height="300%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
                    <feFlood floodColor={plateColor} floodOpacity="0.6" result="color" />
                    <feComposite in="color" in2="blur" operator="in" result="glow" />
                    <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                {/* Clip water to pool interior */}
                <clipPath id="akvo-pool-clip">
                    <rect x="18" y={waterFillY} width={SVG_W - 36} height={waterFillH} />
                </clipPath>
                {/* Wave pattern for water surface */}
                <pattern id="akvo-wave-pat" x="0" y="0" width="64" height="12" patternUnits="userSpaceOnUse"
                    style={isMoving ? { animation: 'akvo-water-drift 1.5s linear infinite' } : {}}>
                    <path d="M0 6 Q8 2 16 6 Q24 10 32 6 Q40 2 48 6 Q56 10 64 6" fill="none"
                        stroke="rgb(186 230 253)" strokeWidth="1.5" strokeOpacity="0.5" />
                </pattern>
            </defs>

            {/* ── Sky / above-deck region ── */}
            <rect x="0" y="0" width={SVG_W} height={DECK_Y}
                fill="rgb(var(--bg) / 0.0)" />

            {/* Structural pool walls */}
            <rect x="18" y={DECK_Y} width="10" height={waterFillH}
                fill="url(#akvo-wall-grad)" rx="2" />
            <rect x={SVG_W - 28} y={DECK_Y} width="10" height={waterFillH}
                fill="url(#akvo-wall-grad)" rx="2" />

            {/* Pool floor at bottom */}
            <rect x="18" y={SVG_H - 12} width={SVG_W - 36} height="12"
                fill="rgb(71 85 105)" rx="2" />

            {/* Water body */}
            <rect x="28" y={waterFillY} width={SVG_W - 56} height={waterFillH}
                fill="url(#akvo-water-grad)" clipPath="url(#akvo-pool-clip)" />

            {/* Animated wave ripple at water surface */}
            <rect x="28" y={waterFillY} width={SVG_W - 56} height="12"
                fill="url(#akvo-wave-pat)" opacity="0.8" />

            {/* ── Deck line ── */}
            {/* Deck cap / coping */}
            <rect x="12" y={DECK_Y - 8} width={SVG_W - 24} height="8"
                fill="rgb(100 116 139)" rx="2" />
            {/* Deck label */}
            <text x={SVG_W / 2} y={DECK_Y - 12} textAnchor="middle"
                fontSize="9" fill="rgb(148 163 184)" fontFamily="monospace" letterSpacing="1.5">
                DECK  0.00 m
            </text>
            {/* Dashed deck reference line */}
            <line x1="28" y1={DECK_Y} x2={SVG_W - 28} y2={DECK_Y}
                stroke="rgb(148 163 184)" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.5" />

            {/* ── Depth ruler on right edge ── */}
            {[-1, 0, 1, 2].map((m) => {
                const y = DECK_Y + m * PX_PER_M;
                if (y < 2 || y > SVG_H - 4) return null;
                return (
                    <g key={m}>
                        <line x1={SVG_W - 18} y1={y} x2={SVG_W - 12} y2={y}
                            stroke="rgb(100 116 139)" strokeWidth="1" />
                        <text x={SVG_W - 10} y={y + 3.5} fontSize="8"
                            fill="rgb(100 116 139)" fontFamily="monospace">
                            {m >= 0 ? `+${m}m` : `${m}m`}
                        </text>
                    </g>
                );
            })}

            {/* ── Baja shelf (secondary floor), if present ── */}
            {bajaY != null && (
                <g style={{
                    transition: 'transform 0.9s cubic-bezier(0.34, 1.18, 0.64, 1)',
                    transform: `translateY(${bajaY - DECK_Y}px)`,
                }}>
                    {/* render relative to deck */}
                    <g transform={`translate(${SVG_W / 2 - BAJA_W / 2}, ${DECK_Y})`}>
                        {/* Baja support brackets */}
                        <line x1="0" y1="0" x2="0" y2={BAJA_H + 4}
                            stroke="rgb(100 116 139)" strokeWidth="2" strokeOpacity="0.6" />
                        <line x1={BAJA_W} y1="0" x2={BAJA_W} y2={BAJA_H + 4}
                            stroke="rgb(100 116 139)" strokeWidth="2" strokeOpacity="0.6" />
                        {/* Baja plate */}
                        <rect x="0" y="0" width={BAJA_W} height={BAJA_H}
                            rx="2"
                            fill="rgb(71 85 105)"
                            stroke="rgb(148 163 184)"
                            strokeWidth="1"
                            opacity="0.75"
                        />
                        <text x={BAJA_W / 2} y={BAJA_H / 2 + 3} textAnchor="middle"
                            fontSize="7" fill="rgb(186 230 253)" fontFamily="monospace" letterSpacing="1">
                            BAJA
                        </text>
                    </g>
                </g>
            )}

            {/* ── Main floor plate ── the hero element ── */}
            {/* Smooth vertical transition; uses inline style so it reacts to real position data */}
            <g style={{
                transition: isMoving
                    ? 'transform 0.6s linear'
                    : 'transform 1.1s cubic-bezier(0.34, 1.18, 0.64, 1)',
                transform: `translateY(${mainY - DECK_Y}px)`,
            }}>
                <g transform={`translate(${SVG_W / 2 - PLATE_W / 2}, ${DECK_Y})`}>
                    {/* Drop shadow / glow under plate */}
                    <ellipse
                        cx={PLATE_W / 2} cy={PLATE_H + 4}
                        rx={PLATE_W / 2 - 4} ry="5"
                        fill={glowColor}
                        style={isFault ? { animation: 'akvo-pulse-alert 1s ease-in-out infinite' } : {}}
                    />
                    {/* Plate body */}
                    <rect
                        x="0" y="0"
                        width={PLATE_W} height={PLATE_H}
                        rx="3"
                        fill={plateColor}
                        filter="url(#akvo-plate-glow)"
                        opacity={isFault ? undefined : 0.92}
                        style={isFault ? { animation: 'akvo-pulse-alert 1s ease-in-out infinite' } : {}}
                    />
                    {/* Plate surface texture lines */}
                    {[20, 40, 60, 80, 100, 120].map((x) => (
                        <line key={x} x1={x} y1="2" x2={x} y2={PLATE_H - 2}
                            stroke="rgba(0,0,0,0.18)" strokeWidth="1" />
                    ))}
                    {/* Label */}
                    <text x={PLATE_W / 2} y={PLATE_H / 2 + 3.5} textAnchor="middle"
                        fontSize="8" fill="rgba(0,0,0,0.72)" fontFamily="monospace"
                        fontWeight="bold" letterSpacing="2">
                        MAIN FLOOR
                    </text>

                    {/* Motion direction arrows when moving */}
                    {motionArrow === 'up' && (
                        <>
                            <polygon points={`${PLATE_W / 2 - 6},-4 ${PLATE_W / 2 + 6},-4 ${PLATE_W / 2},-14`}
                                fill={plateColor} opacity="0.8"
                                style={{ animation: 'akvo-pulse-alert 0.7s ease-in-out infinite' }} />
                            <polygon points={`${PLATE_W / 2 - 6},-16 ${PLATE_W / 2 + 6},-16 ${PLATE_W / 2},-26`}
                                fill={plateColor} opacity="0.4"
                                style={{ animation: 'akvo-pulse-alert 0.7s ease-in-out infinite 0.2s' }} />
                        </>
                    )}
                    {motionArrow === 'down' && (
                        <>
                            <polygon points={`${PLATE_W / 2 - 6},${PLATE_H + 4} ${PLATE_W / 2 + 6},${PLATE_H + 4} ${PLATE_W / 2},${PLATE_H + 14}`}
                                fill={plateColor} opacity="0.8"
                                style={{ animation: 'akvo-pulse-alert 0.7s ease-in-out infinite' }} />
                            <polygon points={`${PLATE_W / 2 - 6},${PLATE_H + 16} ${PLATE_W / 2 + 6},${PLATE_H + 16} ${PLATE_W / 2},${PLATE_H + 26}`}
                                fill={plateColor} opacity="0.4"
                                style={{ animation: 'akvo-pulse-alert 0.7s ease-in-out infinite 0.2s' }} />
                        </>
                    )}

                    {/* Lifting cable indicators */}
                    <line x1="14" y1="0" x2="14" y2="-28"
                        stroke="rgb(100 116 139)" strokeWidth="1.5" strokeOpacity="0.55"
                        strokeDasharray={isMoving ? '4 3' : 'none'}
                        style={isMoving ? { animation: 'akvo-sparkle-flow 0.4s linear infinite' } : {}} />
                    <line x1={PLATE_W - 14} y1="0" x2={PLATE_W - 14} y2="-28"
                        stroke="rgb(100 116 139)" strokeWidth="1.5" strokeOpacity="0.55"
                        strokeDasharray={isMoving ? '4 3' : 'none'}
                        style={isMoving ? { animation: 'akvo-sparkle-flow 0.4s linear infinite 0.2s' } : {}} />
                </g>
            </g>

            {/* ── Depth callout: main floor readout ── */}
            {state.mainFloorPosition != null && (
                <g>
                    {/* leader line from left of plate to readout */}
                    <line
                        x1="24"
                        y1={mainY + PLATE_H / 2}
                        x2="8"
                        y2={mainY + PLATE_H / 2}
                        stroke="rgb(148 163 184)" strokeWidth="1" strokeOpacity="0.5"
                    />
                    <text
                        x="5"
                        y={mainY + PLATE_H / 2 + 3.5}
                        textAnchor="end"
                        fontSize="9"
                        fill={plateColor}
                        fontFamily="monospace"
                        fontWeight="bold"
                        style={{
                            transition: 'y 1.1s cubic-bezier(0.34, 1.18, 0.64, 1)',
                        }}
                    >
                        {state.mainFloorPosition.toFixed(2)}m
                    </text>
                </g>
            )}
        </svg>
    );
};

// ── Motor current gauge ────────────────────────────────────────────────────────
// Small horizontal live-fill gauge. Pure CSS transition on width.
const CurrentGauge = ({ label, value, maxA = 20 }: { label: string; value: number | null; maxA?: number }) => {
    const pct = value != null ? Math.min(100, (value / maxA) * 100) : 0;
    const isHigh = pct > 70;
    const isMed = pct > 40;
    const color = isHigh ? 'var(--accent-alert)' : isMed ? 'var(--accent-warn)' : 'var(--accent-plug)';
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wider font-bold text-gray-400">{label}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: value != null ? color : 'rgb(var(--text) / 0.35)' }}>
                    {value != null ? `${value.toFixed(1)} A` : '-- A'}
                </span>
            </div>
            <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--surface-control) / 0.6)' }}>
                <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                        width: `${pct}%`,
                        background: color,
                        transition: 'width 0.6s ease-out, background 0.4s ease',
                        boxShadow: pct > 10 ? `0 0 4px ${color}` : 'none',
                    }}
                />
            </div>
        </div>
    );
};

// ── Position readout chip (numeric + deck-relative bar) ───────────────────────
// Augments the cross-section with precise numbers. Kept from the original.
const PositionReadout = ({ label, value, unit, isMoving }: {
    label: string; value: number | null; unit: string; isMoving: boolean
}) => {
    const RANGE = 3;
    const pct = value == null ? 50 : Math.max(0, Math.min(100, ((value + RANGE) / (2 * RANGE)) * 100));
    const aboveDeck = value != null && value < 0;
    return (
        <div className="flex flex-col rounded-control p-2.5" style={{
            background: 'rgb(var(--surface-control) / 0.45)',
            border: '1px solid var(--tile-border)',
        }}>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
                {isMoving && <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--accent-warn)', animation: 'akvo-caret-blink 0.9s ease-in-out infinite' }}>moving</span>}
            </div>
            <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-white tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {value != null ? value.toFixed(2) : '--'}
                </span>
                <span className="text-xs text-gray-400 font-semibold">{unit}</span>
            </div>
            <span className="text-[9px] uppercase tracking-wider mt-0.5" style={{
                color: value == null
                    ? 'rgb(var(--text) / 0.35)'
                    : aboveDeck ? 'var(--accent-water)' : value > 0 ? 'var(--accent-warn)' : 'rgb(var(--text) / 0.6)'
            }}>
                {value == null ? 'no reading' : aboveDeck ? 'above deck' : value > 0 ? 'below deck' : 'at deck'}
            </span>
            <div className="relative mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--surface) / 0.8)' }}>
                <div className="absolute top-0 bottom-0 w-px bg-white/30" style={{ left: '50%' }} title="deck level" />
                <div className="absolute top-0 bottom-0 rounded-full" style={{
                    left: '50%',
                    width: `${Math.abs(pct - 50)}%`,
                    transform: pct < 50 ? 'translateX(-100%)' : undefined,
                    background: aboveDeck ? 'var(--accent-water)' : 'var(--accent-warn)',
                    transition: 'width 0.8s ease-out',
                }} />
            </div>
        </div>
    );
};

// ── Status chip (unchanged from original) ─────────────────────────────────────
const StatusChip = ({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'alert' | 'idle' }) => {
    const rgb = tone === 'ok' ? 'var(--accent-plug)' : tone === 'warn' ? 'var(--accent-warn)' : tone === 'alert' ? 'var(--accent-alert)' : 'var(--surface-control)';
    return (
        <div className="flex flex-col rounded-control px-2.5 py-1.5" style={{
            background: 'rgb(var(--surface-control) / 0.4)',
            border: `1px solid color-mix(in srgb, ${rgb} 35%, var(--tile-border))`,
        }}>
            <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">{label}</span>
            <span className="text-sm font-bold" style={{ color: tone === 'idle' ? 'rgb(var(--text) / 0.7)' : rgb }}>{value}</span>
        </div>
    );
};

const triState = (v: boolean | null, on: string, off: string): { value: string; tone: 'ok' | 'warn' | 'alert' | 'idle' } => {
    if (v === null) return { value: 'unknown', tone: 'idle' };
    return v ? { value: on, tone: 'ok' } : { value: off, tone: 'idle' };
};

// ── Faults panel (unchanged from original) ────────────────────────────────────
const FaultsPanel = ({ faults }: { faults: AkvoFault[] }) => {
    const active = faults.filter((f) => f.active);
    const sevColor = (s: AkvoFault['severity']) => s === 'safety' ? 'var(--accent-alert)' : s === 'fault' ? 'var(--accent-alert)' : s === 'problem' ? 'var(--accent-warn)' : 'var(--surface-control)';
    return (
        <div className="flex flex-col rounded-control p-3 min-h-0" style={{
            background: 'rgb(var(--surface-control) / 0.4)',
            border: `1px solid ${active.length ? 'color-mix(in srgb, var(--accent-alert) 45%, var(--tile-border))' : 'var(--tile-border)'}`,
        }}>
            <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-300">
                    {active.length
                        ? <IconAlertOctagon className="w-4 h-4" style={{ color: 'var(--accent-alert)' }} />
                        : <IconCheckCircle className="w-4 h-4" style={{ color: 'var(--accent-plug)' }} />}
                    Faults
                </span>
                <span className="text-xs font-bold" style={{ color: active.length ? 'var(--accent-alert)' : 'var(--accent-plug)' }}>
                    {active.length ? `${active.length} active` : 'all clear'}
                </span>
            </div>
            {active.length === 0 ? (
                <span className="text-xs text-gray-400">No active faults reported by the controller.</span>
            ) : (
                <div className="flex flex-col gap-1 overflow-y-auto">
                    {active.map((f) => (
                        <div key={f.entityId} className="flex items-center gap-2 rounded px-2 py-1"
                            style={{ background: `color-mix(in srgb, ${sevColor(f.severity)} 14%, transparent)` }}>
                            <span className="w-2 h-2 rounded-full shrink-0"
                                style={{
                                    background: sevColor(f.severity),
                                    animation: f.severity === 'safety' ? 'akvo-pulse-alert 0.8s ease-in-out infinite' : 'none',
                                }} />
                            <span className="text-xs font-medium text-white truncate">{f.label}</span>
                            <span className="ml-auto text-[9px] uppercase tracking-wider font-bold"
                                style={{ color: sevColor(f.severity) }}>{f.severity}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ── Press-and-hold request button ──────────────────────────────────────────────
// SAFETY: This component, its HOLD_MS constant, the progress ring logic, the
// onComplete callback, the disabled/requesting gates, and the pointer-event
// handlers are BYTE-FOR-BYTE identical to the original implementation.
// Only the visual styling of the progress fill and label has been updated.
const HoldToRequest = ({
    preset, disabled, requesting, onComplete,
}: {
    preset: string; disabled: boolean; requesting: boolean; onComplete: () => void;
}) => {
    const [progress, setProgress] = useState(0);
    const rafRef = useRef<number | null>(null);
    const startRef = useRef<number>(0);

    const stop = () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        setProgress(0);
    };
    useEffect(() => stop, []);

    const tick = () => {
        const elapsed = Date.now() - startRef.current;
        const p = Math.min(1, elapsed / HOLD_MS);
        setProgress(p);
        if (p >= 1) {
            stop();
            onComplete();
            return;
        }
        rafRef.current = requestAnimationFrame(tick);
    };

    const begin = (e: React.PointerEvent) => {
        if (disabled || requesting) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        startRef.current = Date.now();
        rafRef.current = requestAnimationFrame(tick);
    };

    return (
        <button
            type="button"
            disabled={disabled || requesting}
            onPointerDown={begin}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            className="relative flex flex-col items-center justify-center gap-1 rounded-control py-3 px-3 font-bold text-white select-none touch-none overflow-hidden active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
                background: 'rgb(var(--surface-control))',
                border: `1px solid ${disabled ? 'var(--tile-border)' : 'color-mix(in srgb, var(--accent-warn) 50%, var(--tile-border))'}`,
                minHeight: '3.75rem',
            }}
            title={disabled ? 'AKVO not ready' : `Hold to request ${preset}`}
        >
            {/* hold progress fill */}
            <div className="absolute inset-0 origin-left pointer-events-none" style={{
                transform: `scaleX(${progress})`,
                background: 'color-mix(in srgb, var(--accent-warn) 30%, transparent)',
                transition: progress === 0 ? 'transform 120ms ease-out' : 'none',
            }} />
            <span className="relative z-10 flex items-center gap-1.5 text-sm">
                {requesting ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconHand className="w-4 h-4" />}
                {preset}
            </span>
            <span className="relative z-10 text-[9px] uppercase tracking-wider text-gray-300">
                {requesting ? 'Requesting…' : disabled ? 'unavailable' : progress > 0 ? 'keep holding…' : 'hold to request'}
            </span>
        </button>
    );
};

// ── The surface ────────────────────────────────────────────────────────────────
const AkvoFloorSurface = (_props: TileProps) => {
    // Inject CSS animations into the document once on first render.
    useMemo(() => ensureAnims(), []);

    const { state, gate, status, requestingPreset, requestConfiguration } = useAkvoFloor();
    const overall = overallStatus(state);
    const isMoving = state.floorsMoving === true;
    const isFault = state.emergencyStop === true || state.systemFault === true;

    if (!state.present) {
        return (
            <div className="flex flex-col h-full w-full rounded-tile overflow-hidden bg-gray-700/60 items-center justify-center text-center gap-3 p-6" style={{ border: '1px solid var(--tile-border)' }}>
                <IconWaves className="w-12 h-12 opacity-30" />
                <p className="text-sm text-gray-400 max-w-xs">
                    {status === 'connecting'
                        ? 'Connecting to Home Assistant…'
                        : 'AKVO Movable Floor entities not found. The surface appears automatically once the akvo integration is loaded.'}
                </p>
            </div>
        );
    }

    const ready = state.readyForExternalCommands;

    return (
        <div className="flex flex-col h-full w-full rounded-tile overflow-hidden"
            style={{
                background: 'rgb(var(--surface) / 1)',
                border: '1px solid var(--tile-border)',
            }}>
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ borderBottom: '1px solid var(--tile-border)' }}>
                <div className="flex items-center gap-2.5">
                    <IconWaves className="w-6 h-6" style={{ color: 'var(--accent-water)' }} />
                    <div className="flex flex-col leading-tight">
                        <h2 className="font-bold text-white text-lg">AKVO Movable Floor</h2>
                        <span className="text-xs text-gray-400">Monitor &amp; configuration request</span>
                    </div>
                </div>
                <StatusPill status={status} />
            </div>

            {/* ── Overall status banner ── */}
            <div className="px-4 pt-3 shrink-0">
                <div className="flex items-center gap-3 rounded-control px-4 py-3" style={{
                    background: `color-mix(in srgb, ${overall.rgb} 16%, rgb(var(--surface) / 0.6))`,
                    border: `1px solid color-mix(in srgb, ${overall.rgb} 55%, transparent)`,
                    animation: isFault ? 'akvo-pulse-alert 1s ease-in-out infinite' : 'none',
                }}>
                    <overall.Icon
                        className="w-7 h-7"
                        style={{
                            color: overall.rgb,
                            animation: isMoving ? 'akvo-pulse-alert 0.8s ease-in-out infinite' : 'none',
                        }}
                    />
                    <div className="flex flex-col">
                        <span className="text-xl font-extrabold tracking-wide" style={{ color: overall.rgb }}>
                            {overall.label}
                        </span>
                        <span className="text-xs text-gray-300">
                            Active configuration: <span className="font-semibold text-white">{state.activeConfiguration ?? '—'}</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Body ── responsive: monitor stacks above command on mobile, side-by-side on wide */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>

                    {/* ══ MONITOR (primary) ══ */}
                    <div className="flex flex-col gap-3">

                        {/* ── Cross-section visualization ── */}
                        <div className="relative flex flex-col rounded-control overflow-hidden"
                            style={{
                                background: 'rgb(var(--surface-control) / 0.3)',
                                border: `1px solid color-mix(in srgb, var(--accent-water) 25%, var(--tile-border))`,
                            }}>
                            {/* Section label */}
                            <div className="flex items-center justify-between px-3 pt-2.5 pb-1 shrink-0">
                                <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
                                    Cross-section · Elevation view
                                </span>
                                {isMoving && (
                                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                                        style={{ color: 'var(--accent-warn)' }}>
                                        <IconMoveVertical className="w-3 h-3" />
                                        In motion
                                    </span>
                                )}
                            </div>
                            {/* SVG cross-section centered */}
                            <div className="flex justify-center py-2">
                                <CrossSection state={state} isMoving={isMoving} />
                            </div>
                            {/* Position readouts inline below SVG */}
                            <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                                <PositionReadout
                                    label="Main Floor"
                                    value={state.mainFloorPosition}
                                    unit={state.positionUnit}
                                    isMoving={isMoving}
                                />
                                <PositionReadout
                                    label="Baja"
                                    value={state.bajaPosition}
                                    unit={state.positionUnit}
                                    isMoving={false}
                                />
                            </div>
                        </div>

                        {/* ── Motor current gauges ── */}
                        <div className="flex flex-col gap-2 rounded-control px-3 py-2.5"
                            style={{
                                background: 'rgb(var(--surface-control) / 0.35)',
                                border: '1px solid var(--tile-border)',
                            }}>
                            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-0.5">
                                Motor currents
                            </span>
                            <CurrentGauge label="Main floor motor" value={state.mainFloorMotorCurrent} />
                            <CurrentGauge label="Baja motor" value={state.bajaMotorCurrent} />
                        </div>

                        {/* ── Status chips ── */}
                        <div className="grid grid-cols-3 gap-2">
                            <StatusChip label="Motion"
                                {...(isMoving
                                    ? { value: 'Moving', tone: 'warn' as const }
                                    : state.floorsMoving === false
                                        ? { value: 'Stopped', tone: 'ok' as const }
                                        : { value: 'unknown', tone: 'idle' as const }
                                )} />
                            <StatusChip label="System"
                                {...(state.systemFault === true
                                    ? { value: 'Fault', tone: 'alert' as const }
                                    : triState(state.systemReady, 'Ready', 'Not ready')
                                )} />
                            <StatusChip label="E-Stop"
                                {...(state.emergencyStop === true
                                    ? { value: 'ACTIVE', tone: 'alert' as const }
                                    : state.emergencyStop === false
                                        ? { value: 'Clear', tone: 'ok' as const }
                                        : { value: 'unknown', tone: 'idle' as const }
                                )} />
                            <StatusChip label="Comms"
                                {...(state.badModbusComm === true
                                    ? { value: 'Fault', tone: 'alert' as const }
                                    : state.badModbusComm === false
                                        ? { value: 'OK', tone: 'ok' as const }
                                        : { value: 'unknown', tone: 'idle' as const }
                                )} />
                            <StatusChip label="Main A"
                                value={state.mainFloorMotorCurrent != null ? `${state.mainFloorMotorCurrent.toFixed(1)} A` : '-- A'}
                                tone="idle" />
                            <StatusChip label="Baja A"
                                value={state.bajaMotorCurrent != null ? `${state.bajaMotorCurrent.toFixed(1)} A` : '-- A'}
                                tone="idle" />
                        </div>

                        <FaultsPanel faults={state.faults} />
                    </div>

                    {/* ══ COMMAND (secondary, guarded) ══ */}
                    <div className="flex flex-col gap-3">
                        {/* Safety framing banner — UNCHANGED in behavior */}
                        <div className="flex items-start gap-2 rounded-control px-3 py-2.5"
                            style={{ background: 'rgb(var(--surface-control) / 0.4)', border: '1px solid var(--tile-border)' }}>
                            <IconShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent-warn)' }} />
                            <p className="text-xs text-gray-300 leading-snug">
                                <span className="font-bold text-white">AKVO is the safety authority.</span> These are <span className="font-semibold">requests</span> — the controller validates each one and moves the floor only if safe. B-Panels never commands motion directly.
                            </p>
                        </div>

                        {/* Gate reason when blocked — UNCHANGED in behavior */}
                        {!gate.enabled && (
                            <div className="flex items-center gap-2 rounded-control px-3 py-2"
                                style={{
                                    background: 'color-mix(in srgb, var(--accent-alert) 12%, transparent)',
                                    border: '1px solid color-mix(in srgb, var(--accent-alert) 35%, transparent)',
                                }}>
                                <IconAlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-alert)' }} />
                                <span className="text-xs font-semibold" style={{ color: 'var(--accent-alert)' }}>
                                    Requests disabled — {gate.reason}
                                </span>
                            </div>
                        )}

                        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                            <IconLayers className="w-4 h-4" /> Configuration presets
                        </div>

                        {state.requestSelect && state.requestSelect.options.length > 0 ? (
                            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' }}>
                                {state.requestSelect.options.map((preset) => {
                                    const isActiveCfg = state.activeConfiguration === preset;
                                    const isRequesting = requestingPreset === preset;
                                    return (
                                        <div key={preset} className="flex flex-col gap-0.5">
                                            <HoldToRequest
                                                preset={preset}
                                                disabled={!gate.enabled || isActiveCfg}
                                                requesting={isRequesting}
                                                onComplete={() => { void requestConfiguration(preset); }}
                                            />
                                            {isActiveCfg && (
                                                <span className="text-[9px] text-center uppercase tracking-wider"
                                                    style={{ color: 'var(--accent-plug)' }}>current</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <span className="text-xs text-gray-400">No configuration presets available.</span>
                        )}

                        {/* Live request/motion feedback — UNCHANGED in behavior */}
                        {(requestingPreset || isMoving) && (
                            <div className="flex items-center gap-2 rounded-control px-3 py-2"
                                style={{
                                    background: 'color-mix(in srgb, var(--accent-warn) 14%, transparent)',
                                    border: '1px solid color-mix(in srgb, var(--accent-warn) 40%, transparent)',
                                }}>
                                <IconLoader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-warn)' }} />
                                <span className="text-xs font-semibold" style={{ color: 'var(--accent-warn)' }}>
                                    {isMoving
                                        ? `Moving${state.activeConfiguration ? ` → ${state.activeConfiguration}` : ''}…`
                                        : `Requesting ${requestingPreset}… (AKVO validating)`}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AkvoFloorSurface;
