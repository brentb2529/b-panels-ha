import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Device, TileConfig, LitterRobotState, LitterRobotStatus } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import * as haClient from '../../services/haClient';
import { playTextToSpeech } from '../../services/audioPlayer';
import TileWrapper from './TileWrapper';
import { IconCat, IconRefreshCw, IconX, IconMoon, IconSun, IconLock, IconLockOpen, IconSettings } from '../icons';
import { fluidTextSm, fluidTextXs, fluidTextLg } from './tileScale';

const clampPct = (n: number | null | undefined) => Math.round(Math.min(100, Math.max(0, n || 0)));
const wasteColorFor = (pct: number, isFull: boolean) => (pct >= 90 || isFull ? '#f87171' : pct >= 70 ? '#fbbf24' : '#34d399');
const litterColorFor = (pct: number) => (pct < 20 ? '#f87171' : pct < 40 ? '#fbbf24' : '#22d3ee');
const litterWord = (pct: number) => (pct >= 40 ? 'Optimal' : pct >= 20 ? 'Low' : 'Refill');

// Status dot color + human label, mirroring the Whisker app (Ready = blue dot).
const STATUS_INFO: Record<LitterRobotStatus, { color: string; label: string }> = {
    READY: { color: '#3b82f6', label: 'Ready' },
    CYCLING: { color: '#3b82f6', label: 'Cycling' },
    DRAWER_FULL: { color: '#f87171', label: 'Drawer Full' },
    CAT_DETECTED: { color: '#a78bfa', label: 'Cat Detected' },
    EMPTYING: { color: '#3b82f6', label: 'Emptying' },
    PAUSED: { color: '#fbbf24', label: 'Paused' },
    BONNET_REMOVED: { color: '#f87171', label: 'Bonnet Off' },
    OFFLINE: { color: '#9ca3af', label: 'Offline' },
    FAULT: { color: '#f87171', label: 'Fault' },
};

// Device illustration — a clean Litter-Robot silhouette (white body, dark
// spherical window, base + bonnet) echoing the Whisker app's device render.
const DeviceGlyph = ({ status }: { status: LitterRobotStatus }) => {
    const isCycling = status === 'CYCLING';
    const dotColor = STATUS_INFO[status]?.color || '#9ca3af';
    return (
        <div className={`relative shrink-0 ${isCycling ? 'animate-pulse' : ''}`} style={{ width: 'clamp(2.5rem, 26cqmin, 6rem)', aspectRatio: '1 / 1.05' }}>
            <svg viewBox="0 0 80 84" className="w-full h-full" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))' }}>
                <defs>
                    <linearGradient id="lrBody" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffffff" />
                        <stop offset="55%" stopColor="#eef2f7" />
                        <stop offset="100%" stopColor="#cfd8e3" />
                    </linearGradient>
                    <radialGradient id="lrWindow" cx="38%" cy="32%" r="75%">
                        <stop offset="0%" stopColor="#2b3543" />
                        <stop offset="45%" stopColor="#161d27" />
                        <stop offset="100%" stopColor="#080b10" />
                    </radialGradient>
                    <linearGradient id="lrBase" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#eef2f7" />
                        <stop offset="100%" stopColor="#c2cbd8" />
                    </linearGradient>
                </defs>
                <rect x="9" y="63" width="62" height="17" rx="5" fill="url(#lrBase)" stroke="#b6c0cf" strokeWidth="1" />
                <rect x="27" y="70" width="26" height="7" rx="2.5" fill="#aab4c2" />
                <rect x="5" y="9" width="70" height="60" rx="20" fill="url(#lrBody)" stroke="#c3cdd9" strokeWidth="1" />
                <ellipse cx="32" cy="16" rx="20" ry="5" fill="#ffffff" opacity="0.6" />
                <rect x="31" y="2" width="18" height="10" rx="4" fill="#2a3340" />
                <circle cx="40" cy="37" r="23" fill="url(#lrWindow)" stroke="#3a4654" strokeWidth="1.5" />
                <ellipse cx="32" cy="28" rx="8" ry="4.5" fill="#4b5666" opacity="0.55" />
                <circle cx="62" cy="57" r="3.6" fill={dotColor} style={{ filter: `drop-shadow(0 0 3px ${dotColor})` }}>
                    {isCycling && <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />}
                </circle>
            </svg>
        </div>
    );
};

// Waste drawer — a container that fills bottom-up (the literal drawer filling).
const WasteFill = ({ pct, isFull }: { pct: number; isFull: boolean }) => {
    const color = wasteColorFor(pct, isFull);
    return (
        <div
            className="relative rounded-control overflow-hidden border border-white/15"
            style={{ width: 'clamp(1.4rem, 9cqmin, 2.25rem)', height: 'clamp(1.9rem, 12cqmin, 3rem)', background: 'rgb(0 0 0 / 0.25)', boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.5)' }}
        >
            <div
                className="absolute bottom-0 left-0 right-0"
                style={{ height: `${pct}%`, background: `linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%), ${color}`, transition: 'height 0.6s ease' }}
            />
        </div>
    );
};

// Litter level — a bowl (circle) that fills bottom-up.
const LitterBowl = ({ pct }: { pct: number }) => {
    const color = litterColorFor(pct);
    return (
        <div
            className="relative rounded-full overflow-hidden border border-white/15"
            style={{ width: 'clamp(1.9rem, 12cqmin, 3rem)', aspectRatio: '1 / 1', background: 'rgb(0 0 0 / 0.25)', boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.5)' }}
        >
            <div
                className="absolute bottom-0 left-0 right-0"
                style={{ height: `${pct}%`, background: `linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 50%), ${color}`, transition: 'height 0.6s ease' }}
            />
        </div>
    );
};

const GaugeColumn = ({ label, value, valueColor, children }: { label: string; value: string; valueColor?: string; children: React.ReactNode }) => (
    <div className="flex flex-col items-center gap-1">
        <span className="uppercase tracking-wider font-semibold text-gray-400" style={{ ...fluidTextXs, fontSize: 'clamp(0.5rem, 5cqmin, 0.7rem)' }}>{label}</span>
        {children}
        <span className="font-bold tabular-nums" style={{ ...fluidTextXs, color: valueColor }}>{value}</span>
    </div>
);

// Detail Modal
const LitterRobotDetailModal = ({ device, onClose, onCommand }: {
    device: Device,
    onClose: () => void,
    onCommand: (cmd: string) => Promise<void>
}) => {
    const state = device.state as LitterRobotState;
    const [loading, setLoading] = useState<string | null>(null);

    const handleCommand = async (cmd: string) => {
        setLoading(cmd);
        try {
            await onCommand(cmd);
        } finally {
            setLoading(null);
        }
    };

    const fmt = (val: any, suffix = '') => {
        if (val === undefined || val === null) return 'N/A';
        return `${val}${suffix}`;
    };

    const fmtDate = (dateStr: string | undefined) => {
        if (!dateStr) return 'N/A';
        try {
            return new Date(dateStr).toLocaleString();
        } catch {
            return dateStr;
        }
    };

    const detailItems: { label: string, value: any, isHeader?: boolean }[] = [
        { label: 'Status', value: state.normalizedStatus, isHeader: true },
        { label: 'Unit Status', value: state.unitStatus },
        { label: 'Power', value: state.powerStatus },
        { label: 'Online', value: state.isOnline ? 'Yes' : 'No' },
        { label: 'Model Info', value: null, isHeader: true },
        { label: 'Model', value: state.model },
        { label: 'Serial', value: state.serial },
        { label: 'Cycle Info', value: null, isHeader: true },
        { label: 'Total Cycles', value: state.cycleCount },
        { label: 'Waste Level', value: fmt(state.wasteLevel, '%') },
        { label: 'Drawer Full Alert', value: state.isDFITriggered ? 'YES' : 'No' },
    ];

    if (state.isLR4) {
        detailItems.push(
            { label: 'LR4 Sensors', value: null, isHeader: true },
            { label: 'Litter Level', value: fmt(state.litterLevel, '%') },
            { label: 'Pet Weight', value: state.petWeight ? fmt(state.petWeight, ' lbs') : 'N/A' },
        );
    }

    detailItems.push(
        { label: 'Settings', value: null, isHeader: true },
        { label: 'Night Light', value: state.isNightLightModeEnabled ? 'On' : 'Off' },
        { label: 'Panel Lock', value: state.isPanelLockEnabled ? 'Locked' : 'Unlocked' },
        { label: 'Sleep Mode', value: state.sleepModeEnabled ? 'On' : 'Off' },
        { label: 'Timestamps', value: null, isHeader: true },
        { label: 'Last Seen', value: fmtDate(state.lastSeen) },
    );

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden border border-indigo-500/30 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 bg-indigo-900/50 border-b border-indigo-500/30 shrink-0">
                    <div className="flex items-center gap-3">
                        <IconCat className="w-8 h-8 text-indigo-400" />
                        <div>
                            <h3 className="text-lg font-bold text-white">{device.name}</h3>
                            <p className="text-xs text-indigo-300">{state.model}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-700 transition-colors">
                        <IconX className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Quick Actions</h4>
                    <div className="grid grid-cols-4 gap-2">
                        <button
                            onClick={() => handleCommand('cycle')}
                            disabled={!!loading}
                            className="flex flex-col items-center gap-1 p-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <IconRefreshCw className={`w-5 h-5 ${loading === 'cycle' ? 'animate-spin' : ''}`} />
                            <span className="text-[10px] font-medium">Cycle</span>
                        </button>
                        <button
                            onClick={() => handleCommand(state.isNightLightModeEnabled ? 'nightlight_off' : 'nightlight_on')}
                            disabled={!!loading}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors disabled:opacity-50 ${state.isNightLightModeEnabled ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-gray-600 hover:bg-gray-500'}`}
                        >
                            {state.isNightLightModeEnabled ? <IconSun className="w-5 h-5" /> : <IconMoon className="w-5 h-5" />}
                            <span className="text-[10px] font-medium">Light</span>
                        </button>
                        <button
                            onClick={() => handleCommand(state.isPanelLockEnabled ? 'panellock_off' : 'panellock_on')}
                            disabled={!!loading}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors disabled:opacity-50 ${state.isPanelLockEnabled ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}
                        >
                            {state.isPanelLockEnabled ? <IconLock className="w-5 h-5" /> : <IconLockOpen className="w-5 h-5" />}
                            <span className="text-[10px] font-medium">Lock</span>
                        </button>
                        <button
                            onClick={() => handleCommand('reset')}
                            disabled={!!loading}
                            className="flex flex-col items-center gap-1 p-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <IconSettings className="w-5 h-5" />
                            <span className="text-[10px] font-medium">Reset</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-gray-700/50">
                            {detailItems.map(({ label, value, isHeader }) => (
                                <tr key={label} className={`${isHeader ? 'bg-indigo-900/30' : 'hover:bg-gray-700/30'} transition-colors`}>
                                    <td className={`p-3 font-medium ${isHeader ? 'text-indigo-300' : 'text-gray-400'} w-1/2 border-r border-gray-700/30`}>{label}</td>
                                    <td className="p-3 text-gray-200 font-mono break-all">{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>,
        document.body
    );
};

// Main Tile Component
const LitterRobotTile = ({ device, tile, isEditor, cornerClassName }: {
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string
}) => {
    const { addNotification, ttsNotificationsEnabled, isAudioUnlocked } = useDashboard();
    const [showDetails, setShowDetails] = useState(false);
    const state = device.state as LitterRobotState;
    const isLocked = !!tile.isLocked;

    const prevStatus = useRef(state?.normalizedStatus);
    const notifiedWasteCritical = useRef(false);
    const notifiedLitterLow = useRef(false);
    const notifiedDrawerFull = useRef(false);

    useEffect(() => {
        if (!state) return;
        if (prevStatus.current && prevStatus.current !== state.normalizedStatus) {
            const statusMessages: Record<LitterRobotStatus, { msg: string, type: 'info' | 'success' | 'warning' | 'error' }> = {
                READY: { msg: 'is now ready', type: 'success' },
                CYCLING: { msg: 'is cycling', type: 'info' },
                DRAWER_FULL: { msg: 'waste drawer is full', type: 'error' },
                CAT_DETECTED: { msg: 'cat detected', type: 'info' },
                EMPTYING: { msg: 'is emptying', type: 'info' },
                PAUSED: { msg: 'is paused', type: 'warning' },
                BONNET_REMOVED: { msg: 'bonnet removed', type: 'error' },
                OFFLINE: { msg: 'is OFFLINE', type: 'error' },
                FAULT: { msg: 'has a FAULT', type: 'error' },
            };
            const info = statusMessages[state.normalizedStatus] || { msg: state.normalizedStatus, type: 'info' as const };
            addNotification(`${device.name}: ${info.msg}`, info.type);

            if (state.normalizedStatus === 'DRAWER_FULL' && !notifiedDrawerFull.current) {
                notifiedDrawerFull.current = true;
                if (ttsNotificationsEnabled && isAudioUnlocked) {
                    const announcement = `${device.name} waste drawer is full`;
                    playTextToSpeech(announcement);
                    setTimeout(() => playTextToSpeech(announcement), 4000);
                }
            }
            if (state.normalizedStatus !== 'DRAWER_FULL') notifiedDrawerFull.current = false;
        }
        prevStatus.current = state.normalizedStatus;

        const wasteLevel = state.wasteLevel ?? 0;
        if (wasteLevel >= 90 && !notifiedWasteCritical.current) {
            addNotification(`⚠️ ${device.name}: Waste drawer CRITICAL (${wasteLevel}%) - Empty immediately!`, 'error');
            notifiedWasteCritical.current = true;
        } else if (wasteLevel < 90) {
            notifiedWasteCritical.current = false;
        }

        const litterLevel = state.litterLevel;
        if (litterLevel !== null && litterLevel !== undefined) {
            if (litterLevel < 30 && !notifiedLitterLow.current) {
                addNotification(`⚠️ ${device.name}: Litter level LOW (${litterLevel}%) - Add litter soon!`, 'error');
                notifiedLitterLow.current = true;
            } else if (litterLevel >= 30) {
                notifiedLitterLow.current = false;
            }
        }
    }, [state?.normalizedStatus, state?.wasteLevel, state?.litterLevel, device.name, addNotification, ttsNotificationsEnabled, isAudioUnlocked]);

    if (!state || typeof state !== 'object') {
        return (
            <TileWrapper label={tile.label || device.name} isLocked={isLocked} isEditor={isEditor} className={`!bg-indigo-900/40 border border-indigo-500/20 ${cornerClassName || ''}`}>
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <IconCat className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-xs">Loading...</span>
                </div>
            </TileWrapper>
        );
    }

    const wasteLevel = state.wasteLevel ?? 0;
    const litterLevel = state.litterLevel;
    const isWasteCritical = wasteLevel >= 90;
    const isLitterLow = state.isLR4 && litterLevel !== null && litterLevel !== undefined && litterLevel < 30;
    const isError = ['FAULT', 'OFFLINE', 'BONNET_REMOVED'].includes(state.normalizedStatus);
    const isFull = state.normalizedStatus === 'DRAWER_FULL' || state.isDFITriggered;
    const hasCriticalCondition = isWasteCritical || isLitterLow || isError || isFull;
    const isActive = ['CYCLING', 'CAT_DETECTED', 'EMPTYING'].includes(state.normalizedStatus) || hasCriticalCondition;

    const getAnimation = () => {
        if (isWasteCritical || isLitterLow || isError || isFull) {
            return { enabled: true, effect: 'bounce' as const, color: '#ef4444' };
        }
        if (state.normalizedStatus === 'CYCLING') {
            return { enabled: true, effect: 'pulse' as const, color: '#3b82f6' };
        }
        return tile.animation;
    };

    const handleClick = () => {
        if (!isEditor && !isLocked) setShowDetails(true);
    };

    // Route the modal's quick actions to Home Assistant services using the
    // entity_ids the composite captured for this robot.
    const handleCommand = async (cmd: string) => {
        const e = state.haEntities || {};
        try {
            if (cmd === 'cycle' && e.vacuum) await haClient.callService('vacuum', 'start', { entity_id: e.vacuum });
            else if (cmd === 'nightlight_on' && e.nightLight) await haClient.callService('switch', 'turn_on', { entity_id: e.nightLight });
            else if (cmd === 'nightlight_off' && e.nightLight) await haClient.callService('switch', 'turn_off', { entity_id: e.nightLight });
            else if (cmd === 'panellock_on' && e.panelLock) await haClient.callService('switch', 'turn_on', { entity_id: e.panelLock });
            else if (cmd === 'panellock_off' && e.panelLock) await haClient.callService('switch', 'turn_off', { entity_id: e.panelLock });
            else if (cmd === 'reset' && e.reset) await haClient.callService('button', 'press', { entity_id: e.reset });
            else { addNotification(`${device.name}: '${cmd}' not available for this robot`, 'warning'); return; }
            addNotification(`${device.name}: ${cmd.replace('_', ' ')} sent`, 'success');
        } catch (err: any) {
            addNotification(`${device.name}: ${err?.message || 'Command failed'}`, 'error');
        }
    };

    return (
        <>
            <TileWrapper
                label=""
                isLocked={isLocked}
                isEditor={isEditor}
                accent={hasCriticalCondition ? 'alert' : 'brand'}
                className={cornerClassName}
                isActive={isActive}
                animation={getAnimation()}
                onClick={handleClick}
            >
                {(() => {
                    const info = STATUS_INFO[state.normalizedStatus] || { color: '#9ca3af', label: state.normalizedStatus.replace('_', ' ') };
                    const wastePct = clampPct(state.wasteLevel);
                    const hasLitter = state.litterLevel !== null && state.litterLevel !== undefined;
                    const litterPct = hasLitter ? clampPct(state.litterLevel) : 0;
                    const wasteCrit = wastePct >= 90 || isFull;
                    return (
                        <div className="flex items-center h-full w-full gap-3">
                            <div className="relative flex items-center justify-center shrink-0">
                                <div className="absolute rounded-full blur-xl pointer-events-none" style={{ width: '85%', height: '70%', background: info.color, opacity: 0.35 }} />
                                <DeviceGlyph status={state.normalizedStatus} />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                <h2 className="font-bold text-white truncate leading-tight" style={fluidTextLg}>{tile.label || device.name}</h2>
                                <div className="flex items-center gap-1.5">
                                    <span className="rounded-full shrink-0" style={{ width: '0.55rem', height: '0.55rem', background: info.color, boxShadow: `0 0 8px ${info.color}` }} />
                                    <span className="text-gray-300 truncate" style={fluidTextSm}>{info.label}</span>
                                </div>
                                <div className="flex items-end gap-4 mt-1">
                                    <GaugeColumn label="Waste" value={`${wastePct}%`} valueColor={wasteCrit ? '#f87171' : undefined}>
                                        <WasteFill pct={wastePct} isFull={isFull} />
                                    </GaugeColumn>
                                    {hasLitter && (
                                        <GaugeColumn label="Litter" value={litterWord(litterPct)} valueColor={litterPct < 20 ? '#f87171' : undefined}>
                                            <LitterBowl pct={litterPct} />
                                        </GaugeColumn>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </TileWrapper>

            {showDetails && (
                <LitterRobotDetailModal device={device} onClose={() => setShowDetails(false)} onCommand={handleCommand} />
            )}
        </>
    );
};

export default LitterRobotTile;
