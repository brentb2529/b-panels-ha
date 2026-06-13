// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// SmartThings devices arrive in HA as ordinary domain entities via the HA core
// `smartthings` integration. There is NO per-provider code in b-panels: these
// tests drive the SAME provider-agnostic pipeline (map -> infer -> command
// routing) with entity shapes matching HA's SmartThings output, proving each
// device class renders the right DeviceType + capabilities and controls via the
// allowlisted HA services. NO alarm / no direct-ST path is exercised.

const calls: Array<{ domain: string; service: string; data: any }> = [];
vi.mock('../services/haClient', () => ({
  getStates: vi.fn(async () => []),
  callService: vi.fn(async (domain: string, service: string, data: any) => {
    calls.push({ domain, service, data });
  }),
  subscribeEntities: vi.fn(),
}));

import { mapHaEntityToInternalDevice } from './useDashboard';
import { homeAssistantService } from '../services/homeassistant';
import { DeviceType, DeviceService } from '../types';

beforeEach(() => { calls.length = 0; });

describe('SmartThings device classes — provider-agnostic pipeline', () => {
  it('dimmable + color light -> Dimmer with brightness/color/colorTemp, controls via light.turn_on', async () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'light.st_lamp',
      state: 'on',
      attributes: {
        friendly_name: 'ST Lamp',
        supported_color_modes: ['color_temp', 'hs'],
        brightness: 128, hs_color: [30, 80], color_temp_kelvin: 3000,
        min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500,
      },
    })!;
    expect(d.type).toBe(DeviceType.Dimmer);
    expect(d.service).toBe(DeviceService.HomeAssistant);
    expect(d.supportsColor).toBe(true);
    expect(d.supportsColorTemp).toBe(true);
    expect(d.capabilities).toEqual(expect.arrayContaining(['brightness', 'color', 'colorTemp']));

    await homeAssistantService.setDeviceState('light.st_lamp', { isOn: true, level: 50, hsColor: [30, 80] } as any);
    expect(calls[0]).toMatchObject({ domain: 'light', service: 'turn_on', data: { brightness_pct: 50, hs_color: [30, 80] } });
  });

  it('cover WITH tilt -> Shade with tilt capability + tilt data, controls tilt via cover.set_cover_tilt_position', async () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'cover.st_blind',
      state: 'open',
      attributes: { friendly_name: 'ST Blind', current_position: 70, current_tilt_position: 45, supported_features: 4 | 128 },
    })!;
    expect(d.type).toBe(DeviceType.Shade);
    expect(d.state).toBe(70); // position number, unchanged
    expect(d.capabilities).toContain('tilt');
    expect(d.capabilityData?.tiltPosition).toBe(45);
    expect(d.capabilityData?.tiltSettable).toBe(true);

    await homeAssistantService.setDeviceState('cover.st_blind', { tilt: 60 } as any);
    expect(calls[0]).toMatchObject({ domain: 'cover', service: 'set_cover_tilt_position', data: { tilt_position: 60 } });
  });

  it('cover position-only -> Shade with NO tilt capability (unchanged), position via cover.set_cover_position', async () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'cover.st_shade',
      state: 'open',
      attributes: { friendly_name: 'ST Shade', current_position: 90, supported_features: 4 },
    })!;
    expect(d.type).toBe(DeviceType.Shade);
    expect(d.capabilities).not.toContain('tilt');
    expect(d.capabilityData?.tiltPosition).toBeUndefined();

    await homeAssistantService.setDeviceState('cover.st_shade', 30 as any);
    expect(calls[0]).toMatchObject({ domain: 'cover', service: 'set_cover_position', data: { position: 30 } });
  });

  it('switch / plug -> Switch, controls via switch.turn_on/off', async () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'switch.st_plug', state: 'off', attributes: { friendly_name: 'ST Plug' },
    })!;
    expect(d.type).toBe(DeviceType.Switch);
    expect(d.state).toBe(false);
    await homeAssistantService.setDeviceState('switch.st_plug', true as any);
    expect(calls[0]).toMatchObject({ domain: 'switch', service: 'turn_on' });
  });

  it('contact sensor -> ContactSensor (display only)', () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'binary_sensor.st_door', state: 'on',
      attributes: { friendly_name: 'ST Door', device_class: 'door' },
    })!;
    expect(d.type).toBe(DeviceType.ContactSensor);
    expect(d.state).toBe(true);
  });

  it('motion sensor -> MotionSensor (display only)', () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'binary_sensor.st_motion', state: 'off',
      attributes: { friendly_name: 'ST Motion', device_class: 'motion' },
    })!;
    expect(d.type).toBe(DeviceType.MotionSensor);
  });

  it('temperature sensor -> TemperatureSensor with numeric value', () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'sensor.st_temp', state: '22.5',
      attributes: { friendly_name: 'ST Temp', device_class: 'temperature', unit_of_measurement: '°C' },
    })!;
    expect(d.type).toBe(DeviceType.TemperatureSensor);
    expect(d.state).toBe(22.5);
  });

  it('humidity sensor -> Generic read-only value with unit', () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'sensor.st_humidity', state: '55',
      attributes: { friendly_name: 'ST Humidity', device_class: 'humidity', unit_of_measurement: '%' },
    })!;
    expect(d.type).toBe(DeviceType.Generic);
    expect(d.capabilities).toEqual(['sensor-readonly']);
    expect(d.capabilityData?.unit).toBe('%');
  });

  it('power sensor -> Generic read-only value with W unit', () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'sensor.st_power', state: '412',
      attributes: { friendly_name: 'ST Power', device_class: 'power', unit_of_measurement: 'W' },
    })!;
    expect(d.type).toBe(DeviceType.Generic);
    expect(d.capabilityData?.deviceClass).toBe('power');
    expect(d.capabilityData?.unit).toBe('W');
  });

  it('NO ALARM — an ST-style binary_sensor never becomes an alarm/arm source (display sensor only)', () => {
    const d = mapHaEntityToInternalDevice({
      entity_id: 'binary_sensor.st_security_contact', state: 'on',
      attributes: { friendly_name: 'ST Security Contact', device_class: 'opening' },
    })!;
    expect(d.type).toBe(DeviceType.ContactSensor);
    expect(d.type).not.toBe(DeviceType.AlarmPanel);
    expect(d.capabilities ?? []).not.toContain('alarm');
  });
});
