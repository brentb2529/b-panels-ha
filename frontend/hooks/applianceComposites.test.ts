import { describe, it, expect } from 'vitest';
import { buildApplianceComposites, classifyAppliance } from './applianceComposites';
import { Device, DeviceType, DeviceService } from '../types';
import type {
  FridgeApplianceState,
  OvenApplianceState,
  DishwasherApplianceState,
} from '../types';

function dev(id: string, state: any, name?: string): Device {
  return {
    id,
    name: name || id.split('.')[1].replace(/_/g, ' '),
    type: DeviceType.Generic,
    service: DeviceService.HomeAssistant,
    state,
    isOnline: true,
  };
}

// Demo Sub-Zero fridge entity set (mirrors subzero_wolf sensor/binary_sensor).
const fridgeDevices = (): Device[] => [
  dev('sensor.demo_fridge_refrigerator_temperature', 39),
  dev('sensor.demo_fridge_refrigerator_set_temperature', 38),
  dev('sensor.demo_fridge_freezer_temperature', 1),
  dev('sensor.demo_fridge_freezer_set_temperature', 0),
  dev('binary_sensor.demo_fridge_door', 'off'),
  dev('sensor.demo_fridge_water_filter_life', 80),
  dev('sensor.demo_fridge_air_filter_life', 65),
];

// Demo Wolf oven entity set.
const ovenDevices = (): Device[] => [
  dev('sensor.demo_oven_temperature', 350),
  dev('sensor.demo_oven_set_temperature', 350),
  dev('sensor.demo_oven_cook_mode', 'bake'),
  dev('sensor.demo_oven_probe_temperature', 140),
  dev('binary_sensor.demo_oven_oven_on', 'on'),
  dev('binary_sensor.demo_oven_door', 'off'),
  dev('binary_sensor.demo_oven_preheat_complete', 'on'),
];

// Demo Cove dishwasher entity set.
const dishDevices = (): Device[] => [
  dev('sensor.demo_dishwasher_wash_status', 'washing'),
  dev('sensor.demo_dishwasher_wash_cycle', 'auto'),
  dev('sensor.demo_dishwasher_time_remaining', 45),
  dev('binary_sensor.demo_dishwasher_washing', 'on'),
  dev('binary_sensor.demo_dishwasher_door', 'off'),
  dev('binary_sensor.demo_dishwasher_rinse_aid_low', 'off'),
];

describe('classifyAppliance', () => {
  it('detects each family from entity suffixes', () => {
    expect(classifyAppliance(fridgeDevices())).toBe('fridge');
    expect(classifyAppliance(ovenDevices())).toBe('oven');
    expect(classifyAppliance(dishDevices())).toBe('dishwasher');
  });
  it('returns null for unrelated entities', () => {
    expect(classifyAppliance([dev('light.kitchen', 'on'), dev('sensor.kitchen_lux', 200)])).toBeNull();
  });
});

describe('stem-grouped composite folding', () => {
  it('folds a fridge into one composite with zones + filters', () => {
    const { composites, memberIds } = buildApplianceComposites(fridgeDevices(), {});
    expect(composites).toHaveLength(1);
    const c = composites[0];
    expect(c.type).toBe(DeviceType.Fridge);
    expect(c.id).toMatch(/^appliance:/);
    const s = c.state as FridgeApplianceState;
    expect(s.kind).toBe('fridge');
    const names = s.zones.map((z) => z.name);
    expect(names).toContain('Refrigerator');
    expect(names).toContain('Freezer');
    const fridgeZone = s.zones.find((z) => z.name === 'Refrigerator')!;
    expect(fridgeZone.measuredF).toBe(39);
    expect(fridgeZone.setpointF).toBe(38);
    expect(s.waterFilterPct).toBe(80);
    expect(s.airFilterPct).toBe(65);
    // every member is consumed (folded out of the flat device list)
    fridgeDevices().forEach((d) => expect(memberIds.has(d.id)).toBe(true));
  });

  it('folds a Wolf oven with cavity temp/mode/probe and gate flag', () => {
    const { composites } = buildApplianceComposites(ovenDevices(), {});
    expect(composites).toHaveLength(1);
    const c = composites[0];
    expect(c.type).toBe(DeviceType.Oven);
    const s = c.state as OvenApplianceState;
    expect(s.kind).toBe('oven');
    expect(s.ovenWritesGated).toBe(true);
    expect(s.cavities).toHaveLength(1);
    expect(s.cavities[0].measuredF).toBe(350);
    expect(s.cavities[0].setpointF).toBe(350);
    expect(s.cavities[0].cookMode).toBe('bake');
    expect(s.cavities[0].probeF).toBe(140);
    expect(s.cavities[0].ovenOn).toBe(true);
  });

  it('folds a Cove dishwasher with cycle + time-remaining', () => {
    const { composites } = buildApplianceComposites(dishDevices(), {});
    expect(composites).toHaveLength(1);
    const c = composites[0];
    expect(c.type).toBe(DeviceType.Dishwasher);
    const s = c.state as DishwasherApplianceState;
    expect(s.kind).toBe('dishwasher');
    expect(s.washStatus).toBe('washing');
    expect(s.washCycle).toBe('auto');
    expect(s.timeRemainingMin).toBe(45);
    expect(s.running).toBe(true);
  });

  it('groups three appliances into three composites side by side', () => {
    const all = [...fridgeDevices(), ...ovenDevices(), ...dishDevices()];
    const { composites } = buildApplianceComposites(all, {});
    const kinds = composites.map((c) => c.type).sort();
    expect(kinds).toEqual([DeviceType.Dishwasher, DeviceType.Fridge, DeviceType.Oven].sort());
  });

  it('does not fold a lone unrelated sensor', () => {
    const { composites } = buildApplianceComposites([dev('sensor.outdoor_temp', 70)], {});
    expect(composites).toHaveLength(0);
  });
});

describe('registry-device grouping', () => {
  it('folds by device_id when the registry groups the entities', () => {
    const members = ovenDevices();
    const map: Record<string, string> = {};
    members.forEach((m) => { map[m.id] = 'wolf-device-1'; });
    const { composites } = buildApplianceComposites(members, map);
    expect(composites).toHaveLength(1);
    expect(composites[0].type).toBe(DeviceType.Oven);
  });
});

describe('offline honesty', () => {
  it('marks composite offline when all members are unavailable', () => {
    const offline = fridgeDevices().map((d) => ({ ...d, state: 'unavailable', isOnline: false }));
    const { composites } = buildApplianceComposites(offline, {});
    expect(composites).toHaveLength(1);
    expect((composites[0].state as FridgeApplianceState).isOnline).toBe(false);
  });
});
