import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePrimarySuiteEntities, type LightView, type ClimateMode } from './usePrimarySuiteEntities';
import { useDashboard } from '../../hooks/useDashboard';
import PanelShell from '../shell/PanelShell';
import { useIsThisPanelHome } from '../shell/usePanelDefault';
import './primarySuitePanel.css';

// ---------------------------------------------------------------------------
// PrimarySuitePanel — Increment 6 "design-tiles first" room compilation panel.
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-room-primary-suite-v14cool(-light).html
// into a real in-app panel — the restful/private-weighted sibling of the
// Kitchen room view. Every value is bound to a real dev HA entity via
// usePrimarySuiteEntities (subscribeEntities + callService). The persistent
// arming bar is bound to the REAL alarm_control_panel.house (Alarmo) through
// useDashboard()'s alarmState/armingState — DISPLAY-ONLY (it reads state and
// colors itself; it offers no arm/disarm control). When armed_home it shows the
// contextual "Armed · Stay" the exemplar depicts; otherwise its real state.
//
// SAFETY POSTURE: lights/scenes/blackout-shade position + the Primary Suite
// climate setpoint AND mode are all LIVE, LOW-HAZARD comfort controls (NOT
// equipment-gated). The suite zone is a MASTER per the Climate topology, so it
// gets FULL Cool/Heat/Auto/Off mode control. No equipment-gated tiles here.
//
// Scoping: all markup lives under `.ps-scope` and all CSS is namespaced `ps-*`,
// so this panel never restyles the legacy dashboard or the 22 legacy tiles. It
// is mounted only for panels of kind 'compilation:primary-suite' (see
// Dashboard.tsx), leaving every existing grid panel untouched.
// ---------------------------------------------------------------------------

// ── scene icon set (mirrors the exemplar's SVGs) ───────────────────────────
const SceneIcons: Record<string, React.ReactNode> = {
  Wake: (
    <svg className="ps-scene-ico" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bedside)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2m14 0h2M18.4 5.6l-1.4 1.4" /><path d="M12 8a4 4 0 0 0 0 8" /><path d="M12 8a4 4 0 0 1 0 8" /></svg>
  ),
  Read: (
    <svg className="ps-scene-ico" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><path d="M4 19V5a1 1 0 0 1 1-1h10a4 4 0 0 1 4 4v11" /><path d="M4 13h15" /><path d="M8 4v9" /></svg>
  ),
  Relax: (
    <svg className="ps-scene-ico" viewBox="0 0 24 24" fill="none" stroke="var(--accent-room)" strokeWidth="1.5" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
  ),
  Goodnight: (
    <svg className="ps-scene-ico" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9z" /><circle cx="17" cy="6" r="0.6" fill="currentColor" /><circle cx="20" cy="9" r="0.5" fill="currentColor" /></svg>
  ),
};

// ── small inline shade-window graphic ──────────────────────────────────────
// Shows a cross-section window with a shade fabric dropping from the top.
// position 0 = fully closed (fabric covers all glass),
// position 100 = fully open (fabric retracted, glass visible).
const ShadeGraphic = ({ position }: { position: number }) => {
  const glasH = 26; // glass interior height (SVG units)
  const glasY = 4;  // glass top Y
  const clampedPos = Math.max(0, Math.min(100, position));
  // how many SVG units the fabric covers (from top of glass downward)
  const shadeH = Math.round(((100 - clampedPos) / 100) * glasH);
  const isPartiallyOpen = shadeH > 0 && shadeH < glasH;
  return (
    <svg className="ps-shade-gfx" width="24" height="34" viewBox="0 0 24 34" fill="none" aria-hidden="true">
      {/* window frame */}
      <rect x="1.5" y="1.5" width="21" height="31" rx="2.5"
        stroke="rgba(157,184,214,0.45)" strokeWidth="1.5"
        fill="rgba(157,184,214,0.05)" />
      {/* glass area — brighter when open gap is visible */}
      <rect x="3.5" y={glasY} width="17" height={glasH}
        fill={isPartiallyOpen ? 'rgba(180,210,240,0.22)' : 'rgba(157,184,214,0.07)'} />
      {/* shade fabric — covers from top downward */}
      {shadeH > 0 && (
        <rect x="3.5" y={glasY} width="17" height={shadeH}
          fill="rgba(157,184,214,0.42)" />
      )}
      {/* bottom rod at lower edge of the fabric */}
      {shadeH > 0 && (
        <rect x="3.5" y={glasY + shadeH - 1.5} width="17" height="2.5"
          fill="rgba(157,184,214,0.72)" rx="1" />
      )}
    </svg>
  );
};

const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// ── arming bar (display-only) — derives look from real Alarmo state ─────────


// ── a single bedside / cove dimming fixture row ─────────────────────────────
const FixtureRow = ({ light, onSet, onToggle }: { light: LightView; onSet: (lvl: number) => void; onToggle: () => void }) => {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? light.level;
  return (
    <div className="ps-fixture-row">
      <span className={`ps-fixture-name${light.on ? ' on' : ''}`} onClick={onToggle} title={light.available ? 'Toggle' : 'Unavailable'}>
        {light.name}
      </span>
      <div className="ps-fixture-ctl">
        <div className="ps-mini ps-slider">
          <div className="ps-track"><div className="ps-fill" style={{ width: `${light.on ? shown : 0}%` }} /></div>
          <input
            className="ps-range" type="range" min={0} max={100} value={light.on ? shown : 0}
            disabled={!light.available}
            onChange={(e) => setDrag(parseInt(e.target.value, 10))}
            onMouseUp={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            onTouchEnd={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            aria-label={`${light.name} brightness`}
          />
        </div>
        <span className="ps-mini-pct num" style={{ color: light.on ? undefined : 'var(--text-dim)' }}>
          {!light.available ? '—' : light.on ? `${shown}%` : 'Off'}
        </span>
      </div>
    </div>
  );
};

const PrimarySuitePanel = () => {
  const s = usePrimarySuiteEntities();
  // Per-DEVICE default: badge shows only when this device lands on this panel.
  const { activePanelId } = useDashboard();
  const isThisPanelHome = useIsThisPanelHome(activePanelId);
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
    s.actions.activateScene(id);
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

  const c = s.climate;
  const setpoint = c.setpoint ?? 70;
  const current = c.current ?? setpoint;
  // arc geometry from the exemplar (270° sweep, dasharray 259)
  const ARC = 259;
  const lo = c.minTemp ?? 60;
  const hi = c.maxTemp ?? 85;
  const arcFrac = Math.max(0, Math.min(1, (setpoint - lo) / (hi - lo)));
  const dashOffset = ARC * (1 - arcFrac);

  const modeShown = c.mode;
  const actionLabel = c.action === 'cooling' ? 'cooling' : c.action === 'heating' ? 'heating' : modeShown;

  const groupBright = groupDrag ?? s.roomBrightness;
  const shadePos = shadeDrag ?? s.shade.position;
  const vol = volDrag ?? s.media.volume;

  // shade presets (exemplar: Closed / Privacy / Open) → live set_position
  const SHADE_PRESETS: { label: string; pos: number }[] = [
    { label: 'Closed', pos: 0 },
    { label: 'Privacy', pos: 45 },
    { label: 'Open', pos: 100 },
  ];
  const activePreset = SHADE_PRESETS.reduce((best, p) =>
    Math.abs(p.pos - shadePos) < Math.abs(best.pos - shadePos) ? p : best, SHADE_PRESETS[0]);

  const modeLabel = (m: ClimateMode) => (m === 'auto' ? 'Auto' : m.charAt(0).toUpperCase() + m.slice(1));
  const MODES: ClimateMode[] = ['cool', 'heat', 'auto', 'off'];

  return (
    <PanelShell kind="primary-suite">
    <div className="ps-scope">
      {s.status === 'stale' && <div className="ps-stale">Live feed stale — reconnecting…</div>}

      {/* ── Hero ── */}
      <div className="ps-hero">
        <div className="ps-hero-streak" />
        <div className="ps-hero-vignette" />
        <div className="ps-title-block">
          <div className="ps-hero-left">
            <div className="ps-eyebrow">
              Bensten Residence · Room
              {isThisPanelHome && (
              <span className="ps-home-badge">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                This panel's home
              </span>
              )}
            </div>
            <div className="ps-title">Primary Suite</div>
            <div className="ps-sub">
              <span className="ps-status-pill"><span className="ps-status-dot" />{s.lightsOnCount} of {s.lightsTotal} lights{s.lightsOnCount > 0 ? ` · ${groupBright < 40 ? 'low' : groupBright < 75 ? 'medium' : 'bright'}` : ''}</span>
              <span className="num">{c.current !== null ? `${Math.round(c.current)}°F` : '—'} · {actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)}</span>
              <span>{timeStr.hm}{timeStr.ampm === 'AM' ? 'a' : 'p'}</span>
            </div>
          </div>
          <div className="ps-hero-right">
            <div className="ps-metric">
              <div className="ps-metric-value num">{c.current !== null ? Math.round(c.current) : '—'}<span className="ps-metric-unit">°F</span></div>
              <div className="ps-metric-label">Zone temp</div>
            </div>
            <div className="ps-metric">
              <div className="ps-metric-value num">{s.lightsOnCount}</div>
              <div className="ps-metric-label">Lights on</div>
            </div>
            <div className="ps-metric">
              <div className="ps-metric-value num">{timeStr.hm}</div>
              <div className="ps-metric-label">{timeStr.ampm}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="ps-content">
        {/* PRIMARY — rest-weighted scenes + Suite Lights group + brightness master */}
        <div className="ps-card ps-card-primary">
          <div className="ps-card-label"><span className="ps-card-accent">Suite · Scenes</span><span>Walk up &amp; tap</span></div>
          <div className="ps-scene-grid">
            {s.scenes.map((sc) => (
              <button
                key={sc.id}
                className={`ps-scene${firedScene === sc.id ? ' just-fired' : ''}`}
                disabled={!sc.available}
                onClick={() => fireScene(sc.id)}
              >
                {SceneIcons[sc.name]}
                <div>
                  <div className="ps-scene-name">{sc.name}</div>
                  <div className="ps-scene-meta">{firedScene === sc.id ? 'Activated' : sc.meta}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="ps-group-row">
            <div>
              <div className="ps-group-title">Suite Lights</div>
              <div className="ps-group-sub num">{s.lightsOnCount} of {s.lightsTotal} on · group control</div>
            </div>
            <button
              className={`ps-toggle ${s.groupOn ? 'on' : 'off'}`}
              disabled={!s.groupAvailable}
              onClick={() => s.actions.toggleGroup(!s.groupOn)}
              aria-label="Toggle all suite lights"
            >
              <span className="ps-toggle-thumb" />
            </button>
          </div>

          <div className="ps-room-dimmer">
            <div className="ps-dim-head"><span className="ps-dim-label">Suite brightness</span><span className="ps-dim-pct num">{s.lightsOnCount > 0 ? `${groupBright}%` : 'Off'}</span></div>
            <div className="ps-slider">
              <div className="ps-track"><div className="ps-fill" style={{ width: `${groupBright}%` }} /></div>
              <input
                className="ps-range" type="range" min={0} max={100} value={groupBright}
                onChange={(e) => setGroupDrag(parseInt(e.target.value, 10))}
                onMouseUp={() => { if (groupDrag !== null) { s.actions.setGroupBrightness(groupDrag); setGroupDrag(null); } }}
                onTouchEnd={() => { if (groupDrag !== null) { s.actions.setGroupBrightness(groupDrag); setGroupDrag(null); } }}
                aria-label="Suite brightness"
              />
            </div>
          </div>
        </div>

        {/* SATELLITE — climate (Primary Suite = MASTER zone, full mode) */}
        <div className="ps-card">
          <div className="ps-card-label"><span>Suite · Climate</span><span>Airzone · master</span></div>
          <div className="ps-zone-arc-wrap">
            <div className="ps-zone-arc">
              <svg width="150" height="150" viewBox="0 0 150 150">
                <path d="M30 120 A 55 55 0 1 1 120 120" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" strokeLinecap="round" />
                <path d="M30 120 A 55 55 0 1 1 120 120" fill="none" stroke="var(--accent-climate)" strokeWidth="9" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={dashOffset} />
                <circle cx="120" cy="120" r="5.5" fill="#fff" />
              </svg>
              <div className="ps-arc-center">
                <div className="ps-zone-cur num">{Math.round(current)}<span className="deg">°</span></div>
                <div className="ps-zone-set num">Set {Math.round(setpoint)}° · {actionLabel}</div>
              </div>
            </div>
          </div>

          <div className="ps-setpoint-row">
            <button className="ps-step-btn" disabled={!c.available} onClick={() => s.actions.setSetpoint(Math.round(setpoint) - 1)} aria-label="Lower setpoint">−</button>
            <span className="ps-zone-set num">Setpoint {Math.round(setpoint)}°</span>
            <button className="ps-step-btn" disabled={!c.available} onClick={() => s.actions.setSetpoint(Math.round(setpoint) + 1)} aria-label="Raise setpoint">+</button>
          </div>

          {/* MASTER zone → full mode control (Cool / Heat / Auto / Off) */}
          <div className="ps-zone-mode-row">
            {MODES.map((m) => {
              const active = m === modeShown;
              const cls = active ? (m === 'heat' ? 'ps-zone-mode active-heat' : 'ps-zone-mode active') : 'ps-zone-mode';
              return (
                <button
                  key={m}
                  className={cls}
                  disabled={!c.available}
                  onClick={() => s.actions.setHvacMode(m)}
                  title={`Set mode ${modeLabel(m)}`}
                >
                  {modeLabel(m)}
                </button>
              );
            })}
          </div>
          <div className="ps-zone-foot">
            <span className="num">Humidity {c.humidity !== null ? `${Math.round(c.humidity)}%` : '—'}</span>
            <span>Master zone · fan auto</span>
          </div>
        </div>

        {/* SATELLITE — blackout shade (priority) + bedside lights + media */}
        <div className="ps-card">
          <div className="ps-card-label"><span>Suite · Shades &amp; Lights</span><span>Lutron</span></div>

          {/* BLACKOUT SHADE prominent */}
          <div className="ps-shade-block">
            <div className="ps-shade-head">
              <span className="ps-shade-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-shade)" strokeWidth="1.6" strokeLinecap="round"><rect x="4" y="3" width="16" height="14" rx="1" /><path d="M4 9h16" /><path d="M9 17v3M15 17v3" /></svg>
                Blackout Shade
              </span>
              {/* graphic + percentage: visual shade state at a glance */}
              <div className="ps-shade-right">
                <ShadeGraphic position={shadePos} />
                <span className="ps-shade-pct num">{s.shade.available ? `${shadePos}%` : '—'}</span>
              </div>
            </div>
            <div className="ps-slider">
              <div className="ps-track"><div className="ps-fill ps-fill-shade" style={{ width: `${shadePos}%` }} /></div>
              <input
                className="ps-range" type="range" min={0} max={100} value={shadePos}
                disabled={!s.shade.available}
                onChange={(e) => setShadeDrag(parseInt(e.target.value, 10))}
                onMouseUp={() => { if (shadeDrag !== null) { s.actions.setShade(shadeDrag); setShadeDrag(null); } }}
                onTouchEnd={() => { if (shadeDrag !== null) { s.actions.setShade(shadeDrag); setShadeDrag(null); } }}
                aria-label="Blackout shade position"
              />
            </div>
            <div className="ps-shade-presets">
              {SHADE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`ps-shade-preset${s.shade.available && activePreset.label === p.label ? ' active' : ''}`}
                  disabled={!s.shade.available}
                  onClick={() => { setShadeDrag(null); s.actions.setShade(p.pos); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* bedside + cove lights */}
          {s.lights.map((l) => (
            <FixtureRow
              key={l.id}
              light={l}
              onSet={(lvl) => s.actions.setLight(l.id, lvl)}
              onToggle={() => l.available && s.actions.toggleLight(l.id, !l.on)}
            />
          ))}

          {/* media — live Sonos now-playing */}
          <div className="ps-media">
            <div className="ps-media-now">
              <div className="ps-media-art" style={s.media.albumArt ? { backgroundImage: `url(${s.media.albumArt})` } : undefined}>
                {!s.media.albumArt && <div className="ps-media-art-stub" />}
                <div className="ps-media-art-gloss" />
              </div>
              <div className="ps-media-txt">
                <div className="ps-media-title">{s.media.title}</div>
                <div className="ps-media-artist">{s.media.artist}</div>
                <div className="ps-media-src"><span className="ps-media-dot" />{s.media.source}</div>
              </div>
              <div className="ps-media-transport">
                <button className="ps-tp play" onClick={s.actions.mediaPlayPause} aria-label="Play/Pause">
                  {s.media.playing
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="#0B0F14" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="#0B0F14" stroke="none"><polygon points="7 4 19 12 7 20" /></svg>}
                </button>
              </div>
            </div>
            <div className="ps-media-foot">
              <div className="ps-media-vol">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
                <div className="ps-slider" style={{ flex: 1 }}>
                  <div className="ps-track" style={{ height: 5 }}><div className="ps-fill" style={{ width: `${vol}%` }} /></div>
                  <input
                    className="ps-range" type="range" min={0} max={100} value={vol}
                    disabled={!s.media.available}
                    onChange={(e) => setVolDrag(parseInt(e.target.value, 10))}
                    onMouseUp={() => { if (volDrag !== null) { s.actions.setVolume(volDrag); setVolDrag(null); } }}
                    onTouchEnd={() => { if (volDrag !== null) { s.actions.setVolume(volDrag); setVolDrag(null); } }}
                    aria-label="Volume"
                  />
                </div>
                <span className="ps-vol-pct num">{vol}</span>
              </div>
              <div className="ps-group-chip">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="7" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" /></svg>
                Solo
              </div>
            </div>
          </div>
        </div>

        {/* ── Suite status footer — spans all 3 columns, fills the 4:3 void ── */}
        <div className="ps-footer">
          <span className="ps-footer-item">
            {/* thermometer */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-climate)" strokeWidth="1.7" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>
            <span className="ps-footer-val num">{c.current !== null ? `${Math.round(c.current)}°` : '—'}</span>
            <span className="ps-footer-dim">· {actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)}</span>
          </span>
          <span className="ps-footer-sep" aria-hidden="true" />
          <span className="ps-footer-item">
            {/* bulb */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bedside)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 5 11.92V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2.08A7 7 0 0 1 12 2z" /></svg>
            <span className="ps-footer-val">{s.lightsOnCount > 0 ? `${s.lightsOnCount} light${s.lightsOnCount !== 1 ? 's' : ''}` : 'Lights off'}</span>
            {s.lightsOnCount > 0 && <span className="ps-footer-dim num">· {groupBright}%</span>}
          </span>
          <span className="ps-footer-sep" aria-hidden="true" />
          <span className="ps-footer-item">
            {/* speaker */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
            <span className="ps-footer-val">{s.media.playing ? s.media.title : 'Quiet'}</span>
            {s.media.playing && <span className="ps-footer-dim">· {s.media.artist}</span>}
          </span>
        </div>
      </div>

      {/* ── Bottom switcher ── */}
      
    </div>
    </PanelShell>
  );
};

export default PrimarySuitePanel;
