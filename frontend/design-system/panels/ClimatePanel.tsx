import React, { useMemo, useState } from 'react';
import { useClimateEntities, type ZoneView, type ClimateMode } from './useClimateEntities';
import PanelShell from '../shell/PanelShell';
import './climatePanel.css';

// ---------------------------------------------------------------------------
// ClimatePanel — Increment 5 "design-tiles first" whole-home Climate
// compilation panel. A faithful, LIVE port of the locked cool-slate exemplar
//   daily/2026-06-09/design-direction/exemplar-climate-v14cool(-light)
// into a real in-app panel. The two-column body mirrors the exemplar exactly:
//   • LEFT (core)  Zones · master/slave topology. Each MASTER zone is an
//                  elevated card with its SLAVE zones indented under it on a
//                  connecting rail. Per zone: current temp + RH + setpoint +
//                  mode/hvac_action. MASTERS get FULL mode control
//                  (Cool/Heat/Auto/Off) — LIVE, low-hazard. SLAVES get a live
//                  setpoint but mode is READ-BACK only ("Set on master · <name>",
//                  disabled mode buttons) per ENTITY_CONTRACT Surface 2.
//   • RIGHT        House Summary — the avg ring (house average temp) + panel-side
//                  "N calling cool / N calling heat / N idle" (excl. offline) +
//                  an "Other Zones / Systems" card (independent, slave example,
//                  and an offline zone → em-dash unavailable pattern).
// Persistent arming bar = REAL Alarmo (display-only). Bottom area-switcher.
//
// Scoping: all markup under `.cp-scope`, all CSS namespaced `cp-*`, so this
// panel never restyles the legacy dashboard or the other compilation panels.
// Mounted only for panels of kind 'climate' (Dashboard.tsx) — additive.
// ---------------------------------------------------------------------------

// ── arming bar (display-only) — derives look from real Alarmo state ─────────


// ── mode icons (cool / heat / auto-off) ─────────────────────────────────────
const CoolIcon = ({ stroke }: { stroke: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
  </svg>
);
const HeatIcon = ({ stroke }: { stroke: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 14c0-3 4-4 4-8 2 2 4 4 4 8a4 4 0 0 1-8 0z" />
  </svg>
);

const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const hvacChipClass = (c: ZoneView['calling']) =>
  c === 'cool' ? 'cp-hvac-cool' : c === 'heat' ? 'cp-hvac-heat' : 'cp-hvac-idle';
const hvacChipLabel = (z: ZoneView) =>
  !z.available ? 'Offline' : z.calling === 'cool' ? 'Cooling' : z.calling === 'heat' ? 'Heating' : z.calling === 'off' ? 'Off' : 'Idle';

// ── full mode control on a MASTER zone (LIVE) ───────────────────────────────
// 3 essential pills at 32px tap targets (Cool / Heat / Off). Auto mode is
// wired in the hook (setHvacMode('auto') works) but not surfaced as a pill —
// the hvac chip always shows the live calling state, so Auto is visible even
// when set by a schedule or externally.
const MasterModePills = ({ zone, onMode }: { zone: ZoneView; onMode: (m: ClimateMode) => void }) => {
  const pill = (m: ClimateMode, icon: React.ReactNode, on: boolean, label: string) => (
    <button
      type="button"
      className={`cp-mode-pill${on ? (m === 'cool' ? ' on-cool' : m === 'heat' ? ' on-heat' : '') : ''}`}
      onClick={() => onMode(m)}
      title={label}
      aria-label={`${zone.name} — ${label}`}
      aria-pressed={on}
    >
      {icon}
    </button>
  );
  return (
    <div className="cp-mode-pills">
      {pill('cool', <CoolIcon stroke={zone.mode === 'cool' ? 'var(--accent-cool)' : 'var(--text-dim)'} />, zone.mode === 'cool', 'Cool')}
      {pill('heat', <HeatIcon stroke={zone.mode === 'heat' ? 'var(--accent-heat)' : 'var(--text-dim)'} />, zone.mode === 'heat', 'Heat')}
      {pill('off', <span className="cp-mode-off">⏻</span>, zone.mode === 'off', 'Off')}
    </div>
  );
};

// ── a live setpoint stepper (shared by every zone) ──────────────────────────
const Stepper = ({ zone, onSet }: { zone: ZoneView; onSet: (t: number) => void }) => {
  const sp = zone.setpoint;
  const disabled = !zone.available || sp === null;
  const bump = (d: number) => {
    if (sp === null) return;
    const next = Math.max(zone.minTemp, Math.min(zone.maxTemp, Math.round(sp + d * zone.step)));
    if (next !== sp) onSet(next);
  };
  return (
    <div className="cp-stepper">
      <button type="button" className="cp-step-btn" disabled={disabled} onClick={() => bump(-1)} aria-label={`${zone.name} setpoint down`}>−</button>
      <span className="cp-step-val num">{sp !== null ? `${Math.round(sp)}°` : '—'}</span>
      <button type="button" className="cp-step-btn" disabled={disabled} onClick={() => bump(1)} aria-label={`${zone.name} setpoint up`}>+</button>
    </div>
  );
};

// ── MASTER zone row (elevated, full controls) ───────────────────────────────
const MasterRow = ({ zone, onSet, onMode }: { zone: ZoneView; onSet: (t: number) => void; onMode: (m: ClimateMode) => void }) => (
  <div className="cp-master-row">
    <span className="cp-master-badge">Zone Lead</span>
    <div className="cp-zone-grow">
      <div className="cp-zone-name">{zone.name}</div>
      <div className="cp-zone-meta">
        {zone.humidity !== null && <span className="num">RH {Math.round(zone.humidity)}%</span>}
        <span className={`cp-hvac-chip ${hvacChipClass(zone.calling)}`}>{hvacChipLabel(zone)}</span>
      </div>
    </div>
    <div className="cp-zone-readout">
      <span className="cp-zone-temp num">{zone.current !== null ? Math.round(zone.current) : '—'}<span className="deg">°</span></span>
    </div>
    <div className="cp-zone-setpoint">
      <Stepper zone={zone} onSet={onSet} />
      <div className="cp-sp-cap">Set</div>
    </div>
    <MasterModePills zone={zone} onMode={onMode} />
  </div>
);

// ── SLAVE zone row (indented, live setpoint, mode read-back only) ───────────
// "Follows <zone>" replaces "Set on master" — homeowner-friendly phrasing.
// Mode input is intentionally absent (mode follows the Zone Lead); the live
// hvac chip still shows the current calling state. Setpoint is a live stepper.
const SlaveRow = ({ zone, onSet }: { zone: ZoneView; onSet: (t: number) => void }) => (
  <div className="cp-slave-row">
    <div className="cp-zone-grow">
      <div className="cp-slave-name">{zone.name}</div>
      <div className="cp-zone-meta">
        <span className="cp-slave-follows"><LockIcon />Follows {zone.masterZone}</span>
        <span className={`cp-hvac-chip ${hvacChipClass(zone.calling)}`}>{hvacChipLabel(zone)}</span>
      </div>
    </div>
    <div className="cp-zone-readout">
      <span className="cp-slave-temp num">{zone.current !== null ? Math.round(zone.current) : '—'}<span className="deg">°</span></span>
    </div>
    <div className="cp-zone-setpoint">
      <Stepper zone={zone} onSet={onSet} />
      <div className="cp-sp-cap">Set</div>
    </div>
  </div>
);

const ClimatePanel = () => {
  const c = useClimateEntities();
  const { summary } = c;

  // House-average ring geometry (semicircle-ish arc from the exemplar: 270°
  // sweep, dasharray 259). Map avg temp into a comfortable 60–85 band for the fill.
  const arcFrac = useMemo(() => {
    if (summary.avgTemp === null) return 0;
    return Math.max(0, Math.min(1, (summary.avgTemp - 60) / (85 - 60)));
  }, [summary.avgTemp]);
  const ARC = 259;
  const arcOffset = ARC * (1 - arcFrac);
  const ringColor =
    summary.dominant === 'heat' ? 'var(--accent-heat)'
      : summary.dominant === 'cool' ? 'var(--accent-cool)'
        : 'var(--accent-climate)';

  const heroPill = summary.dominant === 'heat' ? 'heating' : summary.dominant === 'cool' ? 'cooling' : 'idle';
  const heroCounts = `${summary.callingCool} calling for cool · ${summary.callingHeat} heat`;

  return (
    <PanelShell kind="climate">
    <div className="cp-scope">
      {c.status === 'stale' && <div className="cp-stale">Live feed stale — reconnecting…</div>}

      {/* ── Hero — cool slate climate ── */}
      <div className="cp-hero">
        <div className="cp-hero-vignette" />
        <div className="cp-title-block">
          <div className="cp-hero-left">
            <div className="cp-eyebrow">Whole Home · Airzone</div>
            <div className="cp-title">Climate</div>
            <div className="cp-sub">
              <span className="cp-status-pill">
                <span className="cp-status-dot" />{summary.zoneCount} zones · {heroPill}
              </span>
              <span className="num">{heroCounts}</span>
            </div>
          </div>
          <div className="cp-hero-right">
            <div className={`cp-metric${summary.avgTemp === null ? ' is-unavailable' : ''}`}>
              <div className="cp-metric-value num">{summary.avgTemp !== null ? Math.round(summary.avgTemp) : '—'}<span className="cp-metric-unit">°F</span></div>
              <div className="cp-metric-label">House avg</div>
            </div>
            <div className={`cp-metric${summary.avgRh === null ? ' is-unavailable' : ''}`}>
              <div className="cp-metric-value num">{summary.avgRh !== null ? Math.round(summary.avgRh) : '—'}<span className="cp-metric-unit">%</span></div>
              <div className="cp-metric-label">Avg RH</div>
            </div>
            <div className="cp-metric">
              <div className="cp-metric-value num">{summary.zoneCount}</div>
              <div className="cp-metric-label">Zones</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content: one wide primary (topology) + satellites ── */}
      <div className="cp-content">

        {/* PRIMARY — master/slave zone topology */}
        <div className="cp-card cp-card-primary">
          <div className="cp-card-label"><span className="cp-card-accent">Whole-Home Zones</span><span>Airzone</span></div>

          {c.groups.length === 0 && c.independents.length === 0 && (
            <div className="cp-empty">No live climate zones reporting topology.</div>
          )}

          {c.groups.map((g) => (
            <div className="cp-zone-group" key={g.master.id}>
              <MasterRow
                zone={g.master}
                onSet={(t) => c.actions.setTemperature(g.master.id, t)}
                onMode={(m) => c.actions.setHvacMode(g.master.id, m)}
              />
              {g.slaves.map((s) => (
                <SlaveRow key={s.id} zone={s} onSet={(t) => c.actions.setTemperature(s.id, t)} />
              ))}
            </div>
          ))}
        </div>

        {/* RIGHT satellites */}
        <div className="cp-right-col">
          {/* House summary */}
          <div className="cp-card">
            <div className="cp-card-label"><span>House Summary</span><span>panel-side</span></div>
            <div className="cp-summary-arc-wrap">
              <div className="cp-summary-arc">
                <svg width="150" height="150" viewBox="0 0 150 150">
                  <path className="cp-arc-track" d="M30 120 A 55 55 0 1 1 120 120" fill="none" strokeWidth="9" strokeLinecap="round" />
                  <path d="M30 120 A 55 55 0 1 1 120 120" fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={arcOffset} />
                </svg>
                <div className="cp-arc-c">
                  <div className="cp-summary-avg num">{summary.avgTemp !== null ? Math.round(summary.avgTemp) : '—'}<span className="deg">°</span></div>
                  <div className="cp-summary-cap">House average</div>
                </div>
              </div>
            </div>
            <div className="cp-calling-row">
              <div className="cp-calling"><div className="cp-calling-n num" style={{ color: 'var(--accent-cool)' }}>{summary.callingCool}</div><div className="cp-calling-l">Calling cool</div></div>
              <div className="cp-calling"><div className="cp-calling-n num" style={{ color: 'var(--accent-heat)' }}>{summary.callingHeat}</div><div className="cp-calling-l">Calling heat</div></div>
              <div className="cp-calling"><div className="cp-calling-n num">{summary.idle}</div><div className="cp-calling-l">Idle</div></div>
            </div>
            <div className="cp-summary-foot"><span className="num">Avg RH {summary.avgRh !== null ? `${Math.round(summary.avgRh)}%` : '—'}</span><span>Excl. offline zones</span></div>
          </div>

          {/* Other zones / systems */}
          <div className="cp-card" style={{ flex: 1 }}>
            <div className="cp-card-label"><span>Other Zones</span><span>{c.others.length} systems</span></div>
            {c.others.length === 0 && <div className="cp-empty">All zones grouped above.</div>}
            {c.others.map((z) => {
              const offline = !z.available;
              const sub = offline
                ? 'Sensor offline'
                : z.masterZone
                  ? `Grouped · ${z.masterZone}`
                  : z.calling === 'off'
                    ? 'Independent · off'
                    : 'Independent';
              return (
                <div className={`cp-mini-zone${offline ? ' cp-mz-na' : ''}`} key={z.id}>
                  <div className="cp-mz-left"><span className="cp-mz-name">{z.name}</span><span className="cp-mz-sub">{sub}</span></div>
                  <div className="cp-mz-right">
                    {offline ? (
                      <span className="cp-mz-temp num">—</span>
                    ) : z.calling === 'off' && z.current === null ? (
                      <span className={`cp-hvac-chip ${hvacChipClass('off')}`}>Off</span>
                    ) : (
                      <span className="cp-mz-temp num">{z.current !== null ? Math.round(z.current) : '—'}<span className="deg">°</span></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      
    </div>
    </PanelShell>
  );
};

export default ClimatePanel;
