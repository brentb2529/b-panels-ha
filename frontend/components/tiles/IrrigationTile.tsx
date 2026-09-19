import React, { useMemo } from 'react';
import { TileProps } from '../tileRegistry';
import TileWrapper from './TileWrapper';
import { fluidTextXs, fluidTextSm, fluidText2xl, fluidGap } from './tileScale';
import { useIrrigationZones, isReadingStale } from '../../hooks/useIrrigationZones';
import { useIrrigationHistory } from '../../hooks/useIrrigationHistory';
import MoistureSparkline from './MoistureSparkline';
import type { IrrigationZoneState } from '../../services/irrigationEntities';

// Irrigation tile: one zone's soil state, trend and water balance.
//
// ON THRESHOLDS, read this before changing DEFAULT_DRY_AT.
// The probes finished soil-profiling on 2026-09-18. Every calibrated reading
// since has sat between 90.9 and 97.1 (97.1 being field capacity), so we have
// NEVER observed a dry-down on the calibrated scale. DEFAULT_DRY_AT is
// therefore the standard turf refill point - 50% of plant-available water - and
// NOT a number fitted to these probes. It is provisional, and it is deliberately
// overridable per tile so it can be tuned against a real dry-down instead of
// being guessed twice. The previous soil probes shipped hand-picked thresholds
// that meant nothing; that is the mistake this comment exists to prevent.
//
// The tile still emits no water/hold verdict. It shows how dry the soil is and
// how fast it is heading there, and lets a human decide.
//
// A zone can be ONLINE BUT UNCALIBRATED for days after install, so the tile
// must render health and trend from the raw signal without pretending to have a
// calibrated percentage.

interface IrrigationConfig {
    zoneId?: string;
    /** Override the provisional refill point for this zone. */
    dryAt?: number;
}

/** Turf refill point: 50% depletion of plant-available water. Provisional. */
const DEFAULT_DRY_AT = 50;

/** Within this many points of the refill line, the zone reads as "drying". */
const WARN_BAND = 12;

type Status = 'wet' | 'drying' | 'dry';

const fmt = (v: unknown, digits = 1, suffix = ''): string =>
    typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : '--';

const fmtInt = (v: unknown, suffix = ''): string =>
    typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}${suffix}` : '--';

/** "13d" / "4h" — irrigation cadence is days, so hours only matter when recent. */
const sinceLabel = (days: unknown): string => {
    if (typeof days !== 'number' || !Number.isFinite(days)) return 'never';
    if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
    return `${Math.round(days)}d`;
};

// NB: the palette stores bare RGB triples ("56 189 248") for Tailwind's
// <alpha-value> slot, NOT colours. Using var(--accent-water) directly as a
// stroke/color yields invalid CSS and silently falls back to black - which is
// exactly how the first cut of this sparkline rendered as a dark smudge.
const STATUS_COLOR: Record<Status, string> = {
    wet: 'rgb(var(--accent-water))',
    drying: 'rgb(var(--accent-warn))',
    dry: 'rgb(var(--accent-alert))',
};

const Row: React.FC<{ label: string; value: string; dim?: boolean; tone?: string }> = ({
    label, value, dim, tone,
}) => (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span className="text-white/45 truncate" style={fluidTextXs}>{label}</span>
        <span
            className={dim ? 'text-white/45 tabular-nums' : 'text-white/85 tabular-nums'}
            style={tone ? { ...fluidTextXs, color: tone } : fluidTextXs}
        >
            {value}
        </span>
    </div>
);

/** Depth profile as three stacked bars: surface at top, deepest at bottom. */
const DepthBars: React.FC<{ zone: IrrigationZoneState }> = ({ zone }) => {
    const depths = [zone.state.depth1, zone.state.depth2, zone.state.depth3];
    const ok = [zone.state.depth1_ok, zone.state.depth2_ok, zone.state.depth3_ok];
    if (!depths.some((d) => typeof d === 'number')) return null;
    return (
        <div className="flex flex-col gap-[2px] w-full">
            {depths.map((d, i) => {
                const has = typeof d === 'number' && ok[i] !== false;
                return (
                    <div key={i} className="flex items-center gap-1.5 min-w-0">
                        <span className="text-white/30 shrink-0" style={fluidTextXs}>
                            {`d${i + 1}`}
                        </span>
                        <div className="flex-1 h-[5px] rounded-full bg-white/10 overflow-hidden">
                            {has && (
                                <div
                                    className="h-full rounded-full bg-[rgb(var(--accent-water))]"
                                    style={{ width: `${Math.max(0, Math.min(100, d as number))}%` }}
                                />
                            )}
                        </div>
                        <span className="text-white/50 tabular-nums shrink-0 w-7 text-right" style={fluidTextXs}>
                            {has ? Math.round(d as number) : '--'}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

const IrrigationTile: React.FC<TileProps> = ({ tile, device, isEditor }) => {
    const cfg = (device.state || {}) as IrrigationConfig;
    const { zones, status } = useIrrigationZones();

    // Every zone's moisture entity, not just this tile's: the history hook
    // shares one statistics query across all four tiles.
    const historyIds = useMemo(
        () => zones.map((z) => z.state.moistureEntityId).filter((x): x is string => !!x),
        [zones],
    );
    const history = useIrrigationHistory(historyIds);

    const zone = useMemo(() => {
        if (!zones.length) return undefined;
        if (cfg.zoneId) return zones.find((z) => z.zoneId === cfg.zoneId);
        return zones[0];
    }, [zones, cfg.zoneId]);

    const label = tile.label || zone?.name || device.name || 'Irrigation';

    if (isEditor || status === 'connecting') {
        return (
            <TileWrapper label={label} accent="water" isEditor={isEditor}>
                <div className="flex-1 grid place-items-center text-white/40" style={fluidTextSm}>
                    {isEditor ? 'Irrigation' : 'Connecting…'}
                </div>
            </TileWrapper>
        );
    }

    if (!zone) {
        return (
            <TileWrapper label={label} accent="water" isUnavailable>
                <div className="flex-1 grid place-items-center text-center px-2">
                    <span className="text-white/45" style={fluidTextXs}>
                        {status === 'unconfigured'
                            ? 'No soil probes configured'
                            : `Zone "${cfg.zoneId}" not publishing`}
                    </span>
                </div>
            </TileWrapper>
        );
    }

    const s = zone.state;
    const stale = isReadingStale(zone);
    const calibrated = !!s.calibrated;
    const drying = s.dryingRatePerDay as number | undefined;
    const dryAt = typeof cfg.dryAt === 'number' ? cfg.dryAt : DEFAULT_DRY_AT;

    const moisture = calibrated && typeof s.moisture === 'number' ? s.moisture : undefined;
    const points = s.moistureEntityId ? history[s.moistureEntityId] ?? [] : [];

    const zoneStatus: Status =
        moisture === undefined ? 'wet'
            : moisture <= dryAt ? 'dry'
                : moisture <= dryAt + WARN_BAND ? 'drying'
                    : 'wet';
    const tone = STATUS_COLOR[zoneStatus];

    // Days until the soil reaches the refill line at the CURRENT drying rate.
    // Negative rate = losing moisture. A rising or flat trend has no ETA, and a
    // projection past a week is noise, so it is capped rather than shown.
    // Plain expression, NOT useMemo: this sits after the early returns above,
    // so a hook here would be a conditional hook call and React unmounts the
    // tile into its error boundary.
    const daysToDry =
        moisture === undefined || typeof drying !== 'number' || drying >= -0.05
            ? undefined
            : Math.max(0, (moisture - dryAt) / -drying);

    const headline = calibrated ? fmt(s.moisture, 0) : fmt(s.moistureRaw, 0);
    // Progressive disclosure by tile size. A 1x1 shows the reading, its status
    // and the trend; the stat rows and depth profile need a taller tile to be
    // legible rather than clipped.
    const h = tile.height ?? 1;
    const showDetail = h >= 2;
    const showDepth = h >= 3;

    return (
        <TileWrapper
            label={label}
            accent="water"
            isUnavailable={!s.online}
            batteryLevel={typeof s.battery === 'number' ? s.battery : undefined}
            batteryPosition="bottom"
        >
            <div className="flex-1 flex flex-col min-h-0 w-full" style={fluidGap(0.3)}>
                {/* headline + state chip */}
                <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex items-baseline gap-1 min-w-0">
                        <span
                            className="font-semibold tabular-nums"
                            style={{ ...fluidText2xl, color: calibrated ? tone : '#fff' }}
                        >
                            {headline}
                        </span>
                        <span className="text-white/40" style={fluidTextSm}>%</span>
                        {!calibrated && (
                            <span className="text-white/35 ml-1" style={fluidTextXs}>raw</span>
                        )}
                    </div>
                    <span
                        className="shrink-0 px-1.5 py-[1px] rounded-full"
                        style={{
                            ...fluidTextXs,
                            background: stale ? 'rgb(var(--accent-warn) / 0.2)'
                                : calibrated ? tone.replace('))', ') / 0.2)')
                                    : 'rgba(255,255,255,0.1)',
                            color: stale ? 'rgb(var(--accent-warn))' : calibrated ? tone : 'rgba(255,255,255,0.5)',
                        }}
                        title={
                            stale
                                ? `Newest reading ${fmtInt(s.readingAgeMinutes)} min old`
                                : calibrated
                                    ? `Refill line ${dryAt}% (provisional). Reading quality ${s.quality ?? '?'}`
                                    : s.nextAction || 'Calibrating'
                        }
                    >
                        {stale ? 'stale' : !calibrated ? 'calibrating' : zoneStatus}
                    </span>
                </div>

                {calibrated ? (
                    // The chart takes the leftover height. At 1x1 — which is how
                    // all four of these sit on the wall panel — there is no room
                    // for the stat rows, so the trend IS the tile and it gets the
                    // whole box rather than a 26px sliver nobody can read.
                    // pb keeps the trace clear of TileWrapper's zone label, which
                    // sits directly beneath it: without it a low reading draws
                    // straight through the text.
                    <div className="flex-1 min-h-0 w-full pb-[7px]">
                        <MoistureSparkline points={points} dryAt={dryAt} stroke={tone} height="100%" />
                    </div>
                ) : (
                    <div className="text-white/35 leading-snug" style={fluidTextXs}>
                        {s.nextAction === 'ATT_SS_NEW'
                            ? 'Soil profiling — GeoDrops is learning this soil. Depth readings and calibrated moisture appear when it finishes (typically ~6 days).'
                            : 'Soil profiling — depth readings appear once calibration completes.'}
                    </div>
                )}

                {showDepth && calibrated && <DepthBars zone={zone} />}

                {showDetail && (
                <div className="flex flex-col" style={fluidGap(0.15)}>
                    <Row
                        label="trend"
                        value={
                            typeof drying === 'number'
                                ? `${drying > 0 ? '+' : ''}${drying.toFixed(1)} pts/day`
                                : '--'
                        }
                        dim={typeof drying !== 'number'}
                    />
                    <Row
                        label="dry in"
                        value={
                            daysToDry === undefined ? '--'
                                : daysToDry > 7 ? '7d+'
                                    : daysToDry < 1 ? `${Math.max(1, Math.round(daysToDry * 24))}h`
                                        : `${daysToDry.toFixed(1)}d`
                        }
                        dim={daysToDry === undefined}
                        tone={daysToDry !== undefined && daysToDry <= 2 ? tone : undefined}
                    />
                    <Row label="deficit" value={fmt(s.deficitIn, 2, ' in')} dim={s.deficitIn === undefined} />
                    <Row label="last run" value={sinceLabel(s.daysSinceRun)} dim={s.daysSinceRun === undefined} />
                </div>
                )}
            </div>
        </TileWrapper>
    );
};

export default IrrigationTile;
