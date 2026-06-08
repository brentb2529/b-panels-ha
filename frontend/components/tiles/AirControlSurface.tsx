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
//
// VISUAL: Liquid Glass / Apple design system (feat/liquid-glass). All data
// bindings, master/slave nesting, and service wiring are unchanged.

import React from 'react';
import { useClimateZones } from '../../hooks/useClimateZones';
import RoomClimateTile from './RoomClimateTile';
import { resolveModeTarget, zoneRole, type ClimateGroup, type ClimateZone } from '../../services/climate';
import { IconWind, IconLoader2, IconWifiOff } from '../icons';
import type { TileProps } from '../tileRegistry';

// ── Status pill ────────────────────────────────────────────────────────────
const StatusPill = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => {
    if (status === 'live') {
        return (
            <span
                className="flex items-center gap-1.5"
                style={{
                    fontSize: 'var(--type-xs)',
                    fontWeight: 'var(--weight-semibold)',
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase',
                    color: 'rgb(52 211 153)',
                }}
            >
                <span
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'rgb(52 211 153)',
                        boxShadow: '0 0 6px 2px rgba(52,211,153,0.55)',
                        animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
                        display: 'inline-block',
                    }}
                />
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
                    fontWeight: 'var(--weight-semibold)',
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase',
                    color: 'rgba(var(--text) / 0.45)',
                }}
            >
                <IconLoader2 className="w-3 h-3" style={{ animation: 'spin 1s linear infinite' }} />
                Connecting
            </span>
        );
    }
    return (
        <span
            className="flex items-center gap-1.5"
            style={{
                fontSize: 'var(--type-xs)',
                fontWeight: 'var(--weight-semibold)',
                letterSpacing: 'var(--tracking-caps)',
                textTransform: 'uppercase',
                color: 'rgb(251 146 60)',
            }}
        >
            <IconWifiOff style={{ width: 12, height: 12 }} />
            Stale
        </span>
    );
};

type SetTemp = (entityId: string, temperature: number) => void;
type SetMode = (zone: ClimateZone, group: ClimateGroup, hvacMode: string) => void;
type SetFan  = (entityId: string, fanMode: string) => void;

// ── Single zone tile wired to topology-aware handlers ─────────────────────
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
    const role   = zoneRole(zone);
    const target = resolveModeTarget(zone, group);
    return (
        <RoomClimateTile
            zone={zone}
            role={role}
            masterName={role === 'slave' ? target.masterName ?? group.master.name : undefined}
            modeRouted={target.routed}
            nested={nested}
            onSetTemperature={onSetTemperature}
            onCycleHvacMode={(next) => onSetHvacMode(zone, group, next)}
            onSetFanMode={onSetFanMode}
        />
    );
};

// ── Master cluster card — master + slaves in nested sub-grid ───────────────
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
        style={{
            borderRadius: 'var(--radius-card)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            // Level-4 deepest glass: cluster wrapper is most transparent
            backdropFilter:       'blur(var(--glass-l4-blur)) saturate(var(--glass-l4-saturate))',
            WebkitBackdropFilter: 'blur(var(--glass-l4-blur)) saturate(var(--glass-l4-saturate))',
            backgroundColor: 'color-mix(in srgb, var(--accent) 6%, var(--glass-l4-bg))',
            backgroundImage: 'var(--specular-default)',
            border:          '1px solid color-mix(in srgb, var(--accent) 28%, var(--glass-l4-border))',
            boxShadow:       'var(--specular-bevel), var(--elev-2)',
        }}
    >
        {/* Master zone tile */}
        <ZoneTile
            zone={group.master}
            group={group}
            onSetTemperature={onSetTemperature}
            onSetHvacMode={onSetHvacMode}
            onSetFanMode={onSetFanMode}
        />

        {/* Slave group divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-1)' }}>
            <span
                style={{
                    fontSize: 'var(--type-2xs)',
                    fontWeight: 600,
                    letterSpacing: 'var(--tracking-caps)',
                    textTransform: 'uppercase',
                    color: 'rgba(var(--text) / 0.38)',
                }}
            >
                {group.slaves.length} slave {group.slaves.length === 1 ? 'zone' : 'zones'}
            </span>
            <div
                style={{
                    flex: 1,
                    height: 1,
                    background: 'var(--glass-l4-border)',
                }}
            />
        </div>

        {/* Slave sub-grid */}
        <div
            style={{
                display: 'grid',
                gap: 'var(--space-3)',
                gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))',
            }}
        >
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

// ── Empty state ────────────────────────────────────────────────────────────
const EmptyState = ({ status }: { status: 'connecting' | 'live' | 'stale' }) => (
    <div
        style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-10) var(--space-6)',
        }}
    >
        <div
            style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--radius-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter:       'blur(var(--glass-l3-blur)) saturate(var(--glass-l3-saturate))',
                WebkitBackdropFilter: 'blur(var(--glass-l3-blur)) saturate(var(--glass-l3-saturate))',
                backgroundColor: 'var(--glass-l3-bg)',
                border: '1px solid var(--glass-l3-border)',
                boxShadow: 'var(--specular-bevel), var(--elev-2)',
            }}
        >
            <IconWind style={{ width: 24, height: 24, color: 'rgba(var(--text) / 0.22)' }} />
        </div>
        <p
            style={{
                fontSize: 'var(--type-sm)',
                color: 'rgba(var(--text) / 0.40)',
                textAlign: 'center',
                maxWidth: '22rem',
                lineHeight: 1.55,
                fontWeight: 400,
            }}
        >
            {status === 'connecting'
                ? 'Connecting to Home Assistant…'
                : 'No climate zones found. Air zones appear here automatically as climate.· entities come online.'}
        </p>
    </div>
);

// ── Surface root ───────────────────────────────────────────────────────────
// `tile`/`device` are part of the shared TileProps contract but this surface is
// self-driven (it discovers its own entities), so they're unused here.
const AirControlSurface = (_props: TileProps) => {
    const { zones, groups, status, setTargetTemperature, setHvacMode, setFanMode } = useClimateZones();

    const clusterCount = groups.filter((g) => g.isCluster).length;

    return (
        /* Outermost surface: level-1 glass, surface-radius, fills the tile slot */
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                borderRadius: 'var(--radius-surface)',
                overflow: 'hidden',
                // Level-1 base glass
                backdropFilter:       'blur(var(--glass-l1-blur)) saturate(var(--glass-l1-saturate))',
                WebkitBackdropFilter: 'blur(var(--glass-l1-blur)) saturate(var(--glass-l1-saturate))',
                backgroundColor: 'var(--glass-l1-bg)',
                backgroundImage: 'var(--specular-default)',
                border: '1px solid var(--glass-l1-border)',
                boxShadow: 'var(--specular-bevel), var(--elev-3)',
                // Spring-animated mount
                animation: 'glass-mount var(--dur-enter, 320ms) var(--spring-gentle, cubic-bezier(0.22,1,0.36,1)) both',
            }}
        >
            {/* ── Surface header ────────────────────────────────────────── */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: '1px solid var(--glass-l1-border)',
                    flexShrink: 0,
                    // Header gets its own micro-glass layer to separate from scroll content
                    backdropFilter:       'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    backgroundColor: 'rgba(255,255,255,0.025)',
                }}
            >
                {/* Title group */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {/* Icon bead */}
                    <div
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 'var(--radius-control)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backdropFilter:       'blur(var(--glass-l3-blur)) saturate(var(--glass-l3-saturate))',
                            WebkitBackdropFilter: 'blur(var(--glass-l3-blur)) saturate(var(--glass-l3-saturate))',
                            backgroundColor: 'color-mix(in srgb, var(--accent-water) 18%, var(--glass-l3-bg))',
                            border: '1px solid color-mix(in srgb, var(--accent-water) 40%, var(--glass-l3-border))',
                            boxShadow: 'var(--specular-bevel), 0 0 12px -3px color-mix(in srgb, var(--accent-water) 45%, transparent)',
                        }}
                    >
                        <IconWind style={{ width: 18, height: 18, color: 'var(--accent-water)' }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                            Air Control
                        </h2>
                        <span
                            style={{
                                fontSize: 'var(--type-xs)',
                                fontWeight: 500,
                                letterSpacing: 'var(--tracking-default)',
                                color: 'rgba(var(--text) / 0.45)',
                                lineHeight: 1,
                            }}
                        >
                            {zones.length} {zones.length === 1 ? 'zone' : 'zones'}
                            {clusterCount > 0 && ` · ${clusterCount} ${clusterCount === 1 ? 'system' : 'systems'}`}
                        </span>
                    </div>
                </div>

                <StatusPill status={status} />
            </div>

            {/* ── Scrollable zone grid ──────────────────────────────────── */}
            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: 'var(--space-4)',
                    minHeight: 0,
                }}
            >
                {zones.length === 0 ? (
                    <EmptyState status={status} />
                ) : (
                    <div
                        style={{
                            display: 'grid',
                            gap: 'var(--space-4)',
                            alignItems: 'start',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))',
                        }}
                    >
                        {groups.map((group) =>
                            group.isCluster ? (
                                // Cluster spans full row so slaves have room to lay out
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
