import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePoolEntities, AKVO_PRESETS, type FixtureView, type BodyView } from './usePoolEntities';
import PanelShell from '../shell/PanelShell';
import { WeatherSafetyCard } from '../weather-safety/WeatherSafetyBanner';
import './poolPanel.css';

// ---------------------------------------------------------------------------
// PoolPanel — Increment 4 "design-tiles first" flagship compilation panel.
//
// A faithful, LIVE port of the locked blue-hour exemplar
//   daily/2026-06-09/design-direction/exemplar-pool-cool(-light).html
// into a real in-app panel. The three-column body mirrors the exemplar exactly:
//   • LEFT   Pool & Spa Controls — IntelliCenter bodies/waterfall + chem + pump.
//            EQUIPMENT-GATED: rendered with the live status + the gated treatment
//            (GATED badge), but NO actuation is wired (no switch.turn_on on a
//            body/heater/pump). Display + status only.
//   • CENTER Movable Floor — the AKVO card, display-only PREVIEW bound to the
//            REAL akvo custom component reads. Never actuable; presets are inert.
//   • RIGHT  Lighting · Pool Area — LOW-HAZARD live controls (pool/Lutron lights,
//            pool light effect, a cover shade). These DO actuate live.
// Persistent arming bar = REAL Alarmo (display-only). Bottom area-switcher.
//
// Scoping: all markup under `.pp-scope`, all CSS namespaced `pp-*`, so this
// panel never restyles the legacy dashboard or the other compilation panels.
// Mounted only for panels of kind 'pool' (Dashboard.tsx) — additive.
// ---------------------------------------------------------------------------

// ── arming bar (display-only) — derives look from real Alarmo state ─────────


// ── GATED body row — live STATUS + setpoint readout, NO actuation ───────────
// The setpoint arc + run toggle render the real state, but are inert: tapping
// them only flashes a "Gated" affordance (a confirm look), never a service call.
const GatedBodyRow = ({
  name, body, accent, showSetpoint = true, onGatedTap,
}: {
  name: string; body: BodyView; accent: string; showSetpoint?: boolean; onGatedTap: () => void;
}) => {
  const sp = body.setpoint;
  // arc geometry from the exemplar (270° sweep, dasharray 113)
  const ARC = 113;
  const frac = sp === null ? 0.5 : Math.max(0, Math.min(1, (sp - 60) / (110 - 60)));
  const dashOffset = ARC * (1 - frac);
  const meta = !body.available
    ? 'Unavailable'
    : showSetpoint
      ? `${body.on ? 'Running' : 'Standby'} · heater ${body.heating ? 'on' : 'off'}`
      : 'Water feature';

  return (
    <div className="pp-body-row">
      <div>
        <div className="pp-body-name">{name}</div>
        <div className="pp-body-meta">{meta}<span className="pp-gated-tag">Gated</span></div>
      </div>
      <div className="pp-body-controls">
        {showSetpoint && (
          <button className="pp-setpoint-arc" onClick={onGatedTap} title="Equipment-gated — setpoint is read-only here" aria-label={`${name} setpoint (gated)`}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <path d="M14 50 A 24 24 0 1 1 50 50" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" strokeLinecap="round" />
              <path d="M14 50 A 24 24 0 1 1 50 50" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={dashOffset} />
              <circle cx="50" cy="50" r="3.4" fill="#fff" />
            </svg>
            <div className="pp-arc-center">
              <div className="pp-setpoint-val num">{sp !== null ? `${Math.round(sp)}°` : '—'}</div>
              <div className="pp-setpoint-cap">Set</div>
            </div>
          </button>
        )}
        <div className="pp-toggle-stack">
          <button
            className={`pp-toggle-track ${body.on ? 'pp-toggle-on' : 'pp-toggle-off'}`}
            style={body.on ? { background: accent, boxShadow: `0 0 12px ${accent}55` } : undefined}
            onClick={onGatedTap}
            title="Equipment-gated — run state is read-only here"
            aria-label={`${name} run (gated)`}
          >
            <span className="pp-toggle-thumb" />
          </button>
          <div className="pp-toggle-cap">Run</div>
        </div>
      </div>
    </div>
  );
};

// ── a single LIVE dimming fixture row (low-hazard) ──────────────────────────
const FixtureRow = ({ light, onSet, onToggle, shade }: { light?: FixtureView; onSet: (lvl: number) => void; onToggle: () => void; shade?: boolean }) => {
  const [drag, setDrag] = useState<number | null>(null);
  if (!light) return null;
  const shown = drag ?? light.level;
  return (
    <div className="pp-fixture-row">
      <span className={`pp-fixture-name${light.on ? ' on' : ''}`} onClick={onToggle} title={light.available ? 'Toggle' : 'Unavailable'}>
        {light.name}
      </span>
      <div className="pp-fixture-ctl">
        <div className="pp-mini pp-slider">
          <div className="pp-track"><div className={`pp-fill${shade ? ' pp-fill-shade' : ''}`} style={{ width: `${light.on ? shown : 0}%` }} /></div>
          <input
            className="pp-range" type="range" min={0} max={100} value={light.on ? shown : 0}
            disabled={!light.available}
            onChange={(e) => setDrag(parseInt(e.target.value, 10))}
            onMouseUp={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            onTouchEnd={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            aria-label={`${light.name} brightness`}
          />
        </div>
        <span className="pp-mini-pct num" style={{ color: light.on ? undefined : 'var(--text-dim)' }}>
          {!light.available ? '—' : light.on ? `${shown}%` : 'Off'}
        </span>
      </div>
    </div>
  );
};

const fmtDepth = (m: number | null) => (m === null ? '—' : `${m.toFixed(2)} m`);

const PoolPanel = () => {
  const p = usePoolEntities();
  const [firedScene, setFiredScene] = useState<string | null>(null);
  const [gatedFlash, setGatedFlash] = useState<string | null>(null);
  const fireTimer = useRef<number | null>(null);
  const gateTimer = useRef<number | null>(null);
  const [shadeDrag, setShadeDrag] = useState<number | null>(null);

  useEffect(() => () => {
    if (fireTimer.current) window.clearTimeout(fireTimer.current);
    if (gateTimer.current) window.clearTimeout(gateTimer.current);
  }, []);

  const fireScene = (id: string) => {
    p.actions.activateScene(id);
    setFiredScene(id);
    if (fireTimer.current) window.clearTimeout(fireTimer.current);
    fireTimer.current = window.setTimeout(() => setFiredScene(null), 900);
  };

  // GATED tap — never actuates; flashes the confirm-gated affordance so the
  // surface reads as "this is a real, but equipment-protected, control".
  const gatedTap = (key: string) => {
    setGatedFlash(key);
    if (gateTimer.current) window.clearTimeout(gateTimer.current);
    gateTimer.current = window.setTimeout(() => setGatedFlash(null), 1600);
  };

  const fix = (id: string) => p.fixtures.find((f) => f.id === id);
  const shadePos = shadeDrag ?? p.shade.position;

  // chem chip helpers — color the bottom rule by simple in/out-of-range bands
  const phState = p.chem.ph === null ? 'na' : p.chem.ph >= 7.2 && p.chem.ph <= 7.8 ? 'ok' : 'warn';
  const orpState = p.chem.orp === null ? 'na' : p.chem.orp >= 650 ? 'ok' : 'warn';
  const saltState = p.chem.salt === null ? 'na' : 'ok';
  const swgState = p.chem.swg === null ? 'na' : p.chem.swg >= 80 ? 'warn' : 'ok';

  // AKVO depth bars (relative to a 2.7 m max travel like the exemplar)
  const MAX_DEPTH = 2.7;
  const mainPct = p.akvo.mainDepth === null ? 0 : Math.max(0, Math.min(100, (p.akvo.mainDepth / MAX_DEPTH) * 100));
  const bajaPct = p.akvo.bajaDepth === null ? 0 : Math.max(0, Math.min(100, (p.akvo.bajaDepth / MAX_DEPTH) * 100));

  const heroSummary = useMemo(() => {
    const bits: string[] = [];
    if (p.pump.rpm !== null) bits.push(`Main Pump ${p.pump.rpm.toLocaleString()} RPM`);
    if (p.pump.gpm !== null) bits.push(`${p.pump.gpm} GPM`);
    return bits.join(' · ');
  }, [p.pump.rpm, p.pump.gpm]);

  return (
    <PanelShell kind="pool">
    <div className="pp-scope">
      {p.status === 'stale' && <div className="pp-stale">Live feed stale — reconnecting…</div>}

      {/* ── Hero water canvas ── */}
      <div className="pp-hero">
        <div className="pp-hero-caustics" />
        <div className="pp-hero-horizon" />
        <div className="pp-hero-lines">
          <svg className="pp-water-line-svg" width="2800" height="200" viewBox="0 0 2800 200" fill="none">
            <path d="M0 60 C 140 45,280 75,420 60 S 700 45,840 60 S 1120 75,1260 60 S 1540 45,1680 60 S 1960 75,2100 60 S 2380 45,2520 60 S 2660 75,2800 60" stroke="rgba(58,181,212,0.6)" strokeWidth="1.5" fill="none" />
            <path d="M0 90 C 175 75,350 105,525 90 S 875 75,1050 90 S 1400 105,1575 90 S 1925 75,2100 90 S 2450 105,2625 90 S 2800 75,2800 90" stroke="rgba(58,181,212,0.3)" strokeWidth="1" fill="none" />
          </svg>
        </div>
        <div className="pp-hero-vignette" />

        <div className="pp-title-block">
          <div className="pp-hero-left">
            <div className="pp-eyebrow">Backyard · IntelliCenter</div>
            <div className="pp-title">Pool &amp; Spa</div>
            <div className="pp-sub">
              <span className={`pp-status-pill${p.poolActive ? '' : ' idle'}`}>
                <span className="pp-status-dot" />{p.poolActive ? 'Pool Active' : 'Pool Idle'}
              </span>
              {heroSummary && <span className="num">{heroSummary}</span>}
              {p.chem.swg !== null && <span className="num">SWG {Math.round(p.chem.swg)}%</span>}
            </div>
          </div>
          <div className="pp-hero-right">
            <div className={`pp-metric${p.pool.temp === null ? ' is-unavailable' : ''}`}>
              <div className="pp-metric-value num">{p.pool.temp !== null ? Math.round(p.pool.temp) : '—'}<span className="pp-metric-unit">{p.pool.unit}</span></div>
              <div className="pp-metric-label">Pool Temp</div>
            </div>
            <div className={`pp-metric${p.spa.temp === null ? ' is-unavailable' : ''}`}>
              <div className="pp-metric-value num">{p.spa.temp !== null ? Math.round(p.spa.temp) : '—'}<span className="pp-metric-unit">{p.spa.unit}</span></div>
              <div className="pp-metric-label">Spa Temp</div>
            </div>
            <div className={`pp-metric${p.chem.ph === null ? ' is-unavailable' : ''}`}>
              <div className="pp-metric-value num">{p.chem.ph !== null ? p.chem.ph.toFixed(1) : '—'}</div>
              <div className="pp-metric-label">pH</div>
            </div>
            <div className={`pp-metric${p.chem.orp === null ? ' is-unavailable' : ''}`}>
              <div className="pp-metric-value num">{p.chem.orp !== null ? Math.round(p.chem.orp) : '—'}<span className="pp-metric-unit">mV</span></div>
              <div className="pp-metric-label">ORP</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content: 1 wide primary + 2 satellites ── */}
      <div className="pp-content">

        {/* Freeze + storm protective card (feat/freeze-storm) — high relevance on
            the pool view (outdoor pool + AKVO floor). Renders only when active;
            display + notify/log only, protective actions stay IntelliCenter-/
            shade-controller-mediated. Yields to a life-safety takeover. */}
        <WeatherSafetyCard />

        {/* PRIMARY — Pool & Spa Controls (GATED) */}
        <div className="pp-card pp-card-primary">
          <div className="pp-card-label"><span className="pp-card-accent">Pool &amp; Spa · Controls</span><span>IntelliCenter</span></div>

          <GatedBodyRow name="Pool Body" body={p.pool} accent="var(--accent-pool)" onGatedTap={() => gatedTap('pool')} />
          <GatedBodyRow name="Spa Body" body={p.spa} accent="var(--accent-spa)" onGatedTap={() => gatedTap('spa')} />
          <GatedBodyRow name="Waterfall" body={{ available: p.waterfall.available, on: p.waterfall.on, temp: null, setpoint: null, heating: false, unit: '°F' }} accent="var(--accent-spa)" showSetpoint={false} onGatedTap={() => gatedTap('waterfall')} />

          {gatedFlash && (
            <div className="pp-gated-banner">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Equipment-gated — run, heat &amp; pump control require on-site authorization. Display only here.
            </div>
          )}

          {/* Chemistry chips */}
          <div className="pp-chem-row">
            <div className={`pp-chem-chip pp-chem-${phState}`}>
              <div className="pp-chem-value num">{p.chem.ph !== null ? p.chem.ph.toFixed(1) : '—'}</div>
              <div className="pp-chem-label">pH</div>
            </div>
            <div className={`pp-chem-chip pp-chem-${orpState}`}>
              <div className="pp-chem-value num">{p.chem.orp !== null ? Math.round(p.chem.orp) : '—'}</div>
              <div className="pp-chem-label">ORP mV</div>
            </div>
            <div className={`pp-chem-chip pp-chem-${saltState}`}>
              <div className="pp-chem-value num">{p.chem.salt !== null ? p.chem.salt.toLocaleString() : '—'}</div>
              <div className="pp-chem-label">Salt ppm</div>
            </div>
            <div className={`pp-chem-chip pp-chem-${swgState}`}>
              <div className="pp-chem-value num" style={swgState === 'warn' ? { color: 'var(--accent-warning)' } : undefined}>{p.chem.swg !== null ? `${Math.round(p.chem.swg)}%` : '—'}</div>
              <div className="pp-chem-label">SWG Out</div>
            </div>
          </div>

          {/* Pump telemetry (display) */}
          <div className="pp-pump-row">
            <span className="pp-pump-label">Main Pump · VSF<span className="pp-gated-tag">Gated</span></span>
            <div className="pp-pump-stats">
              <div className="pp-pump-stat"><span className="pp-pump-stat-value num">{p.pump.rpm !== null ? p.pump.rpm.toLocaleString() : '—'}</span><span className="pp-pump-stat-unit"> rpm</span></div>
              <div className="pp-pump-stat"><span className="pp-pump-stat-value num">{p.pump.gpm !== null ? p.pump.gpm : '—'}</span><span className="pp-pump-stat-unit"> gpm</span></div>
              <div className="pp-pump-stat"><span className="pp-pump-stat-value num">{p.pump.kw !== null ? p.pump.kw.toFixed(1) : '—'}</span><span className="pp-pump-stat-unit"> kW</span></div>
            </div>
          </div>
        </div>

        {/* SATELLITE — AKVO Movable Floor (PREVIEW / display-only) */}
        <div className="pp-card pp-akvo-card is-preview">
          <div className="pp-card-content-wrap">
            <div className="pp-card-label"><span>Movable Floor · AKVO</span><span>Display only</span></div>

            {/* cross-section */}
            <div className="pp-akvo-chart-wrap">
              <svg className="pp-akvo-chart-svg" height="196" viewBox="0 0 240 196" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="26" y1="30" x2="32" y2="30" stroke="rgba(255,255,255,0.30)" strokeWidth="1" />
                <text x="2" y="33" fill="rgba(255,255,255,0.32)" fontSize="8" fontFamily="DM Sans, sans-serif">0 m</text>
                <line x1="26" y1="120" x2="32" y2="120" stroke="rgba(58,181,212,0.8)" strokeWidth="1" />
                <text x="0" y="123" fill="rgba(58,181,212,0.8)" fontSize="8" fontFamily="DM Sans, sans-serif">{p.akvo.mainDepth !== null ? p.akvo.mainDepth.toFixed(2) : '1.97'}</text>
                <line x1="26" y1="168" x2="32" y2="168" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                <text x="0" y="171" fill="rgba(255,255,255,0.24)" fontSize="8" fontFamily="DM Sans, sans-serif">2.7 m</text>
                <path d="M32 30 L32 168 L226 168 L226 30" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <rect x="32" y="30" width="194" height="138" fill="rgba(58,181,212,0.08)" />
                <path d="M32 30 C 70 27, 110 33, 150 30 S 200 27, 226 30" stroke="rgba(58,181,212,0.5)" strokeWidth="1" fill="none" />
                {/* MAIN floor line — y mapped from depth */}
                <line x1="34" y1={30 + 138 * (mainPct / 100)} x2="224" y2={30 + 138 * (mainPct / 100)} stroke="var(--accent-pool)" strokeWidth="2.5" />
                {/* BAJA shelf line */}
                <line x1="150" y1={30 + 138 * (bajaPct / 100)} x2="224" y2={30 + 138 * (bajaPct / 100)} stroke="rgba(93,232,200,0.85)" strokeWidth="2" />
                <circle cx="52" cy="150" r="4" fill="rgba(93,201,138,0.5)" stroke="rgba(93,201,138,0.8)" strokeWidth="1" />
                <text x="60" y="153" fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="DM Sans, sans-serif">{p.akvo.mainCurrent !== null ? `${p.akvo.mainCurrent.toFixed(1)}A` : '—'}</text>
                <circle cx="180" cy="150" r="4" fill="rgba(93,201,138,0.5)" stroke="rgba(93,201,138,0.8)" strokeWidth="1" />
                <text x="188" y="153" fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="DM Sans, sans-serif">{p.akvo.bajaCurrent !== null ? `${p.akvo.bajaCurrent.toFixed(1)}A` : '—'}</text>
              </svg>
              <div className="pp-akvo-legend">
                <div className="pp-legend-item" style={{ top: `${Math.max(8, Math.min(92, bajaPct))}%` }}>
                  <span className="pp-legend-tick" style={{ background: 'rgba(93,232,200,0.85)' }} />
                  <span className="pp-legend-name" style={{ color: 'var(--accent-spa)' }}>Baja</span>
                  <span className="pp-legend-depth num" style={{ color: 'var(--accent-spa)' }}>{fmtDepth(p.akvo.bajaDepth)}</span>
                </div>
                <div className="pp-legend-item" style={{ top: `${Math.max(8, Math.min(92, mainPct))}%` }}>
                  <span className="pp-legend-tick" style={{ background: 'var(--accent-pool)' }} />
                  <span className="pp-legend-name" style={{ color: 'var(--accent-pool)' }}>Main</span>
                  <span className="pp-legend-depth num" style={{ color: 'var(--accent-pool)' }}>{fmtDepth(p.akvo.mainDepth)}</span>
                </div>
              </div>
            </div>

            {/* depth bars */}
            <div className="pp-depth-gauge">
              <div className="pp-depth-row">
                <span className="pp-depth-label">Main</span>
                <div className="pp-depth-bar-track"><div className="pp-depth-bar-fill" style={{ width: `${mainPct}%` }} /></div>
                <span className="pp-depth-value num" style={{ color: 'var(--accent-pool)' }}>{fmtDepth(p.akvo.mainDepth)}</span>
              </div>
              <div className="pp-depth-row">
                <span className="pp-depth-label">Baja</span>
                <div className="pp-depth-bar-track"><div className="pp-depth-bar-fill" style={{ width: `${bajaPct}%`, background: 'linear-gradient(90deg,var(--accent-spa),rgba(93,232,200,0.5))' }} /></div>
                <span className="pp-depth-value num" style={{ color: 'var(--accent-spa)' }}>{fmtDepth(p.akvo.bajaDepth)}</span>
              </div>
            </div>

            {/* preset requests — inert in preview (NEVER actuated) */}
            <div className="pp-akvo-preset-row">
              {AKVO_PRESETS.map((preset) => (
                <div className="pp-preset-btn" key={preset.label}>
                  <span className="pp-preset-btn-label">{preset.label}</span>
                  <div className="pp-preset-btn-depth num">{preset.depth}</div>
                </div>
              ))}
            </div>

            <div className="pp-akvo-safety-note">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>AKVO PLC validates every preset request. Presets are PLC-mediated requests, never direct motion.</span>
            </div>
          </div>

          <div className="pp-akvo-preview-overlay">
            <div className="pp-akvo-preview-chip">
              <span className="pp-preview-kicker">Preview</span>
              <span className="pp-preview-body">Hardware commissioning pending</span>
            </div>
          </div>
        </div>

        {/* SATELLITE — Lighting · Pool Area (LIVE, low-hazard) */}
        <div className="pp-card pp-lights-card">
          <div className="pp-card-label"><span>Lighting · Pool Area</span><span>Lutron + IntelliCenter</span></div>

          {p.scenes.map((s, i) => (
            <button
              key={s.id}
              className={`pp-scene-btn${firedScene === s.id ? ' active-scene' : ''}`}
              disabled={!s.available}
              onClick={() => fireScene(s.id)}
            >
              <span className="pp-scene-name">{s.name}</span>
              {firedScene === s.id ? <span className="pp-scene-hint">Activated</span> : i === 0 ? <span className="pp-scene-hint">Tap to set</span> : null}
            </button>
          ))}

          {p.poolLightEffects.length > 0 && (
            <button
              className="pp-effect-pill"
              onClick={() => {
                // cycle to the next effect — low-hazard pool light effect
                const list = p.poolLightEffects.filter((e) => e && e.toLowerCase() !== 'off');
                if (!list.length) return;
                const idx = p.poolLightEffect ? list.indexOf(p.poolLightEffect) : -1;
                p.actions.setPoolLightEffect(list[(idx + 1) % list.length]);
              }}
              title="Cycle pool light effect"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><path d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
              Pool light effect · {p.poolLightEffect || 'Color Swim'}
            </button>
          )}

          <div className="pp-fixture-list">
            <FixtureRow light={fix('light.pool_light')} onSet={(l) => p.actions.setLight('light.pool_light', l)} onToggle={() => p.actions.toggleLight('light.pool_light', !fix('light.pool_light')?.on)} />
            <FixtureRow light={fix('light.patio_overhead')} onSet={(l) => p.actions.setLight('light.patio_overhead', l)} onToggle={() => p.actions.toggleLight('light.patio_overhead', !fix('light.patio_overhead')?.on)} />
            <FixtureRow light={fix('light.patio_path')} onSet={(l) => p.actions.setLight('light.patio_path', l)} onToggle={() => p.actions.toggleLight('light.patio_path', !fix('light.patio_path')?.on)} />
            <FixtureRow light={fix('light.pool_cabana')} onSet={(l) => p.actions.setLight('light.pool_cabana', l)} onToggle={() => p.actions.toggleLight('light.pool_cabana', !fix('light.pool_cabana')?.on)} />

            {/* SHADE is a cover → position slider, labelled distinctly */}
            <div className="pp-fixture-row">
              <div>
                <span className="pp-fixture-name on">Patio Shade E</span>
                <div className="pp-fixture-kind">Shade · position</div>
              </div>
              <div className="pp-fixture-ctl">
                <div className="pp-mini pp-slider">
                  <div className="pp-track"><div className="pp-fill pp-fill-shade" style={{ width: `${shadePos}%` }} /></div>
                  <input
                    className="pp-range" type="range" min={0} max={100} value={shadePos}
                    disabled={!p.shade.available}
                    onChange={(e) => setShadeDrag(parseInt(e.target.value, 10))}
                    onMouseUp={() => { if (shadeDrag !== null) { p.actions.setShade(shadeDrag); setShadeDrag(null); } }}
                    onTouchEnd={() => { if (shadeDrag !== null) { p.actions.setShade(shadeDrag); setShadeDrag(null); } }}
                    aria-label="Patio Shade E position"
                  />
                </div>
                <span className="pp-mini-pct num">{p.shade.available ? `${shadePos}%` : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      
    </div>
    </PanelShell>
  );
};

export default PoolPanel;
