import { describe, it, expect, beforeEach, vi } from 'vitest';

// usePanelDefault.ts reads/writes localStorage and window.location for the
// per-DEVICE default + idle-seconds. The test env is `node`, so we install
// minimal shims before importing the module under test.
const store: Record<string, string> = {};
const localStorageShim = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
} as any;

beforeEach(() => {
  localStorageShim.clear();
  vi.stubGlobal('localStorage', localStorageShim);
  vi.stubGlobal('window', { location: { hash: '', search: '' } });
});

describe('per-device default panel persistence (localStorage, NOT global)', () => {
  it('round-trips the device default panel id', async () => {
    const { getDeviceDefaultPanelId, setDeviceDefaultPanelId } = await import('./usePanelDefault');
    expect(getDeviceDefaultPanelId()).toBeNull();
    setDeviceDefaultPanelId('panel-kitchen');
    expect(getDeviceDefaultPanelId()).toBe('panel-kitchen');
    expect(store['bPanelsDeviceDefaultPanel']).toBe('panel-kitchen');
  });

  it('clears the default when set to null', async () => {
    const { getDeviceDefaultPanelId, setDeviceDefaultPanelId } = await import('./usePanelDefault');
    setDeviceDefaultPanelId('panel-suite');
    setDeviceDefaultPanelId(null);
    expect(getDeviceDefaultPanelId()).toBeNull();
  });

  it('persists per-device (a different localStorage = a different default)', async () => {
    const { getDeviceDefaultPanelId, setDeviceDefaultPanelId } = await import('./usePanelDefault');
    setDeviceDefaultPanelId('panel-home');
    expect(getDeviceDefaultPanelId()).toBe('panel-home');
    // simulate a second physical panel (its own empty store)
    localStorageShim.clear();
    expect(getDeviceDefaultPanelId()).toBeNull();
  });
});
