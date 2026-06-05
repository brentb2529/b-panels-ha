// Single Home Assistant gateway for the B-Panels SPA.
//
// The SPA is served by the b_panels custom integration as a sidebar panel
// (iframe, same-origin as HA). It talks to HA directly over the HA WebSocket
// API — there is NO api-server. For standalone dev, point at a remote HA via
// VITE_HASS_URL and the standard auth redirect flow will run.

import {
    getAuth,
    createConnection,
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

export async function callService(
    domain: string,
    service: string,
    data?: Record<string, any>,
    target?: Record<string, any>
): Promise<void> {
    const conn = await getConnection();
    await haCallService(conn, domain, service, data, target as any);
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

export async function saveDashboardConfig(config: any): Promise<void> {
    try {
        const conn = await getConnection();
        await conn.sendMessagePromise({
            type: 'b_panels/config/save',
            config,
        });
    } catch {
        try {
            localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
        } catch {
            /* ignore */
        }
    }
}
