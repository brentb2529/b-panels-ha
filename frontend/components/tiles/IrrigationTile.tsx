import React, { useMemo } from 'react';
import { TileProps } from '../tileRegistry';
import TileWrapper from './TileWrapper';
import { fluidTextXs, fluidTextSm, fluidTextLg, fluidText2xl, fluidGap } from './tileScale';
import { useIrrigationZones, isReadingStale } from '../../hooks/useIrrigationZones';
import type { IrrigationZoneState } from '../../services/irrigationEntities';

// Irrigation tile: one zone's soil state, water balance and irrigation history.
//
// REPORT ONLY, deliberately. It shows soil trend, ET0, rainfall, deficit and
// days-since-run, but emits no water/hold verdict. Thresholds chosen before the
// probes finish calibrating would be guesses, and picking numbers early is
// exactly how the previous soil probes ended up with alert thresholds that
// meant nothing. The verdict layer lands when there is calibrated data to tune
// against.
//
// A zone can be ONLINE BUT UNCALIBRATED for days after install (GeoDrops
// profiles the soil first), so the tile must render health and trend from the
// raw signal without pretending to have a calibrated moisture percentage.

interface IrrigationConfig {
    zoneId?: string;
}

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

const Row: React.FC<{ label: string; value: string; dim?: boolean }> = ({ label, value, dim }) => (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span className="text-white/45 truncate" style={fluidTextXs}>{label}</span>
        <span className={dim ? 'text-white/45 tabular-nums' : 'text-white/85 tabular-nums'} style={fluidTextXs}>
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
                                    className="h-full rounded-full bg-[var(--accent-water)]"
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

    // Headline: the calibrated percentage once we have one, otherwise the raw
    // signal explicitly marked as such. Never show raw as if it were moisture -
    // the two are on different scales (raw 69 corresponds to ~86 calibrated).
    const headline = calibrated ? fmt(s.moisture, 0) : fmt(s.moistureRaw, 0);

    return (
        <TileWrapper
            label={label}
            accent="water"
            isUnavailable={!s.online}
            // Bottom slot, not the default top-left: the top-left overlay sits
            // directly on top of the headline reading and clips it.
            batteryLevel={typeof s.battery === 'number' ? s.battery : undefined}
            batteryPosition="bottom"
        >
            <div className="flex-1 flex flex-col min-h-0 w-full" style={fluidGap(0.35)}>
                {/* headline + state chip */}
                <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex items-baseline gap-1 min-w-0">
                        <span className="text-white font-semibold tabular-nums" style={fluidText2xl}>
                            {headline}
                        </span>
                        <span className="text-white/40" style={fluidTextSm}>%</span>
                        {!calibrated && (
                            <span className="text-white/35 ml-1" style={fluidTextXs}>raw</span>
                        )}
                    </div>
                    <span
                        className={`shrink-0 px-1.5 py-[1px] rounded-full ${
                            stale
                                ? 'bg-[var(--accent-warn)]/20 text-[var(--accent-warn)]'
                                : calibrated
                                  ? 'bg-[var(--accent-water)]/20 text-[var(--accent-water)]'
                                  : 'bg-white/10 text-white/50'
                        }`}
                        style={fluidTextXs}
                        title={
                            stale
                                ? `Newest reading ${fmtInt(s.readingAgeMinutes)} min old`
                                : calibrated
                                  ? `Reading quality ${s.quality ?? '?'}`
                                  : s.nextAction || 'Calibrating'
                        }
                    >
                        {stale ? 'stale' : calibrated ? 'live' : 'calibrating'}
                    </span>
                </div>

                {calibrated ? (
                    <DepthBars zone={zone} />
                ) : (
                    <div className="text-white/35 leading-snug" style={fluidTextXs}>
                        {s.nextAction === 'ATT_SS_NEW'
                            ? 'Soil profiling — GeoDrops is learning this soil. Depth readings and calibrated moisture appear when it finishes (typically ~6 days).'
                            : 'Soil profiling — depth readings appear once calibration completes.'}
                    </div>
                )}

                <div className="flex-1 min-h-0" />

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
                    <Row label="ET₀ 7d" value={fmt(s.et07d, 2, ' in')} dim={s.et07d === undefined} />
                    <Row label="rain 7d" value={fmt(s.rain7d, 2, ' in')} dim={s.rain7d === undefined} />
                    <Row label="deficit" value={fmt(s.deficitIn, 2, ' in')} dim={s.deficitIn === undefined} />
                    <Row label="last run" value={sinceLabel(s.daysSinceRun)} dim={s.daysSinceRun === undefined} />
                </div>
            </div>
        </TileWrapper>
    );
};

export default IrrigationTile;
