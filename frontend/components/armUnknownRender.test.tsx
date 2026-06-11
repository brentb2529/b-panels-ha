// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock the dashboard hook so we can render the REAL ArmingStatusIndicator with a
// chosen alarmState — proving the rendered chrome for an 'unknown' arm state is
// neutral grey "Unknown", NEVER the green "Disarmed" look (lessons A).
const mockState: { alarmState: any; armingState: string } = { alarmState: null, armingState: 'no_sensors' };
vi.mock('../hooks/useDashboard', () => ({
  useDashboard: () => mockState,
}));

import ArmingStatusIndicator from './ArmingStatusIndicator';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(here, '../../../daily/2026-06-11/prod-hardening');

const render = (armState: string, armingState = 'no_sensors') => {
  mockState.alarmState = { armState, securityState: 'OK', violatingSensors: [], phase: 'idle' };
  mockState.armingState = armingState;
  return renderToStaticMarkup(React.createElement(ArmingStatusIndicator));
};

describe('ArmingStatusIndicator — unknown arm renders neutral, not green (lessons A)', () => {
  it('renders "Unknown" in grey for armState unknown — no green disarmed look', () => {
    const html = render('unknown');
    expect(html).toContain('Unknown');
    expect(html).toContain('text-gray-300');     // neutral grey
    expect(html).not.toContain('Disarmed');
    expect(html).not.toContain('bg-green-500/20'); // never the green disarmed/ready chip
  });

  it('still renders the green Disarmed chip for an EXPLICIT disarmed state', () => {
    const html = render('disarmed', 'ready');
    expect(html).toContain('Disarmed');
    expect(html).toContain('bg-green-500/20');
  });

  it('writes the rendered-markup evidence', () => {
    const unknownHtml = render('unknown');
    const disarmedHtml = render('disarmed', 'ready');
    mkdirSync(evidenceDir, { recursive: true });
    const doc = [
      '# Rendered arm-state chrome — DOM evidence (lessons A)',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Real <ArmingStatusIndicator/> rendered with a mocked dashboard state.',
      '',
      '## armState = "unknown" (entity unavailable/absent/stale) — MUST be neutral grey',
      '```html',
      unknownHtml,
      '```',
      '',
      '## armState = "disarmed" + ready — the ONLY path to the green look',
      '```html',
      disarmedHtml,
      '```',
      '',
    ].join('\n');
    writeFileSync(resolve(evidenceDir, 'live-verify-A-rendered-chrome.md'), doc);
    expect(true).toBe(true);
  });
});
