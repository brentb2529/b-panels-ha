import React from 'react';
import { Device, TileConfig, FlairState } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconThermometer, IconSnowflake, IconFlame, IconPower, IconCheck, IconAlertTriangle, IconHome } from '../icons';
import { fluidTextSm, fluidTextLg, fluidText3xl, fluidIcon, fluidGap } from './tileScale';

const StatusBadge = ({ label, status }: { label: string; status: 'ok' | 'warning' | 'error' | 'active' | 'idle' }) => {
    const colors = {
        ok: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        error: 'bg-red-500/20 text-red-400 border-red-500/30',
        active: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
        idle: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };
    const style = colors[status] || colors.idle;
    return (
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${style}`}>
            <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
            {(status === 'ok' || status === 'active') && (
                <div className={`${status === 'ok' ? 'bg-emerald-500' : 'bg-cyan-500'} rounded-full p-0.5`}>
                    <IconCheck className="w-2 h-2 text-black" strokeWidth={4} />
                </div>
            )}
            {(status === 'warning' || status === 'error') && (
                <div className={`${status === 'error' ? 'bg-red-500' : 'bg-yellow-500'} rounded-full p-0.5`}>
                    <IconAlertTriangle className="w-2 h-2 text-black" strokeWidth={4} />
                </div>
            )}
        </div>
    );
};

const MetricItem = ({ label, value, unit, highlight, large }: { label: string; value: string | number | null; unit?: string; highlight?: boolean; large?: boolean }) => (
    <div
        className={`flex flex-col items-center justify-center rounded-control ${large ? 'p-2.5' : 'p-1.5'} flex-1 border backdrop-blur-sm ${highlight ? 'border-cyan-400/40' : 'border-white/10'}`}
        style={{
            background: highlight ? 'rgb(8 51 68 / 0.55)' : 'rgb(0 0 0 / 0.4)',
            boxShadow: highlight
                ? 'inset 0 1px 0 rgb(255 255 255 / 0.1), inset 0 -2px 6px rgb(0 0 0 / 0.4), 0 0 14px -6px #22d3ee'
                : 'inset 0 1px 0 rgb(255 255 255 / 0.06), inset 0 -2px 5px rgb(0 0 0 / 0.4)',
        }}
    >
        <span className={`${large ? 'text-[10px]' : 'text-[8px]'} text-gray-300 uppercase font-bold tracking-wider`}>{label}</span>
        <span className={`${large ? 'text-lg' : 'text-sm'} font-bold leading-tight tabular-nums ${highlight ? 'text-cyan-200' : 'text-white'}`} style={highlight ? { textShadow: '0 0 10px rgba(34,211,238,0.5)' } : undefined}>
            {value ?? '--'}<span className={`${large ? 'text-xs' : 'text-[9px]'} text-gray-400 ml-0.5 font-normal`}>{unit}</span>
        </span>
    </div>
);

const FlairBackground = ({ mode, active }: { mode: string; active: boolean }) => {
    const isCool = mode === 'cool' || mode === 'auto';
    const isHeat = mode === 'heat';
    return (
        <div className="absolute inset-0">
            <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="flairBg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={isHeat ? '#451a03' : isCool ? '#082f49' : '#1f2937'} />
                        <stop offset="60%" stopColor={isHeat ? '#7c2d12' : isCool ? '#0c4a6e' : '#111827'} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={isHeat ? '#431407' : isCool ? '#164e63' : '#0b1220'} />
                    </linearGradient>
                    <radialGradient id="flairGlow1" cx="0.3" cy="0.3" r="0.5">
                        <stop offset="0%" stopColor={isHeat ? '#fb923c' : isCool ? '#38bdf8' : '#6b7280'} stopOpacity={active ? '0.25' : '0.08'} />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                    <radialGradient id="flairGlow2" cx="0.7" cy="0.75" r="0.45">
                        <stop offset="0%" stopColor={isHeat ? '#f97316' : isCool ? '#0ea5e9' : '#4b5563'} stopOpacity={active ? '0.2' : '0.06'} />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                </defs>
                <rect width="100" height="100" fill="url(#flairBg)" />
                <rect width="100" height="100" fill="url(#flairGlow1)">
                    {active && <animate attributeName="opacity" values="0.7;1;0.7" dur="5s" repeatCount="indefinite" />}
                </rect>
                <rect width="100" height="100" fill="url(#flairGlow2)">
                    {active && <animate attributeName="opacity" values="1;0.6;1" dur="6.5s" repeatCount="indefinite" />}
                </rect>
            </svg>
        </div>
    );
};

const FlairTile = ({ device, tile, isEditor, cornerClassName }: {
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string;
}) => {
    const { openDevicePanel } = useDashboard();
    const state = device.state as FlairState;
    const isLocked = !!tile.isLocked;

    if (!state || typeof state !== 'object' || !state.structure) {
        return (
            <TileWrapper
                label={tile.label || device.name}
                isLocked={isLocked}
                isEditor={isEditor}
                className={`!bg-cyan-900/40 border border-cyan-500/20 ${cornerClassName || ''}`}
            >
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <IconThermometer className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-xs">Loading...</span>
                </div>
            </TileWrapper>
        );
    }

    const { structure, rooms } = state;
    const mode = structure.systemMode;
    const ventsOpen = rooms.reduce((n, r) => n + r.vents.filter(v => v.percentOpen > 0).length, 0);
    const ventsTotal = rooms.reduce((n, r) => n + r.vents.length, 0);
    const activeRooms = rooms.filter(r => r.activeMode === 'active').length;
    const anyHeating = rooms.some(r => r.hvacState === 'heating');
    const anyCooling = rooms.some(r => r.hvacState === 'cooling');

    // Primary inside reading — average of room temps
    const roomTempsKnown = rooms.map(r => r.currentTemp).filter((t): t is number => typeof t === 'number');
    const avgInside = roomTempsKnown.length
        ? Math.round(roomTempsKnown.reduce((a, b) => a + b, 0) / roomTempsKnown.length)
        : null;

    const getStatus = (): 'ok' | 'warning' | 'error' | 'active' | 'idle' => {
        if (!state.isOnline) return 'error';
        if (anyHeating || anyCooling) return 'active';
        if (mode === 'off') return 'idle';
        return 'ok';
    };
    const overallStatus = getStatus();

    const statusLabel = !state.isOnline ? 'Offline'
        : anyHeating ? 'Heating'
        : anyCooling ? 'Cooling'
        : mode === 'off' ? 'Off'
        : `Mode ${mode}`;

    const getAnimation = () => {
        if (!state.isOnline) return { enabled: true, effect: 'bounce' as const, color: '#ef4444' };
        if (anyHeating) return { enabled: true, effect: 'pulse' as const, color: '#f97316' };
        if (anyCooling) return { enabled: true, effect: 'pulse' as const, color: '#38bdf8' };
        return tile.animation;
    };

    const isActive = overallStatus === 'active' || overallStatus === 'ok' || !state.isOnline;
    const animation = getAnimation();
    const tileW = tile.width || 1;
    const tileH = tile.height || 1;
    const isLarge = tileW >= 2 && tileH >= 2;

    const ModeIcon = mode === 'heat' ? IconFlame : mode === 'cool' ? IconSnowflake : mode === 'off' ? IconPower : IconHome;
    const modeColor = mode === 'heat' ? 'text-orange-400' : mode === 'cool' ? 'text-sky-400' : mode === 'off' ? 'text-gray-400' : 'text-emerald-400';
    const modeGlowHex = anyHeating ? '#fb923c' : anyCooling ? '#38bdf8' : null;
    const modeGlow = modeGlowHex ? { filter: `drop-shadow(0 0 6px ${modeGlowHex})` } : undefined;
    const tempGlow = anyHeating ? '0 0 16px rgba(251,146,60,0.45)' : anyCooling ? '0 0 16px rgba(56,189,248,0.45)' : undefined;

    const handleClick = () => {
        if (!isEditor && !isLocked) openDevicePanel(device.id);
    };

    return (
        <TileWrapper
            label=""
            isLocked={isLocked}
            isEditor={isEditor}
            className={`!p-0 !block overflow-hidden border ${state.isOnline ? 'border-cyan-500/20' : 'border-red-500/30'} ${cornerClassName || ''}`}
            isActive={isActive}
            accent="water"
            animation={animation}
            onClick={handleClick}
        >
            <div className="flex flex-col h-full relative">
                <FlairBackground mode={mode} active={anyHeating || anyCooling} />

                <div className={`relative z-10 flex flex-col h-full ${isLarge ? 'p-4' : 'p-2.5'}`}>
                    {/* Top */}
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-1.5">
                            <ModeIcon className={`${modeColor}`} style={{ ...fluidIcon(isLarge ? 1.25 : 1), ...modeGlow }} />
                            <h2 className="font-bold text-white leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" style={isLarge ? fluidTextLg : fluidTextSm}>
                                {tile.label || device.name}
                            </h2>
                        </div>
                        <StatusBadge label={statusLabel} status={overallStatus} />
                    </div>

                    {/* Center: average inside temp */}
                    <div className="flex-1 flex items-center justify-center">
                        {avgInside !== null ? (
                            <div className="flex flex-col items-center">
                                <div className="flex items-baseline" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))' }}>
                                    <span className="font-bold text-white tabular-nums" style={{ ...fluidText3xl, textShadow: tempGlow }}>{avgInside}</span>
                                    <span className="text-gray-300 ml-0.5 font-semibold" style={isLarge ? fluidTextLg : fluidTextSm}>°F</span>
                                </div>
                                {isLarge && (
                                    <span className="text-[10px] text-gray-300 uppercase tracking-widest mt-1 font-semibold">Avg Inside</span>
                                )}
                            </div>
                        ) : (
                            <IconThermometer className="text-cyan-400/30" style={fluidIcon(isLarge ? 4 : 2.5)} />
                        )}
                    </div>

                    {/* Large tile: room pills */}
                    {isLarge && (
                        <div className="flex items-center justify-center gap-1.5 mb-2 flex-wrap">
                            {rooms.slice(0, 4).map(r => (
                                <div key={r.id} className="flex items-center gap-1 backdrop-blur-sm rounded-control px-2 py-1 border border-white/10" style={{ background: 'rgb(0 0 0 / 0.32)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06), inset 0 -1px 4px rgb(0 0 0 / 0.35)' }}>
                                    <span className="text-[9px] text-gray-300 uppercase font-bold">{r.name}</span>
                                    <span className="text-xs font-bold text-white tabular-nums">{r.currentTemp ?? '--'}°</span>
                                    {r.hvacState === 'heating' && <IconFlame className="w-3 h-3 text-orange-400" />}
                                    {r.hvacState === 'cooling' && <IconSnowflake className="w-3 h-3 text-sky-400" />}
                                </div>
                            ))}
                            {rooms.length > 4 && (
                                <span className="text-[10px] text-gray-300 bg-black/30 rounded-control px-2 py-1 border border-white/10">+{rooms.length - 4} more</span>
                            )}
                        </div>
                    )}

                    {/* Bottom metrics */}
                    <div className="flex" style={fluidGap(isLarge ? 0.5 : 0.25)}>
                        <MetricItem label="Outside" value={structure.outsideTemp ?? '--'} unit="°F" large={isLarge} />
                        <MetricItem label="Vents" value={`${ventsOpen}/${ventsTotal}`} unit=" open" large={isLarge} />
                        <MetricItem label="Rooms" value={`${activeRooms}/${rooms.length}`} unit=" active" highlight={activeRooms > 0} large={isLarge} />
                    </div>
                </div>
            </div>
        </TileWrapper>
    );
};

export default FlairTile;
