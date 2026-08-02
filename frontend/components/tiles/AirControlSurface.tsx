// The bespoke per-room AIR CONTROL marquee surface.
//
// Discovers every controllable `climate.*` zone dynamically (via useClimateZones
// → subscribeEntities), groups them by Airzone master/slave topology, and lays
// the groups out in a responsive grid that reads at room distance on a wall
// panel and reflows to a single column on mobile. No polling; live updates flow
// from the hook.
//
// Master clusters render the master card with its slave cards nested beneath in
// a bordered group; standalone zones (no topology attrs, or attrs present but
// unresolved) render exactly as before. This is registered as a single
// DeviceType.AirControl tile (the FlairTile precedent: one registered tile that
// renders many rooms). It owns its own subscription and does NOT go through the
// device-mapping pipeline — all data/control still flows through haClient.ts.

import React from 'react';
import { useClimateZones } from '../../hooks/useClimateZones';
import RoomClimateTile from './RoomClimateTile';
import { resolveModeTarget, zoneRole, type ClimateGroup, type ClimateZone } from '../../services/climate';
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

type SetTemp = (entityId: string, temperature: number) => void;
type SetMode = (zone: ClimateZone, group: ClimateGroup, hvacMode: string) => void;
type SetFan = (entityId: string, fanMode: string) => void;

// One climate zone tile wired to the right topology-aware handlers.
const ZoneTile = ({
    zone,
    group,
    nested,
    onSetTemperature,
    onSetHvacMode,
    onSetFanMode,
}: {
    zone: ClimateZone;
    group: ClimateGroup;
    nested?: boolean;
    onSetTemperature: SetTemp;
    onSetHvacMode: SetMode;
    onSetFanMode: SetFan;
}) => {
    const role = zoneRole(zone);
    const target = resolveModeTarget(zone, group);
    return (
        <RoomClimateTile
            zone={zone}
            role={role}
            masterName={role === 'slave' ? target.masterName ?? group.master.name : undefined}
            // A slave's mode control stays enabled only when we can route it to a
            // master entity_id; otherwise the tile shows "mode follows master".
            modeRouted={target.routed}
            nested={nested}
            onSetTemperature={onSetTemperature}
            onCycleHvacMode={(next) => onSetHvacMode(zone, group, next)}
            onSetFanMode={onSetFanMode}
        />
    );
};

// A master cluster: the master card with its slaves nested beneath in a
// bordered group, so the master↔slave relationship is visually unmistakable.
const ClusterCard = ({
    group,
    onSetTemperature,
    onSetHvacMode,
    onSetFanMode,
}: {
    group: ClimateGroup;
    onSetTemperature: SetTemp;
    onSetHvacMode: SetMode;
    onSetFanMode: SetFan;
}) => (
    <div
        className="rounded-tile p-2.5 flex flex-col gap-2.5"
        style={{
            border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--tile-border))',
            background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
        }}
    >
        <ZoneTile
            zone={group.master}
            group={group}
            onSetTemperature={onSetTemperature}
            onSetHvacMode={onSetHvacMode}
            onSetFanMode={onSetFanMode}
        />
        <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {group.slaves.length} slave {group.slaves.length === 1 ? 'zone' : 'zones'}
            </span>
            <div className="flex-1 h-px" style={{ background: 'var(--tile-border)' }} />
        </div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
            {group.slaves.map((slave) => (
                <ZoneTile
                    key={slave.entityId}
                    zone={slave}
                    group={group}
                    nested
                    onSetTemperature={onSetTemperature}
                    onSetHvacMode={onSetHvacMode}
                    onSetFanMode={onSetFanMode}
                />
            ))}
        </div>
    </div>
);

// `tile`/`device` are part of the shared TileProps contract but this surface is
// self-driven (it discovers its own entities), so they're unused here.
const AirControlSurface = (_props: TileProps) => {
    const { zones, groups, status, setTargetTemperature, setHvacMode, setFanMode } = useClimateZones();

    const clusterCount = groups.filter((g) => g.isCluster).length;

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
                            {clusterCount > 0 && ` · ${clusterCount} ${clusterCount === 1 ? 'system' : 'systems'}`}
                        </span>
                    </div>
                </div>
                <StatusPill status={status} />
            </div>

            {/* Group grid (scrolls internally if it overflows the surface) */}
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
                        className="grid gap-3 items-start"
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}
                    >
                        {groups.map((group) =>
                            group.isCluster ? (
                                // A cluster spans the full row so its nested slaves
                                // have room to lay out in their own sub-grid.
                                <div key={group.key} style={{ gridColumn: '1 / -1' }}>
                                    <ClusterCard
                                        group={group}
                                        onSetTemperature={setTargetTemperature}
                                        onSetHvacMode={setHvacMode}
                                        onSetFanMode={setFanMode}
                                    />
                                </div>
                            ) : (
                                <ZoneTile
                                    key={group.key}
                                    zone={group.master}
                                    group={group}
                                    onSetTemperature={setTargetTemperature}
                                    onSetHvacMode={setHvacMode}
                                    onSetFanMode={setFanMode}
                                />
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AirControlSurface;
