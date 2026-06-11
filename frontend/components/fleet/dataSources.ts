// Pure projection for the admin fleet "Data Sources" section (task #25).
//
// Derives a status row per integration/feed the dashboards consume, from the
// LIVE states snapshot (entity availability) — reusing the same availability +
// exclusion grammar as the House Health connectivity rollup — optionally
// enriched with HA `config_entries/get` (admin-only) for a true integration
// setup state. Honest "not configured" for absent sources; never fake-green.
//
// ── SAFETY / least-privilege posture ──────────────────────────────────────────
//   • READ-ONLY. No callService anywhere in this module by construction.
//   • The config-entries enrichment is OPTIONAL and admin-only; this projection
//     works from the entity snapshot alone, so the (non-admin) kiosk runtime
//     never depends on the admin config-entries read. The admin view passes its
//     admin-readable entries; everything else degrades gracefully.
//   • Absent sources render `configured: false` ("not configured"), NEVER OK.

export type SourceStatus = 'connected' | 'erroring' | 'stale' | 'not-configured';

const UNAVAILABLE = new Set(['unavailable', 'unknown', 'none', '']);
const isUnavailState = (state: unknown): boolean =>
  UNAVAILABLE.has(String(state ?? '').toLowerCase());

// Domains whose `unknown` is normal/internal — excluded from availability noise
// (mirrors useHouseHealthEntities ROLLUP_EXCLUDE_DOMAINS).
const EXCLUDE_DOMAINS = new Set([
  'sun', 'zone', 'person', 'todo', 'tts', 'stt', 'conversation', 'button',
  'scene', 'script', 'automation', 'input_boolean', 'input_number',
  'input_select', 'input_text', 'input_datetime', 'timer', 'counter',
  'schedule', 'event', 'tag', 'image', 'persistent_notification', 'group',
]);

// Minimal shape of an HA state object we read (entity_id + state + attributes +
// last_changed/last_updated). Loose so it accepts the raw getStates() payload.
export interface RawState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface ConfigEntryLite {
  domain: string;
  title: string;
  state: string; // loaded | setup_error | setup_retry | not_loaded | ...
  reason?: string | null;
}

// A known data source: a display label + the HA domains / entity-id substrings
// that identify the entities it produces. `domain` is the integration's HA
// platform domain (for config_entries matching). We match an entity to a source
// when its id contains ANY `idMatch` token OR its domain is in `entityDomains`
// AND a `idMatch` is also given (to avoid over-claiming broad domains). When a
// source declares ONLY `idMatch`, any matching id counts.
export interface SourceDef {
  key: string;
  label: string;
  category: string;      // grouping header (Pool / Climate / Security / …)
  configDomains: string[]; // HA integration domains for config_entries lookup
  idMatch: string[];     // entity-id substrings that mark this source's entities
}

// The integrations/feeds the bespoke dashboards consume. Generic + documented:
// matchers are entity-id heuristics, NOT site-specifics. Absent ⇒ not-configured.
export const SOURCE_DEFS: readonly SourceDef[] = [
  { key: 'intellicenter', label: 'Pentair IntelliCenter', category: 'Pool', configDomains: ['intellicenter', 'pentair_intellicenter'], idMatch: ['intellicenter', 'pentair'] },
  { key: 'akvo', label: 'AKVO Pool Floor', category: 'Pool', configDomains: ['akvo'], idMatch: ['akvo', 'pool_floor', 'poolfloor'] },
  { key: 'omnilogic', label: 'Hayward OmniLogic', category: 'Pool', configDomains: ['omnilogic'], idMatch: ['omnilogic', 'hayward'] },
  { key: 'airzone', label: 'Airzone HVAC', category: 'Climate', configDomains: ['airzone', 'airzone_cloud'], idMatch: ['airzone'] },
  { key: 'mitsubishi', label: 'Mitsubishi (MELCloud / Kumo)', category: 'Climate', configDomains: ['melcloud', 'kumo', 'mitsubishi'], idMatch: ['melcloud', 'kumo', 'mitsubishi'] },
  { key: 'coolmaster', label: 'CoolMasterNet', category: 'Climate', configDomains: ['coolmaster'], idMatch: ['coolmaster'] },
  { key: 'flair', label: 'Flair Vents', category: 'Climate', configDomains: ['flair'], idMatch: ['flair'] },
  { key: 'lutron', label: 'Lutron Caséta / RA3', category: 'Lighting', configDomains: ['lutron_caseta', 'lutron'], idMatch: ['lutron', 'caseta'] },
  { key: 'unifi_protect', label: 'UniFi Protect', category: 'Security', configDomains: ['unifiprotect'], idMatch: ['unifi', 'protect', 'g4', 'g5', 'doorbell'] },
  { key: 'unifi_access', label: 'UniFi Access', category: 'Security', configDomains: ['unifi_access', 'unifiaccess'], idMatch: ['unifi_access', 'uid_access'] },
  { key: 'alarmo', label: 'Alarmo', category: 'Security', configDomains: ['alarmo'], idMatch: ['alarmo'] },
  { key: 'noonlight', label: 'Noonlight Dispatch', category: 'Security', configDomains: ['noonlight'], idMatch: ['noonlight'] },
  { key: 'sonos', label: 'Sonos', category: 'Media', configDomains: ['sonos'], idMatch: ['sonos'] },
  { key: 'whisker', label: 'Whisker / Litter-Robot', category: 'Home', configDomains: ['litterrobot', 'whisker'], idMatch: ['litter_robot', 'litterrobot', 'whisker'] },
  { key: 'subzero', label: 'Sub-Zero / Wolf / Cove', category: 'Home', configDomains: ['subzero_wolf', 'subzero'], idMatch: ['subzero', 'sub_zero', 'wolf', 'cove'] },
  { key: 'rachio', label: 'Rachio Irrigation', category: 'Home', configDomains: ['rachio'], idMatch: ['rachio'] },
  { key: 'generator', label: 'Generator (Generac / rehlko)', category: 'Power', configDomains: ['generac', 'rehlko', 'kohler'], idMatch: ['generator', 'rehlko', 'generac', 'kohler'] },
  { key: 'ups', label: 'UPS (NUT)', category: 'Power', configDomains: ['nut'], idMatch: ['ups', '_nut_'] },
  { key: 'unifi_network', label: 'UniFi Network / WAN', category: 'Network', configDomains: ['unifi'], idMatch: ['unifi_wan', 'unifi_clients', 'unifi_total', 'wan_status'] },
  { key: 'weather', label: 'Weather (Tempest / forecast)', category: 'Feeds', configDomains: ['weatherflow', 'weatherflow_cloud', 'met', 'tempest'], idMatch: ['tempest', 'weatherflow', 'weather_'] },
];

const domainOf = (entityId: string): string => entityId.split('.')[0] ?? '';

export interface SourceRow {
  key: string;
  label: string;
  category: string;
  configured: boolean;          // false ⇒ honest "not configured"
  status: SourceStatus;
  entityCount: number;          // entities attributed to this source
  unavailableCount: number;
  unavailable: string[];        // entity ids that are unavailable/unknown
  lastUpdate: string | null;    // most-recent last_changed/updated ISO, or null
  integrationState: string | null; // config_entries state when admin-readable
  note: string;
}

const isExcludedEntity = (s: RawState): boolean => {
  const domain = domainOf(s.entity_id);
  if (EXCLUDE_DOMAINS.has(domain)) return true;
  // diagnostic/config-category entities aren't a homeowner "device online" signal
  if (s.attributes && s.attributes.entity_category) return true;
  return false;
};

const matchesSource = (entityId: string, def: SourceDef): boolean => {
  const id = entityId.toLowerCase();
  return def.idMatch.some((tok) => id.includes(tok));
};

const tsOf = (s: RawState): number => {
  const t = s.last_changed ?? s.last_updated;
  if (!t) return 0;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
};

// staleAfterMs: a configured source whose newest entity hasn't updated in this
// long is flagged `stale` (the feed may be frozen). Default 30 min — generous,
// since many sensors legitimately update slowly; the admin can read lastUpdate.
export const STALE_AFTER_MS = 30 * 60 * 1000;

export const projectDataSources = (
  states: RawState[],
  configEntries: ConfigEntryLite[] = [],
  nowMs: number = Date.now(),
): SourceRow[] => {
  const byDomain = new Map<string, ConfigEntryLite[]>();
  for (const e of configEntries) {
    const list = byDomain.get(e.domain) ?? [];
    list.push(e);
    byDomain.set(e.domain, list);
  }

  return SOURCE_DEFS.map((def) => {
    const owned = states.filter(
      (s) => !isExcludedEntity(s) && matchesSource(s.entity_id, def),
    );
    // config_entries enrichment (admin-only; may be empty)
    const entries = def.configDomains.flatMap((d) => byDomain.get(d) ?? []);
    const integrationState = entries.length ? entries[0].state : null;
    const hasErrorEntry = entries.some(
      (e) => e.state === 'setup_error' || e.state === 'setup_retry' || e.state === 'failed_unload',
    );
    const hasLoadedEntry = entries.some((e) => e.state === 'loaded');

    const configured = owned.length > 0 || entries.length > 0;
    if (!configured) {
      return {
        key: def.key, label: def.label, category: def.category,
        configured: false, status: 'not-configured' as SourceStatus,
        entityCount: 0, unavailableCount: 0, unavailable: [],
        lastUpdate: null, integrationState: null,
        note: 'Not configured — no entities present',
      };
    }

    const unavailable = owned
      .filter((s) => isUnavailState(s.state))
      .map((s) => s.entity_id)
      .sort();
    const unavailableCount = unavailable.length;
    const newestMs = owned.reduce((acc, s) => Math.max(acc, tsOf(s)), 0);
    const lastUpdate = newestMs > 0 ? new Date(newestMs).toISOString() : null;

    // status: integration setup error wins; else all-entities-unavailable ⇒
    // erroring; else partial-unavailable OR stale feed ⇒ stale; else connected.
    let status: SourceStatus;
    let note: string;
    const allUnavail = owned.length > 0 && unavailableCount === owned.length;
    const isStaleFeed = newestMs > 0 && nowMs - newestMs > STALE_AFTER_MS;

    if (hasErrorEntry) {
      status = 'erroring';
      const reason = entries.find((e) => e.reason)?.reason;
      note = reason ? `Integration error: ${reason}` : 'Integration setup error / retrying';
    } else if (allUnavail) {
      status = 'erroring';
      note = 'All entities unavailable — feed down';
    } else if (unavailableCount > 0) {
      status = 'stale';
      note = `${unavailableCount} of ${owned.length} entit${owned.length === 1 ? 'y' : 'ies'} unavailable`;
    } else if (isStaleFeed) {
      status = 'stale';
      note = 'No update in over 30 min — feed may be stale';
    } else {
      status = 'connected';
      note = hasLoadedEntry
        ? `Connected · ${owned.length} entit${owned.length === 1 ? 'y' : 'ies'}`
        : `${owned.length} entit${owned.length === 1 ? 'y' : 'ies'} live`;
    }

    return {
      key: def.key, label: def.label, category: def.category,
      configured: true, status, entityCount: owned.length,
      unavailableCount, unavailable, lastUpdate, integrationState, note,
    };
  });
};

// Group rows by category for sectioned rendering, preserving SOURCE_DEFS order.
export const groupByCategory = (rows: SourceRow[]): { category: string; rows: SourceRow[] }[] => {
  const order: string[] = [];
  const map = new Map<string, SourceRow[]>();
  for (const r of rows) {
    if (!map.has(r.category)) { map.set(r.category, []); order.push(r.category); }
    map.get(r.category)!.push(r);
  }
  return order.map((category) => ({ category, rows: map.get(category)! }));
};
