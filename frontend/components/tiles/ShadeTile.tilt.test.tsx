// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Device, TileConfig } from '../../types';

// Capture updateDeviceState payloads and stub requestPin (pass-through).
const updateDeviceState = vi.fn();
vi.mock('../../hooks/useDashboard', () => ({
  useDashboardActions: () => ({
    updateDeviceState,
    requestPin: (action: () => void) => action(),
  }),
}));

import ShadeTile from './ShadeTile';

const tile = { id: 't', deviceId: 'cover.x', label: 'Blind' } as unknown as TileConfig;

const coverWithTilt: Device = {
  id: 'cover.x', name: 'Blind', type: 'SHADE' as any, service: 'HomeAssistant' as any,
  state: 60, capabilities: ['position', 'toggle', 'tilt'],
  capabilityData: { domain: 'cover', tiltPosition: 40, tiltSettable: true },
};

const coverPositionOnly: Device = {
  id: 'cover.y', name: 'Shade', type: 'SHADE' as any, service: 'HomeAssistant' as any,
  state: 75, capabilities: ['position', 'toggle'],
  capabilityData: { domain: 'cover' },
};

describe('ShadeTile — TILT control', () => {
  it('renders a tilt control + readout when the cover advertises `tilt`', () => {
    const html = renderToStaticMarkup(React.createElement(ShadeTile, { device: coverWithTilt, tile }));
    expect(html).toContain('shade-tilt');
    expect(html).toContain('type="range"');
    expect(html).toContain('Tilt');
    expect(html).toContain('40%'); // current tilt readout from capabilityData
  });

  it('a position-only cover renders NO tilt control (unchanged)', () => {
    const html = renderToStaticMarkup(React.createElement(ShadeTile, { device: coverPositionOnly, tile }));
    expect(html).not.toContain('shade-tilt');
    // The position controls still render exactly as before.
    expect(html).toContain('Open');
    expect(html).toContain('Close');
    expect(html).toContain('50%');
  });
});
