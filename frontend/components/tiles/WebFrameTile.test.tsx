// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WebFrameTile from './WebFrameTile';
import type { Device, TileConfig } from '../../types';

// M-3: the embedded iframe must be sandboxed WITHOUT allow-same-origin. With
// allow-scripts a same-origin frame would escape the sandbox; arbitrary external
// pages do not need same-origin.
describe('WebFrameTile sandbox (M-3)', () => {
  const device = { id: 'wf', name: 'Web', state: 'https://example.com' } as unknown as Device;
  const tile = { id: 't', tileType: 'web-frame', label: 'Web' } as unknown as TileConfig;

  it('renders the iframe sandboxed without allow-same-origin', () => {
    const html = renderToStaticMarkup(
      React.createElement(WebFrameTile, { device, tile, isEditor: true })
    );
    expect(html).toContain('<iframe');
    // sandbox is present and grants scripts/forms but NOT same-origin.
    const m = html.match(/sandbox="([^"]*)"/);
    expect(m).not.toBeNull();
    const sandbox = (m?.[1] || '').toLowerCase();
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });
});
