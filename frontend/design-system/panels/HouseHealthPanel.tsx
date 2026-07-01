import React, { useMemo } from 'react';
import {
  useHouseHealthEntities,
  type HealthStatus,
} from './useHouseHealthEntities';
import PanelShell from '../shell/PanelShell';
import './houseHealthPanel.css';

// Needed for AttentionCard / OverviewCard prop types (display-only projections).
type AttentionViewShape = ReturnType<typeof useHouseHealthEntities>['attention'];
type ConnectivityViewShape = ReturnType<typeof useHouseHealthEntities>['connectivity'];

// ---------------------------------------------------------------------------
// HouseHealthPanel — the "system trust" surface (ECOSYSTEM #8 / §J2).
//
// A single READ-ONLY trust surface in the locked liquid-glass language. It
// groups the house's invisible infrastructure into five status groups, each
// with a clear OK / attention / critical (or honest unknown) status + an
// animated indicator, behind a proactive "what needs attention" summary:
//   • Connectivity / integrations — offline-count rollup + offline list +
//     device-fault (device_class:problem) sensors, derived from entity
//     availability across the LIVE states snapshot.
//   • Power — generator (rehlko) ready/standby/running + source + auto-mode +
//     fuel + exercise; UPS (NUT) runtime/load/battery.
//   • Network / WAN — UniFi WAN up/down, ISP, clients, AP health.
//   • Safety systems — Alarmo reachable + life-safety feed freshness (reusing
//     the takeover's signal-lost logic) + AKVO/security reachability.
//
// ── SAFETY POSTURE — READ-ONLY, honest, never fake-green ──
// There is NO actuation anywhere on this surface and NO callService path in the
// hook. REAL sources (Alarmo, the demo contacts, the live snapshot) are read and
// projected display-only. ABSENT sources (generator/UPS/WAN — not in dev) render
// the honest "not configured / awaiting connection" state, NEVER a fabricated
// green. A frozen/disconnected feed reads `signal-lost` (an explicit UNKNOWN),
// not "all clear". No runtime area-registry read. No secrets surfaced.
//
// Scoping: all markup lives under `.hh-scope` and all CSS is namespaced `hh-*`,
// so this panel never restyles the legacy dashboard or any prior panel. Mounted
// only for compilationKind 'house-health' (see Dashboard.tsx).
// ---------------------------------------------------------------------------

// Push-notification design hook (documented, deferred): the same `attention`
// projection that drives the top summary is the intended trigger source for a
// follow-up notify/automation wiring (e.g. notify.* on a status transition to
// attention/critical). No notify path is wired here — this surface is read-only.

const STATUS_WORD: Record<HealthStatus, string> = {
  ok: 'OK', attention: 'Attention', critical: 'Critical', unknown: 'Not configured',
};

// ── Display-only label mapping for infrastructure entity id patterns ───────────
// Never touches entity ids, hook fields, or types — pure render-time text
// substitution so homeowners see friendly names instead of raw sensor.backup_…
// entity strings. Extend freely; the hook/contract is untouched.
const ENTITY_LABELS: Record<string, string> = {
  'sensor.backup_state':             'HA Backup',
  'sensor.backup_last_successful':   'Last Successful Backup',
  'sensor.backup_last_attempt':      'Last Backup Attempt',
  'sensor.backup_automatic_enabled': 'Automatic Backups',
  'sensor.backup_total_backups':     'Total Backups',
  'sensor.backup_days_until_next':   'Days to Next Backup',
};

/**
 * Return a human-readable display label for an entity (display-only; entity ids
 * and hook fields are never changed). Priority order:
 *   1. friendly_name already resolved by the hook (name ≠ id)
 *   2. Explicit ENTITY_LABELS map
 *   3. sensor.backup_* heuristic → "Backup · Foo Bar"
 *   4. Generic: strip domain prefix, prettify underscores
 */
const toFriendlyName = (id: string, name: string): string => {
  if (name && name !== id) return name;
  if (ENTITY_LABELS[id]) return ENTITY_LABELS[id];
  const bk = id.match(/^sensor\.backup_(.+)$/);
  if (bk) {
    const label = bk[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `Backup · ${label}`;
  }
  // Generic prettifier: strip domain, replace underscores.
  return id.replace(/^[^.]+\./, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// ── animated status dot — pulses on attention, fast-pulses on critical ───────
const StatusDot = ({ status, size = 10 }: { status: HealthStatus; size?: number }) => (
  <span
    className={`hh-dot hh-dot-${status}`}
    style={{ width: size, height: size }}
    aria-hidden="true"
  />
);

// ── status pill (word + dot) ──────────────────────────────────────────────────
const StatusPill = ({ status }: { status: HealthStatus }) => (
  <span className={`hh-pill hh-pill-${status}`}>
    <StatusDot status={status} size={8} />
    {STATUS_WORD[status]}
  </span>
);

// ── stat card — single glass card used in the header cluster ─────────────────
const StatCard = ({
  value, label, tone,
}: {
  value: string | number;
  label: string;
  tone?: 'ok' | 'attention' | 'critical';
}) => (
  <div className={`hh-stat-card${tone ? ` hh-stat-${tone}` : ''}`}>
    <span className="hh-stat-val num">{value}</span>
    <span className="hh-stat-lab">{label}</span>
  </div>
);

// ── system-overview body card — shows alert items or all-clear, never 'unknown'
// items (those are shown in their own cards already). Replaces the old amber
// feed list that lived inside the hero header.
const OverviewCard = ({ a, c }: {
  a: AttentionViewShape;
  c: ConnectivityViewShape;
}) => {
  // Only show real health signals; 'unknown' = not-configured (handled in cards).
  const alertItems = a.items.filter((it) => it.status !== 'unknown');
  const hasAlert = alertItems.some((it) => it.status === 'attention' || it.status === 'critical');
  return (
    <GroupCard eyebrow="System Overview" title={a.headline} status={a.overall}>
      {!hasAlert ? (
        <div className="hh-allclear">
          <StatusDot status="ok" size={8} />
          <span>{c.online} of {c.total} entities online · no issues detected</span>
        </div>
      ) : (
        <ul className="hh-hero-feed">
          {alertItems.map((it, i) => (
            <li className={`hh-feed-row hh-feed-${it.status}`} key={i}>
              <StatusDot status={it.status} size={7} />
              <span className="hh-feed-text">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </GroupCard>
  );
};

// ── small labelled metric (renders the honest em-dash when value is "—") ──────
const Metric = ({ label, value, absent }: { label: string; value: string; absent?: boolean }) => (
  <div className={`hh-metric${absent ? ' hh-metric-absent' : ''}`}>
    <span className="hh-metric-label">{label}</span>
    <span className="hh-metric-value num">{value}</span>
  </div>
);

// ── group card shell ──────────────────────────────────────────────────────────
const GroupCard = ({
  title, eyebrow, status, tag, children,
}: {
  title: string; eyebrow: string; status: HealthStatus; tag?: string; children: React.ReactNode;
}) => (
  <section className={`hh-card hh-card-${status}`}>
    <header className="hh-card-head">
      <div className="hh-card-titles">
        <span className="hh-card-eyebrow">{eyebrow}</span>
        <span className="hh-card-title">{title}</span>
      </div>
      <div className="hh-card-headright">
        {tag && <span className="hh-tag">{tag}</span>}
        <StatusPill status={status} />
      </div>
    </header>
    <div className="hh-card-body">{children}</div>
  </section>
);

// honest "not configured / awaiting connection" empty state for absent sources
const AbsentState = ({ note }: { note: string }) => (
  <div className="hh-absent">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
    <div className="hh-absent-text">
      <span className="hh-absent-title">Not configured</span>
      <span className="hh-absent-note">{note}</span>
    </div>
  </div>
);

const HouseHealthPanel = () => {
  const h = useHouseHealthEntities();
  const { connectivity: c, generator: g, ups: u, network: net, safety: s, attention: a } = h;

  const heroVerdictTone = useMemo<HealthStatus>(() => a.overall, [a.overall]);

  // Lead the hero with the GOOD news: when all monitored devices are online
  // and there are no faults, the headline is the positive, confident message.
  // The fact that some integrations aren't yet configured is demoted to a small
  // sub-callout below the verdict line — not the dominant headline.
  const heroHeadline = useMemo<string>(() => {
    if (
      c.offlineCount === 0 &&
      c.problemCount === 0 &&
      a.overall !== 'critical' &&
      a.overall !== 'attention'
    ) {
      return 'Everything essential is online';
    }
    return a.headline;
  }, [a.overall, a.headline, c.offlineCount, c.problemCount]);

  // True when some integrations are absent (unknown) but connectivity itself is
  // clean — used to show the demoted "awaiting connection" sub-callout.
  const hasAbsentIntegrations = a.overall === 'unknown' && c.offlineCount === 0 && c.problemCount === 0;

  return (
    <PanelShell kind="house-health">
      <div className="hh-scope">
        {h.status === 'stale' && <div className="hh-stale">Live feed stale — reconnecting…</div>}

        {/* ── Hero · proactive "what needs attention" ── */}
        <div className={`hh-hero hh-hero-${heroVerdictTone}`}>
          <div className="hh-hero-aura" />
          <div className="hh-hero-left">
            <div className="hh-hero-eyebrow">House Health · System Trust</div>
            <div className="hh-hero-title">{heroHeadline}</div>
            <div className="hh-hero-verdict">
              <StatusDot status={a.overall} size={13} />
              <span className="hh-hero-verdict-word">{STATUS_WORD[a.overall]}</span>
              <span className="hh-hero-verdict-sub">{c.total} entities monitored</span>
            </div>
            {hasAbsentIntegrations && (
              <div className="hh-hero-sub-callout">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Power, network &amp; UPS integrations awaiting connection</span>
              </div>
            )}
          </div>
          {/* Stat-card cluster — top-right per shared header grammar */}
          <div className="hh-stat-cluster">
            <StatCard value={c.online} label="ONLINE" tone="ok" />
            <StatCard
              value={c.offlineCount}
              label="OFFLINE"
              tone={c.offlineCount > 0 ? 'attention' : undefined}
            />
            <StatCard
              value={c.problemCount}
              label="FAULTS"
              tone={c.problemCount > 0 ? 'critical' : undefined}
            />
          </div>
        </div>

        {/* ── System overview card — amber alert feed moved here from header ── */}
        <div className="hh-attn-bar">
          <OverviewCard a={a} c={c} />
        </div>

        {/* ── Group grid ── */}
        <div className="hh-grid">

          {/* Connectivity / integrations */}
          <GroupCard eyebrow="Connectivity" title="Devices & Integrations" status={c.status}>
            <div className="hh-rollup">
              <div className="hh-rollup-stat">
                <span className="hh-rollup-num num">{c.online}</span>
                <span className="hh-rollup-lab">online</span>
              </div>
              <div className="hh-rollup-divider" />
              <div className="hh-rollup-stat">
                <span className={`hh-rollup-num num${c.offlineCount > 0 ? ' attention' : ''}`}>{c.offlineCount}</span>
                <span className="hh-rollup-lab">offline</span>
              </div>
              <div className="hh-rollup-divider" />
              <div className="hh-rollup-stat">
                <span className={`hh-rollup-num num${c.problemCount > 0 ? ' critical' : ''}`}>{c.problemCount}</span>
                <span className="hh-rollup-lab">faults</span>
              </div>
            </div>

            {c.problemCount > 0 && (
              <div className="hh-list hh-list-critical">
                <div className="hh-list-label">Faults reported</div>
                {c.problems.map((p) => (
                  <div className="hh-list-row" key={p.id}>
                    <StatusDot status="critical" size={7} />
                    <span className="hh-list-name">{toFriendlyName(p.id, p.name)}</span>
                  </div>
                ))}
              </div>
            )}

            {c.offlineCount > 0 ? (
              <div className="hh-list hh-list-attention">
                <div className="hh-list-label">Offline / unavailable</div>
                {c.offline.slice(0, 8).map((o) => (
                  <div className="hh-list-row" key={o.id}>
                    <StatusDot status="attention" size={7} />
                    <span className="hh-list-name">{toFriendlyName(o.id, o.name)}</span>
                  </div>
                ))}
                {c.offline.length > 8 && (
                  <div className="hh-list-more">+{c.offline.length - 8} more offline</div>
                )}
              </div>
            ) : (
              <div className="hh-allclear">
                <StatusDot status="ok" size={8} />
                Everything online · no offline devices
              </div>
            )}
          </GroupCard>

          {/* Safety systems */}
          <GroupCard eyebrow="Safety Systems" title="Alarm · Life-Safety · AKVO" status={s.status} tag="Live">
            <div className="hh-safety-rows">
              <div className="hh-srow">
                <span className="hh-srow-key">Alarm panel</span>
                <span className="hh-srow-val">
                  <StatusDot status={s.alarmReachable ? 'ok' : 'critical'} size={8} />
                  {s.alarmLabel}
                </span>
              </div>
              <div className="hh-srow">
                <span className="hh-srow-key">Life-safety feed</span>
                <span className="hh-srow-val">
                  <StatusDot status={s.freshness === 'known-good' ? 'ok' : s.freshness === 'stale' ? 'attention' : 'critical'} size={8} />
                  {s.freshnessLabel}
                  {s.freshness === 'signal-lost' && s.lastKnownLabel && (
                    <span className="hh-srow-aside">last known · {s.lastKnownLabel}</span>
                  )}
                </span>
              </div>
              <div className="hh-srow">
                <span className="hh-srow-key">Open zones</span>
                <span className="hh-srow-val">
                  <StatusDot status={s.notReady ? 'attention' : 'ok'} size={8} />
                  {s.notReady ? (s.openList ?? 'zones open') : 'All clear · ready'}
                </span>
              </div>
              <div className="hh-srow">
                <span className="hh-srow-key">AKVO floor</span>
                <span className="hh-srow-val hh-srow-muted">
                  <StatusDot status="unknown" size={8} />
                  PLC-mediated · status surface separate
                </span>
              </div>
            </div>
            <div className={`hh-note hh-note-${s.status}`}>{s.note}</div>
          </GroupCard>

          {/* Power · Generator */}
          <GroupCard eyebrow="Power" title="Generator · Rehlko" status={g.status}
            tag={g.configured ? undefined : 'Awaiting connection'}>
            {g.configured ? (
              <>
                <div className="hh-gen-hero">
                  <div className={`hh-gen-ring hh-gen-ring-${g.status}`}>
                    <span className="hh-gen-run">{g.runState}</span>
                  </div>
                  <div className="hh-gen-source">
                    <span className="hh-gen-source-lab">Power source</span>
                    <span className={`hh-gen-source-val${g.onGenerator ? ' on-gen' : ''}`}>{g.source}</span>
                  </div>
                </div>
                <div className="hh-metric-grid">
                  <Metric label="Auto-mode" value={g.autoMode == null ? '—' : g.autoMode ? 'On' : 'Off'} absent={g.autoMode == null} />
                  <Metric label="Fuel" value={g.fuel} absent={g.fuel === '—'} />
                  <Metric label="Last exercise" value={g.lastExercise} absent={g.lastExercise === '—'} />
                  <Metric label="Next exercise" value={g.nextExercise} absent={g.nextExercise === '—'} />
                </div>
                <div className={`hh-note hh-note-${g.status}`}>{g.note}</div>
              </>
            ) : (
              <AbsentState note="Awaiting Rehlko integration connection" />
            )}
          </GroupCard>

          {/* Power · UPS */}
          <GroupCard eyebrow="Power" title="UPS · NUT" status={u.status}
            tag={u.configured ? undefined : 'Not configured'}>
            {u.configured ? (
              <>
                <div className="hh-ups-state">
                  <StatusDot status={u.onBattery ? 'attention' : 'ok'} size={11} />
                  <span className="hh-ups-state-word">{u.stateLabel}</span>
                </div>
                <div className="hh-metric-grid">
                  <Metric label="Battery" value={u.battery} absent={u.battery === '—'} />
                  <Metric label="Runtime" value={u.runtime} absent={u.runtime === '—'} />
                  <Metric label="Load" value={u.load} absent={u.load === '—'} />
                </div>
                <div className={`hh-note hh-note-${u.status}`}>{u.note}</div>
              </>
            ) : (
              <AbsentState note="Awaiting NUT / UPS configuration" />
            )}
          </GroupCard>

          {/* Network / WAN */}
          <GroupCard eyebrow="Network" title="WAN · UniFi" status={net.status}
            tag={net.configured ? undefined : 'Not configured'}>
            {net.configured ? (
              <>
                <div className="hh-wan-state">
                  <StatusDot status={net.wanUp === false ? 'critical' : net.wanUp ? 'ok' : 'unknown'} size={11} />
                  <span className="hh-wan-word">{net.wanLabel}</span>
                  <span className="hh-wan-isp">{net.isp}</span>
                </div>
                <div className="hh-metric-grid">
                  <Metric label="Clients" value={net.clients} absent={net.clients === '—'} />
                  <Metric label="Access points" value={net.aps} absent={net.aps === '—'} />
                </div>
                <div className={`hh-note hh-note-${net.status}`}>{net.note}</div>
              </>
            ) : (
              <AbsentState note="Awaiting UniFi network configuration" />
            )}
          </GroupCard>

        </div>

        <div className="hh-foot">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          Read-only trust surface · absent sources show their honest state, never fake-OK · push alerts deferred
        </div>
      </div>
    </PanelShell>
  );
};

export default HouseHealthPanel;
