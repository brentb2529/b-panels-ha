// AKVO Movable Floor — domain model + the SINGLE gated command path.
//
// SAFETY-CRITICAL. The AKVO controller is the safety authority: it owns the
// watchdog, validates every request, and physically moves the floor. B-Panels
// is a MONITOR plus a request channel. The only write this module performs is
// `select.select_option` on the configuration-request select — the gated,
// watchdog-protected path the `akvo` integration owns. There is NO raw
// motion/stop/reset control here, by design, and none must ever be added.
//
// Everything else is read-only. All transport goes through services/haClient.ts
// (subscribeEntities for reads, callService for the one request write).

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import * as haClient from './haClient';

// Discover AKVO entities by prefix rather than hardcoding ids, so the surface
// tracks the integration's entity set. The integration namespaces everything
// under `akvo_movable_floor`; we match either token to be tolerant.
const AKVO_RE = /^(sensor|binary_sensor|select)\.akvo_movable_floor_|movable_floor/i;

export function isAkvoEntity(id: string): boolean {
    return AKVO_RE.test(id);
}

// "—" / "none" sentinel option on the request select means "no request" — never
// a real preset, never offered as a command.
const SENTINEL_OPTIONS = new Set(['—', '-', 'none', 'idle', 'unknown', '']);

export type FaultSeverity = 'fault' | 'safety' | 'problem' | 'info';

export interface AkvoFault {
    entityId: string;
    label: string;        // humanized friendly_name
    severity: FaultSeverity;
    active: boolean;      // binary_sensor 'on'
}

export interface AkvoFloorMetric {
    entityId: string;
    label: string;
    value: number | null;
    unit: string;
}

export interface AkvoState {
    // Availability — true once we've seen at least one AKVO entity that isn't
    // unavailable. When false, the whole surface shows a degraded shell.
    present: boolean;
    anyAvailable: boolean;

    // Position readings (metres, signed; negative = above deck).
    mainFloorPosition: number | null;
    bajaPosition: number | null;
    positionUnit: string;

    // Motor currents (A).
    mainFloorMotorCurrent: number | null;
    bajaMotorCurrent: number | null;

    // Active configuration (preset the floor is currently AT, per the controller).
    activeConfiguration: string | null;

    // Core status binary_sensors (null = entity absent).
    systemReady: boolean | null;
    systemFault: boolean | null;
    emergencyStop: boolean | null;
    floorsMoving: boolean | null;
    badModbusComm: boolean | null;
    readyForExternalCommands: boolean | null;

    // All fault binary_sensors (drive + top-plate + the core problem ones),
    // classified by severity for the faults panel.
    faults: AkvoFault[];

    // The gated command select.
    requestSelect: {
        entityId: string;
        options: string[];          // real presets (sentinel filtered out)
        current: string | null;     // current selected option (may be sentinel)
        available: boolean;
        // The actual sentinel/"no request" option string present on the live
        // select (e.g. "—"), used to CANCEL/clear a running request. null when
        // the select offers no sentinel. STOP selects this; it is NOT a preset.
        noneOption: string | null;
    } | null;
}

function num(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

function boolFromState(e: HassEntity | undefined): boolean | null {
    if (!e) return null;
    if (e.state === 'unavailable' || e.state === 'unknown') return null;
    return e.state === 'on';
}

function isAvailable(e: HassEntity | undefined): boolean {
    return !!e && e.state !== 'unavailable' && e.state !== 'unknown';
}

function friendly(e: HassEntity | undefined, fallback: string): string {
    return (e?.attributes?.friendly_name as string) || fallback;
}

function humanizeSlug(entityId: string): string {
    return entityId
        .replace(/^[^.]+\./, '')
        .replace(/^akvo_movable_floor_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Find an AKVO entity by id-suffix (the stable part after the akvo prefix), so
// we don't hardcode the full entity_id. Returns the first match.
function findBySuffix(entities: HassEntities, domain: string, suffix: string): HassEntity | undefined {
    const want = `${domain}.akvo_movable_floor_${suffix}`;
    if (entities[want]) return entities[want];
    // Fallback: any entity in the domain whose id ends with the suffix.
    for (const id of Object.keys(entities)) {
        if (!id.startsWith(`${domain}.`)) continue;
        if (!isAkvoEntity(id)) continue;
        if (id.endsWith(`_${suffix}`) || id.endsWith(suffix)) return entities[id];
    }
    return undefined;
}

// Classify a fault binary_sensor by severity. E-stop is the highest-priority
// safety signal; the controller "problem"-class faults and drive/top-plate
// faults are 'fault'; comms is 'problem'; readiness flags are 'info'.
function classifyFault(entityId: string, deviceClass: string | undefined): FaultSeverity {
    const id = entityId.toLowerCase();
    if (id.includes('emergency_stop') || id.includes('estop')) return 'safety';
    if (id.includes('bad_modbus') || id.includes('comm')) return 'problem';
    if (id.includes('system_fault') || deviceClass === 'problem') return 'fault';
    // Drive + top-plate faults all read as active-high problems.
    if (
        id.includes('fault') || id.includes('overtravel') || id.includes('overload') ||
        id.includes('vfd') || id.includes('off_speed') || id.includes('no_movement') ||
        id.includes('direction') || id.includes('position_ref') || id.includes('relative_position') ||
        id.includes('top_plate') || id.includes('overcurrent')
    ) {
        return 'fault';
    }
    return 'info';
}

// Build the composite AkvoState from the full entities map. Pure; never throws.
export function buildAkvoState(entities: HassEntities): AkvoState {
    const akvoIds = Object.keys(entities).filter(isAkvoEntity);
    const present = akvoIds.length > 0;
    const anyAvailable = akvoIds.some((id) => isAvailable(entities[id]));

    const mainPos = findBySuffix(entities, 'sensor', 'main_floor_position');
    const bajaPos = findBySuffix(entities, 'sensor', 'baja_position');
    const mainCur = findBySuffix(entities, 'sensor', 'main_floor_motor_current');
    const bajaCur = findBySuffix(entities, 'sensor', 'baja_motor_current');
    const activeCfg = findBySuffix(entities, 'sensor', 'active_configuration');

    const systemReady = findBySuffix(entities, 'binary_sensor', 'system_ready');
    const systemFault = findBySuffix(entities, 'binary_sensor', 'system_fault');
    const emergencyStop = findBySuffix(entities, 'binary_sensor', 'emergency_stop');
    const floorsMoving = findBySuffix(entities, 'binary_sensor', 'floors_moving');
    const badModbus = findBySuffix(entities, 'binary_sensor', 'bad_modbus_comm');
    const readyExt = findBySuffix(entities, 'binary_sensor', 'ready_for_external_commands');

    // Core status entity_ids we surface as named fields (not duplicated in the
    // faults panel as raw rows; e-stop/fault/comms DO appear as faults too since
    // they are safety-relevant — handled below).
    const coreReadinessIds = new Set(
        [systemReady?.entity_id, floorsMoving?.entity_id, readyExt?.entity_id].filter(Boolean) as string[]
    );

    // Collect every AKVO binary_sensor as a potential fault row.
    const faults: AkvoFault[] = [];
    for (const id of akvoIds) {
        if (!id.startsWith('binary_sensor.')) continue;
        if (coreReadinessIds.has(id)) continue; // readiness flags shown as status, not faults
        const e = entities[id];
        const severity = classifyFault(id, e?.attributes?.device_class as string | undefined);
        faults.push({
            entityId: id,
            label: friendly(e, humanizeSlug(id)),
            severity,
            active: boolFromState(e) === true,
        });
    }
    // Active faults first, then by severity, then alphabetical.
    const sevRank: Record<FaultSeverity, number> = { safety: 0, fault: 1, problem: 2, info: 3 };
    faults.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
        return a.label.localeCompare(b.label);
    });

    // The gated request select.
    let requestSelect: AkvoState['requestSelect'] = null;
    let selectEnt: HassEntity | undefined =
        findBySuffix(entities, 'select', 'configuration_request');
    if (!selectEnt) {
        // Any akvo select is the request select (the integration owns exactly one).
        const selId = akvoIds.find((id) => id.startsWith('select.'));
        if (selId) selectEnt = entities[selId];
    }
    if (selectEnt) {
        const rawOptions: string[] = Array.isArray(selectEnt.attributes?.options)
            ? (selectEnt.attributes!.options as string[])
            : [];
        const options = rawOptions.filter((o) => !SENTINEL_OPTIONS.has(String(o).trim().toLowerCase()));
        // The first sentinel option present (prefer the em-dash) is the
        // "no request" / cancel option we select to clear a running request.
        const noneOption =
            rawOptions.find((o) => o === '—') ??
            rawOptions.find((o) => SENTINEL_OPTIONS.has(String(o).trim().toLowerCase())) ??
            null;
        requestSelect = {
            entityId: selectEnt.entity_id,
            options,
            current: typeof selectEnt.state === 'string' ? selectEnt.state : null,
            available: isAvailable(selectEnt),
            noneOption,
        };
    }

    return {
        present,
        anyAvailable,
        mainFloorPosition: num(mainPos?.state),
        bajaPosition: num(bajaPos?.state),
        positionUnit: (mainPos?.attributes?.unit_of_measurement as string) || 'm',
        mainFloorMotorCurrent: num(mainCur?.state),
        bajaMotorCurrent: num(bajaCur?.state),
        activeConfiguration:
            activeCfg && isAvailable(activeCfg) ? String(activeCfg.state) : null,
        systemReady: boolFromState(systemReady),
        systemFault: boolFromState(systemFault),
        emergencyStop: boolFromState(emergencyStop),
        floorsMoving: boolFromState(floorsMoving),
        badModbusComm: boolFromState(badModbus),
        readyForExternalCommands: boolFromState(readyExt),
        faults,
        requestSelect,
    };
}

// --- The safety gate ----------------------------------------------------------
// Commands are permitted ONLY when the controller says it's ready AND there is
// no fault / e-stop / comms problem AND the floor isn't already moving. We fail
// CLOSED: a null (absent/unknown) safety signal is treated as NOT safe.
export interface AkvoGate {
    enabled: boolean;
    // Human-readable reason the command is blocked (empty when enabled).
    reason: string;
}

export function evaluateGate(s: AkvoState): AkvoGate {
    if (!s.requestSelect || !s.requestSelect.available) {
        return { enabled: false, reason: 'Request channel unavailable' };
    }
    if (!s.anyAvailable) {
        return { enabled: false, reason: 'AKVO offline' };
    }
    // Fail-closed safety checks. Order matters for the displayed reason.
    if (s.emergencyStop === true) return { enabled: false, reason: 'Emergency stop active' };
    if (s.emergencyStop === null) return { enabled: false, reason: 'E-stop status unknown' };
    if (s.systemFault === true) return { enabled: false, reason: 'System fault active' };
    if (s.systemFault === null) return { enabled: false, reason: 'Fault status unknown' };
    if (s.badModbusComm === true) return { enabled: false, reason: 'Controller comms fault' };
    if (s.badModbusComm === null) return { enabled: false, reason: 'Comms status unknown' };
    if (s.floorsMoving === true) return { enabled: false, reason: 'Floor is moving' };
    if (s.readyForExternalCommands !== true) {
        return { enabled: false, reason: 'AKVO not ready for external commands' };
    }
    return { enabled: true, reason: '' };
}

// --- The ONE sanctioned command ----------------------------------------------
// Request a preset by selecting it on the request select. The AKVO controller
// validates and (if safe) moves the floor. We re-check the gate here as a
// defense-in-depth guard so a stale UI can't issue a request; the caller MUST
// also gate + confirm in the UI. Returns false (and issues nothing) if blocked.
export async function requestConfiguration(
    state: AkvoState,
    preset: string
): Promise<boolean> {
    const gate = evaluateGate(state);
    if (!gate.enabled || !state.requestSelect) return false;
    if (!state.requestSelect.options.includes(preset)) return false; // never the sentinel
    await haClient.callService(
        'select',
        'select_option',
        { option: preset },
        { entity_id: state.requestSelect.entityId }
    );
    return true;
}

// --- Cancel / STOP the running request ---------------------------------------
// Selecting the sentinel ("—" / "no request") option clears the active command;
// the AKVO controller then HALTS the running configuration. This is the cancel
// path used by the STOP control while the floor is moving.
//
// IMPORTANT: cancelling is NOT gated and is ALWAYS permitted — stopping must
// work even when (especially when) the floor is moving, faulted, or e-stopped.
// This is intentionally the opposite of the start path's fail-closed gate. It is
// a request-channel cancel, NOT the certified hardware E-stop on the AKVO
// controller. Returns false only when there is no select / no sentinel option.
export async function cancelMovement(state: AkvoState): Promise<boolean> {
    const sel = state.requestSelect;
    if (!sel || !sel.noneOption) return false;
    await haClient.callService(
        'select',
        'select_option',
        { option: sel.noneOption },
        { entity_id: sel.entityId }
    );
    return true;
}
