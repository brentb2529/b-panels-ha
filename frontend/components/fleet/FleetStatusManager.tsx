import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchFleet,
  fetchConfigEntries,
  getStates,
  type FleetPanelRow,
} from '../../services/haClient';
import {
  projectDataSources,
  groupByCategory,
  type RawState,
  type ConfigEntryLite,
  type SourceRow,
  type SourceStatus,
} from './dataSources';
import { relAge, durationLabel, batteryLabel, EMDASH } from './fleetFormat';
import {
  IconCpu, IconRss, IconRefreshCw, IconWifi, IconWifiOff, IconBattery,
  IconClock, IconCheckCircle, IconAlertTriangle, IconXCircle, IconInfo,
} from '../icons';
import './fleetStatus.css';

// ---------------------------------------------------------------------------
// FleetStatusManager — the admin Panels & Data-Sources fleet status view (#25).
//
// An ADMIN diagnostics surface (distinct from the homeowner House Health
// surface). Two sections:
//   1. PANEL FLEET — a card per kiosk from the per-device heartbeat registry
//      (name, version, IP, online-for + last-seen, online/stale/offline status,
//      current panel, battery + screen state), via the admin-only
//      `b_panels/fleet/get` WS command (heartbeat store reuse; H-2 preserved).
//   2. DATA SOURCES — a row per integration/feed the dashboards consume, with
//      connected/erroring/stale/not-configured derived from entity availability
//      (same grammar as House Health connectivity) + optional admin-only
//      config_entries enrichment. Honest "not configured" for absent sources.
//
// READ-ONLY by construction: no callService, no actuation. The admin-scope
// reads (fleet/get, config_entries/get) live ONLY here, in the admin pages; the
// kiosk runtime never calls them (least-privilege).
// ---------------------------------------------------------------------------

const POLL_MS = 15_000;

// status word per state
const STATUS_WORD: Record<string, string> = {
  online: 'Online', stale: 'Stale', offline: 'Offline',
  connected: 'Connected', erroring: 'Erroring', 'not-configured': 'Not configured',
};

const StatusDot = ({ status, size = 9 }: { status: string; size?: number }) => (
  <span className={`fl-dot fl-dot-${status}`} style={{ width: size, height: size }} aria-hidden="true" />
);

const StatusPill = ({ status }: { status: string }) => (
  <span className={`fl-pill fl-pill-${status}`}>
    <StatusDot status={status} size={7} />
    {STATUS_WORD[status] ?? status}
  </span>
);

const SectionHeader: React.FC<React.PropsWithChildren<{ icon: React.ReactNode; title: string; sub?: string }>> = ({ icon, title, sub, children }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-3">
      <span className="text-gray-400">{icon}</span>
      <div>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        {sub && <p className="text-sm text-gray-400">{sub}</p>}
      </div>
    </div>
    {children}
  </div>
);

// ── Panel fleet card ──────────────────────────────────────────────────────────
const PanelCard: React.FC<{ p: FleetPanelRow }> = ({ p }) => {
  return (
    <div className="fl-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconCpu className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-semibold text-white truncate">
              {p.name || p.installationId}
            </span>
          </div>
          <div className="text-xs text-gray-500 truncate mt-0.5 fl-meta">{p.installationId}</div>
        </div>
        <StatusPill status={p.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
        <Field label="Version" value={p.version || EMDASH} />
        <Field label="IP" value={p.ip || EMDASH} hint={p.ipSource === 'remote-addr' ? 'derived' : undefined} />
        <Field
          label="Last seen"
          value={
            <span className="inline-flex items-center gap-1">
              <IconClock className="w-3.5 h-3.5 text-gray-500" />
              {relAge(p.lastSeenAgeS)}
            </span>
          }
        />
        <Field label="Showing" value={p.currentPanelName || p.currentPanelId || EMDASH} />
        <Field
          label="Battery"
          value={
            <span className="inline-flex items-center gap-1">
              <IconBattery className="w-3.5 h-3.5 text-gray-500" />
              {batteryLabel(p.battery)}
            </span>
          }
        />
        <Field
          label="Command link"
          value={
            <span className="inline-flex items-center gap-1">
              {p.commandConnected
                ? <><IconWifi className="w-3.5 h-3.5 text-green-400" /> Reachable</>
                : <><IconWifiOff className="w-3.5 h-3.5 text-gray-500" /> Not connected</>}
            </span>
          }
        />
        {p.screenState && <Field label="Screen" value={p.screenState} />}
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="min-w-0">
    <div className="text-[0.68rem] uppercase tracking-wide text-gray-500">{label}</div>
    <div className="text-gray-200 truncate fl-meta">
      {value}
      {hint && <span className="ml-1 text-[0.62rem] text-gray-500">({hint})</span>}
    </div>
  </div>
);

// ── Data source row ─────────────────────────────────────────────────────────
const SourceStatusIcon = ({ status }: { status: SourceStatus }) => {
  if (status === 'connected') return <IconCheckCircle className="w-4 h-4 text-green-400" />;
  if (status === 'erroring') return <IconXCircle className="w-4 h-4 text-red-400" />;
  if (status === 'stale') return <IconAlertTriangle className="w-4 h-4 text-amber-400" />;
  return <IconInfo className="w-4 h-4 text-gray-500" />;
};

const SourceRowView: React.FC<{ s: SourceRow }> = ({ s }) => (
  <div className="fl-card p-3.5">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <SourceStatusIcon status={s.status} />
        <span className={`font-medium truncate ${s.configured ? 'text-white' : 'text-gray-400'}`}>
          {s.label}
        </span>
      </div>
      <StatusPill status={s.status} />
    </div>
    <div className="flex items-center justify-between gap-3 mt-2 text-xs text-gray-400">
      <span className="truncate">{s.note}</span>
      <span className="flex-shrink-0 fl-meta">
        {s.configured ? `${s.entityCount} entit${s.entityCount === 1 ? 'y' : 'ies'}` : EMDASH}
        {s.integrationState && <span className="ml-2 text-gray-500">[{s.integrationState}]</span>}
      </span>
    </div>
    {s.unavailableCount > 0 && (
      <div className="mt-1.5 text-[0.68rem] text-amber-400/80 truncate">
        Unavailable: {s.unavailable.slice(0, 4).join(', ')}
        {s.unavailable.length > 4 ? ` +${s.unavailable.length - 4} more` : ''}
      </div>
    )}
  </div>
);

// ── main ──────────────────────────────────────────────────────────────────────
const FleetStatusManager: React.FC = () => {
  const [panels, setPanels] = useState<FleetPanelRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    // PANEL FLEET — admin-only fleet/get over the authenticated HA websocket.
    try {
      const res = await fetchFleet();
      if (mounted.current) { setPanels(res.panels); setFleetError(null); }
    } catch (e: any) {
      if (mounted.current) setFleetError(e?.message || 'Fleet status unavailable (admin only)');
    }
    // DATA SOURCES — entity availability (always) + admin config_entries (best-effort).
    try {
      const [statesRaw, entries] = await Promise.all([
        getStates(),
        fetchConfigEntries().catch(() => [] as ConfigEntryLite[]),
      ]);
      const states: RawState[] = Array.isArray(statesRaw) ? statesRaw : [];
      if (mounted.current) {
        setSources(projectDataSources(states, entries, Date.now()));
        setSourcesError(null);
      }
    } catch (e: any) {
      if (mounted.current) setSourcesError(e?.message || 'Data-source snapshot unavailable');
    }
    if (mounted.current) setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const t = setInterval(load, POLL_MS);
    return () => { mounted.current = false; clearInterval(t); };
  }, [load]);

  const grouped = useMemo(() => groupByCategory(sources), [sources]);

  const fleetSummary = useMemo(() => {
    const online = panels.filter((p) => p.status === 'online').length;
    const stale = panels.filter((p) => p.status === 'stale').length;
    const offline = panels.filter((p) => p.status === 'offline').length;
    return { online, stale, offline, total: panels.length };
  }, [panels]);

  const sourceSummary = useMemo(() => {
    const configured = sources.filter((s) => s.configured);
    const erroring = configured.filter((s) => s.status === 'erroring').length;
    const stale = configured.filter((s) => s.status === 'stale').length;
    const connected = configured.filter((s) => s.status === 'connected').length;
    return { connected, stale, erroring, configured: configured.length, total: sources.length };
  }, [sources]);

  return (
    <div className="fleet-scope space-y-8">
      {/* PANEL FLEET */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
        <SectionHeader
          icon={<IconCpu className="w-6 h-6" />}
          title="Panel Fleet"
          sub={
            loading
              ? 'Loading kiosk heartbeats…'
              : `${fleetSummary.online} online · ${fleetSummary.stale} stale · ${fleetSummary.offline} offline (${fleetSummary.total} known)`
          }
        >
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
          >
            <IconRefreshCw className="w-4 h-4" /> Refresh
          </button>
        </SectionHeader>

        {fleetError && (
          <div className="text-sm text-amber-400/90 mb-3 flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4" /> {fleetError}
          </div>
        )}

        {!loading && panels.length === 0 && !fleetError && (
          <div className="text-sm text-gray-400 py-6 text-center">
            No kiosk panels have reported a heartbeat yet. A panel appears here once
            the native iPad app POSTs to <code className="text-gray-300">/api/b_panels/heartbeat</code>.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {panels.map((p) => (
            <PanelCard key={p.installationId} p={p} />
          ))}
        </div>
      </div>

      {/* DATA SOURCES */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
        <SectionHeader
          icon={<IconRss className="w-6 h-6" />}
          title="Data Sources"
          sub={
            loading
              ? 'Reading the live states snapshot…'
              : `${sourceSummary.connected} connected · ${sourceSummary.stale} stale · ${sourceSummary.erroring} erroring · ${sourceSummary.total - sourceSummary.configured} not configured`
          }
        />
        {sourcesError && (
          <div className="text-sm text-amber-400/90 mb-3 flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4" /> {sourcesError}
          </div>
        )}
        <p className="text-xs text-gray-500 mb-4">
          Derived from entity availability across the live states snapshot, enriched
          with integration setup state where admin-readable. Absent integrations show
          an honest “not configured”, never a fabricated healthy state.
        </p>

        <div className="space-y-5">
          {grouped.map((g) => (
            <div key={g.category}>
              <div className="text-[0.7rem] uppercase tracking-wider text-gray-500 mb-2">{g.category}</div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {g.rows.map((s) => (
                  <SourceRowView key={s.key} s={s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FleetStatusManager;
