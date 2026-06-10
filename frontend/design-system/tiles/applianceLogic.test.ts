import { describe, it, expect } from 'vitest';
import {
  tempLabel,
  pretty,
  zoneTone,
  clampFilterPct,
  projectFridge,
  preheatFraction,
  projectOven,
  dishRunState,
  washFraction,
  timeRemainingLabel,
  projectDishwasher,
  ovenControlGate,
  OVEN_GATE_NOTE,
  projectAppliance,
} from './applianceLogic';
import type {
  FridgeApplianceState,
  OvenApplianceState,
  DishwasherApplianceState,
} from '../../types';

function fridge(overrides: Partial<FridgeApplianceState> = {}): FridgeApplianceState {
  return {
    kind: 'fridge', id: 'appliance:f', serial: 'f', name: 'Fridge', isOnline: true,
    zones: [
      { name: 'Refrigerator', setpointF: 38, measuredF: 39 },
      { name: 'Freezer', setpointF: 0, measuredF: 1 },
    ],
    waterFilterPct: 80, airFilterPct: 65,
    ...overrides,
  };
}
function oven(overrides: Partial<OvenApplianceState> = {}): OvenApplianceState {
  return {
    kind: 'oven', id: 'appliance:o', serial: 'o', name: 'Oven', isOnline: true,
    ovenWritesGated: true,
    cavities: [
      { name: 'Oven', measuredF: 350, setpointF: 350, cookMode: 'bake', probeF: null, ovenOn: true, preheatComplete: true, lightOn: false },
    ],
    ...overrides,
  };
}
function dish(overrides: Partial<DishwasherApplianceState> = {}): DishwasherApplianceState {
  return {
    kind: 'dishwasher', id: 'appliance:d', serial: 'd', name: 'Dishwasher', isOnline: true,
    washStatus: 'idle', washCycle: 'auto', timeRemainingMin: null,
    ...overrides,
  };
}

describe('formatting helpers', () => {
  it('tempLabel rounds and em-dashes absent values', () => {
    expect(tempLabel(38.6)).toBe('39°');
    expect(tempLabel(null)).toBe('—');
    expect(tempLabel(undefined)).toBe('—');
    expect(tempLabel(NaN)).toBe('—');
  });
  it('pretty title-cases and em-dashes empties', () => {
    expect(pretty('convection_bake')).toBe('Convection bake');
    expect(pretty('off')).toBe('Off');
    expect(pretty('unknown')).toBe('—');
    expect(pretty(null)).toBe('—');
  });
  it('clampFilterPct preserves null but clamps numbers', () => {
    expect(clampFilterPct(null)).toBeNull();
    expect(clampFilterPct(120)).toBe(100);
    expect(clampFilterPct(-5)).toBe(0);
    expect(clampFilterPct(42.4)).toBe(42);
  });
});

describe('fridge projection', () => {
  it('maps zones with cool tones + temp strings', () => {
    const p = projectFridge(fridge())!;
    expect(p.online).toBe(true);
    expect(p.zones).toHaveLength(2);
    expect(p.zones[0].tempStr).toBe('39°');
    expect(p.zones[0].setStr).toBe('38°');
    expect(p.status.label).toBe('Cooling');
  });
  it('zoneTone reads freezer/wine deeper-cold', () => {
    expect(zoneTone('Freezer', 0)).not.toBe(zoneTone('Refrigerator', 38));
    expect(zoneTone('Wine', 55)).toBeTruthy();
  });
  it('door open beats filter-low for the status pill', () => {
    const p = projectFridge(fridge({ anyDoorAjar: true, waterFilterPct: 5 }))!;
    expect(p.anyDoorAjar).toBe(true);
    expect(p.status.label).toBe('Door Open');
  });
  it('filter-low surfaces when no door open', () => {
    const p = projectFridge(fridge({ waterFilterPct: 8 }))!;
    expect(p.filterLow).toBe(true);
    expect(p.status.label).toBe('Filter Low');
  });
  it('service-required is critical', () => {
    const p = projectFridge(fridge({ serviceRequired: true }))!;
    expect(p.status.label).toBe('Service');
    expect(p.status.accent).toBe('critical');
  });
  it('offline → not online, warning pill', () => {
    const p = projectFridge(fridge({ isOnline: false }))!;
    expect(p.online).toBe(false);
    expect(p.status.label).toBe('Offline');
  });
  it('returns null for a non-fridge state', () => {
    expect(projectFridge(oven() as any)).toBeNull();
    expect(projectFridge(null)).toBeNull();
  });
});

describe('oven projection + preheat', () => {
  it('preheatFraction climbs baseline→setpoint, clamps 0..1', () => {
    expect(preheatFraction(70, 370)).toBeCloseTo(0, 5);
    expect(preheatFraction(220, 370)).toBeCloseTo(0.5, 2);
    expect(preheatFraction(400, 370)).toBe(1);
    expect(preheatFraction(null, 370)).toBeNull();
  });
  it('maps a running cavity with mode + temps', () => {
    const p = projectOven(oven())!;
    expect(p.anyOn).toBe(true);
    expect(p.cavities[0].modeStr).toBe('Bake');
    expect(p.cavities[0].tempStr).toBe('350°');
    expect(p.status.label).toBe('On');
  });
  it('heating cavity reads Preheating', () => {
    const p = projectOven(oven({ cavities: [{ name: 'Oven', measuredF: 200, setpointF: 400, cookMode: 'bake', probeF: null, ovenOn: true, preheatComplete: false }] }))!;
    expect(p.cavities[0].heating).toBe(true);
    expect(p.status.label).toBe('Preheating');
  });
  it('off oven reads Off', () => {
    const p = projectOven(oven({ cavities: [{ name: 'Oven', measuredF: 72, setpointF: null, cookMode: null, probeF: null, ovenOn: false }] }))!;
    expect(p.anyOn).toBe(false);
    expect(p.cavities[0].modeStr).toBe('Off');
    expect(p.status.label).toBe('Off');
  });
  it('probe presence is detected', () => {
    const p = projectOven(oven({ cavities: [{ name: 'Oven', measuredF: 350, setpointF: 350, cookMode: 'bake', probeF: 140, ovenOn: true }] }))!;
    expect(p.cavities[0].hasProbe).toBe(true);
    expect(p.cavities[0].probeStr).toBe('140°');
  });
  it('writesGated is ALWAYS true (read-only surface)', () => {
    expect(projectOven(oven())!.writesGated).toBe(true);
    expect(projectOven(oven({ isOnline: false }))!.writesGated).toBe(true);
  });
});

describe('HARD no-oven-write guard', () => {
  it('ovenControlGate ALWAYS denies', () => {
    const g = ovenControlGate();
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('equipment-gated');
    expect(g.note).toBe(OVEN_GATE_NOTE);
  });
  it('the module exposes NO oven service-call builder', async () => {
    // Defense-in-depth: assert there is no exported function that could build a
    // callService for an oven write. If a write builder is ever added, this test
    // must be revisited with explicit human approval (Brent + hardware).
    const mod: Record<string, unknown> = await import('./applianceLogic');
    const writeBuilders = Object.keys(mod).filter((k) =>
      /serviceCall|setTemp|writeOven|callService|controlServiceCall|setSetpoint|setProbe|setLight/i.test(k),
    );
    expect(writeBuilders).toEqual([]);
  });
});

describe('dishwasher projection + progress', () => {
  it('classifies run states', () => {
    expect(dishRunState(dish({ washStatus: 'running', running: true }))).toBe('running');
    expect(dishRunState(dish({ washStatus: 'drying', running: true }))).toBe('drying');
    expect(dishRunState(dish({ washStatus: 'complete' }))).toBe('clean');
    expect(dishRunState(dish({ doorAjar: true }))).toBe('door');
    expect(dishRunState(dish({ isOnline: false }))).toBe('offline');
    expect(dishRunState(dish({ washStatus: 'idle' }))).toBe('idle');
  });
  it('washFraction: clean=1, idle=0, running derives from time-remaining', () => {
    expect(washFraction(dish({ washStatus: 'complete' }), 'clean')).toBe(1);
    expect(washFraction(dish(), 'idle')).toBe(0);
    expect(washFraction(dish({ running: true, timeRemainingMin: 45 }), 'running', 90)).toBeCloseTo(0.5, 5);
    expect(washFraction(dish({ running: true, timeRemainingMin: 0 }), 'running', 90)).toBe(1);
  });
  it('timeRemainingLabel formats minutes/hours', () => {
    expect(timeRemainingLabel(45)).toBe('45m');
    expect(timeRemainingLabel(90)).toBe('1h 30m');
    expect(timeRemainingLabel(120)).toBe('2h');
    expect(timeRemainingLabel(null)).toBe('—');
    expect(timeRemainingLabel(0)).toBe('—');
  });
  it('projectDishwasher maps a running cycle', () => {
    const p = projectDishwasher(dish({ washStatus: 'washing', washCycle: 'auto', running: true, timeRemainingMin: 45 }))!;
    expect(p.run).toBe('running');
    expect(p.fraction).toBeCloseTo(0.5, 5);
    expect(p.cycleStr).toBe('Auto');
    expect(p.status.label).toBe('Washing');
  });
  it('offline dishwasher', () => {
    const p = projectDishwasher(dish({ isOnline: false }))!;
    expect(p.online).toBe(false);
    expect(p.status.label).toBe('Offline');
  });
});

describe('projectAppliance dispatch', () => {
  it('routes by kind', () => {
    expect(projectAppliance(fridge())!.kind).toBe('fridge');
    expect(projectAppliance(oven())!.kind).toBe('oven');
    expect(projectAppliance(dish())!.kind).toBe('dishwasher');
    expect(projectAppliance(null)).toBeNull();
  });
});
