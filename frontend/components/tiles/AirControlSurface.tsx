// The bespoke per-room AIR CONTROL marquee surface.
//
// Discovers every controllable `climate.*` zone dynamically (via useClimateZones
// → subscribeEntities), then lays out one independent RoomClimateTile per zone
// in a responsive grid that reads at room distance on a wall panel and reflows
// to a single column on mobile. No polling; live updates flow from the hook.
//
// This is registered as a single DeviceType.AirControl tile (the FlairTile
// precedent: one registered tile that renders many rooms), so it drops into any
// panel. It owns its own subscription and does NOT go through the device-mapping
// pipeline — all data/control still flows through services/haClient.ts.

import React from 'react';
import { useClimateZones } from '../../hooks/useClimateZones';
import RoomClimateTile from './RoomClimateTile';
import { IconWind, IconLoader2, IconWifiOff } from '../icons';
import type { TileProps } from '../tileRegistry';

const StatusPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
    if (status === 'live') {
        return (
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live
            </span>
        );
    }
    if (status === 'connecting') {
        return (
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                Connecting
            </span>
        );
    }
    return (
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
            <IconWifiOff className="w-3.5 h-3.5" />
            Stale — reconnecting
        </span>
    );
};

// `tile`/`device` are part of the shared TileProps contract but this surface is
// self-driven (it discovers its own entities), so they're unused here.
const AirControlSurface = (_props: TileProps) => {
    const { zones, status, setTargetTemperature, setHvacMode, setFanMode } = useClimateZones();

    return (
        <div className="flex flex-col h-full w-full rounded-tile overflow-hidden bg-gray-700/60" style={{ border: '1px solid var(--tile-border)' }}>
            {/* Surface header */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--tile-border)' }}>
                <div className="flex items-center gap-2.5">
                    <IconWind className="w-6 h-6" style={{ color: 'var(--accent-water)' }} />
                    <div className="flex flex-col leading-tight">
                        <h2 className="font-bold text-white text-lg">Air Control</h2>
                        <span className="text-xs text-gray-400">
                            {zones.length} {zones.length === 1 ? 'zone' : 'zones'}
                        </span>
                    </div>
                </div>
                <StatusPill status={status} />
            </div>

            {/* Zone grid (scrolls internally if it overflows the surface) */}
            <div className="flex-1 overflow-y-auto p-3 min-h-0">
                {zones.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-3 py-10">
                        <IconWind className="w-12 h-12 opacity-30" />
                        <p className="text-sm max-w-xs">
                            {status === 'connecting'
                                ? 'Connecting to Home Assistant…'
                                : 'No climate zones found. Air zones appear here automatically as climate.* entities come online.'}
                        </p>
                    </div>
                ) : (
                    <div
                        className="grid gap-3"
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}
                    >
                        {zones.map((zone) => (
                            <RoomClimateTile
                                key={zone.entityId}
                                zone={zone}
                                onSetTemperature={setTargetTemperature}
                                onSetHvacMode={setHvacMode}
                                onSetFanMode={setFanMode}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AirControlSurface;
