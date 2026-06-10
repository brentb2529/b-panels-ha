import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDashboard } from '../../hooks/useDashboard';
import { useHomeEntities } from './useHomeEntities';
import './homePanel.css';

// ---------------------------------------------------------------------------
// HomePanel — Increment 3 "design-tiles first" compilation panel.
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-home-cool(-light).html
// into a real in-app panel: the scene-forward landing. Every value is bound to
// a real dev HA entity via useHomeEntities (subscribeEntities + callService).
// The persistent arming bar binds to the REAL alarm_control_panel.house
// (Alarmo) through useDashboard()'s alarmState/armingState — DISPLAY-ONLY (no
// arm/disarm control on this surface). Generator + AKVO render their honest
// unconnected / PROPOSED-gated state; no equipment actuation. The ONE inline
// control is the low-hazard pool-body switch (a normal switch, NOT gated).
//
// Scoping: all markup under `.hp-scope`, all CSS namespaced `hp-*`, so the panel
// never restyles the legacy dashboard, the 22 legacy tiles, or the Kitchen
// panel. Mounted only for panels of kind 'compilation:home' (see Dashboard.tsx).
// ---------------------------------------------------------------------------

const chevron = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
);

const SceneIcons: Record<string, React.ReactNode> = {
  Morning: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-lights)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /></svg>,
  Away: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-climate)" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>,
  Evening: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-lights)" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
  Night: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round"><path d="M12 3a6.364 6.364 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>,
  Guest: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-pool)" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  Movie: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>,
};

const weatherEmoji = (cond: string, day: boolean | null): string => {
  const c = (cond || '').toLowerCase();
  if (c.includes('lightning') || c.includes('thunder')) return '⛈️';
  if (c.includes('pour') || c.includes('rain')) return '🌧️';
  if (c.includes('snow')) return '🌨️';
  if (c.includes('fog')) return '🌫️';
  if (c.includes('partly')) return day === false ? '☁️' : '⛅';
  if (c.includes('cloud')) return '☁️';
  if (c.includes('clear') || c.includes('sunny')) return day === false ? '🌙' : '☀️';
  return day === false ? '🌙' : '☀️';
};

const greetingFor = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

// ── arming bar (display-only) — derives look from the REAL Alarmo state ──────
const ArmingBar = () => {
  const { alarmState, armingState } = useDashboard();
  const phase = alarmState?.phase ?? 'idle';
  const arm = alarmState?.armState ?? 'disarmed';

  let cls = 'hp-arm-ready';
  let state = 'Disarmed · Ready';
  let sub = 'All sensors clear · ready to arm';
  let pulse = true;
  let shieldStroke = 'var(--sem-ready)';

  if (!alarmState) {
    cls = 'hp-arm-notready'; state = 'Alarm · Unavailable'; sub = 'No alarm panel connected'; pulse = false; shieldStroke = 'var(--sem-notready)';
  } else if (phase === 'triggered' || alarmState.securityState === 'VIOLATION') {
    cls = 'hp-arm-triggered'; state = 'Intrusion'; sub = alarmState.trigger?.name ? `Triggered · ${alarmState.trigger.name}` : 'Alarm triggered'; shieldStroke = 'var(--sem-triggered)';
  } else if (arm === 'armedAway') {
    cls = 'hp-arm-away'; state = 'Armed · Away'; sub = 'Perimeter + interior armed'; pulse = false; shieldStroke = 'var(--sem-armed-away)';
  } else if (arm === 'armedStay') {
    cls = 'hp-arm-stay'; state = 'Armed · Stay'; sub = 'Perimeter armed · home'; pulse = false; shieldStroke = 'var(--sem-armed-stay)';
  } else if (armingState === 'not_ready') {
    cls = 'hp-arm-notready'; state = 'Disarmed · Not Ready';
    const open = alarmState.haOpenSensors ? Object.keys(alarmState.haOpenSensors).length : 0;
    sub = open > 0 ? `${open} sensor${open === 1 ? '' : 's'} open` : 'Some sensors open';
    shieldStroke = 'var(--sem-notready)';
  }

  return (
    <div className={`hp-arming ${cls}`} title={`Alarm: ${state}`}>
      <div className="hp-arming-shield">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={shieldStroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
        </svg>
      </div>
      <div className="hp-arming-text">
        <span className="hp-arming-state"><span className={`hp-arming-dot${pulse ? ' pulse' : ''}`} />{state}</span>
        <span className="hp-arming-sub">{sub}</span>
      </div>
    </div>
  );
};

const HomePanel = () => {
  const h = useHomeEntities();
  const navigate = useNavigate();
  const { panels } = useDashboard();
  const [now, setNow] = useState(() => new Date());
  const [firedScene, setFiredScene] = useState<string | null>(null);
  const fireTimer = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { if (fireTimer.current) window.clearTimeout(fireTimer.current); }, []);

  const findPanel = (re: RegExp) => panels.find((p) => re.test(p.name))?.id;
  const open = (re: RegExp) => {
    const id = findPanel(re);
    if (id) navigate(`/dashboard/${id}`);
  };

  const fireScene = (id: string) => {
    h.actions.activateScene(id);
    setFiredScene(id);
    if (fireTimer.current) window.clearTimeout(fireTimer.current);
    fireTimer.current = window.setTimeout(() => setFiredScene(null), 900);
  };

  const time = useMemo(() => {
    let hr = now.getHours();
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12 || 12;
    return { hm: `${hr}:${String(now.getMinutes()).padStart(2, '0')}`, ampm };
  }, [now]);
  const dateLong = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dateShort = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const greeting = greetingFor(now.getHours());

  const armReadout = (() => {
    const s = h.security;
    if (!s.available) return { label: 'Unavailable', cls: 'triggered' };
    if (s.armState === 'armed_away') return { label: 'Armed · Away', cls: 'away' };
    if (s.armState === 'armed_home' || s.armState === 'armed_night') return { label: 'Armed · Stay', cls: 'stay' };
    if (s.armState === 'triggered') return { label: 'Intrusion', cls: 'triggered' };
    return { label: 'Disarmed · Ready', cls: '' };
  })();

  const statusLine = h.security.available && h.security.armState === 'disarmed' && h.security.openContacts === 0
    ? 'All systems nominal'
    : h.security.summary;

  return (
    <div className="hp-scope">
      <div className="hp-canvas" />
      {h.status === 'stale' && <div className="hp-stale">Live feed stale — reconnecting…</div>}

      <div className="hp-main">
        {/* ── Top bar ── */}
        <div className="hp-top">
          <div>
            <div className="hp-eyebrow">Bensten Residence</div>
            <div className="hp-greeting">{greeting}, Brent</div>
            <div className="hp-date">{dateLong} · {statusLine}</div>
          </div>
          <div className="hp-right">
            <div className="hp-chips">
              <div className="hp-chip">
                <svg className="hp-chip-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-pool)" strokeWidth="2" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>
                <span className="hp-chip-val num">{h.pool.water !== null ? `${Math.round(h.pool.water)}°` : '—'}</span>
                <span className="hp-chip-lbl">Pool</span>
              </div>
              <div className="hp-chip">
                <svg className="hp-chip-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sem-ready)" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
                <span className="hp-chip-val">{armReadout.label.replace('Disarmed · ', '').replace('Armed · ', '')}</span>
              </div>
              <div className="hp-chip">
                <svg className="hp-chip-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-lights)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /></svg>
                <span className="hp-chip-val num">{h.lights.onCount}</span>
                <span className="hp-chip-lbl">Lights on</span>
              </div>
              <div className="hp-chip">
                <svg className="hp-chip-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-climate)" strokeWidth="2" strokeLinecap="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" /></svg>
                <span className="hp-chip-val num">{h.climate.avg !== null ? `${h.climate.avg}°` : '—'}</span>
                <span className="hp-chip-lbl">Avg zone</span>
              </div>
            </div>
            <div className="hp-weather">
              <div className="hp-weather-ico">{weatherEmoji(h.weather.condition, h.weather.isDaytime)}</div>
              <div>
                <div className="hp-weather-temp num">{h.weather.temp !== null ? `${Math.round(h.weather.temp)}°F` : '—'}</div>
                <div className="hp-weather-desc">{h.weather.available ? h.weather.condition.charAt(0).toUpperCase() + h.weather.condition.slice(1) : 'Unavailable'}</div>
              </div>
            </div>
            <div className="hp-clock">
              <div className="hp-clock-time num">{time.hm} {time.ampm}</div>
              <div className="hp-clock-date">{dateShort}</div>
            </div>
          </div>
        </div>

        {/* ── Scene row ── */}
        <div className="hp-scenes">
          <span className="hp-scene-label">Scenes</span>
          {h.scenes.map((s) => {
            const active = h.activeScene === s.id;
            return (
              <button
                key={s.id}
                className={`hp-pill${active ? ' active' : ''}${firedScene === s.id ? ' just-fired' : ''}`}
                disabled={!s.available}
                onClick={() => fireScene(s.id)}
                title={s.available ? `Activate ${s.name}` : `${s.name} (unavailable)`}
              >
                {SceneIcons[s.name]}
                <span className="hp-pill-lbl">{s.name}</span>
              </button>
            );
          })}
        </div>

        {/* ── Area card grid ── */}
        <div className="hp-grid">

          {/* Pool */}
          <div className="hp-card hp-pool" onClick={() => open(/pool/i)}>
            <div className="hp-wave">
              <svg className="hp-wave-svg" width="2200" height="80" viewBox="0 0 2200 80" fill="none"><path d="M0 40 C 220 10, 440 70, 660 40 S 1100 10, 1320 40 S 1760 70, 1980 40 S 2200 10, 2200 40 L2200 80 L0 80Z" fill="var(--accent-pool)" /></svg>
            </div>
            <div className="hp-card-inner">
              <div className="hp-card-top">
                <div className="hp-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-pool)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12h2c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 7 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41h.34c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 13 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41H16c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 19 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.59.41" /><path d="M2 6h2c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 7 5c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41h.34c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 13 5c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41H16c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 19 5c.55 0 1.05.22 1.41.59.37.36.87.41 1.59.41" /></svg></div>
                {h.pool.on
                  ? <div className="hp-badge hp-badge-on"><span className="hp-badge-dot" />Active</div>
                  : <div className="hp-badge hp-badge-muted">Idle</div>}
              </div>
              <div className="hp-card-body">
                <div className="hp-card-area">Backyard</div>
                <div className="hp-card-title">Pool &amp; Spa</div>
                <div className="hp-card-sum num">{h.pool.summary}</div>
              </div>
              <div className="hp-card-foot" onClick={(e) => e.stopPropagation()}>
                <div className={`hp-toggle-inline${h.pool.on ? ' on' : ''}`}>
                  <button
                    className={`hp-toggle${h.pool.on ? ' on' : ''}`}
                    disabled={!h.pool.bodyAvailable}
                    onClick={() => h.actions.togglePoolBody(!h.pool.on)}
                    aria-label="Toggle pool body"
                  ><span className="hp-toggle-thumb" /></button>
                  <span className="hp-toggle-lbl">{!h.pool.bodyAvailable ? '—' : h.pool.on ? 'ON' : 'OFF'}</span>
                </div>
                <button className="hp-cta" onClick={() => open(/pool/i)}>Open {chevron}</button>
              </div>
            </div>
          </div>

          {/* Security */}
          <div className="hp-card hp-security" onClick={() => open(/security|alarm/i)}>
            <div className="hp-card-inner">
              <div className="hp-card-top">
                <div className="hp-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-security)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg></div>
                <div className={`hp-arm-pill ${armReadout.cls}`}><span className="hp-arm-dot" />{armReadout.label}</div>
              </div>
              <div className="hp-card-body">
                <div className="hp-card-area">Cameras &amp; Sensors</div>
                <div className="hp-card-title">Security</div>
                <div className="hp-card-sum">{h.security.summary}</div>
              </div>
              <div className="hp-card-foot">
                <div className="hp-foot-data">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /></svg>
                  {h.security.openContacts > 0 ? `${h.security.openContacts} open` : 'Perimeter secure'}
                </div>
                <button className="hp-cta" onClick={() => open(/security|alarm/i)}>Open {chevron}</button>
              </div>
            </div>
          </div>

          {/* Climate */}
          <div className="hp-card hp-climate" onClick={() => open(/climate|air/i)}>
            <div className="hp-card-inner">
              <div className="hp-card-top">
                <div className="hp-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-climate)" strokeWidth="1.5" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg></div>
                {h.climate.action === 'cooling' || h.climate.action === 'heating'
                  ? <div className="hp-badge hp-badge-ok"><span className="hp-badge-dot" />{h.climate.action === 'cooling' ? 'Cooling' : 'Heating'}</div>
                  : <div className="hp-badge hp-badge-muted">{h.climate.available ? 'Idle' : '—'}</div>}
              </div>
              <div className="hp-card-body">
                <div className="hp-card-area">Whole Home · {h.climate.zoneCount} Zones</div>
                <div className="hp-card-title">Climate</div>
                <div className="hp-card-sum num">{h.climate.summary}</div>
              </div>
              <div className="hp-card-foot">
                <div className="hp-foot-data">
                  <span><span style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-primary)' }} className="num">{h.climate.avg !== null ? h.climate.avg : '—'}</span> <span style={{ fontSize: 13 }}>°F avg</span></span>
                </div>
                <button className="hp-cta" onClick={() => open(/climate|air/i)}>Open {chevron}</button>
              </div>
            </div>
          </div>

          {/* Lighting */}
          <div className="hp-card hp-lights" onClick={() => open(/light/i)}>
            <div className="hp-card-inner">
              <div className="hp-card-top">
                <div className="hp-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-lights)" strokeWidth="1.5" strokeLinecap="round"><line x1="9" y1="18" x2="15" y2="18" /><line x1="10" y1="22" x2="14" y2="22" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg></div>
                <div className="hp-badge hp-badge-lights"><span className="hp-badge-dot" />{h.lights.onCount} on</div>
              </div>
              <div className="hp-card-body">
                <div className="hp-card-area">Lutron QSX</div>
                <div className="hp-card-title">Lighting</div>
                <div className="hp-card-sum num">{h.lights.onCount} of {h.lights.total} on{h.activeScene ? ` · ${h.scenes.find((s) => s.id === h.activeScene)?.name ?? ''} scene` : ''}</div>
              </div>
              <div className="hp-card-foot">
                <div className="hp-lit-dots">
                  {h.lights.onNames.slice(0, 2).map((n) => (
                    <div className="hp-lit-item" key={n}><span className="hp-lit-dot" />{n}</div>
                  ))}
                  {h.lights.onCount > 2 && <div className="hp-lit-item" style={{ color: 'var(--text-dim)' }}><span className="hp-lit-dot off" />+{h.lights.onCount - 2}</div>}
                  {h.lights.onCount === 0 && <div className="hp-lit-item" style={{ color: 'var(--text-dim)' }}><span className="hp-lit-dot off" />All off</div>}
                </div>
                <button className="hp-cta" onClick={() => open(/light/i)}>Open {chevron}</button>
              </div>
            </div>
          </div>

          {/* Generator — honest unconnected (display-only) */}
          <div className="hp-card hp-generator" onClick={() => open(/generator/i)}>
            <div className="hp-card-inner">
              <div className="hp-card-top">
                <div className="hp-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-generator)" strokeWidth="1.5" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg></div>
                <div className="hp-badge hp-badge-muted">{h.generator.available ? 'Standby' : 'Awaiting creds'}</div>
              </div>
              <div className="hp-card-body">
                <div className="hp-card-area">Rehlko · Whole Home</div>
                <div className="hp-card-title" style={{ opacity: h.generator.available ? 1 : 0.78 }}>Generator</div>
                <div className="hp-card-sum num" style={{ color: h.generator.available ? undefined : 'var(--text-dim)' }}>{h.generator.available ? h.generator.summary : '— · Cloud account not connected'}</div>
              </div>
              <div className="hp-card-foot">
                <div className="hp-foot-data" style={{ color: 'var(--text-dim)' }}>Display only</div>
                <button className="hp-cta" onClick={() => open(/generator/i)}>Open {chevron}</button>
              </div>
            </div>
          </div>

          {/* AKVO — PREVIEW/commissioning, display-only, gated look */}
          <div className="hp-card hp-akvo" onClick={() => open(/akvo|floor/i)}>
            <div className="hp-card-inner">
              <div className="hp-card-top">
                <div className="hp-card-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-pool)" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /><line x1="6" y1="10" x2="18" y2="10" /><line x1="6" y1="13" x2="12" y2="13" /></svg></div>
                <div className="hp-badge hp-badge-muted">{h.akvo.present ? (h.akvo.fault ? 'Fault' : 'Gated') : 'Pending'}</div>
              </div>
              <div className="hp-card-body">
                <div className="hp-card-area">Movable Floor</div>
                <div className="hp-card-title" style={{ opacity: 0.7 }}>AKVO Floor</div>
                <div className="hp-card-sum num" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {h.akvo.present && h.akvo.position !== null ? `Depth ${h.akvo.position.toFixed(1)} ft · ` : ''}{h.akvo.summary}
                </div>
              </div>
              <div className="hp-card-foot" style={{ borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <div className="hp-foot-data" style={{ fontSize: 11, color: 'var(--text-dim)' }}>PLC-mediated · display only</div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <BottomSwitcher />
    </div>
  );
};

// Bottom area-switcher. Home item active; others link to sibling panels matched
// by name (inert if absent — never breaks when those panels don't exist).
const BottomSwitcher = () => {
  const { panels } = useDashboard();
  const findPanel = (re: RegExp) => panels.find((p) => re.test(p.name))?.id;
  const poolId = findPanel(/pool/i);
  const climateId = findPanel(/climate|air/i);
  const securityId = findPanel(/security|alarm/i);
  const lightsId = findPanel(/light/i);

  const NavLink = ({ to, label, active, children }: { to?: string; label: string; active?: boolean; children: React.ReactNode; }) => {
    const inner = (<><span className="hp-nav-ico">{children}</span><span className="hp-nav-label">{label}</span></>);
    const cls = `hp-nav${active ? ' active' : ''}`;
    return to ? <Link className={cls} to={`/dashboard/${to}`}>{inner}</Link> : <button className={cls} type="button">{inner}</button>;
  };

  return (
    <nav className="hp-switcher">
      <ArmingBar />
      <NavLink label="Home" active>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
      </NavLink>
      <NavLink to={poolId} label="Pool">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-pool)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12h2c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 7 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41h.34c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 13 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41H16c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 19 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.59.41" /></svg>
      </NavLink>
      <NavLink to={climateId} label="Climate">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-climate)" strokeWidth="1.5" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>
      </NavLink>
      <NavLink to={securityId} label="Security">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-security)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
      </NavLink>
      <NavLink to={lightsId} label="Lights">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-lights)" strokeWidth="1.5" strokeLinecap="round"><line x1="9" y1="18" x2="15" y2="18" /><line x1="10" y1="22" x2="14" y2="22" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg>
      </NavLink>
    </nav>
  );
};

export default HomePanel;
