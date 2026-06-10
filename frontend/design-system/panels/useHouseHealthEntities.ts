// Live entity feed for the House Health "system trust" surface (House Health).
//
// ECOSYSTEM #8 / §J2: the single READ-ONLY trust surface a luxury system sells
// as its quiet superpower — every integration/device online state, generator
// ready/fuel/exercise, UPS runtime, WAN/network health, safety-system
// reachability, and integration faults, each with a clear OK / attention /
// critical status + an animated indicator + a proactive "what needs attention"
// summary at the top.
//
// ── SAFETY POSTURE — read-only, honest, never fake-green ──────────────────────
//   • There is NO callService import in this module, by construction. Nothing on
//     the House Health surface actuates anything anywhere.
//   • REAL sources present in dev (the Alarmo alarm_control_panel, the demo
//     door/motion contacts, any `device_class: problem` sensor, the live states
//     snapshot itself) are read live and projected display-only.
//   • ABSENT sources (rehlko generator, NUT UPS, UniFi WAN/network) are NOT in
//     dev. They are rendered in an honest "not configured / awaiting connection"
//     state — NEVER a fabricated green. Every projection below returns
//     `configured: false` when the source's entities are absent, and the UI must
//     show "—" / "not configured", not OK.
//   • Life-safety freshness reuses the same three-state signal-lost logic as the
//     takeover (lifeSafety.ts): a frozen/disconnected feed must NEVER read "all
//     clear" — it reads `signal-lost`, an explicit UNKNOWN, not OK.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities, subscribeConnectionState } from '../../services/haClient';

// ── status vocabulary ────────────────────────────────────────────────────────
// The single status grammar every group on the surface speaks. `unknown` is the
// honest "we can't tell" / not-configured tone — distinct from `ok` (we DO know
// it is healthy). Never collapse `unknown` into `ok`.
export type HealthStatus = 'ok' | 'attention' | 'critical' | 'unknown';

const UNAVAILABLE = new Set(['unavailable', 'unknown', 'none', '']);
const isUnavail = (e?: HassEntity): boolean =>
  !e || UNAVAILABLE.has(String(e.state).toLowerCase());
const isAvail = (e?: HassEntity): boolean => !!e && !isUnavail(e);

// rank for "worst wins" rollups: critical > attention > unknown > ok
const STATUS_RANK: Record<HealthStatus, number> = { critical: 3, attention: 2, unknown: 1, ok: 0 };
export const worst = (a: HealthStatus, b: HealthStatus): HealthStatus =>
  STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;

// ── helpers ───────────────────────────────────────────────────────────────────
const num = (e: HassEntity | undefined): number | null => {
  if (!isAvail(e)) return null;
  const n = Number(e!.state);
  return Number.isFinite(n) ? n : null;
};
const attrNum = (e: HassEntity | undefined, key: string): number | null => {
  const v = e?.attributes?.[key];
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : null;
};
export const fmtClock = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};
// "—" is the honest absent marker per the design bar; never substitute a value.
export const EMDASH = '—';

// ── bound / referenced entities ────────────────────────────────────────────
// Most of these are NOT in dev → their projections return `configured:false` and
// the UI shows the honest not-configured state. None of them are ever written.
export const HOUSE_HEALTH_ENTITIES = {
  // Safety — the REAL Alarmo panel (display-only; same id as the rest of the app).
  alarm: 'alarm_control_panel.house',
  // The coordinator-authored readiness helper (Inc10) — display-only when present.
  securityNotReady: 'binary_sensor.security_not_ready',

  // Power · generator (rehlko). NOT in dev → honest not-configured. We probe a
  // small family of conventional rehlko/generator entity ids; first present wins.
  generator: {
    status: ['sensor.generator_status', 'sensor.rehlko_status', 'sensor.generator'],
    source: ['sensor.generator_power_source', 'sensor.power_source'],
    autoMode: ['binary_sensor.generator_auto_mode', 'switch.generator_auto_mode'],
    fuel: ['sensor.generator_fuel_level', 'sensor.generator_fuel'],
    lastExercise: ['sensor.generator_last_exercise', 'sensor.generator_last_run'],
    nextExercise: ['sensor.generator_next_exercise', 'sensor.generator_next_run'],
  },
  // Power · UPS (NUT). NOT in dev → honest not-configured.
  ups: {
    status: ['sensor.ups_status', 'sensor.nut_status'],
    battery: ['sensor.ups_battery_charge', 'sensor.ups_battery'],
    runtime: ['sensor.ups_runtime', 'sensor.ups_battery_runtime'],
    load: ['sensor.ups_load'],
  },
  // Network / WAN (UniFi). NOT in dev → honest not-configured.
  network: {
    wan: ['binary_sensor.unifi_wan_status', 'binary_sensor.wan_link', 'binary_sensor.internet'],
    isp: ['sensor.unifi_wan_isp', 'sensor.wan_isp'],
    clients: ['sensor.unifi_clients', 'sensor.unifi_total_clients'],
    aps: ['sensor.unifi_active_aps', 'sensor.unifi_aps'],
  },
} as const;

// Resolve the first present entity from a candidate list (honest absence model).
const firstOf = (ents: HassEntities, ids: readonly string[]): HassEntity | undefined => {
  for (const id of ids) if (ents[id]) return ents[id];
  return undefined;
};

// ── Connectivity / integrations rollup ────────────────────────────────────────
// Derived from entity AVAILABILITY across the live states snapshot. We never read
// the area/device registry at runtime (least-privilege). An entity counts as
// "offline" when its state is unavailable/unknown. We additionally surface any
// `device_class: problem` / `problem`-style fault sensor that is ON.
//
// Some HA-internal/diagnostic domains are intentionally EXCLUDED from the
// online/offline rollup because their `unknown` state is normal (a button never
// has a value, a conversation agent idles unknown, etc.) — counting them would
// manufacture false "offline" noise.
const ROLLUP_EXCLUDE_DOMAINS = new Set([
  'sun', 'zone', 'person', 'todo', 'tts', 'stt', 'conversation', 'button',
  'scene', 'script', 'automation', 'input_boolean', 'input_number',
  'input_select', 'input_text', 'input_datetime', 'timer', 'counter',
  'schedule', 'event', 'tag', 'image', 'persistent_notification', 'group',
]);
const domainOf = (entityId: string): string => entityId.split('.')[0] ?? '';

export interface OfflineEntity { id: string; name: string; }
export interface ProblemEntity { id: string; name: string; }
export interface ConnectivityView {
  status: HealthStatus;
  total: number;        // entities considered in the rollup
  online: number;
  offlineCount: number;
  offline: OfflineEntity[];
  problemCount: number;
  problems: ProblemEntity[]; // device_class:problem (or *_problem) sensors that are ON
}

const nameOf = (e: HassEntity, id: string): string =>
  (e.attributes?.friendly_name as string | undefined) ?? id;

export const projectConnectivity = (ents: HassEntities): ConnectivityView => {
  const offline: OfflineEntity[] = [];
  const problems: ProblemEntity[] = [];
  let total = 0;

  for (const [id, e] of Object.entries(ents)) {
    const domain = domainOf(id);
    const dc = String(e.attributes?.device_class ?? '').toLowerCase();

    // problem/fault sensors: ON ⇒ a fault. (binary_sensor device_class:problem,
    // safety, tamper, or any *_problem id.) Surfaced regardless of domain filter.
    const isProblemSensor =
      domain === 'binary_sensor' &&
      (dc === 'problem' || dc === 'safety' || dc === 'tamper' || /_problem$/.test(id));
    if (isProblemSensor && String(e.state).toLowerCase() === 'on') {
      problems.push({ id, name: nameOf(e, id) });
    }

    if (ROLLUP_EXCLUDE_DOMAINS.has(domain)) continue;
    // A diagnostic/config entity_category entity is excluded from the rollup too —
    // its availability is not a homeowner-facing "device online" signal.
    if (e.attributes?.entity_category) continue;
    total += 1;
    if (isUnavail(e)) offline.push({ id, name: nameOf(e, id) });
  }

  offline.sort((a, b) => a.id.localeCompare(b.id));
  problems.sort((a, b) => a.id.localeCompare(b.id));
  const offlineCount = offline.length;
  const problemCount = problems.length;
  const online = Math.max(0, total - offlineCount);

  let status: HealthStatus = 'ok';
  if (problemCount > 0) status = 'critical';
  else if (offlineCount > 0) status = 'attention';

  return { status, total, online, offlineCount, offline, problemCount, problems };
};

// ── Power · generator (rehlko) ────────────────────────────────────────────────
export interface GeneratorView {
  configured: boolean;            // false ⇒ honest "not connected" state
  status: HealthStatus;
  runState: string;               // "Running" | "Standby" | "Ready" | EMDASH
  onGenerator: boolean;           // true ⇒ running on generator (attention)
  source: string;                 // "Utility" | "Generator" | EMDASH
  autoMode: boolean | null;       // null ⇒ unknown/absent
  fuel: string;                   // "78%" | EMDASH (honest dash when absent)
  lastExercise: string;           // clock/relative | EMDASH
  nextExercise: string;           // clock/relative | EMDASH
  note: string;
}

export const projectGenerator = (ents: HassEntities): GeneratorView => {
  const g = HOUSE_HEALTH_ENTITIES.generator;
  const statusE = firstOf(ents, g.status);
  const sourceE = firstOf(ents, g.source);
  const autoE = firstOf(ents, g.autoMode);
  const fuelE = firstOf(ents, g.fuel);
  const lastE = firstOf(ents, g.lastExercise);
  const nextE = firstOf(ents, g.nextExercise);

  const configured = isAvail(statusE) || isAvail(sourceE);
  if (!configured) {
    return {
      configured: false, status: 'unknown',
      runState: EMDASH, onGenerator: false, source: EMDASH,
      autoMode: null, fuel: EMDASH, lastExercise: EMDASH, nextExercise: EMDASH,
      note: 'Generator integration (rehlko) not connected — awaiting connection',
    };
  }

  const raw = isAvail(statusE) ? String(statusE!.state).toLowerCase() : '';
  const running = /run|on|active|engaged/.test(raw);
  const fault = /fault|alarm|error|fail/.test(raw);
  const runState = fault ? 'Fault' : running ? 'Running' : /standby|ready|off/.test(raw)
    ? (raw.charAt(0).toUpperCase() + raw.slice(1)) : (statusE ? String(statusE.state) : EMDASH);

  const srcRaw = isAvail(sourceE) ? String(sourceE!.state).toLowerCase() : '';
  const onGenerator = running || /gen/.test(srcRaw);
  const source = isAvail(sourceE)
    ? (/gen/.test(srcRaw) ? 'Generator' : /util|grid|mains/.test(srcRaw) ? 'Utility' : String(sourceE!.state))
    : (running ? 'Generator' : EMDASH);

  const autoMode = isAvail(autoE) ? String(autoE!.state).toLowerCase() === 'on' : null;
  const fuelN = num(fuelE);
  const fuel = fuelN != null
    ? `${Math.round(fuelN)}${fuelE?.attributes?.unit_of_measurement === '%' || true ? '%' : ''}`
    : EMDASH;
  const lastExercise = isAvail(lastE) ? (fmtClock(lastE!.last_changed ?? null) || String(lastE!.state)) : EMDASH;
  const nextExercise = isAvail(nextE) ? String(nextE!.state) : EMDASH;

  const status: HealthStatus = fault ? 'critical' : onGenerator ? 'attention' : 'ok';
  const note = fault ? 'Generator fault — service required'
    : onGenerator ? 'Running on generator power'
    : 'On utility power · generator standby';

  return { configured: true, status, runState, onGenerator, source, autoMode, fuel, lastExercise, nextExercise, note };
};

// ── Power · UPS (NUT) ──────────────────────────────────────────────────────────
export interface UpsView {
  configured: boolean;
  status: HealthStatus;
  onBattery: boolean;
  stateLabel: string;     // "Online" | "On Battery" | EMDASH
  battery: string;        // "100%" | EMDASH
  runtime: string;        // "42 min" | EMDASH
  load: string;           // "18%" | EMDASH
  note: string;
}

export const projectUps = (ents: HassEntities): UpsView => {
  const u = HOUSE_HEALTH_ENTITIES.ups;
  const statusE = firstOf(ents, u.status);
  const batE = firstOf(ents, u.battery);
  const rtE = firstOf(ents, u.runtime);
  const loadE = firstOf(ents, u.load);

  const configured = isAvail(statusE) || isAvail(batE);
  if (!configured) {
    return {
      configured: false, status: 'unknown', onBattery: false, stateLabel: EMDASH,
      battery: EMDASH, runtime: EMDASH, load: EMDASH,
      note: 'UPS / NUT not configured in dev',
    };
  }

  const raw = isAvail(statusE) ? String(statusE!.state).toUpperCase() : '';
  const onBattery = /OB|BATT|DISCHARG/.test(raw);
  const low = /LB|LOW/.test(raw);
  const stateLabel = onBattery ? 'On Battery' : /OL|ONLINE/.test(raw) ? 'Online' : (statusE ? String(statusE.state) : EMDASH);

  const batN = num(batE);
  const battery = batN != null ? `${Math.round(batN)}%` : EMDASH;
  // NUT runtime is seconds; convert to minutes for the readout.
  const rtN = num(rtE);
  const runtime = rtN != null ? `${Math.round(rtN >= 600 ? rtN / 60 : rtN)} min` : EMDASH;
  const loadN = num(loadE);
  const load = loadN != null ? `${Math.round(loadN)}%` : EMDASH;

  const status: HealthStatus = low ? 'critical' : onBattery ? 'attention' : 'ok';
  const note = low ? 'UPS battery LOW — rack at risk'
    : onBattery ? 'Rack on battery — utility lost'
    : 'Rack on utility · battery healthy';

  return { configured: true, status, onBattery, stateLabel, battery, runtime, load, note };
};

// ── Network / WAN (UniFi) ──────────────────────────────────────────────────────
export interface NetworkView {
  configured: boolean;
  status: HealthStatus;
  wanUp: boolean | null;
  wanLabel: string;       // "WAN Up" | "WAN Down" | EMDASH
  isp: string;            // ISP/failover | EMDASH
  clients: string;        // "32 clients" | EMDASH
  aps: string;            // "6 APs healthy" | EMDASH
  note: string;
}

export const projectNetwork = (ents: HassEntities): NetworkView => {
  const n = HOUSE_HEALTH_ENTITIES.network;
  const wanE = firstOf(ents, n.wan);
  const ispE = firstOf(ents, n.isp);
  const clientsE = firstOf(ents, n.clients);
  const apsE = firstOf(ents, n.aps);

  const configured = isAvail(wanE) || isAvail(ispE) || isAvail(clientsE);
  if (!configured) {
    return {
      configured: false, status: 'unknown', wanUp: null, wanLabel: EMDASH,
      isp: EMDASH, clients: EMDASH, aps: EMDASH,
      note: 'UniFi network not configured in dev',
    };
  }

  const wanUp = isAvail(wanE) ? String(wanE!.state).toLowerCase() === 'on' : null;
  const wanLabel = wanUp == null ? EMDASH : wanUp ? 'WAN Up' : 'WAN Down';
  const isp = isAvail(ispE) ? String(ispE!.state) : EMDASH;
  const clientsN = num(clientsE);
  const clients = clientsN != null ? `${clientsN} clients` : EMDASH;
  const apsN = num(apsE);
  const aps = apsN != null ? `${apsN} APs` : EMDASH;

  const status: HealthStatus = wanUp === false ? 'critical' : 'ok';
  const note = wanUp === false ? 'WAN down — internet unreachable'
    : wanUp ? 'WAN healthy · internet reachable'
    : 'Network reachable';

  return { configured: true, status, wanUp, wanLabel, isp, clients, aps, note };
};

// ── Safety systems status ──────────────────────────────────────────────────────
// Alarmo reachable + life-safety feed freshness (reusing the takeover's
// signal-lost three-state logic) + AKVO / security-panel reachability.
export type Freshness = 'known-good' | 'stale' | 'signal-lost';

export interface SafetyView {
  status: HealthStatus;
  alarmReachable: boolean;
  alarmLabel: string;            // "Alarmo · Disarmed" | "Alarmo · Unavailable"
  freshness: Freshness;
  freshnessLabel: string;        // "Live · fresh" | "Stale" | "Signal lost"
  lastKnownLabel: string | null; // last confident arm word when signal-lost
  notReady: boolean;             // disarmed-but-open zones present
  openList: string | null;
  note: string;
}

const labelArm = (state: string): string => {
  switch (state) {
    case 'disarmed': return 'Disarmed';
    case 'armed_home': return 'Armed · Home';
    case 'armed_away': return 'Armed · Away';
    case 'armed_night': return 'Armed · Night';
    case 'armed_vacation': return 'Armed · Vacation';
    case 'arming': return 'Arming';
    case 'pending': return 'Entry delay';
    case 'triggered': return 'Triggered';
    default: return state;
  }
};

// PURE projection. `connected` + `lastSeenMs` + `nowMs` mirror lifeSafety.ts so
// a frozen/disconnected feed NEVER reads "all clear" — it reads signal-lost.
export const projectSafety = (
  ents: HassEntities,
  connected: boolean,
  lastSeenMs: number | null,
  nowMs: number,
  staleAfterMs = 45000,
): SafetyView => {
  const alarm = ents[HOUSE_HEALTH_ENTITIES.alarm]
    ?? ents[Object.keys(ents).find((k) => k.startsWith('alarm_control_panel.')) ?? ''];
  const alarmAvail = isAvail(alarm);

  let freshness: Freshness = 'known-good';
  if (!connected || !alarmAvail) freshness = 'signal-lost';
  else if (lastSeenMs != null && nowMs - lastSeenMs > staleAfterMs) freshness = 'stale';

  const armState = alarmAvail ? String(alarm!.state).toLowerCase() : '';
  const lastKnownLabel = alarmAvail ? labelArm(armState) : null;
  const triggered = armState === 'triggered';

  // not-ready helper (display-only)
  const nrE = ents[HOUSE_HEALTH_ENTITIES.securityNotReady];
  const notReady = isAvail(nrE) && String(nrE!.state).toLowerCase() === 'on';
  const openList = (typeof nrE?.attributes?.open_list === 'string' && nrE.attributes.open_list.trim())
    ? String(nrE.attributes.open_list).trim() : null;

  const freshnessLabel = freshness === 'signal-lost' ? 'Signal lost'
    : freshness === 'stale' ? 'Stale feed' : 'Live · fresh';

  let status: HealthStatus;
  if (triggered) status = 'critical';
  else if (freshness === 'signal-lost') status = 'critical';   // unknown life-safety ⇒ critical, never OK
  else if (freshness === 'stale' || notReady) status = 'attention';
  else status = 'ok';

  const alarmLabel = alarmAvail ? `Alarmo · ${labelArm(armState)}` : 'Alarmo · Unavailable';
  const note = triggered ? 'Alarm TRIGGERED — life-safety annunciation active'
    : freshness === 'signal-lost' ? 'Life-safety feed unknown — NOT confirmed clear'
    : freshness === 'stale' ? 'Life-safety feed stale — reconnecting'
    : notReady ? `Disarmed · ${openList ?? 'zones open'}`
    : 'Alarmo reachable · life-safety feed fresh';

  return {
    status, alarmReachable: alarmAvail, alarmLabel, freshness, freshnessLabel,
    lastKnownLabel, notReady, openList, note,
  };
};

// ── Proactive "what needs attention" summary ──────────────────────────────────
export interface AttentionItem { status: HealthStatus; text: string; }
export interface AttentionView {
  overall: HealthStatus;
  headline: string;          // one-line system verdict
  items: AttentionItem[];    // prioritized "what needs attention" list
}

export const projectAttention = (
  conn: ConnectivityView, gen: GeneratorView, ups: UpsView, net: NetworkView, safety: SafetyView,
): AttentionView => {
  const items: AttentionItem[] = [];

  // Safety first — always speaks (it's the trust core).
  items.push({ status: safety.status, text: safety.note });

  if (conn.problemCount > 0)
    items.push({ status: 'critical', text: `${conn.problemCount} device fault${conn.problemCount === 1 ? '' : 's'} reported` });
  if (conn.offlineCount > 0)
    items.push({ status: 'attention', text: `${conn.offlineCount} device${conn.offlineCount === 1 ? '' : 's'} offline` });

  // Power
  if (gen.configured) items.push({ status: gen.status, text: gen.note });
  if (ups.configured) items.push({ status: ups.status, text: ups.note });

  // Network
  if (net.configured) items.push({ status: net.status, text: net.note });

  // Honest absent-source notes (kept low-priority, never green).
  if (!gen.configured) items.push({ status: 'unknown', text: 'Generator — awaiting connection' });
  if (!ups.configured) items.push({ status: 'unknown', text: 'UPS — not configured' });
  if (!net.configured) items.push({ status: 'unknown', text: 'Network — not configured' });

  if (conn.offlineCount === 0 && conn.problemCount === 0)
    items.push({ status: 'ok', text: `${conn.online} of ${conn.total} entities online` });

  // worst real status wins (unknown does NOT promote to OK or to attention).
  const overall = [conn.status, gen.status, ups.status, net.status, safety.status]
    .reduce(worst, 'ok' as HealthStatus);

  const headline = overall === 'critical' ? 'Attention needed'
    : overall === 'attention' ? 'A few things to review'
    : overall === 'unknown' ? 'Partially monitored'
    : 'All systems healthy';

  // Sort: critical → attention → unknown → ok, stable within rank.
  items.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);

  return { overall, headline, items };
};

// ── full view + hook ──────────────────────────────────────────────────────────
export interface HouseHealthView {
  status: 'connecting' | 'live' | 'stale';
  connectivity: ConnectivityView;
  generator: GeneratorView;
  ups: UpsView;
  network: NetworkView;
  safety: SafetyView;
  attention: AttentionView;
}

// Compose all projections from a snapshot + connection liveness. Exported pure
// for unit testing (deterministic via injected now/connected/lastSeen).
export const projectHouseHealth = (
  ents: HassEntities, connected: boolean, lastSeenMs: number | null, nowMs: number,
): Omit<HouseHealthView, 'status'> => {
  const connectivity = projectConnectivity(ents);
  const generator = projectGenerator(ents);
  const ups = projectUps(ents);
  const network = projectNetwork(ents);
  const safety = projectSafety(ents, connected, lastSeenMs, nowMs);
  const attention = projectAttention(connectivity, generator, ups, network, safety);
  return { connectivity, generator, ups, network, safety, attention };
};

export function useHouseHealthEntities(): HouseHealthView {
  const [view, setView] = useState<Omit<HouseHealthView, 'status'>>(
    () => projectHouseHealth({}, false, null, Date.now()),
  );
  const [status, setStatus] = useState<HouseHealthView['status']>('connecting');
  const entsRef = useRef<HassEntities>({});
  const connectedRef = useRef<boolean>(false);
  const lastSeenRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubEnts: (() => void) | null = null;
    let unsubConn: (() => void) | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;

    const recompute = () => {
      if (cancelled) return;
      setView(projectHouseHealth(entsRef.current, connectedRef.current, lastSeenRef.current, Date.now()));
    };
    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => { if (!cancelled) setStatus('stale'); }, 45000);
    };

    (async () => {
      try {
        unsubConn = await subscribeConnectionState((connected) => {
          if (cancelled) return;
          connectedRef.current = connected;
          recompute();
        });
      } catch { /* connection-state stream optional */ }
      try {
        unsubEnts = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          connectedRef.current = true;
          lastSeenRef.current = Date.now();
          setStatus('live');
          armStale();
          recompute();
        });
      } catch {
        if (!cancelled) setStatus('stale');
      }
    })();

    // Re-evaluate freshness on a slow tick so a frozen feed flips to stale/
    // signal-lost even with no new pushes (mirrors the takeover liveness model).
    tick = setInterval(recompute, 10000);

    return () => {
      cancelled = true;
      if (staleTimer) clearTimeout(staleTimer);
      if (tick) clearInterval(tick);
      if (unsubEnts) unsubEnts();
      if (unsubConn) unsubConn();
    };
  }, []);

  // NOTE: no `actions` returned. This surface is READ-ONLY by construction.
  return { status, ...view };
}
