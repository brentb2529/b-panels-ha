import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal browser-like global: the module only needs window + its timers.
(globalThis as any).window = globalThis;
import { hasExternalAuth, createExternalAuth } from './externalAuth';

describe('externalAuth (HA Companion / VACA web view handshake)', () => {
  beforeEach(() => {
    delete (window as any).externalApp;
    delete (window as any).webkit;
  });

  it('is not detected in a plain browser', () => {
    expect(hasExternalAuth()).toBe(false);
  });

  it('requests a token from the Android bridge and stores it', async () => {
    const getExternalAuth = vi.fn((json: string) => {
      const { callback, force } = JSON.parse(json);
      expect(callback).toBe('externalAuthSetToken');
      expect(force).toBe(false);
      setTimeout(() => (window as any)[callback](true, { access_token: 'tok-123', expires_in: 1800 }), 0);
    });
    (window as any).externalApp = { getExternalAuth };
    expect(hasExternalAuth()).toBe(true);

    const auth = await createExternalAuth('http://ha.local:8123');
    expect(getExternalAuth).toHaveBeenCalledTimes(1);
    expect(auth.accessToken).toBe('tok-123');
    expect(auth.expired).toBe(false);
    expect(auth.data.hassUrl).toBe('http://ha.local:8123');
  });

  it('passes force=true on refresh and rejects when the app refuses', async () => {
    let calls = 0;
    (window as any).externalApp = {
      getExternalAuth: (json: string) => {
        const { callback, force } = JSON.parse(json);
        calls += 1;
        if (calls === 1) setTimeout(() => (window as any)[callback](true, { access_token: 'a', expires_in: 60 }), 0);
        else {
          expect(force).toBe(true);
          setTimeout(() => (window as any)[callback](false, null), 0);
        }
      },
    };
    const auth = await createExternalAuth('http://ha.local:8123');
    await expect(auth.refreshAccessToken(true)).rejects.toThrow('External auth refused');
  });

  it('uses the iOS message handler when present', async () => {
    const postMessage = vi.fn((payload: any) => {
      setTimeout(() => (window as any)[payload.callback](true, { access_token: 'ios', expires_in: 60 }), 0);
    });
    (window as any).webkit = { messageHandlers: { getExternalAuth: { postMessage } } };
    const auth = await createExternalAuth('http://ha.local:8123');
    expect(postMessage).toHaveBeenCalled();
    expect(auth.accessToken).toBe('ios');
  });
});
