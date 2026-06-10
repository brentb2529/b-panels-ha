import React, { useEffect, useRef, useState } from 'react';
import { useWeatherSafety } from './useWeatherSafety';
import { useTakeoverActive } from '../takeover/takeoverSignal';
import {
  SEVERITY_LABEL, fmtExpires, fmtSince,
  type WeatherSafetyView, type WeatherSafetyConfig,
} from './weatherSafety';
import './weatherSafety.css';

// ---------------------------------------------------------------------------
// WeatherSafetyBanner — the GLOBAL, LOWER-TIER freeze + storm protection
// announcement (feat/freeze-storm). PROTECTIVE · DISPLAY + NOTIFY/LOG ONLY.
//
// Mounted ONCE below the life-safety takeover (App.tsx), so it surfaces on
// EVERY panel — a freeze/storm condition is whole-house context. It is a calm,
// non-alarm banner (NEVER the red life-safety wash). It is explicitly LOWER tier
// than the life-safety takeover:
//
//   • The projection sets `suppressedByLifeSafety` from the SAME alarm entity
//     the takeover reads (panel triggered → yield).
//   • Belt-and-suspenders: we ALSO subscribe to the takeover-active signal and
//     render nothing while a takeover (fire/CO/gas/intrusion) is on screen.
//
// ── HARD POSTURE — NO EQUIPMENT ACTUATION ──
// There is NO callService import in this tier, by construction. The "extra
// circulation" / "retract exterior shades" affordances are RECOMMENDED +
// confirm-gated; pressing them updates LOCAL state only and issues ZERO
// pump/shade/valve/AKVO service calls. Any real protective action stays
// equipment-mediated (IntelliCenter / shade controller) behind human approval.
// Push-notify is a documented follow-up (see report).
// ---------------------------------------------------------------------------

// ── glyphs (line-art, never color-alone) ──
const SnowGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />
    <line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" />
  </svg>
);
const StormGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9" /><polyline points="13 11 9 17 15 17 11 23" />
  </svg>
);
const LockGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

// A single recommended, confirm-gated protective action. Wires NOTHING — it
// updates local "acknowledged" state and shows the gated note. Real actuation
// is IntelliCenter/shade-controller-mediated behind human approval.
const RecommendedAction = ({ label, detail }: { label: string; detail: string }) => {
  const [open, setOpen] = useState(false);
  const [acked, setAcked] = useState(false);
  return (
    <div className="wxs-rec">
      {!open ? (
        <button type="button" className="wxs-rec-cta" onClick={() => setOpen(true)}>
          <LockGlyph /> {label}
        </button>
      ) : acked ? (
        <div className="wxs-rec-note"><LockGlyph /> Noted — equipment-mediated · no actuation fired here.</div>
      ) : (
        <div className="wxs-rec-confirm">
          <span className="wxs-rec-detail">{detail}</span>
          <div className="wxs-rec-row">
            <button type="button" className="wxs-rec-btn ghost" onClick={() => setOpen(false)}>Dismiss</button>
            {/* GATED: render only — wires NO pump/shade/valve service. */}
            <button type="button" className="wxs-rec-btn" onClick={() => setAcked(true)}>Acknowledge</button>
          </div>
        </div>
      )}
    </div>
  );
};

// The freeze + storm protective content (shared between the banner + the
// in-panel card). `compact` trims it for the banner strip.
export const WeatherSafetyBody = ({ view, nowMs }: { view: WeatherSafetyView; nowMs: number }) => {
  const { freeze, storm } = view;
  return (
    <>
      {storm.active && (
        <div className="wxs-row wxs-row-storm">
          <div className="wxs-ico" aria-hidden><StormGlyph /></div>
          <div className="wxs-row-text">
            <div className="wxs-row-head">
              <span className="wxs-event">{storm.event}</span>
              <span className={`wxs-sev wxs-sev-${storm.severity}`}>{SEVERITY_LABEL[storm.severity]}</span>
              {storm.count > 1 && <span className="wxs-count">{storm.count} active</span>}
            </div>
            {storm.headline && <div className="wxs-headline">{storm.headline}</div>}
            <div className="wxs-meta">
              {storm.expiresIso ? fmtExpires(storm.expiresIso, nowMs) : 'In effect for your area'}
              <span className="wxs-src"> · weather alert by location</span>
            </div>
            <RecommendedAction
              label="Retract exterior shades?"
              detail="Recommended: retract patio/exterior shades ahead of high wind. Shade controller-mediated — confirm-only, no actuation fires here."
            />
          </div>
        </div>
      )}

      {freeze.active && (
        <div className="wxs-row wxs-row-freeze">
          <div className="wxs-ico" aria-hidden><SnowGlyph /></div>
          <div className="wxs-row-text">
            <div className="wxs-row-head">
              <span className="wxs-event">Freeze protection active</span>
              <span className="wxs-sev wxs-sev-freeze">Pool</span>
            </div>
            <div className="wxs-headline">
              Circulation running to protect plumbing &amp; equipment.
              {freeze.sinceIso ? ` Since ${fmtSince(freeze.sinceIso)}.` : ''}
            </div>
            <div className="wxs-meta">
              {freeze.name}
              <span className="wxs-src"> · IntelliCenter freeze sensor</span>
            </div>
            <RecommendedAction
              label="Extra circulation?"
              detail="Recommended: run extra pool/spa circulation while temperatures are low. IntelliCenter-mediated (drives the pump) — confirm-only, no actuation fires here."
            />
          </div>
        </div>
      )}
    </>
  );
};

interface Props {
  config?: WeatherSafetyConfig;
  /** Notifies the parent whether the weather-safety tier is active (for logging
   *  / future push hook). */
  onActiveChange?: (active: boolean) => void;
}

const WeatherSafetyBanner = ({ config, onActiveChange }: Props) => {
  const view = useWeatherSafety(config);
  const takeoverActive = useTakeoverActive(); // belt-and-suspenders yield
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // EFFECTIVELY active = projection active AND no life-safety takeover on screen.
  const effectiveActive = view.active && !takeoverActive;

  // LOG hook: on each transition into an active weather-safety condition, log it
  // (console today; the documented follow-up is a push-notify via HA notify.*).
  useEffect(() => {
    if (!effectiveActive) { loggedRef.current = null; onActiveChange?.(false); return; }
    const key = `${view.kind}|${view.storm.event}|${view.freeze.active}`;
    if (loggedRef.current !== key) {
      loggedRef.current = key;
      // eslint-disable-next-line no-console
      console.info('[weather-safety] active:', {
        kind: view.kind,
        storm: view.storm.active ? { event: view.storm.event, severity: view.storm.severity, expires: view.storm.expiresIso } : null,
        freeze: view.freeze.active ? { entity: view.freeze.entityId, since: view.freeze.sinceIso } : null,
      });
    }
    onActiveChange?.(true);
  }, [effectiveActive, view.kind, view.storm.active, view.storm.event, view.storm.severity, view.storm.expiresIso, view.freeze.active, view.freeze.entityId, view.freeze.sinceIso, onActiveChange]);

  // Re-show the banner whenever the active condition changes (a new alert/freeze
  // shouldn't stay hidden because an earlier one was dismissed).
  useEffect(() => { setDismissed(false); }, [view.kind, view.storm.event]);

  if (!effectiveActive || dismissed) return null;

  const isFreezeOnly = view.kind === 'freeze';
  const title = view.kind === 'storm+freeze'
    ? 'Weather protection'
    : view.kind === 'storm'
    ? 'Severe weather alert'
    : 'Freeze protection';

  return (
    <div className={`wxs-scope${isFreezeOnly ? ' wxs-freeze-only' : ''}`}>
      <div className="wxs-banner" role="status" aria-live="polite">
        <div className="wxs-banner-head">
          <span className="wxs-kicker">Protective · monitoring</span>
          <span className="wxs-title">{title}</span>
          <button type="button" className="wxs-dismiss" aria-label="Dismiss banner" onClick={() => setDismissed(true)}>×</button>
        </div>
        <WeatherSafetyBody view={view} nowMs={nowMs} />
        <div className="wxs-foot">
          <LockGlyph />
          Surface &amp; log only · protective actions stay equipment-mediated (no pump/shade/valve fired) · life-safety always outranks this
        </div>
      </div>
    </div>
  );
};

export default WeatherSafetyBanner;

// ---------------------------------------------------------------------------
// WeatherSafetyCard — the in-panel (Home / Pool) protective card variant.
// Renders INLINE (not fixed-position) inside a panel's flow when a freeze/storm
// is active, reusing the exact `WeatherSafetyBody` rows. Same hard posture:
// DISPLAY + NOTIFY/LOG ONLY, no callService, yields to a life-safety takeover.
// Returns null when nothing is active (additive — panels are unchanged at rest).
// ---------------------------------------------------------------------------
export const WeatherSafetyCard = ({ config }: { config?: WeatherSafetyConfig }) => {
  const view = useWeatherSafety(config);
  const takeoverActive = useTakeoverActive(); // belt-and-suspenders yield
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const effectiveActive = view.active && !takeoverActive;
  if (!effectiveActive) return null;

  const isFreezeOnly = view.kind === 'freeze';
  const title = view.kind === 'storm+freeze'
    ? 'Weather protection'
    : view.kind === 'storm'
    ? 'Severe weather alert'
    : 'Freeze protection';

  return (
    <div className={`wxs-scope wxs-scope-inline${isFreezeOnly ? ' wxs-freeze-only' : ''}`}>
      <div className="wxs-card" role="status" aria-live="polite">
        <div className="wxs-banner-head">
          <span className="wxs-kicker">Protective · monitoring</span>
          <span className="wxs-title">{title}</span>
        </div>
        <WeatherSafetyBody view={view} nowMs={nowMs} />
        <div className="wxs-foot">
          <LockGlyph />
          Surface &amp; log only · protective actions stay equipment-mediated · life-safety always outranks this
        </div>
      </div>
    </div>
  );
};
