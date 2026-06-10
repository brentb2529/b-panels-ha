// ---------------------------------------------------------------------------
// configIO — config EXPORT / IMPORT for the dashboard StoredConfig
// (Admin Stage 4, Increment 13). Pure transforms — no React, no DOM here; the
// Admin UI handles the file download/upload and calls these.
//
//   • exportConfig(cfg)  -> a clean JSON-serialisable object, with the H-1
//     secret-bearing connection keys STRIPPED (defense-in-depth; per H-1 there
//     should be none, but we enforce so an exported file is never a credential
//     leak), the volatile server `_rev` dropped, and the current
//     `schema_version` stamped.
//   • importConfig(raw, current)  -> { config, summary } — validates shape,
//     runs the SAME boot migration the runtime uses (migrateTile + schema_version
//     stamp), strips secrets again on the way IN, and RESPECTS the clobber-guard:
//     it refuses to return a config with no panels when the current one has
//     panels (the same invariant the server enforces), so a re-import can never
//     wipe a populated dashboard.
//
// Round-trip invariant: importConfig(exportConfig(cfg)) === cfg up to the
// additive migration fields (and minus any secrets / _rev, which must not be
// present anyway). The Stage-4 tests assert this.
// ---------------------------------------------------------------------------

import type { StoredConfig } from '../hooks/useDashboard';
import { CONFIG_SCHEMA_VERSION, migrateTile } from '../hooks/configMigration';

// Mirrors SECRET_CONNECTION_KEYS in custom_components/b_panels/gating.py and the
// fields removed from ServiceConnection in types.ts. Keep in sync.
export const SECRET_CONNECTION_KEYS: readonly string[] = [
  'apiKey',
  'apiToken',
  'lutronClientKey',
  'lutronClientCert',
  'lutronCaCert',
  'energytrakMagicLink',
  'whiskerPassword',
  'tempestApiToken',
  'haywardPassword',
  'flairClientSecret',
  'coolmasterPassword',
  'smartPlugPassword',
  'haAlarmCode',
];

const SECRET_SET = new Set<string>(SECRET_CONNECTION_KEYS);

/**
 * Strip every secret-bearing key from every connection in a config, in place on
 * a CLONE. Returns the count stripped (a tamper/leak signal the caller can log).
 * Mirrors gating.strip_secret_keys server-side.
 */
export function stripSecrets(cfg: any): number {
  let stripped = 0;
  for (const conn of (cfg?.connections ?? [])) {
    if (!conn || typeof conn !== 'object') continue;
    for (const key of Object.keys(conn)) {
      if (SECRET_SET.has(key)) {
        delete conn[key];
        stripped += 1;
      }
    }
  }
  // internetMonitorConfig.smartPlugPassword lives outside connections — scrub it
  // too (it is a credential the export must never carry).
  if (cfg?.internetMonitorConfig && typeof cfg.internetMonitorConfig === 'object') {
    if ('smartPlugPassword' in cfg.internetMonitorConfig && cfg.internetMonitorConfig.smartPlugPassword) {
      cfg.internetMonitorConfig.smartPlugPassword = '';
      stripped += 1;
    }
  }
  return stripped;
}

/**
 * Produce the export payload from a live StoredConfig: deep clone, drop the
 * server-internal `_rev`, strip secrets, stamp `schema_version`. The returned
 * object is safe to JSON.stringify and write to a file.
 */
export function exportConfig(cfg: StoredConfig): StoredConfig {
  const clone: any = JSON.parse(JSON.stringify(cfg ?? {}));
  delete clone._rev;            // volatile server bookkeeping — not portable
  stripSecrets(clone);
  clone.schema_version = CONFIG_SCHEMA_VERSION;
  return clone as StoredConfig;
}

export interface ImportSummary {
  panels: number;
  fromSchema: number | 'unknown';
  toSchema: number;
  secretsStripped: number;
  tilesMigrated: number;
}

export class ConfigImportError extends Error {}

/**
 * Validate + migrate an imported config. Throws ConfigImportError on a shape that
 * cannot be an export, or on a clobber-guard violation (no panels while current
 * has panels). Returns the migrated, secret-stripped config + a summary.
 */
export function importConfig(
  raw: unknown,
  current: StoredConfig | null,
): { config: StoredConfig; summary: ImportSummary } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigImportError('Not a valid b-panels config file (expected a JSON object).');
  }
  const incoming: any = JSON.parse(JSON.stringify(raw));

  if (!Array.isArray(incoming.panels)) {
    throw new ConfigImportError('Config is missing a "panels" array — this does not look like a b-panels export.');
  }

  // Clobber-guard parity with the server: never let an empty-panels import wipe a
  // populated dashboard.
  if (incoming.panels.length === 0 && (current?.panels?.length ?? 0) > 0) {
    throw new ConfigImportError(
      'Refused: the imported config has no panels but the current dashboard does. ' +
      'Importing it would wipe your panels. (Clobber-guard.)',
    );
  }

  const fromSchema: number | 'unknown' =
    typeof incoming.schema_version === 'number' ? incoming.schema_version : 'unknown';

  // Drop server bookkeeping so an imported file can't pin a stale rev.
  delete incoming._rev;

  // Run the SAME additive boot migration the runtime applies on load.
  let tilesMigrated = 0;
  for (const panel of incoming.panels) {
    if (!panel || typeof panel !== 'object' || !Array.isArray(panel.tiles)) continue;
    panel.tiles = panel.tiles.map((t: any) => {
      const migrated = migrateTile(t);
      if (migrated !== t) tilesMigrated += 1;
      return migrated;
    });
  }
  incoming.schema_version = CONFIG_SCHEMA_VERSION;

  const secretsStripped = stripSecrets(incoming);

  return {
    config: incoming as StoredConfig,
    summary: {
      panels: incoming.panels.length,
      fromSchema,
      toSchema: CONFIG_SCHEMA_VERSION,
      secretsStripped,
      tilesMigrated,
    },
  };
}
