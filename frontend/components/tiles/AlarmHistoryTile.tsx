
import React from 'react';
import { Device, TileConfig, ArmingEvent } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import { IconShield, IconShieldCheck, IconShieldAlert, IconInfo, IconHistory, IconAlertTriangle } from '../icons';
import TileWrapper from './TileWrapper';
import { fluidIcon, fluidTextSm, fluidTextXs } from './tileScale';

const formatTimeAgo = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    // Compact units (no " ago") so the event label keeps room in narrow tiles.
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
};

const AlarmHistoryTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    // The alarm event history (arm/disarm/triggered) recorded from the HA/Alarmo
    // alarm state transitions. (Renamed from the legacy `sthmHistory`.)
    const { alarmHistory } = useDashboard();

    const rowIconStyle = { ...fluidIcon(1.1), flexShrink: 0 as const };
    // Each event carries a semantic accent: green = disarmed/ready, amber =
    // armed-home, red = armed-away/triggered. The icon sits in a small tinted
    // disc so the event type reads at a glance down the list.
    const getStatusInfo = (event: ArmingEvent): { text: string; color: string; icon: React.ReactNode } => {
        switch (event.status) {
            case 'armedAway':
                return { text: 'Armed Away', color: '#f87171', icon: <IconShieldAlert className="text-red-300" style={rowIconStyle} /> };
            case 'armedStay':
                return { text: 'Armed Stay', color: '#fb923c', icon: <IconShield className="text-orange-300" style={rowIconStyle} /> };
            case 'disarmed':
                return { text: 'Disarmed', color: '#34d399', icon: <IconShieldCheck className="text-green-300" style={rowIconStyle} /> };
            case 'triggered':
                return {
                    text: event.triggerName ? `Triggered — ${event.triggerName}` : 'Triggered',
                    color: '#ef4444',
                    icon: <IconAlertTriangle className="text-red-300" style={rowIconStyle} />
                };
            default:
                return { text: 'Unknown', color: '#9ca3af', icon: <IconInfo className="text-gray-400" style={rowIconStyle} /> };
        }
    };

    // A dimensional disc behind a row icon — soft tinted glass keyed to the
    // event's color, brighter and ringed for a triggered (intrusion) event.
    const RowDisc = ({ color, alert, children }: { color: string; alert?: boolean; children: React.ReactNode }) => (
        <div
            className="relative flex items-center justify-center rounded-full shrink-0"
            style={{
                width: 'clamp(1.5rem, 16cqmin, 2.25rem)',
                aspectRatio: '1 / 1',
                background: `radial-gradient(circle at 38% 30%, color-mix(in srgb, ${color} ${alert ? 55 : 32}%, transparent), color-mix(in srgb, ${color} 10%, transparent) 70%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} ${alert ? 70 : 40}%, transparent)`,
                boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.12), 0 0 ${alert ? 16 : 8}px -4px ${color}`,
            }}
        >
            {children}
        </div>
    );

    const history = alarmHistory || [];

    return (
        <TileWrapper
            label={tile.label || device.name}
            isLocked={tile.isLocked}
            isEditor={isEditor}
            className={cornerClassName}
        >
            <div className="w-full h-full flex flex-col overflow-y-auto p-2">
                {history.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400">
                        <IconHistory className="mb-2" style={fluidIcon(2)} />
                        <p style={fluidTextSm}>No alarm history yet.</p>
                    </div>
                ) : (
                    <ul className="space-y-1.5">
                        {history.map((event, index) => {
                            const { text, color, icon } = getStatusInfo(event);
                            const isTriggered = event.status === 'triggered';
                            return (
                                <li
                                    key={index}
                                    className="flex items-center justify-between gap-2 rounded-control px-2 py-1.5"
                                    style={{
                                        background: isTriggered
                                            ? 'linear-gradient(180deg, color-mix(in srgb, #ef4444 28%, transparent), color-mix(in srgb, #ef4444 12%, transparent))'
                                            : 'rgb(255 255 255 / 0.04)',
                                        border: `1px solid ${isTriggered ? 'color-mix(in srgb, #ef4444 45%, transparent)' : 'rgb(255 255 255 / 0.06)'}`,
                                        boxShadow: isTriggered
                                            ? 'inset 0 1px 0 rgb(255 255 255 / 0.10), 0 0 14px -6px #ef4444'
                                            : 'inset 0 1px 0 rgb(255 255 255 / 0.05)',
                                    }}
                                >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <RowDisc color={color} alert={isTriggered}>{icon}</RowDisc>
                                        <span className={`font-bold truncate ${isTriggered ? 'text-white' : 'text-gray-100'}`} style={fluidTextSm}>{text}</span>
                                    </div>
                                    <span className="text-gray-300 flex-shrink-0 font-mono tabular-nums pl-1" style={fluidTextXs}>
                                        {formatTimeAgo(event.timestamp)}
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </TileWrapper>
    );
};

export default AlarmHistoryTile;
