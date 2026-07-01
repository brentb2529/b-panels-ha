import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLightingEntities, type AreaView, type ShadeView } from './useLightingEntities';
import PanelShell from '../shell/PanelShell';
import './lightingPanel.css';

// ---------------------------------------------------------------------------
// LightingPanel — Increment 8 "design-tiles first" whole-home Lighting hub.
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-lighting-v14cool(-light).html
// (the near-achromatic "platinum" Lights identity) into a real in-app panel.
//
// Layout (per exemplar): a wide PRIMARY card (whole-home scenes on top + a
// by-area group-dimming grid — the core) and a RIGHT column (Shades & Covers +
// a DISPLAY-ONLY keypad LED diagnostic card). Persistent arming bar (REAL
// Alarmo, display-only) + bottom area-switcher.
//
// ── HAZARD POSTURE — LIVE but LOW-HAZARD ──
//   • Scenes (scene.turn_on / synthetic All Off), per-area group toggle + master
//     dim (light.turn_on/off + brightness_pct), and shades (cover.set_position)
//     are LIVE/low-hazard — wired through useLightingEntities.actions.
//   • The persistent arming bar reads the REAL alarm_control_panel.house via
//     useDashboard — DISPLAY-ONLY, no arm/disarm path here.
//   • Keypad LED state is DISPLAY-ONLY · DIAGNOSTIC. LED *control* is deferred /
//     equipment-gated, so we render LED state only — there is NO toggle.
//
// Scoping: all markup lives under `.ltp-scope` and all CSS is namespaced
// `ltp-*`, so this panel never restyles the legacy dashboard or any prior
// panel. Mounted only for compilationKind 'lighting' (see Dashboard.tsx).
// ---------------------------------------------------------------------------

// ── scene glyphs keyed by the curated icon name ─────────────────────────────
const SceneIcon = ({ name, active }: { name: string; active: boolean }) => {
  const stroke = active ? 'var(--accent-lights)' : 'var(--text-secondary)';
  // strokeWidth 1.5 normalised across all five for consistent visual weight
  const common = { className: 'ltp-scene-ico', viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round' as const };
  switch (name) {
    case 'sun':
      return (<svg {...common}><circle cx="12" cy="12" r="5" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="4" y1="12" x2="2" y2="12" /><line x1="22" y1="12" x2="20" y2="12" /><line x1="4.93" y1="4.93" x2="6.34" y2="6.34" /><line x1="17.66" y1="17.66" x2="19.07" y2="19.07" /></svg>);
    case 'house':
      return (<svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>);
    case 'moon':
      // Evening — clean single crescent moon
      return (<svg {...common}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>);
    case 'crescent':
      // Night — crescent moon + three filled star dots (distinct from Evening's
      // plain crescent). Dots are intentionally larger (r≥1.1) so they render
      // visibly at the 22px icon size. Positions placed in the open sky quadrant.
      return (
        <svg {...common}>
          <path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9z" />
          <circle cx="19.5" cy="4.5" r="1.30" fill={stroke} stroke="none" />
          <circle cx="22.0" cy="8.5" r="1.00" fill={stroke} stroke="none" />
          <circle cx="17.0" cy="2.6" r="0.85" fill={stroke} stroke="none" />
        </svg>
      );
    case 'power':
    default:
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><line x1="12" y1="12" x2="12" y2="4" /></svg>);
  }
};

// ── per-area group tile: toggle + master dim + "N of M on" (LIVE/low-hazard) ──
const AreaTile = ({
  area, onToggle, onDim,
}: { area: AreaView; onToggle: (on: boolean) => void; onDim: (level: number) => void }) => {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? area.brightness;
  const off = area.available ? area.onCount === 0 : true;

  return (
    <div className={`ltp-area-tile${area.available ? '' : ' ltp-area-unavail'}`}>
      <div className="ltp-area-top">
        <span className="ltp-area-name">{area.name}</span>
        <button
          type="button"
          className={`ltp-area-toggle ${area.anyOn ? 'ltp-at-on' : 'ltp-at-off'}`}
          disabled={!area.available}
          onClick={() => onToggle(!area.anyOn)}
          aria-label={`${area.name} lights ${area.anyOn ? 'off' : 'on'}`}
          title={area.available ? `Toggle ${area.name} lights` : 'No fixtures available'}
        >
          <span className="ltp-at-thumb" />
        </button>
      </div>
      <div className="ltp-area-dim-row">
        <div className="ltp-area-slider">
          <div className="ltp-area-track">
            <div className={off ? 'ltp-area-fill-off' : 'ltp-area-fill'} style={{ width: off ? 0 : `${shown}%` }} />
          </div>
          <input
            className="ltp-area-range" type="range" min={0} max={100}
            value={off ? 0 : shown}
            disabled={!area.available}
            onChange={(e) => setDrag(parseInt(e.target.value, 10))}
            onMouseUp={() => { if (drag !== null) { onDim(drag); setDrag(null); } }}
            onTouchEnd={() => { if (drag !== null) { onDim(drag); setDrag(null); } }}
            aria-label={`${area.name} master brightness`}
          />
        </div>
        <span className="ltp-area-count num" style={off ? { color: 'var(--text-dim)' } : undefined}>
          {area.onCount}/{area.total}
        </span>
      </div>
    </div>
  );
};

// ── shade position row (LIVE) ────────────────────────────────────────────────
const ShadeRow = ({ shade, onSet }: { shade: ShadeView; onSet: (pos: number) => void }) => {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? shade.position;
  return (
    <div className="ltp-shade-row">
      <span className="ltp-shade-name" title={shade.name}>{shade.name}</span>
      <div className="ltp-shade-ctl">
        <div className="ltp-shade-slider">
          <div className="ltp-shade-track"><div className="ltp-shade-fill" style={{ width: `${shown}%` }} /></div>
          <input
            className="ltp-shade-range" type="range" min={0} max={100}
            value={shown}
            disabled={!shade.available}
            onChange={(e) => setDrag(parseInt(e.target.value, 10))}
            onMouseUp={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            onTouchEnd={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
            aria-label={`${shade.name} position`}
          />
        </div>
        <span className="ltp-shade-pct num" style={shade.available ? undefined : { color: 'var(--text-dim)' }}>
          {shade.available ? `${shown}%` : '—'}
        </span>
      </div>
    </div>
  );
};

const LightingPanel = () => {
  const l = useLightingEntities();
  const [firedScene, setFiredScene] = useState<string | null>(null);
  const fireTimer = useRef<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [masterDrag, setMasterDrag] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { if (fireTimer.current) window.clearTimeout(fireTimer.current); }, []);
  void now;

  const fireScene = (id: string) => {
    l.actions.activateScene(id);
    setFiredScene(id);
    if (fireTimer.current) window.clearTimeout(fireTimer.current);
    fireTimer.current = window.setTimeout(() => setFiredScene(null), 1400);
  };

  const heroSummary = useMemo(() => {
    const last = l.lastScene ? `Last scene: ${l.lastScene.name} · ${l.lastScene.clock}` : 'No scene activated yet';
    return last;
  }, [l.lastScene]);

  // ── Whole-home master brightness (average of ON areas) ──
  const masterBrightness = useMemo(() => {
    const onAreas = l.areas.filter((a) => a.available && a.anyOn);
    if (!onAreas.length) return 0;
    return Math.round(onAreas.reduce((s, a) => s + a.brightness, 0) / onAreas.length);
  }, [l.areas]);
  const shownMaster = masterDrag ?? masterBrightness;
  const masterOff = !l.areas.some((a) => a.anyOn);
  const masterAvail = l.areas.some((a) => a.available);
  const applyMasterBrightness = (level: number) => {
    l.areas.filter((a) => a.available).forEach((a) => l.actions.setAreaBrightness(a.name, level));
  };

  return (
    <PanelShell kind="lighting">
    <div className="ltp-scope">
      {l.status === 'stale' && <div className="ltp-stale">Live feed stale — reconnecting…</div>}

      {/* ── Hero ── */}
      <div className="ltp-hero">
        <div className="ltp-hero-canvas" />
        <div className="ltp-hero-streak" />
        <div className="ltp-hero-vignette" />
        <div className="ltp-hero-title-block">
          <div className="ltp-hero-left">
            <div className="ltp-hero-eyebrow">Whole Home · Lutron QSX</div>
            <div className="ltp-hero-title">Lighting</div>
            <div className="ltp-hero-sub">
              <div className="ltp-hero-pill"><span className="ltp-hero-dot" />{l.onTotal} of {l.fixtureTotal} on</div>
              <span className="num">{l.areas.length} areas · {l.shadesCount} shades</span>
              <span>{heroSummary}</span>
            </div>
          </div>
          <div className="ltp-hero-right">
            <div className="ltp-hero-metric"><div className="ltp-hero-metric-value num">{l.onTotal}</div><div className="ltp-hero-metric-label">On / {l.fixtureTotal}</div></div>
            <div className="ltp-hero-metric"><div className="ltp-hero-metric-value num">{l.scenesCount}</div><div className="ltp-hero-metric-label">Scenes</div></div>
            <div className="ltp-hero-metric"><div className="ltp-hero-metric-value num">{l.shadesCount}</div><div className="ltp-hero-metric-label">Shades</div></div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="ltp-content">

        {/* PRIMARY — whole-home scenes + per-area group dimming (the core) */}
        <div className="ltp-card ltp-primary-card">
          <div className="ltp-card-label"><span className="ltp-card-accent">Whole-Home Scenes</span><span>scene.turn_on</span></div>
          <div className="ltp-scene-row">
            {l.scenes.map((s) => {
              const justFired = firedScene === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`ltp-scene-pill${justFired ? ' ltp-scene-fired' : ''}`}
                  disabled={!s.available}
                  onClick={() => fireScene(s.id)}
                  title={s.available ? `Activate ${s.name}` : `${s.name} not available`}
                >
                  <SceneIcon name={s.icon} active={justFired} />
                  <div className="ltp-scene-nm">{s.name}</div>
                  <div className="ltp-scene-hint">
                    {justFired ? 'activated' : s.lastActivated ? `last ${s.lastActivated}` : '—'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Whole-Home Brightness master row ── */}
          <div className="ltp-master-row">
            <span className="ltp-master-label">All Areas</span>
            <div className="ltp-master-slider">
              <div className="ltp-master-track">
                <div
                  className={masterOff ? 'ltp-master-fill-off' : 'ltp-master-fill'}
                  style={{ width: masterOff ? 0 : `${shownMaster}%` }}
                />
              </div>
              <input
                className="ltp-master-range"
                type="range" min={0} max={100}
                value={masterOff ? 0 : shownMaster}
                disabled={!masterAvail}
                onChange={(e) => setMasterDrag(parseInt(e.target.value, 10))}
                onMouseUp={() => { if (masterDrag !== null) { applyMasterBrightness(masterDrag); setMasterDrag(null); } }}
                onTouchEnd={() => { if (masterDrag !== null) { applyMasterBrightness(masterDrag); setMasterDrag(null); } }}
                aria-label="Whole-home master brightness"
              />
            </div>
            <span className="ltp-master-pct num">
              {masterAvail ? (masterOff ? 'Off' : `${shownMaster}%`) : '—'}
            </span>
          </div>

          <div className="ltp-sub-label">By Area · group dimming</div>
          <div className="ltp-area-grid">
            {l.areas.map((a) => (
              <AreaTile
                key={a.name}
                area={a}
                onToggle={(on) => l.actions.toggleArea(a.name, on)}
                onDim={(level) => l.actions.setAreaBrightness(a.name, level)}
              />
            ))}
          </div>
        </div>

        {/* RIGHT — Shades & Covers (LIVE) */}
        <div className="ltp-right-col">
          <div className="ltp-card ltp-shades-card">
            <div className="ltp-card-label"><span>Shades &amp; Covers</span><span>cover.set_position</span></div>
            {l.shades.map((sh) => (
              <ShadeRow key={sh.id} shade={sh} onSet={(pos) => l.actions.setShade(sh.id, pos)} />
            ))}
          </div>
        </div>
      </div>

    </div>
    </PanelShell>
  );
};

export default LightingPanel;
