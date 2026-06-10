import { describe, it, expect } from 'vitest';
import {
  clampPct,
  wasteColor,
  litterColor,
  litterWord,
  hopperWord,
  lastCycleLabel,
  statusInfo,
  projectLitterRobot,
  controlGate,
  controlServiceCall,
} from './litterRobotLogic';
import type { LitterRobotState } from '../../types';

function lr(overrides: Partial<LitterRobotState> = {}): LitterRobotState {
  return {
    id: 'robot:abc', serial: 'abc', name: 'Litter-Robot', model: 'Litter-Robot 4',
    isOnline: true, powerStatus: 'on', unitStatus: 'rdy', statusText: 'rdy', statusCode: 'rdy',
    normalizedStatus: 'READY',
    cycleCount: 0, cyclesAfterDrawerFull: 0,
    isDFITriggered: false, wasteLevel: 40,
    sleepModeEnabled: false,
    isLR4: true, litterLevel: 60,
    isLR3: false,
    haEntities: { vacuum: 'vacuum.litter_robot', nightLight: 'switch.litter_robot_night_light', panelLock: 'switch.litter_robot_panel_lock', startCycle: 'button.litter_robot_start_cycle', reset: 'button.litter_robot_reset' },
    ...overrides,
  };
}

describe('level / drawer math', () => {
  it('clamps and rounds to 0–100', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(42.6)).toBe(43);
    expect(clampPct(null)).toBe(0);
    expect(clampPct(undefined)).toBe(0);
    expect(clampPct(NaN)).toBe(0);
  });

  it('waste color escalates green -> amber -> red, and red when full', () => {
    expect(wasteColor(10, false)).toBe('#34d399');
    expect(wasteColor(75, false)).toBe('#fbbf24');
    expect(wasteColor(95, false)).toBe('#f87171');
    expect(wasteColor(10, true)).toBe('#f87171'); // DFI forces red regardless of %
  });

  it('litter color flags low litter as the actionable state', () => {
    expect(litterColor(80)).toBe('#22d3ee');
    expect(litterColor(30)).toBe('#fbbf24');
    expect(litterColor(10)).toBe('#f87171');
  });

  it('litter word prefers the integration enum, else derives from %', () => {
    expect(litterWord(80)).toBe('Optimal');
    expect(litterWord(30)).toBe('Low');
    expect(litterWord(5)).toBe('Refill');
    expect(litterWord(5, 'optimal')).toBe('Optimal'); // enum overrides the % derivation
    expect(litterWord(80, 'low_litter')).toBe('Low litter');
  });
});

describe('hopper + last-cycle labels', () => {
  it('hopper word normalizes the enum and flags removed', () => {
    expect(hopperWord(lr({ hopperStatus: undefined }))).toBe('—');
    expect(hopperWord(lr({ hopperStatus: 'enabled' }))).toBe('Enabled');
    expect(hopperWord(lr({ hopperStatus: 'motor_fault_short' }))).toBe('Motor fault short');
    expect(hopperWord(lr({ isHopperRemoved: true }))).toBe('Removed');
  });

  it('last-cycle relative label', () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    expect(lastCycleLabel(undefined, now)).toBe('—');
    expect(lastCycleLabel('not-a-date', now)).toBe('—');
    expect(lastCycleLabel('2026-06-10T11:59:40Z', now)).toBe('Just now');
    expect(lastCycleLabel('2026-06-10T11:30:00Z', now)).toBe('30m ago');
    expect(lastCycleLabel('2026-06-10T09:00:00Z', now)).toBe('3h ago');
    expect(lastCycleLabel('2026-06-08T12:00:00Z', now)).toBe('2d ago');
  });
});

describe('status / fault mapping', () => {
  it('maps each status to a color + accent + active flag', () => {
    expect(statusInfo('READY').accent).toBe('positive');
    expect(statusInfo('CYCLING').active).toBe(true);
    expect(statusInfo('CAT_DETECTED').active).toBe(true);
    expect(statusInfo('DRAWER_FULL').accent).toBe('critical');
    expect(statusInfo('FAULT').accent).toBe('critical');
    expect(statusInfo('OFFLINE').label).toBe('Offline');
    expect(statusInfo(undefined).label).toBe('Offline'); // safe default
  });
});

describe('projection', () => {
  it('returns null for missing/invalid state', () => {
    expect(projectLitterRobot(null)).toBeNull();
    expect(projectLitterRobot(undefined)).toBeNull();
    expect(projectLitterRobot('nope' as any)).toBeNull();
  });

  it('projects a healthy LR4', () => {
    const p = projectLitterRobot(lr({ wasteLevel: 40, litterLevel: 60, scoopsSaved: 312 }))!;
    expect(p.wastePct).toBe(40);
    expect(p.wasteCritical).toBe(false);
    expect(p.hasLitter).toBe(true);
    expect(p.litterPct).toBe(60);
    expect(p.litterLow).toBe(false);
    expect(p.scoopsSaved).toBe(312);
    expect(p.critical).toBe(false);
    expect(p.isOnline).toBe(true);
  });

  it('flags a full drawer as critical via DFI even below 90%', () => {
    const p = projectLitterRobot(lr({ wasteLevel: 50, isDFITriggered: true, normalizedStatus: 'DRAWER_FULL' }))!;
    expect(p.wasteFull).toBe(true);
    expect(p.wasteCritical).toBe(true);
    expect(p.wasteColor).toBe('#f87171');
    expect(p.critical).toBe(true);
  });

  it('flags low litter as critical', () => {
    const p = projectLitterRobot(lr({ litterLevel: 12 }))!;
    expect(p.litterLow).toBe(true);
    expect(p.critical).toBe(true);
  });

  it('treats fault / offline / bonnet as critical', () => {
    expect(projectLitterRobot(lr({ normalizedStatus: 'FAULT' }))!.critical).toBe(true);
    expect(projectLitterRobot(lr({ normalizedStatus: 'BONNET_REMOVED' }))!.critical).toBe(true);
    expect(projectLitterRobot(lr({ isOnline: false, normalizedStatus: 'OFFLINE' }))!.isOnline).toBe(false);
  });

  it('LR3 (no litter sensor) reports no litter gauge', () => {
    const p = projectLitterRobot(lr({ isLR4: false, isLR3: true, litterLevel: undefined }))!;
    expect(p.hasLitter).toBe(false);
    expect(p.litterPct).toBe(0);
  });
});

describe('control confirm-gate (low-hazard appliance)', () => {
  it('every control ALWAYS requires confirm (never fire-on-tap)', () => {
    expect(controlGate({ entityId: 'switch.x', isOnline: true }).requiresConfirm).toBe(true);
  });

  it('allows a control when present, online, not editor/locked', () => {
    const g = controlGate({ entityId: 'button.cycle', isOnline: true });
    expect(g.allowed).toBe(true);
    expect(g.reason).toBeUndefined();
  });

  it('blocks in editor, when locked, offline, or with no backing entity', () => {
    expect(controlGate({ isEditor: true, entityId: 'switch.x', isOnline: true })).toMatchObject({ allowed: false, reason: 'editor' });
    expect(controlGate({ isLocked: true, entityId: 'switch.x', isOnline: true })).toMatchObject({ allowed: false, reason: 'locked' });
    expect(controlGate({ entityId: 'switch.x', isOnline: false })).toMatchObject({ allowed: false, reason: 'offline' });
    expect(controlGate({ isOnline: true })).toMatchObject({ allowed: false, reason: 'no-entity' });
  });
});

describe('control service-call mapping', () => {
  it('cycle prefers the dedicated start-cycle button, else vacuum.start', () => {
    expect(controlServiceCall('cycle', lr())).toEqual({ domain: 'button', service: 'press', data: { entity_id: 'button.litter_robot_start_cycle' } });
    const noBtn = lr({ haEntities: { vacuum: 'vacuum.lr' } });
    expect(controlServiceCall('cycle', noBtn)).toEqual({ domain: 'vacuum', service: 'start', data: { entity_id: 'vacuum.lr' } });
    expect(controlServiceCall('cycle', lr({ haEntities: {} }))).toBeNull();
  });

  it('night-light toggles the switch based on current state', () => {
    expect(controlServiceCall('nightlight', lr({ isNightLightModeEnabled: false }))).toEqual({ domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.litter_robot_night_light' } });
    expect(controlServiceCall('nightlight', lr({ isNightLightModeEnabled: true }))).toEqual({ domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.litter_robot_night_light' } });
  });

  it('night-light uses select_option when backed by a select (LR4 globe light)', () => {
    const sel = lr({ isNightLightModeEnabled: false, haEntities: { nightLight: 'select.litter_robot_night_light_level' } });
    expect(controlServiceCall('nightlight', sel)).toEqual({ domain: 'select', service: 'select_option', data: { entity_id: 'select.litter_robot_night_light_level', option: 'on' } });
  });

  it('panel-lock toggles based on current state, null when unbound', () => {
    expect(controlServiceCall('panellock', lr({ isPanelLockEnabled: false }))).toEqual({ domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.litter_robot_panel_lock' } });
    expect(controlServiceCall('panellock', lr({ isPanelLockEnabled: true }))).toEqual({ domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.litter_robot_panel_lock' } });
    expect(controlServiceCall('panellock', lr({ haEntities: {} }))).toBeNull();
  });
});
