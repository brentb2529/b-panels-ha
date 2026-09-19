import React, { useMemo } from 'react';
import type { MoisturePoint } from '../../hooks/useIrrigationHistory';

// Soil-moisture sparkline: hourly mean as a line, hourly min/max as a band.
//
// The y-axis fits the DATA, never 0-100. Calibrated soil moisture lives in a
// narrow high band (these probes have run 90.9-97.1 since calibration), so a
// 0-100 axis draws every zone as the same flat line pinned to the top and hides
// the only thing worth looking at - the daily dry-down. Autoscaling costs an
// absolute reference, which is why the headline number sits beside the chart
// and the axis range is labelled.
//
// Plain inline SVG on purpose: no chart library, no animation, no canvas. These
// render on Fire tablets whose WebView is already leaking ~78 MB/hour, and four
// of these tiles are on the wall panel permanently.

interface Props {
    points: MoisturePoint[];
    /** Provisional refill line; drawn only when it falls inside the data range. */
    dryAt?: number;
    /** Colour of the trend line, so the tile can drive it from zone status. */
    stroke?: string;
    /** number (px) or a CSS length; pass "100%" to fill a flex parent. */
    height?: number | string;
}

const W = 100;

const MoistureSparkline: React.FC<Props> = ({ points, dryAt, stroke = 'rgb(var(--accent-water))', height = 26 }) => {
    const geom = useMemo(() => {
        if (points.length < 2) return null;

        const H = 100;
        let lo = Math.min(...points.map((p) => p.min));
        let hi = Math.max(...points.map((p) => p.max));

        // A dead-flat series would divide by zero; give it a visible band.
        if (hi - lo < 0.5) {
            const mid = (hi + lo) / 2;
            lo = mid - 0.5;
            hi = mid + 0.5;
        }
        const pad = (hi - lo) * 0.12;
        lo -= pad;
        hi += pad;

        const t0 = points[0].t;
        const tspan = Math.max(1, points[points.length - 1].t - t0);
        const x = (t: number) => ((t - t0) / tspan) * W;
        const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;

        const line = points.map((p) => `${x(p.t).toFixed(2)},${y(p.mean).toFixed(2)}`).join(' ');
        const band = [
            ...points.map((p) => `${x(p.t).toFixed(2)},${y(p.max).toFixed(2)}`),
            ...points.slice().reverse().map((p) => `${x(p.t).toFixed(2)},${y(p.min).toFixed(2)}`),
        ].join(' ');

        const last = points[points.length - 1];
        const dryY = typeof dryAt === 'number' && dryAt > lo && dryAt < hi ? y(dryAt) : null;

        return { line, band, H, dryY, lastX: x(last.t), lastY: y(last.mean), lo, hi };
    }, [points, dryAt]);

    if (!geom) {
        return (
            <div
                className="w-full grid place-items-center text-white/25"
                style={{ height, fontSize: '0.6em' }}
            >
                {points.length ? 'building history…' : 'no history yet'}
            </div>
        );
    }

    return (
        <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${W} ${geom.H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            style={{ display: 'block', overflow: 'visible' }}
        >
            <polygon points={geom.band} fill={stroke} opacity={0.22} />
            {geom.dryY !== null && (
                <line
                    x1={0}
                    x2={W}
                    y1={geom.dryY}
                    y2={geom.dryY}
                    stroke="rgb(var(--accent-warn))"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    opacity={0.8}
                    vectorEffect="non-scaling-stroke"
                />
            )}
            <polyline
                points={geom.line}
                fill="none"
                stroke={stroke}
                strokeWidth={2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
            <circle cx={geom.lastX} cy={geom.lastY} r={2.4} fill={stroke} vectorEffect="non-scaling-stroke" />
        </svg>
    );
};

export default MoistureSparkline;
