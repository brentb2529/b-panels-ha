import React, { useMemo, useState, useEffect } from 'react';
import Modal from './Modal';
import { useDashboard, useDashboardActions } from '../hooks/useDashboard';
import { Device, ColorTempRange } from '../types';
import TileSlider from './tiles/TileSlider';

// Full light control: brightness, preset whites, a fine colour-temperature
// slider, and arbitrary colour. Lives in a modal because the picker can't fit
// in a 1x1 tile.
//
// Colour vs colour-temperature are MUTUALLY EXCLUSIVE on the wire: a light is
// either in `hs` mode or `color_temp` mode, never both. Every commit therefore
// sends exactly one of `hsColor` / `colorTemp` and explicitly clears the other,
// so the optimistic merge in useDashboard can't leave a stale value behind that
// the service layer would then prefer. (homeassistant.ts checks hsColor first.)

const DEFAULT_RANGE: ColorTempRange = { min: 2000, max: 6500 };

// Preset whites, filtered at render time to what the device can actually
// produce. Labels are what the light looks like, not marketing names.
const WHITE_PRESETS: { k: number; label: string }[] = [
    { k: 2000, label: 'Candle' },
    { k: 2200, label: 'Amber' },
    { k: 2400, label: 'Warm' },
    { k: 2700, label: 'Soft' },
    { k: 3000, label: 'Warm White' },
    { k: 3500, label: 'Neutral' },
    { k: 4000, label: 'Cool White' },
    { k: 5000, label: 'Daylight' },
    { k: 6500, label: 'Cool Day' },
];

const QUICK_COLORS: { hex: string; label: string }[] = [
    { hex: '#ff0000', label: 'Red' },
    { hex: '#ff7a00', label: 'Orange' },
    { hex: '#ffd400', label: 'Yellow' },
    { hex: '#37d67a', label: 'Green' },
    { hex: '#00b5d8', label: 'Cyan' },
    { hex: '#2f6bff', label: 'Blue' },
    { hex: '#8b5cf6', label: 'Violet' },
    { hex: '#ff4fa3', label: 'Pink' },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Planckian locus approximation (Tanner Helland). Good enough for swatches.
export const kelvinToHex = (kelvin: number): string => {
    const t = clamp(kelvin, 1000, 12000) / 100;
    let r: number, g: number, b: number;
    if (t <= 66) r = 255;
    else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
    else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    if (t >= 66) b = 255;
    else if (t <= 19) b = 0;
    else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
};

const hexToHs = (hex: string): [number, number] => {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return [h, Math.round(s * 100)];
};

const hsToHex = (hs: [number, number]) => {
    const [h, s] = hs;
    const l = 0.5;
    const a = (s / 100) * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
};

type LightState = {
    level?: number;
    isOn?: boolean;
    hsColor?: [number, number];
    colorTemp?: number;
    colorTempRange?: ColorTempRange;
    supportsColor?: boolean;
    supportsColorTemp?: boolean;
};

const readState = (device: Device | undefined): LightState => {
    const s = device?.state;
    if (typeof s === 'number') return { level: s, isOn: s > 0 };
    if (s && typeof s === 'object' && !Array.isArray(s)) return s as LightState;
    return { level: s ? 100 : 0, isOn: Boolean(s) };
};

const LightControlModal = ({ deviceId, onClose }: { deviceId: string; onClose: () => void }) => {
    const { deviceMap } = useDashboard();
    const { updateDeviceState } = useDashboardActions();
    const device = deviceMap.get(deviceId);
    const live = readState(device);

    const supportsColor = Boolean(device?.supportsColor || live.supportsColor);
    const supportsTemp = Boolean(device?.supportsColorTemp || live.supportsColorTemp);
    const range = device?.colorTempRange || live.colorTempRange || DEFAULT_RANGE;

    const isOn = live.isOn ?? (live.level ?? 0) > 0;
    const [level, setLevel] = useState<number>(live.level ?? 100);
    const [temp, setTemp] = useState<number>(live.colorTemp ?? Math.round((range.min + range.max) / 2));
    const [hex, setHex] = useState<string>(live.hsColor ? hsToHex(live.hsColor) : '#ffffff');

    // Follow live state unless the user is mid-drag (commit resets it).
    useEffect(() => { setLevel(live.level ?? 0); }, [live.level]);
    useEffect(() => { if (typeof live.colorTemp === 'number') setTemp(live.colorTemp); }, [live.colorTemp]);
    useEffect(() => { if (live.hsColor) setHex(hsToHex(live.hsColor)); }, [live.hsColor?.[0], live.hsColor?.[1]]);

    const presets = useMemo(
        () => WHITE_PRESETS.filter(p => p.k >= range.min && p.k <= range.max),
        [range.min, range.max]
    );

    // Whichever mode the light is currently in, so the UI can show what's active.
    const inTempMode = typeof live.colorTemp === 'number' && !live.hsColor;

    const send = (patch: LightState) => {
        const lvl = patch.level ?? (level > 0 ? level : 100);
        updateDeviceState(deviceId, {
            colorTempRange: range,
            supportsColor,
            supportsColorTemp: supportsTemp,
            ...patch,
            level: lvl,
            isOn: patch.isOn ?? true,
        } as any);
    };

    const applyTemp = (k: number) => {
        setTemp(k);
        // Explicitly clear hsColor so the service layer picks color_temp_kelvin.
        send({ colorTemp: k, hsColor: undefined, isOn: true });
    };

    const applyColor = (nextHex: string) => {
        setHex(nextHex);
        // Explicitly clear colorTemp so the service layer picks hs_color.
        send({ hsColor: hexToHs(nextHex), colorTemp: undefined, isOn: true });
    };

    const applyLevel = () => send({ level, isOn: level > 0 });

    const toggle = () => {
        const next = !isOn;
        updateDeviceState(deviceId, {
            level: next ? (level > 0 ? level : 100) : 0,
            isOn: next,
            colorTempRange: range,
            supportsColor,
            supportsColorTemp: supportsTemp,
        } as any);
    };

    if (!device) {
        return (
            <Modal onClose={onClose} size="md" title="Light">
                <p className="text-gray-400 text-sm">This light is no longer available.</p>
            </Modal>
        );
    }

    return (
        <Modal onClose={onClose} size="md" title={device.name}>
            <div className="flex flex-col gap-5">
                {/* Power + brightness */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={toggle}
                        className={`px-4 py-2 rounded-control font-semibold text-sm transition ${
                            isOn ? 'bg-yellow-400 text-gray-900' : 'bg-gray-700 text-gray-300'
                        }`}
                    >
                        {isOn ? 'On' : 'Off'}
                    </button>
                    <div className="flex-1">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>Brightness</span>
                            <span className="font-mono tabular-nums">{level}%</span>
                        </div>
                        <TileSlider
                            value={level}
                            accentColor="rgb(var(--accent-light))"
                            onChange={(e) => setLevel(parseInt(e.target.value, 10))}
                            onCommit={applyLevel}
                        />
                    </div>
                </div>

                {/* Preset whites */}
                {supportsTemp && presets.length > 0 && (
                    <div>
                        <p className="text-xs text-gray-400 mb-2">Whites</p>
                        <div className="grid grid-cols-4 gap-2">
                            {presets.map(p => {
                                const active = inTempMode && Math.abs((live.colorTemp ?? -1) - p.k) < 60;
                                return (
                                    <button
                                        key={p.k}
                                        onClick={() => applyTemp(p.k)}
                                        className={`rounded-control border px-1 py-2 flex flex-col items-center gap-1 transition ${
                                            active ? 'border-white ring-2 ring-white/60' : 'border-gray-600 hover:border-gray-400'
                                        }`}
                                    >
                                        <span
                                            className="w-7 h-7 rounded-full border border-black/30"
                                            style={{ backgroundColor: kelvinToHex(p.k) }}
                                        />
                                        <span className="text-[10px] leading-tight text-gray-300">{p.label}</span>
                                        <span className="text-[10px] font-mono tabular-nums text-gray-500">{p.k}K</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Fine colour temperature */}
                {supportsTemp && (
                    <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>Warm</span>
                            <span className="font-mono tabular-nums">{temp}K</span>
                            <span>Cool</span>
                        </div>
                        <TileSlider
                            value={clamp(temp, range.min, range.max)}
                            min={range.min}
                            max={range.max}
                            accentColor="#f8fafc"
                            trackBackground={`linear-gradient(to right, ${kelvinToHex(range.min)}, ${kelvinToHex(
                                Math.round((range.min + range.max) / 2)
                            )}, ${kelvinToHex(range.max)})`}
                            onChange={(e) => setTemp(parseInt(e.target.value, 10))}
                            onCommit={() => applyTemp(temp)}
                        />
                    </div>
                )}

                {/* Arbitrary colour */}
                {supportsColor && (
                    <div>
                        <p className="text-xs text-gray-400 mb-2">Colour</p>
                        <div className="grid grid-cols-8 gap-2 mb-3">
                            {QUICK_COLORS.map(c => {
                                const active = !inTempMode && hex.toLowerCase() === c.hex.toLowerCase();
                                return (
                                    <button
                                        key={c.hex}
                                        title={c.label}
                                        onClick={() => applyColor(c.hex)}
                                        className={`aspect-square rounded-full border transition ${
                                            active ? 'border-white ring-2 ring-white/60' : 'border-black/30 hover:border-white/60'
                                        }`}
                                        style={{ backgroundColor: c.hex }}
                                    />
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={hex}
                                onChange={(e) => applyColor(e.target.value)}
                                className="h-10 w-20 rounded-control border border-gray-600 bg-transparent p-0 cursor-pointer"
                            />
                            <span className="text-xs text-gray-400">
                                Custom — <span className="font-mono uppercase">{hex}</span>
                            </span>
                        </div>
                    </div>
                )}

                {!supportsColor && !supportsTemp && (
                    <p className="text-xs text-gray-500">This light supports brightness only.</p>
                )}
            </div>
        </Modal>
    );
};

export default LightControlModal;
