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
