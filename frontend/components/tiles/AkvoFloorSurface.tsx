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

import React, { useEffect, useRef, useState } from 'react';
import { useAkvoFloor } from '../../hooks/useAkvoFloor';
import type { AkvoState, AkvoFault } from '../../services/akvo';
import {
    IconWaves, IconLoader2, IconWifiOff, IconShieldAlert, IconShieldCheck,
    IconAlertOctagon, IconAlertTriangle, IconActivity, IconGauge, IconMoveVertical,
    IconHand, IconCheckCircle, IconLayers,
} from '../icons';
import type { TileProps } from '../tileRegistry';

const HOLD_MS = 2000; // press-and-hold duration to issue a request

// ---- Connection status pill --------------------------------------------------
const StatusPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
    if (status === 'live') {
        return (
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live
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

// ---- Overall system status banner -------------------------------------------
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

// ---- Position visual: a deck line with the floor level relative to it --------
// Negative = above deck (raised), positive = below deck (lowered/submerged).
const PositionGauge = ({ label, value, unit }: { label: string; value: number | null; unit: string }) => {
    // Map a plausible travel range to a 0..100% bar; clamp. We don't know exact
    // limits, so use a symmetric ±3 m visual scale, clamped.
    const RANGE = 3;
    const pct = value == null ? 50 : Math.max(0, Math.min(100, ((value + RANGE) / (2 * RANGE)) * 100));
    const aboveDeck = value != null && value < 0;
    return (
        <div className="flex flex-col rounded-control p-3" style={{ background: 'rgb(var(--surface-control) / 0.5)', border: '1px solid var(--tile-border)' }}>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">{label}</span>
                <IconMoveVertical className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white tabular-nums">
                    {value != null ? value.toFixed(2) : '--'}
                </span>
                <span className="text-sm text-gray-400 font-semibold">{unit}</span>
            </div>
            <span className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: value == null ? 'rgb(var(--text) / 0.4)' : aboveDeck ? 'var(--accent-water)' : 'var(--accent-warn)' }}>
                {value == null ? 'no reading' : aboveDeck ? 'above deck' : value > 0 ? 'below deck' : 'at deck'}
            </span>
            {/* deck-relative bar */}
            <div className="relative mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'rgb(var(--surface) / 0.8)' }}>
                <div className="absolute top-0 bottom-0 w-px bg-white/50" style={{ left: '50%' }} title="deck level" />
                <div className="absolute top-0 bottom-0 rounded-full" style={{ left: '50%', width: `${Math.abs(pct - 50)}%`, transform: pct < 50 ? 'translateX(-100%)' : undefined, background: aboveDeck ? 'var(--accent-water)' : 'var(--accent-warn)' }} />
            </div>
        </div>
    );
};

// ---- A labelled status chip --------------------------------------------------
const StatusChip = ({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'alert' | 'idle' }) => {
    const rgb = tone === 'ok' ? 'var(--accent-plug)' : tone === 'warn' ? 'var(--accent-warn)' : tone === 'alert' ? 'var(--accent-alert)' : 'var(--surface-control)';
    return (
        <div className="flex flex-col rounded-control px-2.5 py-1.5" style={{ background: 'rgb(var(--surface-control) / 0.4)', border: `1px solid color-mix(in srgb, ${rgb} 35%, var(--tile-border))` }}>
            <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">{label}</span>
            <span className="text-sm font-bold" style={{ color: tone === 'idle' ? 'rgb(var(--text) / 0.7)' : rgb }}>{value}</span>
        </div>
    );
};

const triState = (v: boolean | null, on: string, off: string): { value: string; tone: 'ok' | 'warn' | 'alert' | 'idle' } => {
    if (v === null) return { value: 'unknown', tone: 'idle' };
    return v ? { value: on, tone: 'ok' } : { value: off, tone: 'idle' };
};

// ---- Faults panel ------------------------------------------------------------
const FaultsPanel = ({ faults }: { faults: AkvoFault[] }) => {
    const active = faults.filter((f) => f.active);
    const sevColor = (s: AkvoFault['severity']) => s === 'safety' ? 'var(--accent-alert)' : s === 'fault' ? 'var(--accent-alert)' : s === 'problem' ? 'var(--accent-warn)' : 'var(--surface-control)';
    return (
        <div className="flex flex-col rounded-control p-3 min-h-0" style={{ background: 'rgb(var(--surface-control) / 0.4)', border: `1px solid ${active.length ? 'color-mix(in srgb, var(--accent-alert) 45%, var(--tile-border))' : 'var(--tile-border)'}` }}>
            <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-300">
                    {active.length ? <IconAlertOctagon className="w-4 h-4" style={{ color: 'var(--accent-alert)' }} /> : <IconCheckCircle className="w-4 h-4" style={{ color: 'var(--accent-plug)' }} />}
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
                        <div key={f.entityId} className="flex items-center gap-2 rounded px-2 py-1" style={{ background: `color-mix(in srgb, ${sevColor(f.severity)} 14%, transparent)` }}>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sevColor(f.severity) }} />
                            <span className="text-xs font-medium text-white truncate">{f.label}</span>
                            <span className="ml-auto text-[9px] uppercase tracking-wider font-bold" style={{ color: sevColor(f.severity) }}>{f.severity}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ---- Press-and-hold request button -------------------------------------------
// No single tap can issue motion: the user must hold for HOLD_MS. Releasing
// early cancels. While holding, a progress ring fills.
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
            <div className="absolute inset-0 origin-left pointer-events-none" style={{ transform: `scaleX(${progress})`, background: 'color-mix(in srgb, var(--accent-warn) 30%, transparent)', transition: progress === 0 ? 'transform 120ms ease-out' : 'none' }} />
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

// ---- The surface -------------------------------------------------------------
const AkvoFloorSurface = (_props: TileProps) => {
    const { state, gate, status, requestingPreset, requestConfiguration } = useAkvoFloor();
    const overall = overallStatus(state);

    if (!state.present) {
        return (
            <div className="flex flex-col h-full w-full rounded-tile overflow-hidden bg-gray-700/60 items-center justify-center text-center gap-3 p-6" style={{ border: '1px solid var(--tile-border)' }}>
                <IconWaves className="w-12 h-12 opacity-30" />
                <p className="text-sm text-gray-400 max-w-xs">
                    {status === 'connecting' ? 'Connecting to Home Assistant…' : 'AKVO Movable Floor entities not found. The surface appears automatically once the akvo integration is loaded.'}
                </p>
            </div>
        );
    }

    const ready = state.readyForExternalCommands;
    const isMoving = state.floorsMoving === true;

    return (
        <div className="flex flex-col h-full w-full rounded-tile overflow-hidden bg-gray-700/60" style={{ border: '1px solid var(--tile-border)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--tile-border)' }}>
                <div className="flex items-center gap-2.5">
                    <IconWaves className="w-6 h-6" style={{ color: 'var(--accent-water)' }} />
                    <div className="flex flex-col leading-tight">
                        <h2 className="font-bold text-white text-lg">AKVO Movable Floor</h2>
                        <span className="text-xs text-gray-400">Monitor &amp; configuration request</span>
                    </div>
                </div>
                <StatusPill status={status} />
            </div>

            {/* Big overall status banner */}
            <div className="px-4 pt-3 shrink-0">
                <div className="flex items-center gap-3 rounded-control px-4 py-3" style={{ background: `color-mix(in srgb, ${overall.rgb} 16%, rgb(var(--surface) / 0.6))`, border: `1px solid color-mix(in srgb, ${overall.rgb} 55%, transparent)` }}>
                    <overall.Icon className={`w-7 h-7 ${isMoving ? 'animate-pulse' : ''}`} style={{ color: overall.rgb }} />
                    <div className="flex flex-col">
                        <span className="text-xl font-extrabold tracking-wide" style={{ color: overall.rgb }}>{overall.label}</span>
                        <span className="text-xs text-gray-300">
                            Active configuration: <span className="font-semibold text-white">{state.activeConfiguration ?? '—'}</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* Body: responsive — monitor stacks above command on mobile, side-by-side on wide */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>
                    {/* MONITOR (primary) */}
                    <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-3">
                            <PositionGauge label="Main Floor" value={state.mainFloorPosition} unit={state.positionUnit} />
                            <PositionGauge label="Baja" value={state.bajaPosition} unit={state.positionUnit} />
                        </div>

                        {/* Status chips */}
                        <div className="grid grid-cols-3 gap-2">
                            <StatusChip label="Motion" {...(isMoving ? { value: 'Moving', tone: 'warn' as const } : state.floorsMoving === false ? { value: 'Stopped', tone: 'ok' as const } : { value: 'unknown', tone: 'idle' as const })} />
                            <StatusChip label="System" {...(state.systemFault === true ? { value: 'Fault', tone: 'alert' as const } : triState(state.systemReady, 'Ready', 'Not ready'))} />
                            <StatusChip label="E-Stop" {...(state.emergencyStop === true ? { value: 'ACTIVE', tone: 'alert' as const } : state.emergencyStop === false ? { value: 'Clear', tone: 'ok' as const } : { value: 'unknown', tone: 'idle' as const })} />
                            <StatusChip label="Comms" {...(state.badModbusComm === true ? { value: 'Fault', tone: 'alert' as const } : state.badModbusComm === false ? { value: 'OK', tone: 'ok' as const } : { value: 'unknown', tone: 'idle' as const })} />
                            <StatusChip label="Main Current" value={state.mainFloorMotorCurrent != null ? `${state.mainFloorMotorCurrent.toFixed(1)} A` : '-- A'} tone="idle" />
                            <StatusChip label="Baja Current" value={state.bajaMotorCurrent != null ? `${state.bajaMotorCurrent.toFixed(1)} A` : '-- A'} tone="idle" />
                        </div>

                        <FaultsPanel faults={state.faults} />
                    </div>

                    {/* COMMAND (secondary, guarded) */}
                    <div className="flex flex-col gap-3">
                        {/* Safety framing banner */}
                        <div className="flex items-start gap-2 rounded-control px-3 py-2.5" style={{ background: 'rgb(var(--surface-control) / 0.4)', border: '1px solid var(--tile-border)' }}>
                            <IconShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent-warn)' }} />
                            <p className="text-xs text-gray-300 leading-snug">
                                <span className="font-bold text-white">AKVO is the safety authority.</span> These are <span className="font-semibold">requests</span> — the controller validates each one and moves the floor only if safe. B-Panels never commands motion directly.
                            </p>
                        </div>

                        {/* Gate reason when blocked */}
                        {!gate.enabled && (
                            <div className="flex items-center gap-2 rounded-control px-3 py-2" style={{ background: 'color-mix(in srgb, var(--accent-alert) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-alert) 35%, transparent)' }}>
                                <IconAlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-alert)' }} />
                                <span className="text-xs font-semibold" style={{ color: 'var(--accent-alert)' }}>Requests disabled — {gate.reason}</span>
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
                                            {isActiveCfg && <span className="text-[9px] text-center uppercase tracking-wider" style={{ color: 'var(--accent-plug)' }}>current</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <span className="text-xs text-gray-400">No configuration presets available.</span>
                        )}

                        {/* Live request/motion feedback */}
                        {(requestingPreset || isMoving) && (
                            <div className="flex items-center gap-2 rounded-control px-3 py-2" style={{ background: 'color-mix(in srgb, var(--accent-warn) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-warn) 40%, transparent)' }}>
                                <IconLoader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-warn)' }} />
                                <span className="text-xs font-semibold" style={{ color: 'var(--accent-warn)' }}>
                                    {isMoving ? `Moving${state.activeConfiguration ? ` → ${state.activeConfiguration}` : ''}…` : `Requesting ${requestingPreset}… (AKVO validating)`}
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
