// HA-only API surface.
//
// This frontend was ported from a dashboard that talked to a Node api-server.
// All persistence and realtime now go through Home Assistant directly via
// services/haClient.ts. Auth is handled by HA (same-origin iframe). The
// api-server-only features have no HA equivalent and are kept as safe stubs so
// existing callers continue to compile.

import { StoredConfig } from '../hooks/useDashboard';
import { AdminUser } from '../types';
import * as haClient from './haClient';

// --- Config storage (HA WebSocket custom command, localStorage fallback) ------
export const apiGetConfig = async (): Promise<StoredConfig | null> => {
    return (await haClient.getDashboardConfig()) as StoredConfig | null;
};

export const apiSaveConfig = async (config: StoredConfig): Promise<void> => {
    await haClient.saveDashboardConfig(config);
};

// --- HA entity states ---------------------------------------------------------
export const apiGetHomeAssistantStates = async (): Promise<any[]> => {
    return haClient.getStates();
};

export const apiTestHomeAssistant = async (): Promise<{ ok: boolean; entityCount?: number; alarmoFound?: boolean; error?: string }> => {
    try {
        const states = await haClient.getStates();
        const alarmoFound = states.some((e: any) => e.entity_id === 'alarm_control_panel.alarmo');
        return { ok: true, entityCount: states.length, alarmoFound };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
};

// --- Auth (handled by HA — these are safe stubs) ------------------------------
export const apiLogin = async (_username: string, _password: string): Promise<{ token: string; user: AdminUser }> => {
    // HA owns auth; no separate admin login. Resolve a synthetic admin user.
    const user: AdminUser = { id: 'ha-user', username: 'admin', displayName: 'Home Assistant' };
    return { token: 'ha', user };
};

export const apiLogout = async (): Promise<void> => {
    return Promise.resolve();
};

export const apiGetCurrentUser = async (): Promise<AdminUser | null> => {
    // Same-origin iframe in HA: treat as an authenticated admin.
    return { id: 'ha-user', username: 'admin', displayName: 'Home Assistant' };
};

export const bootstrapDeviceToken = async (): Promise<void> => {
    return Promise.resolve();
};

export const apiValidateDeviceToken = async (): Promise<void> => {
    return Promise.resolve();
};

// --- Admin user management (no-op; HA manages users) --------------------------
export const apiListAdminUsers = async (): Promise<AdminUser[]> => {
    return [];
};

export const apiAddAdminUser = async (newUser: Omit<AdminUser, 'id'> & { password: string }): Promise<AdminUser> => {
    const { password, ...rest } = newUser;
    void password;
    return { id: `user-${Date.now()}`, ...rest };
};

export const apiDeleteAdminUser = async (_userId: string): Promise<void> => {
    return Promise.resolve();
};

// --- Device tokens (api-server-only; stubs) -----------------------------------
export const apiListDevices = async (): Promise<any[]> => [];
export const apiAddDevice = async (name: string): Promise<{ id: string; name: string; token: string }> => ({ id: `device-${Date.now()}`, name, token: '' });
export const apiDeleteDevice = async (_deviceId: string): Promise<void> => Promise.resolve();

// --- Monitoring webhooks (api-server-only; stubs) -----------------------------
export const apiSendTestWebhook = async (): Promise<void> => Promise.resolve();
export const apiSendWebhookNotification = async (_message: string, _status: string, _metadata?: Record<string, any>): Promise<void> => Promise.resolve();

// --- TTS broadcast (api-server fan-out; local-only now, stub) -----------------
export const apiBroadcastTts = async (_text: string, _panelId?: string): Promise<{ ok: boolean; broadcasted?: string; error?: string }> => ({ ok: false, error: 'TTS broadcast is not available in HA-only mode.' });

// --- Alarmo arm/disarm (now via HA WebSocket) ---------------------------------
export const apiHomeAssistantArm = async (
    armState: 'armedAway' | 'armedStay' | 'disarmed',
    options?: { skipDelay?: boolean; force?: boolean; pin?: string }
): Promise<{ ok: boolean; error?: string }> => {
    try {
        const data: Record<string, any> = { entity_id: 'alarm_control_panel.alarmo' };
        if (options?.pin) data.code = options.pin;
        let service: string;
        if (armState === 'disarmed') {
            service = 'disarm';
        } else {
            service = 'arm';
            data.mode = armState === 'armedAway' ? 'away' : 'home';
            if (options?.skipDelay) data.skip_delay = true;
            if (options?.force) data.force = true;
        }
        await haClient.callService('alarmo', service, data);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
};

// --- Removed api-server features (Lutron / SmartThings / RSS / panel fleet / ---
// --- cloud + ST backup / Noonlight / Whisker). Stubbed so imports compile. -----

export const apiGetLutronDevices = async (): Promise<any[]> => [];
export const apiSendLutronCommand = async (_deviceId: string, _command: any): Promise<void> => Promise.resolve();
export const apiGetLutronStatus = async (): Promise<any> => ({ isPaired: false, isConnected: false });
export const apiGenerateLutronCsr = async (): Promise<{ csr: string; privateKey: string }> => ({ csr: '', privateKey: '' });
export const apiUploadLutronCerts = async (_clientCert: string, _caCert: string): Promise<void> => Promise.resolve();
export const apiUploadLutronCertsManual = async (_clientKey: string, _clientCert: string, _caCert: string): Promise<void> => Promise.resolve();
export const apiDiscoverLutronProcessors = async (): Promise<{ processors: Array<{ name: string; ip: string; port: number; type: string }> }> => ({ processors: [] });
export const apiPairLutron = async (_processorIp: string): Promise<{ ok: boolean; message: string; processorIp: string; error?: string }> => ({ ok: false, message: 'Lutron is not available in HA-only mode.', processorIp: _processorIp });

export const apiReportSTHMState = async (_locationId: string, _armState: string): Promise<void> => Promise.resolve();

export const apiFetchRssFeed = async (_feedUrl: string): Promise<string> => {
    throw new Error('RSS proxy is not available in HA-only mode.');
};

export const apiSendPanelCommand = async (_installationId: string, _command: Record<string, any>): Promise<void> => Promise.resolve();
export const apiGetPanelScreenshotUrl = async (_installationId: string): Promise<string> => {
    throw new Error('Panel screenshots are not available in HA-only mode.');
};

export const apiWhiskerLogin = async (_email: string, _password: string): Promise<any> => ({ access_token: '' });
export const apiWhiskerGetRobots = async (_token: string): Promise<any[]> => [];

// --- Cloud backup (api-server-only; types + stubs kept so Admin compiles) -----
export interface CloudBackupConfig {
    enabled: boolean;
    provider: 's3' | 'gdrive' | null;
    encryptionKey?: string;
    schedule?: { frequency: string; timeOfDay: string };
    keepLocalBackups?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    webhookUrl?: string;
    s3?: { bucket: string; region: string; prefix?: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; retentionDays: number };
    gdrive?: { folderId?: string; clientId?: string; clientSecret?: string; refreshToken?: string; retentionDays: number };
}
export interface CloudBackupStatus {
    enabled: boolean;
    provider: string | null;
    lastBackupTime: string | null;
    lastBackupResult: { success: boolean; timestamp?: string; filename?: string; size?: number; error?: string } | null;
    nextScheduledBackup: string | null;
    backupHistory: any[];
    serviceAvailable?: boolean;
    error?: string;
}
export interface CloudBackupTestResult {
    success: boolean;
    tests: { name: string; passed: boolean; message?: string; error?: string; suggestion?: string }[];
    config?: { bucket?: string; region?: string; endpoint?: string; prefix?: string; folderId?: string };
}
export const apiGetCloudBackupConfig = async (): Promise<CloudBackupConfig | null> => ({ enabled: false, provider: null });
export const apiSaveCloudBackupConfig = async (_config: CloudBackupConfig): Promise<void> => Promise.resolve();
export const apiGetCloudBackupStatus = async (): Promise<CloudBackupStatus> => ({ enabled: false, provider: null, lastBackupTime: null, lastBackupResult: null, nextScheduledBackup: null, backupHistory: [], serviceAvailable: false });
export const apiTriggerCloudBackup = async (): Promise<any> => ({ success: false, error: 'Backups are not available in HA-only mode.' });
export const apiGenerateEncryptionKey = async (): Promise<{ key: string }> => ({ key: '' });
export const apiTestCloudBackupConnection = async (_config: CloudBackupConfig): Promise<CloudBackupTestResult> => ({ success: false, tests: [] });

// --- SmartThings backup (removed; types + stubs kept so Admin compiles) -------
export interface SmartThingsBackupConfig {
    enabled: boolean;
    schedule: 'hourly' | 'daily' | 'weekly';
    hasPat: boolean;
    lastBackup: string | null;
    backupCount: number;
}
export interface SmartThingsBackupInfo { filename: string; path: string; size: number; created: string }
export interface SmartThingsPatValidation { valid: boolean; locationCount?: number; locations?: { id: string; name: string }[]; error?: string }
export const apiGetSmartThingsBackupConfig = async (): Promise<SmartThingsBackupConfig> => ({ enabled: false, schedule: 'daily', hasPat: false, lastBackup: null, backupCount: 0 });
export const apiSaveSmartThingsBackupConfig = async (_config: { enabled?: boolean; schedule?: string; pat?: string }): Promise<void> => Promise.resolve();
export const apiValidateSmartThingsPat = async (_pat: string): Promise<SmartThingsPatValidation> => ({ valid: false, error: 'SmartThings is not available in HA-only mode.' });
export const apiTriggerSmartThingsBackup = async (): Promise<any> => ({ success: false, message: 'SmartThings is not available in HA-only mode.' });
export const apiListSmartThingsBackups = async (): Promise<{ backups: SmartThingsBackupInfo[] }> => ({ backups: [] });
export const apiGetSmartThingsBackup = async (_filename: string): Promise<any> => null;
export const apiGetLatestSmartThingsBackup = async (): Promise<any> => null;
