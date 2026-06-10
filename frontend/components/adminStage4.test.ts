import { describe, it, expect } from 'vitest';

// Deploy is tested via the PURE shape-builder (buildPanelCommand) — no socket.
import { buildPanelCommand } from '../services/haClient';
import {
  isPanelScoped,
  panelRequiresUnlock,
  findUnlockingUser,
  pinsMatch,
  visiblePanels,
} from '../services/panelScoping';
import {
  exportConfig,
  importConfig,
  stripSecrets,
  ConfigImportError,
  SECRET_CONNECTION_KEYS,
} from '../services/configIO';
import type { DashboardPanel, User } from '../types';
import type { StoredConfig } from '../hooks/useDashboard';

// ─────────────────────────────────────────────────────────────────────────
// 1. Deploy — the b_panels.command call SHAPE
// ─────────────────────────────────────────────────────────────────────────
describe('deploy: b_panels.command call shape', () => {
  it('deploy-reload to all panels fires reload with no installation_id', () => {
    const call = buildPanelCommand('reload');
    expect(call).toEqual({ domain: 'b_panels', service: 'command', data: { action: 'reload' } });
  });

  it('deploy-reload to one installation targets it', () => {
    const call = buildPanelCommand('reload', { installationId: 'ipad-pool' });
    expect(call.data).toEqual({ action: 'reload', installation_id: 'ipad-pool' });
  });

  it('maps optional fields to the service schema', () => {
    const call = buildPanelCommand('switchPanel', { installationId: 'a', panelId: 'pool', value: 0.5, text: 't', url: 'u' });
    expect(call.data).toEqual({
      action: 'switchPanel', installation_id: 'a', panel_id: 'pool', value: 0.5, text: 't', url: 'u',
    });
  });

  it('omits absent optionals (clean reload)', () => {
    expect(buildPanelCommand('reload').data).toEqual({ action: 'reload' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Per-user scoping — visibility filter + default-open + takeover override
// ─────────────────────────────────────────────────────────────────────────
const mkPanel = (id: string, visibleToUsers?: string[]): DashboardPanel =>
  ({ id, name: id, tiles: [], visibleToUsers } as DashboardPanel);

describe('panel scoping: default-open + the unlock rule', () => {
  const users: User[] = [
    { id: 'owner', name: 'Owner', pin: '2580' },
    { id: 'guest', name: 'Guest', pin: '1379' },
  ];

  it('a panel with no visibleToUsers is OPEN (the default)', () => {
    expect(isPanelScoped(mkPanel('home'))).toBe(false);
    expect(isPanelScoped(mkPanel('home', []))).toBe(false);
    expect(panelRequiresUnlock(mkPanel('home'), { deviceDefaultPanelId: null, unlockedUserIds: new Set() })).toBe(false);
  });

  it('a scoped panel requires unlock unless an allowed profile is unlocked', () => {
    const p = mkPanel('pool', ['owner']);
    expect(panelRequiresUnlock(p, { deviceDefaultPanelId: null, unlockedUserIds: new Set() })).toBe(true);
    expect(panelRequiresUnlock(p, { deviceDefaultPanelId: null, unlockedUserIds: new Set(['owner']) })).toBe(false);
    // A DIFFERENT unlocked user does not grant access.
    expect(panelRequiresUnlock(p, { deviceDefaultPanelId: null, unlockedUserIds: new Set(['guest']) })).toBe(true);
  });

  it('the device default panel is ALWAYS open on its own device (local-first)', () => {
    const p = mkPanel('guesthouse', ['owner']);
    expect(panelRequiresUnlock(p, { deviceDefaultPanelId: 'guesthouse', unlockedUserIds: new Set() })).toBe(false);
  });

  it('findUnlockingUser matches PIN AND membership only', () => {
    const p = mkPanel('pool', ['owner']);
    expect(findUnlockingUser('2580', p, users)).toBe('owner');     // owner allowed + correct pin
    expect(findUnlockingUser('1379', p, users)).toBeNull();        // guest correct pin but NOT allowed
    expect(findUnlockingUser('0000', p, users)).toBeNull();        // wrong pin
  });

  it('pinsMatch is exact + length-guarded', () => {
    expect(pinsMatch('1234', '1234')).toBe(true);
    expect(pinsMatch('1234', '12345')).toBe(false);
    expect(pinsMatch('1234', '1235')).toBe(false);
  });

  it('visiblePanels shows open panels + default; gates scoped ones (show-but-lock default)', () => {
    const panels = [mkPanel('home'), mkPanel('pool', ['owner']), mkPanel('guest', ['guest'])];
    const all = visiblePanels(panels, { deviceDefaultPanelId: 'home', unlockedUserIds: new Set() });
    expect(all.map((p) => p.id)).toEqual(['home', 'pool', 'guest']); // shown, just gated on switch
    const hidden = visiblePanels(panels, { deviceDefaultPanelId: 'home', unlockedUserIds: new Set(), showLocked: false });
    expect(hidden.map((p) => p.id)).toEqual(['home']); // only the open default survives a hide-locked surface
  });

  it('LIFE-SAFETY OVERRIDE: scoping never suppresses a takeover (it is enforced above the router)', () => {
    // The takeover mounts as a sibling ABOVE the scoped router and is driven by
    // the alarm state, never by these helpers. There is therefore NO scoping
    // input that can make panelRequiresUnlock affect a takeover. We assert the
    // structural fact: even a fully-scoped panel with NOTHING unlocked still has
    // a defined, takeover-independent gate result (true), and the takeover path
    // simply does not call these helpers. This guards against a future refactor
    // that might try to route the takeover through scoping.
    const p = mkPanel('pool', ['owner']);
    const gated = panelRequiresUnlock(p, { deviceDefaultPanelId: null, unlockedUserIds: new Set() });
    expect(gated).toBe(true);
    // The gate operates ONLY on panel body rendering; it exposes no API a
    // takeover could be funneled through (no takeover argument exists).
    expect(panelRequiresUnlock.length).toBe(2); // (panel, opts) — no takeover param
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Config export / import — round-trip + migration + secret strip
// ─────────────────────────────────────────────────────────────────────────
const baseConfig = (): StoredConfig =>
  ({
    schema_version: 2,
    panels: [
      { id: 'p1', name: 'Main', tiles: [{ id: 't1', deviceId: 'light.kitchen' }] },
    ],
    areas: [],
    connections: [
      { id: 'lutron' as any, cloudEndpoint: '', enabled: true, lutronManualIp: '10.0.0.5' },
    ],
    useDemoMode: false,
    users: [{ id: 'u1', name: 'Admin', pin: '1234' }],
    virtualDevices: [],
    mediaItems: [],
    dashboardTitle: 'Home',
    ipFilterEnabled: false,
    allowedIPs: [],
  } as unknown as StoredConfig);

describe('config export', () => {
  it('strips secrets, drops _rev, stamps schema_version', () => {
    const cfg: any = baseConfig();
    cfg._rev = 42;
    cfg.connections[0].apiKey = 'SECRET';      // a stray secret
    cfg.connections[0].haAlarmCode = '9999';   // disarm code
    const out: any = exportConfig(cfg);
    expect(out._rev).toBeUndefined();
    expect(out.schema_version).toBe(2);
    expect(out.connections[0].apiKey).toBeUndefined();
    expect(out.connections[0].haAlarmCode).toBeUndefined();
    expect(out.connections[0].lutronManualIp).toBe('10.0.0.5'); // non-secret kept
  });

  it('every documented secret key is in the strip list and is removed', () => {
    const cfg: any = baseConfig();
    for (const k of SECRET_CONNECTION_KEYS) cfg.connections[0][k] = 'x';
    const out: any = exportConfig(cfg);
    for (const k of SECRET_CONNECTION_KEYS) expect(out.connections[0][k]).toBeUndefined();
  });

  it('stripSecrets scrubs internetMonitorConfig.smartPlugPassword too', () => {
    const cfg: any = baseConfig();
    cfg.internetMonitorConfig = { smartPlugPassword: 'hunter2', enabled: true };
    const n = stripSecrets(cfg);
    expect(cfg.internetMonitorConfig.smartPlugPassword).toBe('');
    expect(n).toBeGreaterThan(0);
  });
});

describe('config import', () => {
  it('round-trips: export then import yields an equivalent config', () => {
    const cfg = baseConfig();
    const exported = exportConfig(cfg);
    const { config: imported } = importConfig(JSON.parse(JSON.stringify(exported)), cfg);
    expect(imported.panels).toEqual(cfg.panels.map((p) => ({
      ...p,
      // migrateTile derives entityId from a dotted deviceId
      tiles: p.tiles.map((t) => ({ ...t, entityId: t.entityId ?? (t.deviceId.includes('.') ? t.deviceId : undefined) })),
    })));
    expect(imported.schema_version).toBe(2);
    expect(imported.dashboardTitle).toBe('Home');
  });

  it('migrates a legacy (schema-less) config and reports the jump', () => {
    const legacy: any = baseConfig();
    delete legacy.schema_version;
    legacy.panels[0].tiles[0] = { id: 't1', deviceId: 'switch.lamp' }; // no entityId
    const { config, summary } = importConfig(legacy, null);
    expect(summary.fromSchema).toBe('unknown');
    expect(summary.toSchema).toBe(2);
    expect(config.schema_version).toBe(2);
    expect(config.panels[0].tiles[0].entityId).toBe('switch.lamp'); // derived by migration
    expect(summary.tilesMigrated).toBe(1);
  });

  it('strips secrets on the way IN', () => {
    const dirty: any = baseConfig();
    dirty.connections[0].apiToken = 'LEAK';
    const { config, summary } = importConfig(dirty, null);
    expect((config.connections[0] as any).apiToken).toBeUndefined();
    expect(summary.secretsStripped).toBeGreaterThan(0);
  });

  it('respects the clobber-guard: refuses an empty import over a populated config', () => {
    const empty: any = { schema_version: 2, panels: [] };
    expect(() => importConfig(empty, baseConfig())).toThrow(ConfigImportError);
  });

  it('allows an empty import when there is nothing to clobber', () => {
    const empty: any = { schema_version: 2, panels: [] };
    const { config } = importConfig(empty, null);
    expect(config.panels).toEqual([]);
  });

  it('rejects non-config junk', () => {
    expect(() => importConfig({ foo: 'bar' }, null)).toThrow(ConfigImportError);
    expect(() => importConfig(null, null)).toThrow(ConfigImportError);
    expect(() => importConfig([1, 2, 3], null)).toThrow(ConfigImportError);
  });
});
