// Build the ScenXus tile's document from Home Assistant entities.
//
// The Prolitec ScenXus integration (HACS: brentb2529/Prolitec, >= 0.1.1) stamps
// every entity with two attributes, and this module reassembles them. Friendly
// names and entity ids both move when a device is renamed, so neither is safe
// to key on (same approach as irrigationEntities.ts).
//
//   bp_scenxus_field   stable field key, e.g. "fragrance_remaining"
//   bp_scenxus_dsn     device serial, so several diffusers stay separate

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

const FIELD_ATTR = 'bp_scenxus_field';
const DSN_ATTR = 'bp_scenxus_dsn';

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

/** Field key -> the HA entity that carries it (for service calls). */
export interface ScenxusState {
    online: boolean;
    /** At least one entity is reporting a usable value. */
    reachable: boolean;
    mode?: string;            // "Off" | "24/7" | "Run"
    cycle?: string;           // off-cycle label
    intensity?: number;
    intensityMax?: number;
    fan?: number;
    fragrance?: number;       // % remaining
    cartridge?: number;       // % life
    pump?: number;
    appliance?: number;
    coreTempF?: number;
    errorCode?: string;
    schedule?: string;
    modeOptions: string[];
    cycleOptions: string[];
    /** field -> entity_id, for controls. */
    entityIds: Record<string, string>;
}

export interface ScenxusDevice {
    dsn: string;
    name: string;
    state: ScenxusState;
}

const usable = (e: HassEntity): boolean =>
    !!e && typeof e.state === 'string' && !UNAVAILABLE.has(e.state.toLowerCase());

const num = (e: HassEntity): number | undefined => {
    if (!usable(e)) return undefined;
    const n = Number(e.state);
    return Number.isFinite(n) ? n : undefined;
};

const str = (e: HassEntity): string | undefined => (usable(e) ? e.state : undefined);

// A zero error code means "no error"; the cloud reports it as "0".
export const hasError = (s: ScenxusState): boolean =>
    !!s.errorCode && !['0', 'none', 'ok', 'no error'].includes(s.errorCode.toLowerCase());

export function buildScenxusDevices(entities: HassEntities): ScenxusDevice[] {
    const byDsn = new Map<string, HassEntity[]>();
    for (const e of Object.values(entities ?? {})) {
        if (typeof e?.attributes?.[FIELD_ATTR] !== 'string') continue;
        const dsn = String(e.attributes[DSN_ATTR] ?? 'default');
        const list = byDsn.get(dsn);
        if (list) list.push(e);
        else byDsn.set(dsn, [e]);
    }

    const out: ScenxusDevice[] = [];
    for (const [dsn, list] of byDsn) {
        const s: ScenxusState = {
            online: false, reachable: false, modeOptions: [], cycleOptions: [], entityIds: {},
        };
        let name = '';
        for (const e of list) {
            const field = e.attributes[FIELD_ATTR] as string;
            s.entityIds[field] = e.entity_id;
            if (usable(e)) s.reachable = true;
            if (!name && typeof e.attributes.bp_scenxus_name === 'string') name = e.attributes.bp_scenxus_name;
            switch (field) {
                case 'online': s.online = e.state === 'on'; break;
                case 'current_state_in':
                    s.mode = str(e);
                    s.modeOptions = Array.isArray(e.attributes.options) ? e.attributes.options : [];
                    break;
                case 'cycle_in':
                    s.cycle = str(e);
                    s.cycleOptions = Array.isArray(e.attributes.options) ? e.attributes.options : [];
                    break;
                case 'current_intensity_in':
                    s.intensity = num(e);
                    if (typeof e.attributes.max === 'number') s.intensityMax = e.attributes.max;
                    break;
                case 'fan_in': s.fan = num(e); break;
                // Integration >= 0.1.2 renamed the key to *_pct; accept both.
                case 'fragrance_remaining':
                case 'fragrance_remaining_pct': s.fragrance = num(e); break;
                case 'cartridge_life': s.cartridge = num(e); break;
                case 'pump_life': s.pump = num(e); break;
                case 'appliance_life': s.appliance = num(e); break;
                case 'esp32_core_temp': {
                    // Unit follows the entity (HA converts to the user's system).
                    const v = num(e);
                    const unit = String(e.attributes.unit_of_measurement ?? '');
                    s.coreTempF = v === undefined ? undefined : unit.includes('C') ? v * 9 / 5 + 32 : v;
                    break;
                }
                case 'error_code': s.errorCode = str(e); break;
                case 'current_schedule_running': s.schedule = str(e); break;
            }
        }
        out.push({ dsn, name: name || 'ScenXus', state: s });
    }
    out.sort((a, b) => a.dsn.localeCompare(b.dsn));
    return out;
}
