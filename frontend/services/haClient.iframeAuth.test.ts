// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// IFRAME PANEL AUTH (production-failure lessons C). When b-panels runs as an HA
// sidebar iframe panel (same-origin), it MUST reuse window.parent.hassConnection
// and SKIP getAuth — running its own OAuth in-frame makes HA reject with
// "Invalid redirect URI". It falls back to getAuth only when standalone
// (window.parent === window). These tests pin both branches.
// ─────────────────────────────────────────────────────────────────────────────

const getAuth = vi.fn();
const createConnection = vi.fn();
const createLongLivedTokenAuth = vi.fn();

vi.mock('home-assistant-js-websocket', () => ({
  getAuth: (...a: any[]) => getAuth(...a),
  createConnection: (...a: any[]) => createConnection(...a),
  createLongLivedTokenAuth: (...a: any[]) => createLongLivedTokenAuth(...a),
  getStates: vi.fn(),
  subscribeEntities: vi.fn(),
  callService: vi.fn(),
  ERR_HASS_HOST_REQUIRED: 1,
}));

const fakeConn = { connected: true, id: 'parent-conn' } as any;

async function freshClient() {
  vi.resetModules();
  getAuth.mockReset();
  createConnection.mockReset();
  createLongLivedTokenAuth.mockReset();
  getAuth.mockResolvedValue({ accessToken: 'tok', data: { hassUrl: 'http://x' } });
  createConnection.mockResolvedValue({ connected: true, id: 'getauth-conn' });
  // Re-import the module so its module-level connectionPromise is fresh.
  return await import('./haClient');
}

describe('haClient.connect — iframe panel auth reuse (lessons C)', () => {
  beforeEach(() => {
    localStorage.clear();
    // No provisioned LLAT in the URL/storage for these tests.
    window.history.replaceState(null, '', '/');
  });

  it('reuses window.parent.hassConnection and SKIPS getAuth in the iframe panel', async () => {
    // Simulate the sidebar iframe: parent !== window, parent exposes hassConnection.
    const parentObj: any = { hassConnection: Promise.resolve({ conn: fakeConn, auth: { accessToken: 'parent-tok' } }) };
    Object.defineProperty(window, 'parent', { value: parentObj, configurable: true });

    const haClient = await freshClient();
    const conn: any = await haClient.getConnection();

    expect(conn.id).toBe('parent-conn');     // reused the host connection
    expect(getAuth).not.toHaveBeenCalled();  // never ran its own OAuth (no "Invalid redirect URI")
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('falls back to getAuth when standalone (window.parent === window)', async () => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true });

    const haClient = await freshClient();
    const conn: any = await haClient.getConnection();

    expect(getAuth).toHaveBeenCalledTimes(1);  // standalone/dev runs the redirect flow
    expect(conn.id).toBe('getauth-conn');
  });
});
