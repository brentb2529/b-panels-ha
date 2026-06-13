// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferCapabilityProfile } from './haCapabilities';

// Mock the HA WS client so setDeviceState's service calls are captured, not sent.
const calls: Array<{ domain: string; service: string; data: any }> = [];
vi.mock('./haClient', () => ({
  getStates: vi.fn(async () => []),
  callService: vi.fn(async (domain: string, service: string, data: any) => {
    calls.push({ domain, service, data });
  }),
}));

// Imported AFTER the mock so the service uses the mocked haClient.
import { homeAssistantService } from './homeassistant';

beforeEach(() => { calls.length = 0; });

// HA CoverEntityFeature bits used for tilt.
const OPEN_TILT = 16, CLOSE_TILT = 32, STOP_TILT = 64, SET_TILT_POSITION = 128;
const SET_POSITION = 4;

describe('cover TILT — capability inference', () => {
  it('emits `tilt` when current_tilt_position is present', () => {
    const p = inferCapabilityProfile({
      entity_id: 'cover.blind',
      state: 'open',
      attributes: { current_position: 60, current_tilt_position: 40 },
    });
    expect(p.capabilities).toContain('tilt');
    expect(p.capabilities).toContain('position');
    expect(p.primary).toBe('position'); // tilt is auxiliary, position stays primary
  });

  it('emits `tilt` when only the SET_TILT_POSITION feature bit is set (no current_tilt_position)', () => {
    const p = inferCapabilityProfile({
      entity_id: 'cover.venetian',
      state: 'open',
      attributes: { supported_features: SET_POSITION | SET_TILT_POSITION, current_position: 100 },
    });
    expect(p.capabilities).toContain('tilt');
  });

  it('emits `tilt` for open/close/stop-tilt-only covers (no settable tilt position)', () => {
    const p = inferCapabilityProfile({
      entity_id: 'cover.slat',
      state: 'open',
      attributes: { supported_features: OPEN_TILT | CLOSE_TILT | STOP_TILT },
    });
    expect(p.capabilities).toContain('tilt');
  });

  it('position-only covers are UNCHANGED — no `tilt` capability', () => {
    const p = inferCapabilityProfile({
      entity_id: 'cover.shade',
      state: 'open',
      attributes: { supported_features: SET_POSITION, current_position: 75 },
    });
    expect(p.capabilities).not.toContain('tilt');
    expect(p.capabilities).toContain('position');
    expect(p.primary).toBe('position');
  });

  it('open/close-only covers (no position, no tilt) are unchanged — toggle only', () => {
    const p = inferCapabilityProfile({
      entity_id: 'cover.garage',
      state: 'closed',
      attributes: { supported_features: 1 | 2 },
    });
    expect(p.capabilities).toEqual(['toggle']);
    expect(p.primary).toBe('toggle');
  });
});

describe('cover TILT — service routing in setDeviceState', () => {
  it('a { tilt } payload calls cover.set_cover_tilt_position with tilt_position', async () => {
    await homeAssistantService.setDeviceState('cover.venetian', { tilt: 35 } as any);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      domain: 'cover',
      service: 'set_cover_tilt_position',
      data: { entity_id: 'cover.venetian', tilt_position: 35 },
    });
  });

  it('tiltAction open/close/stop route to the matching tilt services', async () => {
    await homeAssistantService.setDeviceState('cover.slat', { tiltAction: 'open' } as any);
    await homeAssistantService.setDeviceState('cover.slat', { tiltAction: 'close' } as any);
    await homeAssistantService.setDeviceState('cover.slat', { tiltAction: 'stop' } as any);
    expect(calls.map(c => c.service)).toEqual(['open_cover_tilt', 'close_cover_tilt', 'stop_cover_tilt']);
  });

  it('a plain numeric payload is UNCHANGED — still cover.set_cover_position', async () => {
    await homeAssistantService.setDeviceState('cover.shade', 80 as any);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      domain: 'cover',
      service: 'set_cover_position',
      data: { entity_id: 'cover.shade', position: 80 },
    });
  });

  it('a { position } object payload also routes to set_cover_position', async () => {
    await homeAssistantService.setDeviceState('cover.shade', { position: 25 } as any);
    expect(calls[0]).toMatchObject({ service: 'set_cover_position', data: { position: 25 } });
  });
});
