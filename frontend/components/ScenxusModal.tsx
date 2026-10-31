import React, { useState } from 'react';
import Modal from './Modal';
import { callService } from '../services/haClient';
import { hasError, type ScenxusDevice } from '../services/scenxusEntities';

// Detail + control view for one ScenXus diffuser. Reads the LIVE device from
// the parent each render; writes go straight to HA services on the entities the
// integration created, then the 30s coordinator refresh confirms them.

const Bar: React.FC<{ label: string; value?: number }> = ({ label, value }) => {
    const pct = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : undefined;
    const color = pct === undefined ? 'transparent'
        : pct <= 10 ? 'rgb(var(--accent-alert))'
        : pct <= 25 ? 'rgb(var(--accent-warn))'
        : 'rgb(var(--accent-water))';
    return (
        <div>
            <div className="flex justify-between text-sm">
                <span className="text-white/60">{label}</span>
                <span className="text-white tabular-nums">{pct === undefined ? '--' : `${Math.round(pct)}%`}</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 mt-1 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: color }} />
            </div>
        </div>
    );
};

const Chips: React.FC<{
    options: string[]; value?: string; onPick: (o: string) => void;
}> = ({ options, value, onPick }) => (
    <div className="flex flex-wrap gap-2">
        {options.map((o) => (
            <button
                key={o}
                type="button"
                onClick={() => onPick(o)}
                className={`px-3 py-2 rounded-lg text-sm active:scale-95 transition-all ${
                    o === value ? 'bg-sky-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'
                }`}
            >
                {o}
            </button>
        ))}
    </div>
);

const Stepper: React.FC<{
    label: string; value?: number; min: number; max: number; onSet: (n: number) => void;
}> = ({ label, value, min, max, onSet }) => (
    <div className="flex items-center justify-between">
        <span className="text-white/60 text-sm">{label}</span>
        <div className="flex items-center gap-3">
            <button
                type="button"
                disabled={value === undefined || value <= min}
                onClick={() => value !== undefined && onSet(value - 1)}
                className="w-11 h-11 rounded-full bg-white/10 text-white text-xl disabled:opacity-30 active:scale-95"
            >−</button>
            <span className="w-8 text-center text-white text-lg tabular-nums">{value ?? '--'}</span>
            <button
                type="button"
                disabled={value === undefined || value >= max}
                onClick={() => value !== undefined && onSet(value + 1)}
                className="w-11 h-11 rounded-full bg-white/10 text-white text-xl disabled:opacity-30 active:scale-95"
            >+</button>
        </div>
    </div>
);

const ScenxusModal: React.FC<{ device: ScenxusDevice; onClose: () => void }> = ({ device, onClose }) => {
    const s = device.state;
    const [err, setErr] = useState<string | null>(null);

    const run = async (p: Promise<void>) => {
        try { setErr(null); await p; } catch (e: any) { setErr(e?.message || 'Command failed'); }
    };
    const pickSelect = (field: string, option: string) => {
        const id = s.entityIds[field];
        if (id) run(callService('select', 'select_option', { option }, { entity_id: id }));
    };
    const setNumber = (field: string, value: number) => {
        const id = s.entityIds[field];
        if (id) run(callService('number', 'set_value', { value }, { entity_id: id }));
    };

    const tempF = typeof s.coreTempC === 'number' ? s.coreTempC * 9 / 5 + 32 : undefined;

    return (
        <Modal onClose={onClose} size="md" title={`${device.name} — Scent`}>
            <div className="flex flex-col gap-5">
                <div className="flex items-center gap-2 text-sm">
                    <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: s.online ? 'rgb(var(--accent-plug))' : 'rgb(var(--accent-alert))' }}
                    />
                    <span className="text-white/70">{s.online ? 'Online' : 'Offline'}</span>
                    {hasError(s) && <span className="text-red-400 ml-2">Error {s.errorCode}</span>}
                    {s.schedule && <span className="text-white/40 ml-auto truncate">Schedule: {s.schedule}</span>}
                </div>

                <div className="flex flex-col gap-3">
                    <Bar label="Fragrance remaining" value={s.fragrance} />
                    <Bar label="Cartridge life" value={s.cartridge} />
                    <Bar label="Pump life" value={s.pump} />
                    <Bar label="Appliance life" value={s.appliance} />
                </div>

                <div className="flex flex-col gap-3">
                    <div className="text-white/60 text-sm">Mode</div>
                    <Chips options={s.modeOptions} value={s.mode} onPick={(o) => pickSelect('current_state_in', o)} />
                    <div className="text-white/60 text-sm">Off-cycle</div>
                    <Chips options={s.cycleOptions} value={s.cycle} onPick={(o) => pickSelect('cycle_in', o)} />
                    <Stepper
                        label="Intensity" value={s.intensity} min={1} max={s.intensityMax ?? 50}
                        onSet={(n) => setNumber('current_intensity_in', n)}
                    />
                    <Stepper label="Fan speed" value={s.fan} min={0} max={5} onSet={(n) => setNumber('fan_in', n)} />
                </div>

                {tempF !== undefined && (
                    <div className="text-white/35 text-xs">Core temperature {tempF.toFixed(0)}°F</div>
                )}
                {err && <div className="text-red-400 text-sm">{err}</div>}
            </div>
        </Modal>
    );
};

export default ScenxusModal;
