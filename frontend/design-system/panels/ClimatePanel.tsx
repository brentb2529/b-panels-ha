import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard } from '../../hooks/useDashboard';
import { useClimateEntities, type ZoneView, type ClimateMode } from './useClimateEntities';
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
const ArmingBar = () => {
  const { alarmState, armingState } = useDashboard();
  const phase = alarmState?.phase ?? 'idle';
  const arm = alarmState?.armState ?? 'disarmed';

  let cls = 'cp-arm-ready';
  let state = 'Disarmed · Ready';
  let sub = 'All sensors clear · ready to arm';
  let pulse = true;
  let shieldStroke = 'var(--sem-ready)';
  let shieldPath = (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  );

  if (!alarmState) {
    cls = 'cp-arm-notready';
    state = 'Alarm · Unavailable';
    sub = 'No alarm panel connected';
    pulse = false;
    shieldStroke = 'var(--sem-notready)';
  } else if (phase === 'triggered' || alarmState.securityState === 'VIOLATION') {
    cls = 'cp-arm-triggered';
    state = 'Intrusion';
    sub = alarmState.trigger?.name ? `Triggered · ${alarmState.trigger.name}` : 'Alarm triggered';
    shieldStroke = 'var(--sem-triggered)';
  } else if (arm === 'armedAway') {
    cls = 'cp-arm-away';
    state = 'Armed · Away';
    sub = 'Perimeter + interior armed';
    pulse = false;
    shieldStroke = 'var(--sem-armed-away)';
  } else if (arm === 'armedStay') {
    cls = 'cp-arm-stay';
    state = 'Armed · Stay';
    sub = 'Perimeter armed · home';
    pulse = false;
    shieldStroke = 'var(--sem-armed-stay)';
  } else if (armingState === 'not_ready') {
    cls = 'cp-arm-notready';
    state = 'Disarmed · Not Ready';
    const open = alarmState.haOpenSensors ? Object.keys(alarmState.haOpenSensors).length : 0;
    sub = open > 0 ? `${open} sensor${open === 1 ? '' : 's'} open · close to arm` : 'Some sensors open';
    shieldStroke = 'var(--sem-notready)';
    shieldPath = (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="13" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </>
    );
  }

  return (
    <div className={`cp-arming ${cls}`} title={`Alarm: ${state}`}>
      <div className="cp-arming-shield">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={shieldStroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {shieldPath}
        </svg>
      </div>
      <div className="cp-arming-text">
        <span className="cp-arming-state"><span className={`cp-arming-dot${pulse ? ' pulse' : ''}`} />{state}</span>
        <span className="cp-arming-sub">{sub}</span>
      </div>
    </div>
  );
};

// ── mode icons (cool / heat / auto-off) ─────────────────────────────────────
const CoolIcon = ({ stroke }: { stroke: string }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
  </svg>
);
const HeatIcon = ({ stroke }: { stroke: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 14c0-3 4-4 4-8 2 2 4 4 4 8a4 4 0 0 1-8 0z" />
  </svg>
);
const AutoIcon = ({ stroke }: { stroke: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
    <line x1="12" y1="2" x2="12" y2="12" />
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
const MasterModePills = ({ zone, onMode }: { zone: ZoneView; onMode: (m: ClimateMode) => void }) => {
  const pill = (m: ClimateMode, icon: React.ReactNode, on: boolean, label: string) => (
    <button
      type="button"
      className={`cp-mode-pill${on ? (m === 'cool' ? ' on-cool' : m === 'heat' ? ' on-heat' : ' on-auto') : ''}`}
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
      {pill('auto', <AutoIcon stroke={zone.mode === 'auto' ? 'var(--accent-climate)' : 'var(--text-dim)'} />, zone.mode === 'auto', 'Auto')}
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
    <span className="cp-master-badge">Master</span>
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
const SlaveRow = ({ zone, onSet }: { zone: ZoneView; onSet: (t: number) => void }) => (
  <div className="cp-slave-row">
    <div className="cp-zone-grow">
      <span className="cp-slave-name">{zone.name}</span>
      {' · '}
      <span className="cp-slave-lock"><LockIcon />mode on {zone.masterZone}</span>
    </div>
    <span className="cp-slave-temp num">{zone.current !== null ? Math.round(zone.current) : '—'}<span className="deg">°</span></span>
    <span className={`cp-hvac-chip ${hvacChipClass(zone.calling)}`} style={{ margin: '0 4px' }}>{hvacChipLabel(zone)}</span>
    {/* mode buttons are DISABLED on a slave — read-back only */}
    <div className="cp-mode-pills cp-mode-readback" aria-hidden="true">
      <span className="cp-mode-pill is-disabled" title="Set on master"><CoolIcon stroke="var(--text-dim)" /></span>
    </div>
    <Stepper zone={zone} onSet={onSet} />
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
          <div className="cp-card-label"><span className="cp-card-accent">Zones · Master &amp; Slave Topology</span><span>Airzone</span></div>

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
                  <path d="M30 120 A 55 55 0 1 1 120 120" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" strokeLinecap="round" />
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
                  ? `Slave · ${z.masterZone}`
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

      <BottomSwitcher />
    </div>
  );
};

// Bottom area-switcher — links to sibling panels when present (matched by name).
const BottomSwitcher = () => {
  const { panels } = useDashboard();
  const findPanel = (re: RegExp) => panels.find((p) => re.test(p.name))?.id;
  const homeId = findPanel(/home|overview|main/i);
  const poolId = findPanel(/pool|spa/i);
  const securityId = findPanel(/security|alarm/i);
  const lightsId = findPanel(/light/i);

  const NavLink = ({ to, label, active, children }: { to?: string; label: string; active?: boolean; children: React.ReactNode; }) => {
    const inner = (<><span className="cp-nav-ico">{children}</span><span className="cp-nav-label">{label}</span></>);
    const cls = `cp-nav${active ? ' active' : ''}`;
    return to ? <Link className={cls} to={`/dashboard/${to}`}>{inner}</Link> : <button className={cls} type="button">{inner}</button>;
  };

  return (
    <nav className="cp-switcher">
      <ArmingBar />
      <NavLink to={homeId} label="Home">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
      </NavLink>
      <NavLink to={poolId} label="Pool">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12h2c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 7 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41h.34c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 13 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41H16c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 19 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.59.41" /></svg>
      </NavLink>
      <NavLink label="Climate" active>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-climate)" strokeWidth="1.5" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>
      </NavLink>
      <NavLink to={securityId} label="Security">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
      </NavLink>
      <NavLink to={lightsId} label="Lights">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><line x1="9" y1="18" x2="15" y2="18" /><line x1="10" y1="22" x2="14" y2="22" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg>
      </NavLink>
    </nav>
  );
};

export default ClimatePanel;
