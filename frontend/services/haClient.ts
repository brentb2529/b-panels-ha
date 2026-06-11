// Single Home Assistant gateway for the B-Panels SPA.
//
// The SPA is served by the b_panels custom integration as a sidebar panel
// (iframe, same-origin as HA). It talks to HA directly over the HA WebSocket
// API — there is NO api-server. For standalone dev, point at a remote HA via
// VITE_HASS_URL and the standard auth redirect flow will run.

import {
    getAuth,
    createConnection,
    createLongLivedTokenAuth,
    getStates as haGetStates,
    subscribeEntities as haSubscribeEntities,
    callService as haCallService,
    ERR_HASS_HOST_REQUIRED,
    type Auth,
    type Connection,
    type HassEntities,
} from 'home-assistant-js-websocket';

// HA stores the signed-in user's session (full AuthData) under 'hassTokens'.
// When the SPA runs as an HA sidebar panel it is a same-origin iframe, so we
// reuse that session and getAuth never runs the OAuth redirect — whose
// redirect URI is invalid inside the panel iframe ("Invalid redirect URI").
const HA_TOKEN_STORAGE_KEY = 'hassTokens';
// Our own key, used only for standalone dev (VITE_HASS_URL) where the redirect
// flow is valid and HA's hassTokens are not present.
const TOKEN_STORAGE_KEY = 'bPanelsHassTokens';
const LOCAL_CONFIG_KEY = 'bPanelsConfig';

const hassUrl = (): string => {
    const envUrl = (import.meta as any).env?.VITE_HASS_URL;
    if (envUrl) return envUrl as string;
    return window.location.origin;
};

// Headless/kiosk auth: an HA Long-Lived Access Token lets a standalone panel
// (Fully Kiosk, wall tablet, any non-sidebar load) connect with NO login.
// Provision it once by opening the panel with ?access_token=<LLAT> (also accepts
// ?token=, in the normal query OR inside the hash route); we persist it here and
// strip it from the URL so it isn't left visible or re-read.
const LLAT_KEY = 'bPanelsHAToken';
function getProvisionedToken(): string | null {
    const readFrom = (qs: string) => {
        const p = new URLSearchParams(qs);
        return p.get('access_token') || p.get('token');
    };
    let urlTok: string | null = null;
    try {
        urlTok = readFrom(window.location.search);
        if (!urlTok && window.location.hash.includes('?')) {
            urlTok = readFrom(window.location.hash.split('?')[1]);
        }
    } catch { /* ignore */ }
    if (urlTok) {
        try { localStorage.setItem(LLAT_KEY, urlTok); } catch { /* ignore */ }
        // Strip the token from both the query and the hash route.
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('access_token');
            url.searchParams.delete('token');
            let hash = url.hash;
            if (hash.includes('?')) {
                const [hpath, hq] = hash.split('?');
                const hp = new URLSearchParams(hq);
                hp.delete('access_token');
                hp.delete('token');
                hash = hp.toString() ? `${hpath}?${hp.toString()}` : hpath;
            }
            history.replaceState(null, '', url.pathname + url.search + hash);
        } catch { /* ignore */ }
        return urlTok;
    }
    try { return localStorage.getItem(LLAT_KEY); } catch { return null; }
}

let connectionPromise: Promise<Connection> | null = null;
// The active Auth, captured on connect, for authenticated HTTP calls (haFetch).
let currentAuth: Auth | null = null;

const loadTokens = () => {
    // Prefer HA's own session (panel mode = no redirect); fall back to our
    // standalone-dev key.
    for (const key of [HA_TOKEN_STORAGE_KEY, TOKEN_STORAGE_KEY]) {
        try {
            const raw = localStorage.getItem(key);
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore parse error / disabled storage; try next key */
        }
    }
    return null;
};

const saveTokens = (tokens: unknown) => {
    try {
        if (tokens === null) {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        } else {
            localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
        }
    } catch {
        /* ignore quota / disabled storage */
    }
};

async function connect(): Promise<Connection> {
    // Preferred path when running as an HA iframe panel (same-origin): reuse the
    // host HA frontend's live, already-authenticated connection. HA exposes it
    // as `window.hassConnection` (a Promise<{conn, auth}>); from our iframe that
    // is `window.parent.hassConnection`. This avoids our own OAuth redirect
    // entirely — the redirect is what fails with HA's "Invalid redirect URI"
    // when this frame has no readable session token. Cross-origin access throws,
    // so we guard and fall through to the standalone getAuth flow below.
    try {
        const parent = window.parent as any;
        if (parent && parent !== window && parent.hassConnection) {
            const { conn, auth: parentAuth } = await parent.hassConnection;
            if (conn) {
                if (parentAuth) currentAuth = parentAuth as Auth;
                return conn as Connection;
            }
        }
    } catch {
        /* parent is cross-origin or has no hassConnection — use getAuth below */
    }

    // Headless/kiosk: a provisioned Long-Lived Access Token connects with no
    // login and no OAuth redirect. This is the standalone-panel path (the
    // sidebar uses the parent connection above; dev/desktop falls through to the
    // interactive getAuth below).
    const llat = getProvisionedToken();
    if (llat) {
        try {
            const auth = createLongLivedTokenAuth(hassUrl(), llat);
            currentAuth = auth;
            return await createConnection({ auth });
        } catch (e) {
            console.warn('[HA] Long-lived token connect failed; falling back to interactive auth.', e);
        }
    }

    let auth: Auth;
    try {
        auth = await getAuth({
            hassUrl: hassUrl(),
            saveTokens,
            loadTokens: async () => loadTokens(),
        });
    } catch (err) {
        if (err === ERR_HASS_HOST_REQUIRED) {
            // Standalone dev with no configured host: ask once, then retry.
            const url = window.prompt(
                'Enter the Home Assistant URL (e.g. http://homeassistant.local:8123)',
                hassUrl()
            );
            if (!url) {
                throw err;
            }
            auth = await getAuth({
                hassUrl: url,
                saveTokens,
                loadTokens: async () => loadTokens(),
            });
        } else {
            throw err;
        }
    }

    currentAuth = auth;
    const connection = await createConnection({ auth });

    // If we obtained fresh tokens via the redirect flow, strip the auth
    // callback params from the URL so a refresh doesn't re-trigger it.
    if (location.search.includes('auth_callback=1')) {
        history.replaceState(null, '', location.pathname + location.hash);
    }

    return connection;
}

export function getConnection(): Promise<Connection> {
    if (!connectionPromise) {
        connectionPromise = connect().catch((err) => {
            // Allow a later retry if this attempt failed.
            connectionPromise = null;
            throw err;
        });
    }
    return connectionPromise;
}

export async function getStates(): Promise<any[]> {
    const conn = await getConnection();
    const states = await haGetStates(conn);
    return Array.isArray(states) ? states : Object.values(states ?? {});
}

// SAFETY (production-failure lessons A — alarm false-"disarmed"): the proven
// root fix for a zombie websocket (one that answers ping() yet has MISSED the
// arm push, leaving a stale snapshot) is a full RESYNC. `forceReconnect` tears
// the socket down and back up so home-assistant-js-websocket re-fetches the
// entire entity collection — re-anchoring every subscriber to the live truth.
//
// We do NOT rely on this connection's own auto-reconnect or its ping timer:
// both can freeze when a kiosk device sleeps. The caller invokes this on a
// DEFINITE state mismatch detected by the independent truth-reconcile.
export async function forceReconnect(): Promise<void> {
    try {
        const conn = await getConnection();
        // `reconnect(true)` forces a fresh socket + re-subscribes everything,
        // which re-emits the full state to subscribeEntities consumers.
        (conn as any).reconnect?.(true);
    } catch (e) {
        // If we can't even reach the cached connection, drop it so the next
        // getConnection() rebuilds from scratch.
        console.warn('[HA] forceReconnect failed; dropping cached connection.', e);
        connectionPromise = null;
    }
}

// Liveness probe used as a SECONDARY signal only. A request/response getStates()
// (the truth-reconcile) is the primary check because a zombie socket can answer
// a bare ping while having missed pushes. Resolves true if the socket round-
// trips within `timeoutMs`, false otherwise (never throws).
export async function pingAlive(timeoutMs = 5000): Promise<boolean> {
    try {
        const conn = await getConnection();
        const ping = (conn as any).ping?.() ?? (conn as any).sendMessagePromise?.({ type: 'ping' });
        if (!ping) return !!(conn as any).connected;
        const timeout = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), timeoutMs));
        const result = await Promise.race([ping.then(() => 'ok' as const), timeout]);
        return result === 'ok';
    } catch {
        return false;
    }
}

// Send a raw websocket command and return its result (for integration WS
// commands without a dedicated wrapper, e.g. Alarmo's read-only `alarmo/users`).
export async function haSendMessage(msg: Record<string, any>): Promise<any> {
    const conn = await getConnection();
    return (conn as any).sendMessagePromise(msg);
}

// Authenticated fetch to an HA HTTP endpoint (for integration HTTP APIs that
// aren't exposed over the websocket — e.g. Alarmo's `/api/alarmo/users` write
// view). Uses the session's bearer token + the configured HA base URL, so it
// works both in the same-origin panel and in standalone dev.
export async function haFetch(path: string, init?: RequestInit): Promise<Response> {
    await getConnection();
    const token: string | undefined = currentAuth?.accessToken;
    const base: string = (currentAuth?.data?.hassUrl as string) || hassUrl();
    return fetch(`${base}${path}`, {
        ...init,
        headers: {
            ...(init?.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}

export async function subscribeEntities(
    cb: (entities: HassEntities) => void
): Promise<() => void> {
    const conn = await getConnection();
    return haSubscribeEntities(conn, cb);
}

// Connection liveness for the life-safety takeover's three-state freshness
// (known-good / stale / signal-lost). The takeover MUST be able to tell "live"
// from "I have no idea" — a frozen/disconnected panel must never read clear.
// We surface the WS `ready`/`disconnected`/`reconnect-error` events plus the
// current `connected` getter; the takeover combines this with state-age.
export async function subscribeConnectionState(
    cb: (connected: boolean) => void
): Promise<() => void> {
    const conn = await getConnection();
    const onReady = () => cb(true);
    const onDown = () => cb(false);
    conn.addEventListener('ready', onReady);
    conn.addEventListener('disconnected', onDown);
    conn.addEventListener('reconnect-error', onDown);
    // Emit the current state immediately so the consumer doesn't sit at a stale
    // default until the next transition.
    try { cb((conn as any).connected !== false); } catch { cb(true); }
    return () => {
        conn.removeEventListener('ready', onReady);
        conn.removeEventListener('disconnected', onDown);
        conn.removeEventListener('reconnect-error', onDown);
    };
}

export async function callService(
    domain: string,
    service: string,
    data?: Record<string, any>,
    target?: Record<string, any>
): Promise<void> {
    const conn = await getConnection();
    await haCallService(conn, domain, service, data, target as any);
}

// --- Deploy / command rail (Admin Stage 4, Inc 13) ----------------------------
// Thin wrapper around the existing `b_panels.command` service (registered in
// custom_components/b_panels/__init__.py). The service fans a command out to
// every connected kiosk panel over the command-channel WebSocket, or to a single
// panel when `installation_id` is given. This is the PUSH half of "Deploy":
// after the admin SAVES the config (config/save), firing `reload` makes the
// connected iPads re-fetch and re-render the new config. No new backend needed.
//
// Allowed actions mirror COMMAND_SERVICE_SCHEMA: reload | hardReset |
// switchPanel | screenOn | screenOff | setBrightness | tts | playSound |
// screenshot. Deploy uses `reload` (all panels) or a targeted `reload`.
export type BPanelsCommandAction =
  | 'reload' | 'hardReset' | 'switchPanel' | 'screenOn' | 'screenOff'
  | 'setBrightness' | 'tts' | 'playSound' | 'screenshot';

export interface BPanelsCommandOptions {
  /** Target a single panel by its installation id; omit = all connected panels. */
  installationId?: string;
  /** for switchPanel */
  panelId?: string;
  /** for setBrightness (0.0–1.0) */
  value?: number;
  /** for tts */
  text?: string;
  /** for playSound */
  url?: string;
}

/**
 * PURE: build the exact `b_panels.command` service-call shape for an action +
 * options. No I/O — split out so the Admin UI and unit tests can assert on the
 * shape without a live socket. Mirrors COMMAND_SERVICE_SCHEMA's field mapping.
 */
export function buildPanelCommand(
  action: BPanelsCommandAction,
  opts: BPanelsCommandOptions = {},
): { domain: string; service: string; data: Record<string, any> } {
  const data: Record<string, any> = { action };
  if (opts.installationId) data.installation_id = opts.installationId;
  if (opts.panelId) data.panel_id = opts.panelId;
  if (typeof opts.value === 'number') data.value = opts.value;
  if (opts.text) data.text = opts.text;
  if (opts.url) data.url = opts.url;
  return { domain: 'b_panels', service: 'command', data };
}

/**
 * Fire the `b_panels.command` service. Returns the exact service-call shape sent
 * (so the Admin UI can show/confirm it). Resolves even when no kiosk panels are
 * connected (the service logs a warning and returns).
 */
export async function sendPanelCommand(
  action: BPanelsCommandAction,
  opts: BPanelsCommandOptions = {},
): Promise<{ domain: string; service: string; data: Record<string, any> }> {
  const call = buildPanelCommand(action, opts);
  await callService(call.domain, call.service, call.data);
  return call;
}

/** Convenience: the Deploy push — reload all panels, or a single installation. */
export async function deployReload(
  installationId?: string,
): Promise<{ domain: string; service: string; data: Record<string, any> }> {
  return sendPanelCommand('reload', installationId ? { installationId } : {});
}

// --- RSS/Atom feed proxy ------------------------------------------------------
// Fetch a feed via the b_panels integration (server-side, CORS-safe). Returns
// the raw feed body; the News tile parses it client-side.
export async function fetchRssFeed(url: string): Promise<string> {
    const conn = await getConnection();
    const res: any = await conn.sendMessagePromise({ type: 'b_panels/rss', url });
    return res?.body ?? '';
}

// --- Generator / local-device JSON proxy --------------------------------------
// Fetch a generator endpoint (e.g. an EnergyTrak/genmon site-details API) via
// the b_panels integration (server-side, CORS-safe, LAN-allowed). The URL comes
// from the dashboard config, never hardcoded. Returns the parsed JSON document.
export async function fetchGeneratorData(url: string): Promise<any> {
    const conn = await getConnection();
    const res: any = await conn.sendMessagePromise({ type: 'b_panels/generator', url });
    return res?.data ?? null;
}

// --- Panel-to-panel intercom signaling (feat/panel-intercom) ------------------
// A thin WebRTC signaling relay that rides the SPA's AUTHENTICATED HA websocket
// (the same `getConnection()` used everywhere else). A panel sends a small
// envelope via the `b_panels/intercom/signal` command; the b_panels component
// re-fires it as the `b_panels_intercom_signal` HA event, which every panel
// subscribes to (filtering on `to`). This is token-gated by HA auth itself —
// NO new unauthenticated endpoint, NO LAN-token kiosk channel. It carries ONLY
// signaling (SDP/ICE/call control) and actuates NO home equipment.

export type IntercomSignalKind =
  | 'presence' | 'invite' | 'accept' | 'decline' | 'ice' | 'bye' | 'busy';

export interface IntercomSignal {
  /** target panel installation id */
  to: string;
  /** caller panel installation id */
  from: string;
  kind: IntercomSignalKind;
  /** correlates all messages of one call */
  callId: string;
  /** caller's room label (display only) */
  fromName?: string | null;
  /** SDP / ICE candidate / call-control payload */
  payload?: Record<string, any> | string | null;
}

/** Send one intercom signaling envelope over the authenticated HA websocket. */
export async function sendIntercomSignal(sig: IntercomSignal): Promise<void> {
  const conn = await getConnection();
  await conn.sendMessagePromise({ type: 'b_panels/intercom/signal', ...sig });
}

/**
 * Subscribe to inbound intercom signals. The callback fires for EVERY relayed
 * signal; the caller is responsible for filtering on `to === myId` (the hook
 * does this). Returns an unsubscribe function.
 */
export async function subscribeIntercomSignals(
  cb: (sig: IntercomSignal) => void,
): Promise<() => void> {
  const conn = await getConnection();
  return conn.subscribeEvents((ev: any) => {
    const d = ev?.data;
    if (d && typeof d === 'object' && d.kind && d.callId) cb(d as IntercomSignal);
  }, 'b_panels_intercom_signal');
}

// --- Weather forecast ---------------------------------------------------------
// Daily forecast for a HA `weather.*` entity via the get_forecasts service
// (response-returning). Returns [] if unavailable.
export async function getWeatherForecast(entityId: string): Promise<any[]> {
    try {
        const conn = await getConnection();
        const res: any = await conn.sendMessagePromise({
            type: 'call_service',
            domain: 'weather',
            service: 'get_forecasts',
            service_data: { type: 'daily' },
            target: { entity_id: entityId },
            return_response: true,
        });
        const fc = res?.response?.[entityId]?.forecast;
        return Array.isArray(fc) ? fc : [];
    } catch {
        return [];
    }
}

// --- Entity → device grouping -------------------------------------------------
// Map each entity_id to the HA device it belongs to, so the UI can group an
// integration's split entities back into one tile (e.g. a Litter-Robot's
// vacuum + waste + litter sensors). Uses the display-oriented registry command,
// which is available to non-admin users. Returns {} if unavailable.
export async function getEntityDeviceMap(): Promise<Record<string, string>> {
    const conn = await getConnection();
    const map: Record<string, string> = {};
    // Prefer the full registry (admin users): each entry has entity_id +
    // device_id directly. Fall back to the display list (non-admin) whose
    // entries use the short keys { ei: entity_id, di: device_id }.
    const commands = ['config/entity_registry/list', 'config/entity_registry/list_for_display'];
    for (const type of commands) {
        try {
            const res: any = await conn.sendMessagePromise({ type });
            const entities: any[] = Array.isArray(res?.entities) ? res.entities : Array.isArray(res) ? res : [];
            for (const e of entities) {
                const eid = e.entity_id ?? e.ei;
                const did = e.device_id ?? e.di;
                if (eid && did) map[eid] = did;
            }
            if (Object.keys(map).length > 0) {
                console.log(`[B-Panels] entity→device map: ${Object.keys(map).length} entities via ${type}`);
                return map;
            }
        } catch (e) {
            console.warn(`[B-Panels] ${type} unavailable:`, e);
        }
    }
    console.warn('[B-Panels] No entity→device map available; composite device cards (e.g. Litter-Robot) will fall back to individual tiles.');
    return map;
}

// --- Areas (Admin Stage 2 — EDITOR-ONLY one-time import) ----------------------
// IMPORTANT (least-privilege): these read HA's area_registry + entity_registry,
// which are ADMIN-ONLY. They exist SOLELY to let the admin Areas manager
// PRE-SEED the curated `areas` map in the b_panels config. The rendered kiosk
// dashboard (non-admin LLAT) must NEVER call these — it reads only the curated
// `areas` from config. Each returns [] on failure so the import degrades
// gracefully (the admin can still build areas by hand).

export interface HaArea { area_id: string; name: string }
export interface HaEntityArea { entity_id: string; area_id: string | null; device_id: string | null }

// HA's area_registry/list (admin-only). Returns the list of areas, or [].
export async function fetchAreaRegistry(): Promise<HaArea[]> {
    try {
        const conn = await getConnection();
        const res: any = await conn.sendMessagePromise({ type: 'config/area_registry/list' });
        const areas: any[] = Array.isArray(res) ? res : Array.isArray(res?.areas) ? res.areas : [];
        return areas
            .filter(a => a && a.area_id)
            .map(a => ({ area_id: a.area_id, name: a.name || a.area_id }));
    } catch (e) {
        console.warn('[B-Panels] area_registry/list unavailable (non-admin?):', e);
        return [];
    }
}

// HA's entity_registry/list (admin-only) projected to entity→area assignments.
// Note an entity's effective area is its own `area_id` if set, else the area of
// its device (`device_id`); we surface both so the caller can resolve via the
// entity→device map when needed. Returns [].
export async function fetchEntityAreaRegistry(): Promise<HaEntityArea[]> {
    try {
        const conn = await getConnection();
        const res: any = await conn.sendMessagePromise({ type: 'config/entity_registry/list' });
        const ents: any[] = Array.isArray(res?.entities) ? res.entities : Array.isArray(res) ? res : [];
        return ents
            .filter(e => e && (e.entity_id || e.ei))
            .map(e => ({
                entity_id: e.entity_id ?? e.ei,
                area_id: e.area_id ?? null,
                device_id: e.device_id ?? e.di ?? null,
            }));
    } catch (e) {
        console.warn('[B-Panels] entity_registry/list unavailable (non-admin?):', e);
        return [];
    }
}

// --- Camera streams -----------------------------------------------------------
// Resolve a live HLS stream URL for a Home Assistant `camera` entity via HA's
// stream component (the `camera/stream` WS command). HA replies with a
// host-relative path (e.g. /api/hls/<token>/master_playlist.m3u8); we resolve
// it to an absolute URL against the HA origin so hls.js can load it. Returns
// null if the camera can't provide a stream.
export async function getCameraStreamUrl(entityId: string): Promise<string | null> {
    const conn = await getConnection();
    const result: any = await conn.sendMessagePromise({
        type: 'camera/stream',
        entity_id: entityId,
    });
    const path = result?.url;
    if (!path) return null;
    try {
        return new URL(path, hassUrl()).toString();
    } catch {
        return path;
    }
}

// --- Dashboard config storage (custom WebSocket commands) ---------------------
// Backed by the b_panels integration's storage. Falls back to localStorage in
// standalone dev where the custom commands are not registered.

export async function getDashboardConfig(): Promise<any | null> {
    try {
        const conn = await getConnection();
        const result: any = await conn.sendMessagePromise({
            type: 'b_panels/config/get',
        });
        // The command may return the config directly or wrapped in { config }.
        if (result && typeof result === 'object' && 'config' in result) {
            return result.config ?? null;
        }
        return result ?? null;
    } catch {
        try {
            const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }
}

// Stable per-tab id so a panel can ignore the config-updated broadcast it
// caused itself (only react to saves from OTHER panels).
export const PANEL_SOURCE_ID =
    Math.random().toString(36).slice(2) + Date.now().toString(36);

// Persist the config. Pass `clientRev` = the `_rev` this config was loaded from
// so the server can REFUSE a stale overwrite (config-clobber guard) and so two
// panels editing concurrently can't silently clobber each other. Returns the new
// stored `_rev` on success (so the caller can advance its tracked rev). On a
// stale-rev refusal the server sends an error and this REJECTS — the caller must
// re-fetch before retrying.
export async function saveDashboardConfig(
    config: any,
    clientRev?: number,
): Promise<number | undefined> {
    try {
        const conn = await getConnection();
        const rev = typeof clientRev === 'number'
            ? clientRev
            : (typeof config?._rev === 'number' ? config._rev : undefined);
        const res: any = await conn.sendMessagePromise({
            type: 'b_panels/config/save',
            config,
            source: PANEL_SOURCE_ID,
            ...(rev !== undefined ? { client_rev: rev } : {}),
        });
        return typeof res?.rev === 'number' ? res.rev : undefined;
    } catch (e: any) {
        // A stale_rev / stale_empty refusal must PROPAGATE (the caller re-fetches);
        // only the no-backend standalone-dev path falls back to localStorage.
        const code = e?.code || e?.error?.code;
        if (code === 'stale_rev' || code === 'stale_empty') throw e;
        try {
            localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
            return undefined;
        } catch {
            throw e;
        }
    }
}

// Live config sync: fire `cb` when ANOTHER panel saves the config, so this panel
// can re-fetch + apply it (React state, no reload) instead of holding a stale
// copy it might later save back over the newer one (the clobber/wipe cause).
export async function subscribeConfigUpdates(
    cb: (ev: { rev?: number; source?: string }) => void
): Promise<() => void> {
    const conn = await getConnection();
    return conn.subscribeEvents((ev: any) => {
        const data = ev?.data || {};
        if (data.source !== PANEL_SOURCE_ID) cb(data);
    }, 'b_panels_config_updated');
}

// --- Frontend version (build) detection, for unobtrusive auto-reload ---------
// Vite hashes the main bundle filename on every build, so a changed
// `assets/index-<hash>.js` means a new frontend was deployed.
const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;
let loadedBundle: string | null = null;
export function getLoadedBundle(): string | null {
    if (loadedBundle) return loadedBundle;
    const src = Array.from(document.scripts).map((s) => s.src).find((s) => BUNDLE_RE.test(s));
    const m = src?.match(BUNDLE_RE);
    loadedBundle = m ? m[0] : null;
    return loadedBundle;
}
export async function getDeployedBundle(): Promise<string | null> {
    try {
        const url = new URL('index.html', document.baseURI).toString();
        const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return null;
        const m = (await r.text()).match(BUNDLE_RE);
        return m ? m[0] : null;
    } catch {
        return null;
    }
}
