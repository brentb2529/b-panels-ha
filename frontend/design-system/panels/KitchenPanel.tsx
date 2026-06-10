import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard } from '../../hooks/useDashboard';
import { useKitchenEntities, type LightView } from './useKitchenEntities';
import './kitchenPanel.css';

// ---------------------------------------------------------------------------
// KitchenPanel — Increment 2 "design-tiles first" compilation panel.
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-room-kitchen-cool(-light).html
// into a real in-app panel. Every value is bound to a real dev HA entity via
// useKitchenEntities (subscribeEntities + callService). The persistent arming
// bar is bound to the REAL alarm_control_panel.house (Alarmo) through
// useDashboard()'s alarmState/armingState — DISPLAY-ONLY in this increment (it
// reads state and colors itself; it offers no arm/disarm control).
//
// Scoping: all markup lives under `.kp-scope` and all CSS is namespaced `kp-*`,
// so this panel never restyles the legacy dashboard or the 22 legacy tiles. It
// is mounted only for panels of kind 'compilation:kitchen' (see Dashboard.tsx),
// leaving every existing grid panel untouched.
// ---------------------------------------------------------------------------

// ── small inline icon set (mirrors the exemplar's SVGs) ────────────────────
const SceneIcons: Record<string, React.ReactNode> = {
  Morning: (
    <svg className="kp-scene-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /></svg>
  ),
  Cook: (
    <svg className="kp-scene-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>
  ),
  Dine: (
    <svg className="kp-scene-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2" /><path d="M5 11v11" /><path d="M19 2v20" /><path d="M19 9c0-3-2-5-2-7" /></svg>
  ),
  'Clean Up': (
    <svg className="kp-scene-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
  ),
};

const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// ── arming bar (display-only) — derives look from real Alarmo state ─────────
const ArmingBar = () => {
  const { alarmState, armingState } = useDashboard();

  // No alarm entity present: keep the slot but show a neutral readout (honest).
  const phase = alarmState?.phase ?? 'idle';
  const arm = alarmState?.armState ?? 'disarmed';

  let cls = 'kp-arm-ready';
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
    cls = 'kp-arm-notready';
    state = 'Alarm · Unavailable';
    sub = 'No alarm panel connected';
    pulse = false;
    shieldStroke = 'var(--sem-notready)';
  } else if (phase === 'triggered' || alarmState.securityState === 'VIOLATION') {
    cls = 'kp-arm-triggered';
    state = 'Intrusion';
    sub = alarmState.trigger?.name ? `Triggered · ${alarmState.trigger.name}` : 'Alarm triggered';
    shieldStroke = 'var(--sem-triggered)';
  } else if (arm === 'armedAway') {
    cls = 'kp-arm-away';
    state = 'Armed · Away';
    sub = 'Perimeter + interior armed';
    pulse = false;
    shieldStroke = 'var(--sem-armed-away)';
  } else if (arm === 'armedStay') {
    cls = 'kp-arm-stay';
    state = 'Armed · Stay';
    sub = 'Perimeter armed · home';
    pulse = false;
    shieldStroke = 'var(--sem-armed-stay)';
  } else {
    // disarmed — readiness from the live sensor list
    if (armingState === 'not_ready') {
      cls = 'kp-arm-notready';
      state = 'Disarmed · Not Ready';
      const open = alarmState.haOpenSensors ? Object.keys(alarmState.haOpenSensors).length : 0;
      sub = open > 0 ? `${open} sensor${open === 1 ? '' : 's'} open` : 'Some sensors open';
      shieldStroke = 'var(--sem-notready)';
    } else {
      cls = 'kp-arm-ready';
      state = 'Disarmed · Ready';
      sub = 'All sensors clear · ready to arm';
      shieldStroke = 'var(--sem-ready)';
    }
  }

  return (
    <div className={`kp-arming ${cls}`} title={`Alarm: ${state}`}>
      <div className="kp-arming-shield">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={shieldStroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {shieldPath}
        </svg>
      </div>
      <div className="kp-arming-text">
        <span className="kp-arming-state"><span className={`kp-arming-dot${pulse ? ' pulse' : ''}`} />{state}</span>
        <span className="kp-arming-sub">{sub}</span>
      </div>
    </div>
  );
};

// ── a single dimming fixture row ────────────────────────────────────────────
const FixtureRow = ({ light, onSet, onToggle }: { light: LightView; onSet: (lvl: number) => void; onToggle: () => void }) => {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? light.level;
  return (
    <div className="kp-fixture-row">
      <span className={`kp-fixture-name${light.on ? ' on' : ''}`} onClick={onToggle} title={light.available ? 'Toggle' : 'Unavailable'}>
        {light.name}
      </span>
      <div className="kp-fixture-ctl">
        <div className="kp-mini kp-slider">
          <div className="kp-track"><div className="kp-fill" style={{ width: `${light.on ? shown : 0}%` }} /></div>
          <input
            className="kp-range" type="range" min={0} max={100} value={light.on ? shown : 0}
            disabled={!light.available}
            onChange={(e) => setDrag(parseInt(e.target.value, 10))}
            onMouseUp={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            onTouchEnd={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            aria-label={`${light.name} brightness`}
          />
        </div>
        <span className="kp-mini-pct num" style={{ color: light.on ? undefined : 'var(--text-dim)' }}>
          {!light.available ? '—' : light.on ? `${shown}%` : 'Off'}
        </span>
      </div>
    </div>
  );
};

const KitchenPanel = () => {
  const k = useKitchenEntities();
  const [firedScene, setFiredScene] = useState<string | null>(null);
  const fireTimer = useRef<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [shadeDrag, setShadeDrag] = useState<number | null>(null);
  const [groupDrag, setGroupDrag] = useState<number | null>(null);
  const [volDrag, setVolDrag] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { if (fireTimer.current) window.clearTimeout(fireTimer.current); }, []);

  const fireScene = (id: string) => {
    k.actions.activateScene(id);
    setFiredScene(id);
    if (fireTimer.current) window.clearTimeout(fireTimer.current);
    fireTimer.current = window.setTimeout(() => setFiredScene(null), 900);
  };

  const timeStr = useMemo(() => {
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return { hm: `${h}:${String(now.getMinutes()).padStart(2, '0')}`, ampm };
  }, [now]);

  const c = k.climate;
  const setpoint = c.setpoint ?? 72;
  const current = c.current ?? setpoint;
  // arc geometry from the exemplar (270° sweep, dasharray 259)
  const ARC = 259;
  const arcFrac = Math.max(0, Math.min(1, (setpoint - 60) / (85 - 60)));
  const dashOffset = ARC * (1 - arcFrac);

  const modeShown = (c.mode || 'off').toLowerCase();
  const isSlave = c.hasGatingInfo && !c.isMaster;
  const modeLabel = (m: string) => (m === 'heat_cool' || m === 'auto' ? 'Auto' : m.charAt(0).toUpperCase() + m.slice(1));
  const heatActive = modeShown === 'heat';

  const groupBright = groupDrag ?? k.roomBrightness;
  const shadePos = shadeDrag ?? k.shade.position;
  const vol = volDrag ?? k.media.volume;

  return (
    <div className="kp-scope">
      {k.status === 'stale' && <div className="kp-stale">Live feed stale — reconnecting…</div>}

      {/* ── Hero ── */}
      <div className="kp-hero">
        <div className="kp-hero-streak" />
        <div className="kp-hero-vignette" />
        <div className="kp-title-block">
          <div className="kp-hero-left">
            <div className="kp-eyebrow">
              Bensten Residence · Room
              <span className="kp-home-badge">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                This panel's home
              </span>
            </div>
            <div className="kp-title">Kitchen</div>
            <div className="kp-sub">
              <span className="kp-status-pill"><span className="kp-status-dot" />{k.lightsOnCount} of {k.lightsTotal} lights on</span>
              <span className="num">{c.current !== null ? `${Math.round(c.current)}°F` : '—'} · {c.action === 'cooling' ? 'Cooling' : c.action === 'heating' ? 'Heating' : modeLabel(modeShown)}</span>
              <span>{timeStr.hm}{timeStr.ampm === 'AM' ? 'a' : 'p'}</span>
            </div>
          </div>
          <div className="kp-hero-right">
            <div className="kp-metric">
              <div className="kp-metric-value num">{c.current !== null ? Math.round(c.current) : '—'}<span className="kp-metric-unit">°F</span></div>
              <div className="kp-metric-label">Zone temp</div>
            </div>
            <div className="kp-metric">
              <div className="kp-metric-value num">{k.lightsOnCount}</div>
              <div className="kp-metric-label">Lights on</div>
            </div>
            <div className="kp-metric">
              <div className="kp-metric-value num">{timeStr.hm}</div>
              <div className="kp-metric-label">{timeStr.ampm}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="kp-content">
        {/* PRIMARY — scenes + group */}
        <div className="kp-card kp-card-primary">
          <div className="kp-card-label"><span className="kp-card-accent">Kitchen · Scenes</span><span>Walk up &amp; tap</span></div>
          <div className="kp-scene-grid">
            {k.scenes.map((s) => (
              <button
                key={s.id}
                className={`kp-scene${firedScene === s.id ? ' just-fired' : ''}`}
                disabled={!s.available}
                onClick={() => fireScene(s.id)}
                style={{ color: firedScene === s.id ? 'var(--accent-room)' : 'var(--text-secondary)' }}
              >
                {SceneIcons[s.name]}
                <div>
                  <div className="kp-scene-name">{s.name}</div>
                  <div className="kp-scene-meta">{firedScene === s.id ? 'Activated' : s.meta}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="kp-group-row">
            <div>
              <div className="kp-group-title">All Kitchen Lights</div>
              <div className="kp-group-sub num">{k.lightsOnCount} of {k.lightsTotal} on · group control</div>
            </div>
            <button
              className={`kp-toggle ${k.groupOn ? 'on' : 'off'}`}
              disabled={!k.groupAvailable}
              onClick={() => k.actions.toggleGroup(!k.groupOn)}
              aria-label="Toggle all kitchen lights"
            >
              <span className="kp-toggle-thumb" />
            </button>
          </div>

          <div className="kp-room-dimmer">
            <div className="kp-dim-head"><span className="kp-dim-label">Room brightness</span><span className="kp-dim-pct num">{groupBright}%</span></div>
            <div className="kp-slider">
              <div className="kp-track"><div className="kp-fill" style={{ width: `${groupBright}%` }} /></div>
              <input
                className="kp-range" type="range" min={0} max={100} value={groupBright}
                onChange={(e) => setGroupDrag(parseInt(e.target.value, 10))}
                onMouseUp={() => { if (groupDrag !== null) { k.actions.setGroupBrightness(groupDrag); setGroupDrag(null); } }}
                onTouchEnd={() => { if (groupDrag !== null) { k.actions.setGroupBrightness(groupDrag); setGroupDrag(null); } }}
                aria-label="Room brightness"
              />
            </div>
          </div>
        </div>

        {/* SATELLITE — climate */}
        <div className="kp-card">
          <div className="kp-card-label"><span>Kitchen · Climate</span><span>Airzone</span></div>
          <div className="kp-zone-arc-wrap">
            <div className="kp-zone-arc">
              <svg width="150" height="150" viewBox="0 0 150 150">
                <path d="M30 120 A 55 55 0 1 1 120 120" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" strokeLinecap="round" />
                <path d="M30 120 A 55 55 0 1 1 120 120" fill="none" stroke="var(--accent-climate)" strokeWidth="9" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={dashOffset} />
                <circle cx="120" cy="120" r="5.5" fill="#fff" />
              </svg>
              <div className="kp-arc-center">
                <div className="kp-zone-cur num">{Math.round(current)}<span className="deg">°</span></div>
                <div className="kp-zone-set num">Set {Math.round(setpoint)}° · {c.action === 'cooling' ? 'cooling' : c.action === 'heating' ? 'heating' : modeLabel(modeShown).toLowerCase()}</div>
              </div>
            </div>
          </div>

          {/* setpoint is always adjustable, even on a slave zone (per exemplar foot) */}
          <div className="kp-setpoint-row">
            <button className="kp-step-btn" disabled={!c.available} onClick={() => k.actions.setSetpoint(Math.round(setpoint) - 1)} aria-label="Lower setpoint">−</button>
            <span className="kp-zone-set num">Setpoint {Math.round(setpoint)}°</span>
            <button className="kp-step-btn" disabled={!c.available} onClick={() => k.actions.setSetpoint(Math.round(setpoint) + 1)} aria-label="Raise setpoint">+</button>
          </div>

          <div className="kp-zone-mode-head">
            <span className="kp-zone-mode-cap">Mode</span>
            {isSlave && (
              <span className="kp-zone-lock-note">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Set on master · {c.masterZone}
              </span>
            )}
          </div>
          <div className={`kp-zone-mode-row${isSlave ? ' gated' : ''}`}>
            {['cool', 'heat', 'auto', 'off'].map((m) => {
              const active = (m === modeShown) || (m === 'auto' && (modeShown === 'heat_cool' || modeShown === 'auto'));
              const cls = active ? (m === 'heat' ? 'kp-zone-mode shown-heat' : 'kp-zone-mode shown') : 'kp-zone-mode';
              return (
                <div key={m} className={cls} title={isSlave ? 'Mode is set on the master zone' : 'Mode read-back (setpoint-only this increment)'}>
                  {m === 'auto' ? 'Auto' : m.charAt(0).toUpperCase() + m.slice(1)}
                </div>
              );
            })}
          </div>
          <div className="kp-zone-foot">
            <span className="num">Humidity {c.humidity !== null ? `${Math.round(c.humidity)}%` : '—'}</span>
            <span>{isSlave ? 'Slave zone · setpoint adjustable' : 'Setpoint adjustable'}</span>
          </div>
        </div>

        {/* SATELLITE — lights + shades + media */}
        <div className="kp-card">
          <div className="kp-card-label"><span>Kitchen · Lights &amp; Shades</span><span>Lutron</span></div>
          {k.lights.map((l) => (
            <FixtureRow
              key={l.id}
              light={l}
              onSet={(lvl) => k.actions.setLight(l.id, lvl)}
              onToggle={() => l.available && k.actions.toggleLight(l.id, !l.on)}
            />
          ))}

          <div className="kp-sub-label">Shades · position</div>
          <div className="kp-fixture-row">
            <div><span className="kp-fixture-name on">Window Shade N</span><div className="kp-fixture-kind">Cover</div></div>
            <div className="kp-fixture-ctl">
              <div className="kp-mini kp-slider">
                <div className="kp-track"><div className="kp-fill kp-fill-shade" style={{ width: `${shadePos}%` }} /></div>
                <input
                  className="kp-range" type="range" min={0} max={100} value={shadePos}
                  disabled={!k.shade.available}
                  onChange={(e) => setShadeDrag(parseInt(e.target.value, 10))}
                  onMouseUp={() => { if (shadeDrag !== null) { k.actions.setShade(shadeDrag); setShadeDrag(null); } }}
                  onTouchEnd={() => { if (shadeDrag !== null) { k.actions.setShade(shadeDrag); setShadeDrag(null); } }}
                  aria-label="Window Shade N position"
                />
              </div>
              <span className="kp-mini-pct num">{shadePos}%</span>
            </div>
          </div>

          {/* media — live Sonos now-playing */}
          <div className="kp-media">
            <div className="kp-media-now">
              <div className="kp-media-art" style={k.media.albumArt ? { backgroundImage: `url(${k.media.albumArt})` } : undefined}>
                {!k.media.albumArt && <div className="kp-media-art-stub" />}
                <div className="kp-media-art-gloss" />
              </div>
              <div className="kp-media-txt">
                <div className="kp-media-title">{k.media.title}</div>
                <div className="kp-media-artist">{k.media.artist}</div>
                <div className="kp-media-src"><span className="kp-media-dot" />{k.media.source}</div>
              </div>
              <div className="kp-media-transport">
                <button className="kp-tp" onClick={k.actions.mediaPrev} aria-label="Previous"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)" stroke="none"><polygon points="19 20 9 12 19 4" /><rect x="5" y="4" width="2.5" height="16" rx="1" /></svg></button>
                <button className="kp-tp play" onClick={k.actions.mediaPlayPause} aria-label="Play/Pause">
                  {k.media.playing
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="#0B0F14" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="#0B0F14" stroke="none"><polygon points="7 4 19 12 7 20" /></svg>}
                </button>
                <button className="kp-tp" onClick={k.actions.mediaNext} aria-label="Next"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)" stroke="none"><polygon points="5 4 15 12 5 20" /><rect x="16.5" y="4" width="2.5" height="16" rx="1" /></svg></button>
              </div>
            </div>
            <div className="kp-media-prog">
              <span className="kp-media-time num">{fmtTime(k.media.position)}</span>
              <div className="kp-track" style={{ height: 4 }}><div className="kp-fill" style={{ width: `${k.media.duration ? Math.min(100, (k.media.position / k.media.duration) * 100) : 0}%` }} /></div>
              <span className="kp-media-time num">{fmtTime(k.media.duration)}</span>
            </div>
            <div className="kp-media-foot">
              <div className="kp-media-vol">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a9 9 0 0 1 0 14" /></svg>
                <div className="kp-slider" style={{ flex: 1 }}>
                  <div className="kp-track" style={{ height: 5 }}><div className="kp-fill" style={{ width: `${vol}%` }} /></div>
                  <input
                    className="kp-range" type="range" min={0} max={100} value={vol}
                    disabled={!k.media.available}
                    onChange={(e) => setVolDrag(parseInt(e.target.value, 10))}
                    onMouseUp={() => { if (volDrag !== null) { k.actions.setVolume(volDrag); setVolDrag(null); } }}
                    onTouchEnd={() => { if (volDrag !== null) { k.actions.setVolume(volDrag); setVolDrag(null); } }}
                    aria-label="Volume"
                  />
                </div>
                <span className="kp-vol-pct num">{vol}</span>
              </div>
              <div className="kp-group-chip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="7" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" /><path d="M16 14a4 4 0 0 1 4 4v2" /></svg>
                + Group rooms
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom switcher ── */}
      <BottomSwitcher />
    </div>
  );
};

// Bottom area-switcher. Nav items link to sibling panels when present (matched
// by name), else are inert affordances — never breaking if those panels don't
// exist in the current config.
const BottomSwitcher = () => {
  const { panels } = useDashboard();
  const findPanel = (re: RegExp) => panels.find((p) => re.test(p.name))?.id;
  const homeId = findPanel(/home|overview|main/i);
  const poolId = findPanel(/pool/i);
  const climateId = findPanel(/climate|air/i);
  const securityId = findPanel(/security|alarm/i);
  const lightsId = findPanel(/light/i);

  const NavLink = ({ to, label, active, children }: { to?: string; label: string; active?: boolean; children: React.ReactNode; }) => {
    const inner = (
      <>
        <span className="kp-nav-ico">{children}</span>
        <span className="kp-nav-label">{label}</span>
      </>
    );
    const cls = `kp-nav${active ? ' active' : ''}${label === 'Rooms' ? ' kp-nav-rooms' : ''}`;
    return to ? <Link className={cls} to={`/dashboard/${to}`}>{inner}</Link> : <button className={cls} type="button">{inner}</button>;
  };

  return (
    <nav className="kp-switcher">
      <ArmingBar />
      <NavLink to={homeId} label="Home">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
      </NavLink>
      <NavLink label="Rooms" active>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-room)" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
      </NavLink>
      <NavLink to={poolId} label="Pool">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12h2c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 7 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41h.34c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 13 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41H16c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 19 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.59.41" /></svg>
      </NavLink>
      <NavLink to={climateId} label="Climate">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>
      </NavLink>
      <NavLink to={securityId} label="Security">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
      </NavLink>
      <NavLink to={lightsId} label="Lights">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinecap="round"><line x1="9" y1="18" x2="15" y2="18" /><line x1="10" y1="22" x2="14" y2="22" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg>
      </NavLink>
      <div className="kp-rooms-hub">
        <div className="kp-rh-grid"><span /><span /><span /><span /></div>
        <span className="rh-label">All Rooms</span>
      </div>
    </nav>
  );
};

export default KitchenPanel;
