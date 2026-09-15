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
// SAFETY (READ-ONLY): evaluateGate, press-and-hold confirm (HOLD_MS = 2000),
// requestConfiguration, and the single select.select_option write are
// BYTE-FOR-BYTE identical to the original implementation. The HoldToRequest
// component, its RAF-based progress ring logic, disabled/requesting gates, and
// all pointer-event handlers are UNCHANGED in behavior. Only the visual layer
// (glass material, tokens, layout) has been updated.
//
// VISUAL: Liquid Glass / Apple design system.

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

// ── Accent shorthand ───────────────────────────────────────────────────────────
const WATER = 'var(--accent-water)';

// ── CSS animation keyframes injected once ─────────────────────────────────────
// Avoids a build-time CSS import; keeps the component self-contained.
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

// ── Glass section card (replaces plain rounded-control divs) ──────────────────
const GlassSection = ({
    children,
    style: extra,
    accentVar: accent,
    active,
}: {
    children: React.ReactNode;
    style?: React.CSSProperties;
    accentVar?: string;
    active?: boolean;
}) => (
    <div
        style={{
            borderRadius: 'var(--radius-control)',
            backdropFilter:       'var(--glass-l2-backdrop)',
            WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
            backgroundColor: active && accent
                ? `color-mix(in srgb, ${accent} 14%, var(--glass-l2-bg))`
                : 'var(--glass-l2-bg)',
            backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
            border: `1px solid ${active && accent
                ? `color-mix(in srgb, ${accent} 40%, var(--glass-l2-border))`
                : 'var(--glass-l2-border)'}`,
            boxShadow: active && accent
                ? `var(--rim), inset 0 0 22px -6px color-mix(in srgb, ${accent} 28%, transparent), var(--elev-2)`
                : 'var(--rim), var(--elev-1)',
            transition: 'background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
            ...extra,
        }}
    >
        {children}
    </div>
);

// ── Connection status pill ─────────────────────────────────────────────────────
const StatusPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
    if (status === 'live') {
        return (
            <span
                className="flex items-center gap-1.5"
                style={{
                    fontSize: 'var(--type-xs)',
                    fontWeight: 700,
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase' as const,
                    color: 'rgb(52 211 153)',
                }}
            >
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
            <span
                className="flex items-center gap-1.5"
                style={{
                    fontSize: 'var(--type-xs)',
                    fontWeight: 600,
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase' as const,
                    color: 'rgba(var(--text) / 0.4)',
                }}
            >
                <IconLoader2 className="w-3.5 h-3.5 animate-spin" /> Connecting
            </span>
        );
    }
    return (
        <span
            className="flex items-center gap-1.5"
            style={{
                fontSize: 'var(--type-xs)',
                fontWeight: 700,
                letterSpacing: 'var(--tracking-caps)',
                textTransform: 'uppercase' as const,
                color: 'var(--accent-warn)',
            }}
        >
            <IconWifiOff style={{ width: 12, height: 12 }} /> Stale — reconnecting
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
const DECK_Y = 80;
const PX_PER_M = 44;
const PLATE_H = 10;
const PLATE_W = 140;
const BAJA_W = 90;
const BAJA_H = 7;

function positionToPx(m: number | null): number {
    const val = m ?? 0;
    return DECK_Y + val * PX_PER_M;
}

interface CrossSectionProps {
    state: AkvoState;
    isMoving: boolean;
}

// The CrossSection SVG is UNCHANGED in structure and animation logic.
// Glass context is expressed by the surrounding GlassSection wrapper.
const CrossSection: React.FC<CrossSectionProps> = ({ state, isMoving }) => {
    const { plate: plateColor, glow: glowColor } = floorColor(state);
    const isFault = state.emergencyStop === true || state.systemFault === true;

    const mainY = positionToPx(state.mainFloorPosition);
    const bajaY = state.bajaPosition != null ? positionToPx(state.bajaPosition) : null;

    const waterFillY = DECK_Y;
    const waterFillH = SVG_H - DECK_Y;

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
                {/* Water gradient — brighter/more luminous inside glass context */}
                <linearGradient id="akvo-water-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="rgb(14 116 144)" stopOpacity="0.80" />
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
                        stroke="rgb(186 230 253)" strokeWidth="1.5" strokeOpacity="0.55" />
                </pattern>
            </defs>

            {/* Sky / above-deck region */}
            <rect x="0" y="0" width={SVG_W} height={DECK_Y} fill="rgb(var(--bg) / 0.0)" />

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

            {/* Deck cap / coping */}
            <rect x="12" y={DECK_Y - 8} width={SVG_W - 24} height="8"
                fill="rgb(100 116 139)" rx="2" />
            {/* Deck label */}
            <text x={SVG_W / 2} y={DECK_Y - 12} textAnchor="middle"
                fontSize="9" fill="rgba(var(--text) / 0.4)" fontFamily="monospace" letterSpacing="1.5">
                DECK  0.00 m
            </text>
            {/* Dashed deck reference line */}
            <line x1="28" y1={DECK_Y} x2={SVG_W - 28} y2={DECK_Y}
                stroke="rgba(var(--text) / 0.3)" strokeWidth="1" strokeDasharray="4 3" />

            {/* Depth ruler on right edge */}
            {[-1, 0, 1, 2].map((m) => {
                const y = DECK_Y + m * PX_PER_M;
                if (y < 2 || y > SVG_H - 4) return null;
                return (
                    <g key={m}>
                        <line x1={SVG_W - 18} y1={y} x2={SVG_W - 12} y2={y}
                            stroke="rgba(var(--text) / 0.25)" strokeWidth="1" />
                        <text x={SVG_W - 10} y={y + 3.5} fontSize="8"
                            fill="rgba(var(--text) / 0.35)" fontFamily="monospace">
                            {m >= 0 ? `+${m}m` : `${m}m`}
                        </text>
                    </g>
                );
            })}

            {/* Baja shelf (secondary floor), if present */}
            {bajaY != null && (
                <g style={{
                    transition: 'transform 0.9s cubic-bezier(0.34, 1.18, 0.64, 1)',
                    transform: `translateY(${bajaY - DECK_Y}px)`,
                }}>
                    <g transform={`translate(${SVG_W / 2 - BAJA_W / 2}, ${DECK_Y})`}>
                        <line x1="0" y1="0" x2="0" y2={BAJA_H + 4}
                            stroke="rgb(100 116 139)" strokeWidth="2" strokeOpacity="0.6" />
                        <line x1={BAJA_W} y1="0" x2={BAJA_W} y2={BAJA_H + 4}
                            stroke="rgb(100 116 139)" strokeWidth="2" strokeOpacity="0.6" />
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

            {/* Main floor plate — the hero element.
                Smooth vertical transition; uses inline style so it reacts to real position data. */}
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

            {/* Depth callout: main floor readout */}
            {state.mainFloorPosition != null && (
                <g>
                    <line
                        x1="24"
                        y1={mainY + PLATE_H / 2}
                        x2="8"
                        y2={mainY + PLATE_H / 2}
                        stroke="rgba(var(--text) / 0.3)" strokeWidth="1"
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

// ── Motor current gauge (glass BuildBar variant) ───────────────────────────────
// Pure CSS transition on width — UNCHANGED in behavior, glass in look.
const CurrentGauge = ({ label, value, maxA = 20 }: { label: string; value: number | null; maxA?: number }) => {
    const pct = value != null ? Math.min(100, (value / maxA) * 100) : 0;
    const isHigh = pct > 70;
    const isMed = pct > 40;
    const color = isHigh ? 'var(--accent-alert)' : isMed ? 'var(--accent-warn)' : 'var(--accent-plug)';
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span
                    style={{
                        fontSize: 'var(--type-2xs)',
                        letterSpacing: 'var(--tracking-caps)',
                        textTransform: 'uppercase' as const,
                        fontWeight: 700,
                        color: 'rgba(var(--text) / 0.45)',
                    }}
                >
                    {label}
                </span>
                <span
                    style={{
                        fontSize: 'var(--type-xs)',
                        fontWeight: 700,
                        fontFamily: 'var(--font-numeric)',
                        color: value != null ? color : 'rgba(var(--text) / 0.25)',
                    }}
                >
                    {value != null ? `${value.toFixed(1)} A` : '-- A'}
                </span>
            </div>
            <div
                className="relative h-1.5 rounded-full overflow-hidden"
                style={{
                    backdropFilter:       'var(--glass-l3-backdrop)',
                    WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                    backgroundColor: 'var(--glass-l3-bg)',
                    border: '1px solid var(--glass-l3-border)',
                }}
            >
                <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                        width: `${pct}%`,
                        background: color,
                        transition: 'width 0.6s var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), background 0.4s ease',
                        boxShadow: pct > 10 ? `0 0 5px 1px ${color}` : 'none',
                    }}
                />
            </div>
        </div>
    );
};

// ── Position readout chip (numeric + deck-relative bar) ───────────────────────
// UNCHANGED in behavior — glass in visual.
const PositionReadout = ({ label, value, unit, isMoving }: {
    label: string; value: number | null; unit: string; isMoving: boolean
}) => {
    const RANGE = 3;
    const pct = value == null ? 50 : Math.max(0, Math.min(100, ((value + RANGE) / (2 * RANGE)) * 100));
    const aboveDeck = value != null && value < 0;
    return (
        <div
            className="flex flex-col"
            style={{
                borderRadius: 'var(--radius-control)',
                padding: 'clamp(0.4rem, 2cqmin, 0.6rem)',
                backdropFilter:       'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: 'var(--glass-l3-bg)',
                backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                border: '1px solid var(--glass-l3-border)',
                boxShadow: 'var(--rim), var(--elev-1)',
            }}
        >
            <div className="flex items-center justify-between mb-1">
                <span
                    style={{
                        fontSize: 'var(--type-2xs)',
                        fontWeight: 700,
                        letterSpacing: 'var(--tracking-caps)',
                        textTransform: 'uppercase' as const,
                        color: 'rgba(var(--text) / 0.45)',
                    }}
                >
                    {label}
                </span>
                {isMoving && (
                    <span
                        style={{
                            fontSize: 'var(--type-2xs)',
                            letterSpacing: 'var(--tracking-caps)',
                            textTransform: 'uppercase' as const,
                            fontWeight: 700,
                            color: 'var(--accent-warn)',
                            animation: 'akvo-caret-blink 0.9s ease-in-out infinite',
                        }}
                    >
                        moving
                    </span>
                )}
            </div>
            <div className="flex items-baseline gap-1">
                <span
                    style={{
                        fontSize: 'clamp(1.1rem, 6cqmin, 1.5rem)',
                        fontWeight: 700,
                        fontFamily: 'var(--font-numeric)',
                        color: 'rgb(var(--text))',
                        fontVariantNumeric: 'tabular-nums' as const,
                    }}
                >
                    {value != null ? value.toFixed(2) : '--'}
                </span>
                <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)', fontWeight: 600 }}>{unit}</span>
            </div>
            <span
                style={{
                    fontSize: 'var(--type-2xs)',
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase' as const,
                    marginTop: 2,
                    color: value == null
                        ? 'rgba(var(--text) / 0.25)'
                        : aboveDeck ? WATER : value > 0 ? 'var(--accent-warn)' : 'rgba(var(--text) / 0.5)',
                }}
            >
                {value == null ? 'no reading' : aboveDeck ? 'above deck' : value > 0 ? 'below deck' : 'at deck'}
            </span>
            {/* Depth bar */}
            <div
                className="relative mt-1.5 h-1.5 rounded-full overflow-hidden"
                style={{
                    backdropFilter: 'var(--glass-l3-backdrop)',
                    WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                    backgroundColor: 'var(--glass-l3-bg)',
                    border: '1px solid var(--glass-l3-border)',
                }}
            >
                <div className="absolute top-0 bottom-0 w-px" style={{ left: '50%', background: 'rgba(var(--text) / 0.2)' }} title="deck level" />
                <div className="absolute top-0 bottom-0 rounded-full" style={{
                    left: '50%',
                    width: `${Math.abs(pct - 50)}%`,
                    transform: pct < 50 ? 'translateX(-100%)' : undefined,
                    background: aboveDeck ? WATER : 'var(--accent-warn)',
                    transition: 'width 0.8s var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
                    boxShadow: `0 0 4px 1px ${aboveDeck ? WATER : 'var(--accent-warn)'}`,
                }} />
            </div>
        </div>
    );
};

// ── Status chip (glass variant) ────────────────────────────────────────────────
const StatusChip = ({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'alert' | 'idle' }) => {
    const rgb = tone === 'ok'
        ? 'var(--accent-plug)'
        : tone === 'warn'
            ? 'var(--accent-warn)'
            : tone === 'alert'
                ? 'var(--accent-alert)'
                : 'rgba(var(--text) / 0.3)';
    const active = tone !== 'idle';
    return (
        <div
            className="flex flex-col"
            style={{
                borderRadius: 'var(--radius-control)',
                padding: 'clamp(0.3rem, 1.5cqmin, 0.5rem) clamp(0.4rem, 2cqmin, 0.65rem)',
                backdropFilter:       'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: active
                    ? `color-mix(in srgb, ${rgb} 14%, var(--glass-l3-bg))`
                    : 'var(--glass-l3-bg)',
                backgroundImage: 'var(--specular-default), var(--glass-l3-tint)',
                border: `1px solid ${active
                    ? `color-mix(in srgb, ${rgb} 38%, var(--glass-l3-border))`
                    : 'var(--glass-l3-border)'}`,
                boxShadow: active
                    ? `var(--rim), inset 0 0 12px -4px color-mix(in srgb, ${rgb} 22%, transparent), 0 0 8px -2px color-mix(in srgb, ${rgb} 28%, transparent)`
                    : 'var(--rim)',
                transition: 'background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))',
            }}
        >
            <span
                style={{
                    fontSize: 'var(--type-2xs)',
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase' as const,
                    fontWeight: 700,
                    color: 'rgba(var(--text) / 0.4)',
                }}
            >
                {label}
            </span>
            <span
                style={{
                    fontSize: 'var(--type-sm)',
                    fontWeight: 700,
                    color: tone === 'idle' ? 'rgba(var(--text) / 0.65)' : rgb,
                    transition: 'color var(--dur-medium, 260ms) ease',
                }}
            >
                {value}
            </span>
        </div>
    );
};

const triState = (v: boolean | null, on: string, off: string): { value: string; tone: 'ok' | 'warn' | 'alert' | 'idle' } => {
    if (v === null) return { value: 'unknown', tone: 'idle' };
    return v ? { value: on, tone: 'ok' } : { value: off, tone: 'idle' };
};

// ── Faults panel (glass card) ──────────────────────────────────────────────────
const FaultsPanel = ({ faults }: { faults: AkvoFault[] }) => {
    const active = faults.filter((f) => f.active);
    const sevColor = (s: AkvoFault['severity']) =>
        s === 'safety' ? 'var(--accent-alert)'
        : s === 'fault' ? 'var(--accent-alert)'
        : s === 'problem' ? 'var(--accent-warn)'
        : 'rgba(var(--text) / 0.3)';

    return (
        <GlassSection
            active={active.length > 0}
            accentVar={active.length > 0 ? 'var(--accent-alert)' : undefined}
            style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 0 }}
        >
            <div className="flex items-center justify-between shrink-0">
                <span
                    className="flex items-center gap-1.5"
                    style={{
                        fontSize: 'var(--type-xs)',
                        fontWeight: 700,
                        letterSpacing: 'var(--tracking-caps)',
                        textTransform: 'uppercase' as const,
                        color: 'rgba(var(--text) / 0.6)',
                    }}
                >
                    {active.length
                        ? <IconAlertOctagon className="w-4 h-4" style={{ color: 'var(--accent-alert)' }} />
                        : <IconCheckCircle className="w-4 h-4" style={{ color: 'var(--accent-plug)' }} />}
                    Faults
                </span>
                <span
                    style={{
                        fontSize: 'var(--type-xs)',
                        fontWeight: 700,
                        color: active.length ? 'var(--accent-alert)' : 'var(--accent-plug)',
                    }}
                >
                    {active.length ? `${active.length} active` : 'all clear'}
                </span>
            </div>
            {active.length === 0 ? (
                <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.4)' }}>
                    No active faults reported by the controller.
                </span>
            ) : (
                <div className="flex flex-col gap-1 overflow-y-auto">
                    {active.map((f) => (
                        <div
                            key={f.entityId}
                            className="flex items-center gap-2 rounded"
                            style={{
                                padding: 'clamp(0.2rem, 1cqmin, 0.3rem) clamp(0.4rem, 2cqmin, 0.6rem)',
                                background: `color-mix(in srgb, ${sevColor(f.severity)} 12%, transparent)`,
                                border: `1px solid color-mix(in srgb, ${sevColor(f.severity)} 20%, transparent)`,
                                borderRadius: 'var(--radius-chip)',
                            }}
                        >
                            <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{
                                    background: sevColor(f.severity),
                                    boxShadow: `0 0 4px 1px ${sevColor(f.severity)}`,
                                    animation: f.severity === 'safety' ? 'akvo-pulse-alert 0.8s ease-in-out infinite' : 'none',
                                }}
                            />
                            <span style={{ fontSize: 'var(--type-xs)', fontWeight: 500, color: 'rgb(var(--text))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {f.label}
                            </span>
                            <span
                                className="ml-auto"
                                style={{
                                    fontSize: 'var(--type-2xs)',
                                    letterSpacing: 'var(--tracking-caps)',
                                    textTransform: 'uppercase' as const,
                                    fontWeight: 700,
                                    color: sevColor(f.severity),
                                    flexShrink: 0,
                                }}
                            >
                                {f.severity}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </GlassSection>
    );
};

// ── Press-and-hold request button ──────────────────────────────────────────────
// SAFETY: This component, HOLD_MS, the RAF progress ring, onComplete callback,
// disabled/requesting gates, and all pointer-event handlers are BYTE-FOR-BYTE
// identical to the original implementation. Only the glass visual styling of
// the progress fill, button frame, and label has been updated.
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
            className="relative flex flex-col items-center justify-center gap-1 select-none touch-none overflow-hidden active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
                borderRadius: 'var(--radius-control)',
                padding: 'clamp(0.5rem, 2.5cqmin, 0.75rem) clamp(0.5rem, 3cqmin, 0.85rem)',
                minHeight: '3.75rem',
                fontWeight: 700,
                color: 'rgb(var(--text))',
                // Glass l3 button material, tinted by warn when not disabled
                backdropFilter:       'var(--glass-l3-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l3-backdrop)',
                backgroundColor: !disabled
                    ? `color-mix(in srgb, var(--accent-warn) 14%, var(--glass-l3-bg))`
                    : 'var(--glass-l3-bg)',
                backgroundImage: 'var(--sheen-default), var(--specular-strong), var(--glass-l3-tint)',
                border: `1px solid ${!disabled
                    ? `color-mix(in srgb, var(--accent-warn) 40%, var(--glass-l3-border))`
                    : 'var(--glass-l3-border)'}`,
                boxShadow: !disabled
                    ? `var(--rim), inset 0 0 16px -4px color-mix(in srgb, var(--accent-warn) 26%, transparent), 0 0 12px -3px color-mix(in srgb, var(--accent-warn) 32%, transparent)`
                    : 'var(--rim)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), box-shadow var(--dur-medium, 260ms) ease`,
            }}
            title={disabled ? 'AKVO not ready' : `Hold to request ${preset}`}
        >
            {/* hold progress fill — pure overlay */}
            <div
                className="absolute inset-0 origin-left pointer-events-none"
                style={{
                    transform: `scaleX(${progress})`,
                    background: 'color-mix(in srgb, var(--accent-warn) 34%, transparent)',
                    transition: progress === 0 ? 'transform 120ms ease-out' : 'none',
                    borderRadius: 'inherit',
                }}
            />
            <span className="relative z-10 flex items-center gap-1.5" style={{ fontSize: 'var(--type-sm)' }}>
                {requesting
                    ? <IconLoader2 className="w-4 h-4 animate-spin" />
                    : <IconHand className="w-4 h-4" />}
                {preset}
            </span>
            <span
                className="relative z-10"
                style={{
                    fontSize: 'var(--type-2xs)',
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase' as const,
                    color: 'rgba(var(--text) / 0.5)',
                }}
            >
                {requesting ? 'Requesting…' : disabled ? 'unavailable' : progress > 0 ? 'keep holding…' : 'hold to request'}
            </span>
        </button>
    );
};

// ── The surface ────────────────────────────────────────────────────────────────
const AkvoFloorSurface = (_props: TileProps) => {
    useMemo(() => ensureAnims(), []);

    const { state, gate, status, requestingPreset, requestConfiguration } = useAkvoFloor();
    const overall = overallStatus(state);
    const isMoving = state.floorsMoving === true;
    const isFault = state.emergencyStop === true || state.systemFault === true;

    // ── Absent state ──────────────────────────────────────────────────────────
    if (!state.present) {
        return (
            <div
                className="flex flex-col h-full w-full items-center justify-center text-center gap-3 p-6"
                style={{
                    borderRadius: 'var(--radius-surface)',
                    overflow: 'hidden',
                    backdropFilter:       'var(--glass-l1-backdrop)',
                    WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
                    backgroundColor: 'var(--glass-l1-bg)',
                    backgroundImage: 'var(--specular-default), var(--glass-l1-tint)',
                    border: '1px solid var(--glass-l1-border)',
                    boxShadow: 'var(--rim), var(--elev-4)',
                    animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
                }}
            >
                <div
                    style={{
                        width: 56, height: 56,
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
                <p style={{ fontSize: 'var(--type-sm)', color: 'rgba(var(--text) / 0.40)', maxWidth: '22rem', lineHeight: 1.55 }}>
                    {status === 'connecting'
                        ? 'Connecting to Home Assistant…'
                        : 'AKVO Movable Floor entities not found. The surface appears automatically once the akvo integration is loaded.'}
                </p>
            </div>
        );
    }

    const ready = state.readyForExternalCommands;

    // ── Main surface ──────────────────────────────────────────────────────────
    return (
        <div
            className="flex flex-col h-full w-full"
            style={{
                borderRadius: 'var(--radius-surface)',
                overflow: 'hidden',
                // Level-1 base glass — active tint based on system state
                backdropFilter:       'var(--glass-l1-backdrop)',
                WebkitBackdropFilter: 'var(--glass-l1-backdrop)',
                backgroundColor: isFault
                    ? `color-mix(in srgb, var(--accent-alert) 12%, var(--glass-l1-bg))`
                    : isMoving
                        ? `color-mix(in srgb, var(--accent-warn) 10%, var(--glass-l1-bg))`
                        : 'var(--glass-l1-bg)',
                backgroundImage: 'var(--sheen-default), var(--specular-default), var(--glass-l1-tint)',
                border: `1px solid ${isFault
                    ? `color-mix(in srgb, var(--accent-alert) 40%, var(--glass-l1-border))`
                    : isMoving
                        ? `color-mix(in srgb, var(--accent-warn) 28%, var(--glass-l1-border))`
                        : 'var(--glass-l1-border)'}`,
                boxShadow: isFault
                    ? `var(--rim), inset 0 0 40px -10px color-mix(in srgb, var(--accent-alert) 22%, transparent), var(--elev-4)`
                    : isMoving
                        ? `var(--rim), inset 0 0 34px -10px color-mix(in srgb, var(--accent-warn) 18%, transparent), var(--elev-4)`
                        : 'var(--rim), var(--elev-4)',
                animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
                transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), box-shadow var(--dur-medium, 260ms) ease`,
            }}
        >
            {/* ── Header ── */}
            <div
                className="flex items-center justify-between shrink-0"
                style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: '1px solid var(--glass-l1-border)',
                    backdropFilter:       'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    backgroundColor: 'var(--glass-l1-tint)',
                }}
            >
                <div className="flex items-center gap-3">
                    {/* Icon bead */}
                    <div
                        style={{
                            width: 36, height: 36,
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
                        <IconWaves style={{ width: 18, height: 18, color: WATER }} />
                    </div>
                    <div className="flex flex-col" style={{ gap: 1 }}>
                        <h2
                            style={{
                                margin: 0,
                                fontFamily: 'var(--font-display)',
                                fontSize: 'var(--type-lg)',
                                fontWeight: 700,
                                letterSpacing: 'var(--tracking-tight)',
                                color: 'rgb(var(--text))',
                                lineHeight: 1.2,
                            }}
                        >
                            AKVO Movable Floor
                        </h2>
                        <span
                            style={{
                                fontSize: 'var(--type-xs)',
                                fontWeight: 500,
                                letterSpacing: 'var(--tracking-default)',
                                color: 'rgba(var(--text) / 0.4)',
                                lineHeight: 1,
                            }}
                        >
                            Monitor &amp; configuration request
                        </span>
                    </div>
                </div>
                <StatusPill status={status} />
            </div>

            {/* ── Overall status banner ── */}
            <div style={{ padding: 'var(--space-4) var(--space-5) 0', flexShrink: 0 }}>
                <div
                    className="flex items-center gap-3"
                    style={{
                        borderRadius: 'var(--radius-control)',
                        padding: 'clamp(0.5rem, 2cqmin, 0.75rem) clamp(0.75rem, 3cqmin, 1rem)',
                        // Glass l2 tinted by overall state color
                        backdropFilter:       'var(--glass-l2-backdrop)',
                        WebkitBackdropFilter: 'var(--glass-l2-backdrop)',
                        backgroundColor: `color-mix(in srgb, ${overall.rgb} 18%, var(--glass-l2-bg))`,
                        backgroundImage: 'var(--specular-default), var(--glass-l2-tint)',
                        border: `1px solid color-mix(in srgb, ${overall.rgb} 55%, var(--glass-l2-border))`,
                        boxShadow: [
                            'var(--rim)',
                            `inset 0 0 28px -8px color-mix(in srgb, ${overall.rgb} 30%, transparent)`,
                            `0 0 22px -4px color-mix(in srgb, ${overall.rgb} 36%, transparent)`,
                            'var(--elev-2)',
                        ].join(', '),
                        animation: isFault ? 'akvo-pulse-alert 1s ease-in-out infinite' : 'none',
                        transition: `background-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)), border-color var(--dur-medium, 260ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1))`,
                    }}
                >
                    <overall.Icon
                        style={{
                            width: 28,
                            height: 28,
                            color: overall.rgb,
                            filter: `drop-shadow(0 0 6px ${overall.rgb})`,
                            animation: isMoving ? 'akvo-pulse-alert 0.8s ease-in-out infinite' : 'none',
                            flexShrink: 0,
                        }}
                    />
                    <div className="flex flex-col">
                        <span
                            style={{
                                fontSize: 'clamp(1rem, 5cqmin, 1.35rem)',
                                fontWeight: 800,
                                letterSpacing: 'var(--tracking-tight)',
                                color: overall.rgb,
                                textShadow: `0 0 20px color-mix(in srgb, ${overall.rgb} 50%, transparent)`,
                                transition: 'color var(--dur-medium, 260ms) ease',
                            }}
                        >
                            {overall.label}
                        </span>
                        <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.55)' }}>
                            Active configuration:{' '}
                            <span style={{ fontWeight: 600, color: 'rgb(var(--text))' }}>
                                {state.activeConfiguration ?? '—'}
                            </span>
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Body ── responsive: monitor stacks above command on mobile, side-by-side on wide */}
            <div className="flex-1 overflow-y-auto min-h-0" style={{ padding: 'var(--space-4)', containerType: 'inline-size' }}>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>

                    {/* ══ MONITOR (primary) ══ */}
                    <div className="flex flex-col gap-3">

                        {/* Cross-section visualization inside glass card */}
                        <GlassSection
                            accentVar={WATER}
                            active={true}
                            style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                        >
                            <div
                                className="flex items-center justify-between shrink-0"
                                style={{ padding: 'clamp(0.4rem, 2cqmin, 0.6rem) clamp(0.5rem, 2.5cqmin, 0.75rem) clamp(0.2rem, 1cqmin, 0.3rem)' }}
                            >
                                <span
                                    style={{
                                        fontSize: 'var(--type-2xs)',
                                        letterSpacing: 'var(--tracking-caps)',
                                        textTransform: 'uppercase' as const,
                                        fontWeight: 700,
                                        color: 'rgba(var(--text) / 0.4)',
                                    }}
                                >
                                    Cross-section · Elevation view
                                </span>
                                {isMoving && (
                                    <span
                                        className="flex items-center gap-1"
                                        style={{
                                            fontSize: 'var(--type-2xs)',
                                            fontWeight: 700,
                                            letterSpacing: 'var(--tracking-caps)',
                                            textTransform: 'uppercase' as const,
                                            color: 'var(--accent-warn)',
                                        }}
                                    >
                                        <IconMoveVertical style={{ width: 12, height: 12 }} />
                                        In motion
                                    </span>
                                )}
                            </div>
                            {/* SVG cross-section centered */}
                            <div className="flex justify-center" style={{ padding: 'var(--space-2) 0' }}>
                                <CrossSection state={state} isMoving={isMoving} />
                            </div>
                            {/* Position readouts */}
                            <div
                                className="grid grid-cols-2 gap-2"
                                style={{ padding: '0 clamp(0.5rem, 2.5cqmin, 0.75rem) clamp(0.5rem, 2.5cqmin, 0.75rem)' }}
                            >
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
                        </GlassSection>

                        {/* Motor current gauges inside glass card */}
                        <GlassSection style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            <span
                                style={{
                                    fontSize: 'var(--type-2xs)',
                                    letterSpacing: 'var(--tracking-caps)',
                                    textTransform: 'uppercase' as const,
                                    fontWeight: 700,
                                    color: 'rgba(var(--text) / 0.4)',
                                    marginBottom: 2,
                                    display: 'block',
                                }}
                            >
                                Motor currents
                            </span>
                            <CurrentGauge label="Main floor motor" value={state.mainFloorMotorCurrent} />
                            <CurrentGauge label="Baja motor" value={state.bajaMotorCurrent} />
                        </GlassSection>

                        {/* Status chips grid */}
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
                        <GlassSection
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                                padding: 'var(--space-3)',
                            }}
                        >
                            <IconShieldAlert
                                className="w-5 h-5 shrink-0 mt-0.5"
                                style={{ color: 'var(--accent-warn)', filter: 'drop-shadow(0 0 4px var(--accent-warn))' }}
                            />
                            <p style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.65)', lineHeight: 1.55 }}>
                                <span style={{ fontWeight: 700, color: 'rgb(var(--text))' }}>AKVO is the safety authority.</span>{' '}
                                These are{' '}
                                <span style={{ fontWeight: 600 }}>requests</span>{' '}
                                — the controller validates each one and moves the floor only if safe. B-Panels never commands motion directly.
                            </p>
                        </GlassSection>

                        {/* Gate reason when blocked — UNCHANGED in behavior */}
                        {!gate.enabled && (
                            <GlassSection
                                active
                                accentVar="var(--accent-alert)"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                    padding: 'var(--space-3)',
                                }}
                            >
                                <IconAlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-alert)' }} />
                                <span style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: 'var(--accent-alert)' }}>
                                    Requests disabled — {gate.reason}
                                </span>
                            </GlassSection>
                        )}

                        <div
                            className="flex items-center gap-1.5"
                            style={{
                                fontSize: 'var(--type-xs)',
                                fontWeight: 700,
                                letterSpacing: 'var(--tracking-caps)',
                                textTransform: 'uppercase' as const,
                                color: 'rgba(var(--text) / 0.45)',
                            }}
                        >
                            <IconLayers style={{ width: 16, height: 16 }} /> Configuration presets
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
                                                <span
                                                    style={{
                                                        fontSize: 'var(--type-2xs)',
                                                        textAlign: 'center',
                                                        letterSpacing: 'var(--tracking-caps)',
                                                        textTransform: 'uppercase' as const,
                                                        color: 'var(--accent-plug)',
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    current
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <span style={{ fontSize: 'var(--type-xs)', color: 'rgba(var(--text) / 0.35)' }}>
                                No configuration presets available.
                            </span>
                        )}

                        {/* Live request/motion feedback — UNCHANGED in behavior */}
                        {(requestingPreset || isMoving) && (
                            <GlassSection
                                active
                                accentVar="var(--accent-warn)"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                    padding: 'var(--space-3)',
                                }}
                            >
                                <IconLoader2
                                    className="w-4 h-4 animate-spin"
                                    style={{ color: 'var(--accent-warn)', flexShrink: 0 }}
                                />
                                <span style={{ fontSize: 'var(--type-xs)', fontWeight: 600, color: 'var(--accent-warn)' }}>
                                    {isMoving
                                        ? `Moving${state.activeConfiguration ? ` → ${state.activeConfiguration}` : ''}…`
                                        : `Requesting ${requestingPreset}… (AKVO validating)`}
                                </span>
                            </GlassSection>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AkvoFloorSurface;
