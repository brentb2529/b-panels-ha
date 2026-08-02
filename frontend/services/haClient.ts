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

// Liveness probe. After a kiosk device sleeps, the websocket can become a
// "zombie" — still flagged open but delivering nothing — so the state (incl. the
// alarm tile) silently goes stale. ping() round-trips over the live socket; if it
// doesn't answer within the timeout, the socket is dead and the caller should
// force a reconnect. Returns true only on a real, timely pong.
export async function pingAlive(timeoutMs = 3000): Promise<boolean> {
    try {
        const conn = await getConnection();
        await Promise.race([
            (conn as any).ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), timeoutMs)),
        ]);
        return true;
    } catch {
        return false;
    }
}

// Force the existing connection to drop its socket and reconnect now (which
// re-runs subscriptions and re-syncs the full entity collection). Used on wake /
// network-online / when a liveness ping fails, so a stale snapshot can't persist.
export async function forceReconnect(): Promise<void> {
    try {
        const conn = await getConnection();
        (conn as any).reconnect(true);
    } catch {
        // No live connection object — getConnection's own retry path will rebuild it.
        connectionPromise = null;
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

// --- Airzone climate-zone topology id map (DEVICE-REGISTRY FALLBACK) ----------
// Resolve `climate.*` entity_ids to their Airzone "system:zone" id (e.g. "1:2")
// via the device registry. This is now a FALLBACK ONLY: each climate entity
// exposes a `zone_id` attribute in its state (see climate.zoneIdMapFromEntities),
// which needs no admin call and is the primary path. We keep this for entities
// that somehow lack `zone_id` (older firmware / pre-merge instances).
//
// The Airzone integration names each zone's HA device with identifier
// `f"{entry_id}_{system_zone_id}"` where system_zone_id = "{system}:{zone}".
// We join entity_registry (entity_id → device_id) with device_registry
// (device_id → identifiers) and extract the "<digits>:<digits>" suffix.
//
// device_registry/list is admin-gated; if it's unavailable (non-admin user)
// this returns {} and the affected entities degrade to standalone grouping.
// `onlyEntities`, when given, limits the result to those entity_ids (the ones
// still missing a state-based zone_id), so a non-admin failure here is harmless
// when the state path already covered everything. Never throws.
export async function getClimateZoneIdMap(onlyEntities?: Set<string>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (onlyEntities && onlyEntities.size === 0) return out;
    try {
        const conn = await getConnection();

        // device_id → "system:zone" from the device registry identifiers.
        const deviceZoneId: Record<string, string> = {};
        let devices: any[] = [];
        try {
            const res: any = await conn.sendMessagePromise({ type: 'config/device_registry/list' });
            devices = Array.isArray(res) ? res : Array.isArray(res?.devices) ? res.devices : [];
        } catch (e) {
            console.warn('[B-Panels] device_registry/list unavailable (non-admin?); zone_id-less climates degrade to standalone.', e);
            return out;
        }
        // HA identifiers are [[domain, id], ...]. Match the trailing
        // "<system>:<zone>" (digits:digits) regardless of the entry_id prefix.
        const ZONE_RE = /(\d+:\d+)$/;
        for (const d of devices) {
            const ids: any[] = Array.isArray(d?.identifiers) ? d.identifiers : [];
            for (const tuple of ids) {
                const idStr = Array.isArray(tuple) ? String(tuple[1] ?? '') : String(tuple ?? '');
                const m = idStr.match(ZONE_RE);
                if (m && d.id) {
                    deviceZoneId[d.id] = m[1];
                    break;
                }
            }
        }
        if (Object.keys(deviceZoneId).length === 0) return out;

        // entity_id → device_id, then join to "system:zone".
        const entityDevice = await getEntityDeviceMap();
        for (const [eid, did] of Object.entries(entityDevice)) {
            if (!eid.startsWith('climate.')) continue;
            if (onlyEntities && !onlyEntities.has(eid)) continue;
            const zoneId = deviceZoneId[did];
            if (zoneId) out[eid] = zoneId;
        }
    } catch (e) {
        console.warn('[B-Panels] climate zone-id device-registry fallback failed; affected zones degrade to standalone.', e);
    }
    return out;
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

export async function saveDashboardConfig(config: any): Promise<void> {
    try {
        const conn = await getConnection();
        await conn.sendMessagePromise({
            type: 'b_panels/config/save',
            config,
            source: PANEL_SOURCE_ID,
        });
    } catch {
        try {
            localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
        } catch {
            /* ignore */
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
