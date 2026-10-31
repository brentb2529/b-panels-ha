import React, { useMemo, useState } from 'react';
import { TileProps } from '../tileRegistry';
import TileWrapper from './TileWrapper';
import ScenxusModal from '../ScenxusModal';
import { fluidTextXs, fluidTextSm, fluidText2xl, fluidGap } from './tileScale';
import { useScenxus } from '../../hooks/useScenxus';
import { hasError } from '../../services/scenxusEntities';

// ScenXus scent diffuser: the tile shows status at a glance (fragrance left,
// mode, online/error); tapping opens ScenxusModal with every detail + controls.
// Optional device.state.dsn pins the tile to one diffuser; otherwise the first.

const LOW = 20;   // fragrance % that reads as "running low"
const EMPTY = 8;

const ScenxusTile: React.FC<TileProps> = ({ tile, device, isEditor }) => {
    const cfg = (device.state || {}) as { dsn?: string };
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
    const running = s.mode === '24/7' || s.mode === 'Run';
    const chip = err ? `Error ${s.errorCode}` : !s.online ? 'offline' : hasFrag ? (s.mode ?? '--') : (s.cycle?.split(' (')[0] ?? 'on');

    return (
        <>
        <TileWrapper
            label={label}
            accent={err || !s.online ? 'alert' : 'water'}
            isActive={running && s.online && !err}
            isUnavailable={!s.reachable}
            onClick={() => setOpen(true)}
        >
            <div className="flex-1 flex flex-col justify-between min-h-0 w-full" style={fluidGap(0.3)}>
                <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex items-baseline gap-1 min-w-0">
                        {hasFrag ? (
                            <>
                                <span className="font-semibold tabular-nums" style={{ ...fluidText2xl, color: tone }}>
                                    {Math.round(frag as number)}
                                </span>
                                <span className="text-white/40" style={fluidTextSm}>%</span>
                            </>
                        ) : (
                            <span className="font-semibold truncate" style={{ ...fluidText2xl, color: tone }}>
                                {s.mode ?? '--'}
                            </span>
                        )}
                    </div>
                    <span
                        className="shrink-0 px-1.5 py-[1px] rounded-full"
                        style={{
                            ...fluidTextXs,
                            background: err || !s.online ? 'rgb(var(--accent-alert) / 0.2)' : 'rgba(255,255,255,0.1)',
                            color: err || !s.online ? 'rgb(var(--accent-alert))' : 'rgba(255,255,255,0.7)',
                        }}
                    >
                        {chip}
                    </span>
                </div>
                <div className="text-white/45 truncate" style={fluidTextXs}>
                    {hasFrag ? 'fragrance left · ' : ''}
                    {typeof s.intensity === 'number' ? `intensity ${s.intensity}` : ''}
                    {typeof s.fan === 'number' ? ` · fan ${s.fan}` : ''}
                </div>
            </div>
        </TileWrapper>
        {/* Sibling, not child: portal events bubble through the React tree, so a
            child modal's backdrop click would re-trigger the tile's onClick. */}
        {open && <ScenxusModal device={diffuser} onClose={() => setOpen(false)} />}
        </>
    );
};

export default ScenxusTile;
