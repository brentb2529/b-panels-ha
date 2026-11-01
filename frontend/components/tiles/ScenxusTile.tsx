import React, { useMemo, useState } from 'react';
import { TileProps } from '../tileRegistry';
import TileWrapper from './TileWrapper';
import ScenxusModal from '../ScenxusModal';
import { fluidTextXs, fluidTextSm, fluidText2xl, fluidText3xl, fluidGap } from './tileScale';
import { useScenxus } from '../../hooks/useScenxus';
import { hasError } from '../../services/scenxusEntities';

// ScenXus scent diffuser: the tile shows status at a glance (fragrance left,
// mode, online/error); tapping opens ScenxusModal with every detail + controls.
// Optional device.state.dsn pins the tile to one diffuser; otherwise the first.

const LOW = 20;   // fragrance % that reads as "running low"
const EMPTY = 8;

const ScenxusTile: React.FC<TileProps> = ({ tile, device, isEditor }) => {
    const cfg = (device.state || {}) as { dsn?: string; fragrance?: string };
    const { devices, status } = useScenxus();
    const [open, setOpen] = useState(false);

    const diffuser = useMemo(() => {
        if (!devices.length) return undefined;
        if (cfg.dsn) return devices.find((d) => d.dsn === cfg.dsn);
        return devices[0];
    }, [devices, cfg.dsn]);

    const label = tile.label || device.name || diffuser?.name || 'Scent';

    if (isEditor || status === 'connecting') {
        return (
            <TileWrapper label={label} accent="water" isEditor={isEditor}>
                <div className="flex-1 grid place-items-center text-white/40" style={fluidTextSm}>
                    {isEditor ? 'ScenXus' : 'Connecting…'}
                </div>
            </TileWrapper>
        );
    }
    if (!diffuser) {
        return (
            <TileWrapper label={label} accent="water" isUnavailable>
                <div className="flex-1 grid place-items-center text-center px-2">
                    <span className="text-white/45" style={fluidTextXs}>
                        {status === 'unconfigured' ? 'ScenXus not set up' : `Diffuser ${cfg.dsn} not found`}
                    </span>
                </div>
            </TileWrapper>
        );
    }

    const s = diffuser.state;
    const err = hasError(s);
    // Cloud may report no fragrance level; fall back to mode as the headline.
    const frag = s.fragrance;
    const hasFrag = typeof frag === 'number';
    const tone = err || !s.online || (frag !== undefined && frag <= EMPTY) ? 'rgb(var(--accent-alert))'
        : frag !== undefined && frag <= LOW ? 'rgb(var(--accent-warn))'
        : 'rgb(var(--accent-water))';
    // Fragrance level drives the whole tile: it tints amber at LOW and red at
    // EMPTY (and on error/offline) so it reads from across the room.
    const level: 'ok' | 'low' | 'empty' = err || !s.online ? 'empty'
        : hasFrag && (frag as number) <= EMPTY ? 'empty'
        : hasFrag && (frag as number) <= LOW ? 'low' : 'ok';
    const running = s.mode === '24/7' || s.mode === 'Run';

    const subtitle = [
        s.mode,
        typeof s.intensity === 'number' ? `int ${s.intensity}` : null,
        typeof s.fan === 'number' ? `fan ${s.fan}` : null,
    ].filter(Boolean).join(' · ');

    return (
        <>
        <TileWrapper
            label={label}
            accent={level === 'empty' ? 'alert' : level === 'low' ? 'warn' : 'water'}
            isActive={level !== 'ok' || (running && s.online)}
            isUnavailable={!s.reachable}
            onClick={() => setOpen(true)}
        >
            <div className="flex-1 flex flex-col min-h-0 w-full" style={fluidGap(0.2)}>
                {/* scent name + status */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-white/85 font-medium truncate" style={fluidTextSm}>
                        {cfg.fragrance || 'Fragrance'}
                    </span>
                    {(err || !s.online) && (
                        <span
                            className="shrink-0 px-1.5 py-[1px] rounded-full"
                            style={{
                                ...fluidTextXs,
                                background: 'rgb(var(--accent-alert) / 0.2)',
                                color: 'rgb(var(--accent-alert))',
                            }}
                        >
                            {err ? `Error ${s.errorCode}` : 'offline'}
                        </span>
                    )}
                </div>

                {/* headline: remaining fragrance, or the mode when no level is reported */}
                <div className="flex-1 min-h-0 grid place-items-center">
                    {hasFrag ? (
                        <span className="font-semibold tabular-nums leading-none" style={{ ...fluidText3xl, color: tone }}>
                            {Math.round(frag as number)}
                            <span className="text-white/40" style={fluidTextSm}>%</span>
                        </span>
                    ) : (
                        <span className="font-semibold leading-none" style={{ ...fluidText2xl, color: tone }}>
                            {s.mode ?? '--'}
                        </span>
                    )}
                </div>

                <div className="text-white/45 truncate text-center" style={fluidTextXs}>{level === 'low' ? 'running low' : level === 'empty' && hasFrag && !err && s.online ? 'replace now' : subtitle}</div>
            </div>
        </TileWrapper>
        {/* Sibling, not child: portal events bubble through the React tree, so a
            child modal's backdrop click would re-trigger the tile's onClick. */}
        {open && <ScenxusModal device={diffuser} fragrance={cfg.fragrance} onClose={() => setOpen(false)} />}
        </>
    );
};

export default ScenxusTile;
