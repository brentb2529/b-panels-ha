// External-app auth — the token handshake used by the HA Companion apps and by
// the View Assist Companion App (VACA). When B-Panels runs inside one of those
// apps' web views there is NO `hassTokens` in localStorage: the app logs the
// user in natively and hands the page short-lived access tokens on request.
//
// Protocol (same as HA's own frontend, src/external_app/external_auth.ts):
//   page → app:  window.externalApp.getExternalAuth(JSON.stringify({callback, force}))
//                (iOS: window.webkit.messageHandlers.getExternalAuth.postMessage({...}))
//   app → page:  window[callback](success: boolean, data: {access_token, expires_in})
//
// Without this, B-Panels inside VACA waits forever on "Loading Dashboard…" and
// the console shows "window.externalAuthSetToken is not a function".

import { Auth } from 'home-assistant-js-websocket';

const CALLBACK = 'externalAuthSetToken';
const REVOKE_CALLBACK = 'externalAuthRevokeToken';

interface ExternalTokenData {
  access_token: string;
  expires_in: number;
}

// Resolved lazily so importing this module is safe outside a browser (tests/SSR).
const win = (): any => (typeof window === 'undefined' ? {} : window);

export const hasExternalAuth = (): boolean => {
  const w = win();
  return !!(w.externalApp?.getExternalAuth || w.webkit?.messageHandlers?.getExternalAuth);
};

const requestToken = (force: boolean): Promise<ExternalTokenData> =>
  new Promise((resolve, reject) => {
    const w = win();
    const timer = window.setTimeout(() => reject(new Error('External auth timed out')), 15000);
    w[CALLBACK] = (success: boolean, data: ExternalTokenData) => {
      window.clearTimeout(timer);
      if (success && data?.access_token) resolve(data);
      else reject(new Error('External auth refused'));
    };
    const payload = { callback: CALLBACK, force };
    if (w.externalApp?.getExternalAuth) {
      w.externalApp.getExternalAuth(JSON.stringify(payload));
    } else {
      w.webkit.messageHandlers.getExternalAuth.postMessage(payload);
    }
  });

export class ExternalAuth extends Auth {
  constructor(hassUrl: string) {
    super({
      hassUrl,
      clientId: '',
      refresh_token: '',
      access_token: '',
      expires_in: 0,
      expires: 0,
    });
  }

  async refreshAccessToken(force?: boolean): Promise<void> {
    const data = await requestToken(!!force);
    this.data.access_token = data.access_token;
    this.data.expires = data.expires_in * 1000 + Date.now();
  }

  async revoke(): Promise<void> {
    await new Promise<void>((resolve) => {
      const w = win();
      w[REVOKE_CALLBACK] = () => resolve();
      const payload = { callback: REVOKE_CALLBACK };
      if (w.externalApp?.revokeExternalAuth) w.externalApp.revokeExternalAuth(JSON.stringify(payload));
      else if (w.webkit?.messageHandlers?.revokeExternalAuth) w.webkit.messageHandlers.revokeExternalAuth.postMessage(payload);
      else resolve();
    });
  }
}

/** Build an ExternalAuth with a fresh token already loaded. */
export async function createExternalAuth(hassUrl: string): Promise<ExternalAuth> {
  const auth = new ExternalAuth(hassUrl);
  await auth.refreshAccessToken();
  return auth;
}
