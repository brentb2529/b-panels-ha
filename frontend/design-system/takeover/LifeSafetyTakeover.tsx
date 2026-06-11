import React, { useEffect, useState } from 'react';
import { useLifeSafetyTakeover } from './useLifeSafetyTakeover';
import { COPY, fmtClock, fmtRelative, type TakeoverType, type TakeoverView } from './lifeSafety';
import './takeover.css';

// ---------------------------------------------------------------------------
// LifeSafetyTakeover — the GLOBAL, scope-overriding, non-dismissible alarm
// annunciation overlay (Increment 10). SAFETY-CRITICAL · GATED.
//
// Mounted ONCE at the top of the render tree (above the scoped router — see
// App.tsx), so it renders on EVERY panel/device/route, including PIN-locked and
// pool-only/guest scoped panels. A whole-house fire alarm shows on a pool-only
// panel; life-safety is NEVER scoped out (FIRE_LIFE_SAFETY_REVIEW §5).
//
// ── HARD SAFETY POSTURE — DISPLAY + ANNUNCIATION ONLY ──
// There is NO callService import anywhere in this module, by construction. Every
// control rendered here — the intrusion DISARM keypad, the "Silence local sound"
// button, the "Cancel dispatch" link, the Acknowledge button — wires ZERO
// service calls. They update only LOCAL component state (e.g. an "acknowledged"
// flag, a typed-but-discarded PIN buffer) and issue NO alarm_arm_*/alarm_disarm,
// NO Noonlight create/cancel, NO lock/cover. Enabling any of that is an
// equipment + security human-escalation and is explicitly OUT OF SCOPE.
//
// The takeover is driven PURELY by the REAL alarm_control_panel.house state
// (+ its open_sensors attribute) via the global subscription in
// useLifeSafetyTakeover — never by local UI.
//
// ── suppressIdleReturn ──
// The overlay reports whether a takeover is active so the shell's idle-return
// can be suppressed (idle must never navigate away from an active life-safety
// annunciation). App.tsx mirrors `view.active` into a global the shell reads.
// ---------------------------------------------------------------------------

// ── distinct glyph SHAPE per type (never color-alone) ───────────────────────
const TypeGlyph = ({ type }: { type: TakeoverType }) => {
  const bright = 'var(--lst-crit-bright)';
  switch (type) {
    case 'fire':
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 L22 20 L2 20 Z" fill="rgba(229,72,77,0.18)" stroke={bright} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M12 8c1.6 1.6 2.4 3 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-.7.3-1.3.8-1.9-.1 1 .6 1.5 1 1.5.5 0 .9-.5.8-1.3-.1-1 0-1.8 0-2.7z" fill={bright} />
        </svg>
      );
    case 'co':
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 L22 20 L2 20 Z" fill="rgba(214,35,51,0.18)" stroke={bright} strokeWidth="1.4" strokeLinejoin="round" />
          <text x="12" y="18" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="8" fontWeight="700" fill={bright}>CO</text>
        </svg>
      );
    case 'gas':
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 L22 20 L2 20 Z" fill="rgba(229,72,77,0.18)" stroke={bright} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M12 9c1.4 1.2 2 2.3 2 3.4a2 2 0 0 1-4 0c0-.6.2-1.1.6-1.6-.1.8.4 1.2.8 1.2.4 0 .7-.4.6-1z" fill={bright} />
          <text x="12" y="19" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize="5.5" fontWeight="700" fill={bright}>GAS</text>
        </svg>
      );
    case 'intrusion':
      return (
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={bright} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12.5" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case 'evacuate':
    default:
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 L22 20 L2 20 Z" fill="rgba(229,72,77,0.18)" stroke={bright} strokeWidth="1.4" strokeLinejoin="round" />
          <line x1="12" y1="9" x2="12" y2="14" stroke={bright} strokeWidth="2" strokeLinecap="round" /><line x1="12" y1="17" x2="12.01" y2="17" stroke={bright} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
};

const InfoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);
const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

// ── Multiplicity string: "2 — Garage, Kitchen" ──────────────────────────────
const multiplicityText = (view: TakeoverView): string => {
  const names = view.matchingSensors.map((s) => s.name);
  if (names.length === 0) return view.initiatingZone ?? '—';
  return `${names.length} — ${names.join(', ')}`;
};

// ── LIFE-SAFETY (fire / CO / gas / evacuate) variant ────────────────────────
const LifeSafetyVariant = ({ view, nowMs }: { view: TakeoverView; nowMs: number }) => {
  const copy = COPY[view.type];
  const [acked, setAcked] = useState(false);
  const multi = view.matchingSensors.length > 1;

  return (
    <div className="lst-take">
      <div className="lst-modal">
        {/* LEFT — WHAT + WHAT TO DO */}
        <div className="lst-left">
          <div className="lst-type-row">
            <div className="lst-type-glyph"><TypeGlyph type={view.type} /></div>
            <div>
              <div className="lst-type-kicker"><span className="lst-kdot" />{copy.kicker}</div>
              <div className="lst-type-word">{copy.word}</div>
            </div>
          </div>

          <div className="lst-instruction">
            <div className="lst-instruction-main">{copy.instructionMain}</div>
            <div className="lst-instruction-sub">{copy.instructionSub}</div>
          </div>

          <div className="lst-facts">
            <div className="lst-fact">
              <div className="lst-fact-label">Initiating zone</div>
              <div className="lst-fact-value">{view.initiatingZone ?? '—'}</div>
            </div>
            <div className="lst-fact">
              <div className="lst-fact-label">Time</div>
              <div className="lst-fact-value lst-num">
                {fmtClock(view.triggeredAtIso) || '—'}
                {view.triggeredAtIso && <span className="lst-small"> · {fmtRelative(view.triggeredAtIso, nowMs)}</span>}
              </div>
            </div>
            <div className={`lst-fact lst-multi`}>
              <div className="lst-fact-label">Zones active{multi ? ' · spreading' : ''}</div>
              <div className="lst-fact-value lst-num">{multiplicityText(view)}{multi ? ' · SPREADING' : ''}</div>
            </div>
            <div className="lst-fact">
              <div className="lst-fact-label">Source · freshness</div>
              <div className="lst-fact-value">{view.source} <span className="lst-small">· {view.freshness === 'stale' ? 'stale' : 'live'}</span></div>
            </div>
          </div>

          <div className="lst-left-foot">
            <div className="lst-secondary-actions">
              {/* Silence is DEMOTED + labeled "does NOT clear" — and wires NOTHING. */}
              <div className="lst-sec-btn" role="button" aria-disabled="true">
                <div className="lst-sb-title">Silence local sound</div>
                <div className="lst-sb-note">Does NOT clear the condition · this panel only</div>
              </div>
              <div className="lst-sec-btn" role="button" aria-disabled="true">
                <div className="lst-sb-title">Show on map / cameras</div>
                <div className="lst-sb-note">Situational context</div>
              </div>
            </div>
            <div className="lst-provenance">
              <InfoIcon />
              <span>
                Supervisory display. Listed smoke/CO alarms and the monitored panel are your primary
                protection. Fire/CO sensing source is PROPOSED (Surface 7) — framework shown; not live
                until a listed source is bridged.
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT — dispatch status (display) + reassurance + acknowledge */}
        <div className="lst-right">
          <div className="lst-dispatch-head">Emergency Dispatch · Noonlight</div>

          <div className="lst-dispatch-state">
            <div className="lst-ds-label">Alarm created</div>
            <div className="lst-ds-line">{copy.dispatchLine}</div>
          </div>

          {/* v1.2.1: NO countdown ring on life-safety. Reassurance, not a race. */}
          <div className="lst-reassure">
            <div className="lst-reassure-glyph">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--lst-go)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="8.5 12.5 11 15 16 9" /></svg>
            </div>
            <div className="lst-reassure-head">RESPONDERS BEING DISPATCHED</div>
            <div className="lst-reassure-sub">{copy.reassureSub}</div>
          </div>

          {/* Acknowledge — distinct from silence/resolve. Updates LOCAL state only. */}
          <button
            type="button"
            className={`lst-ack-btn${acked ? ' lst-ack-on' : ''}`}
            style={{ marginTop: 18 }}
            onClick={() => setAcked(true)}
          >
            <div className="lst-ab-title">{acked ? 'Acknowledged' : 'Acknowledge'}</div>
            <div className="lst-ab-note">"I see it." Does not clear or silence the alarm.</div>
          </button>

          {/* Cancel demoted to tiny secondary text; opens a separate stern confirm. */}
          <div className="lst-cancel-demoted">
            False alarm? <button type="button" className="lst-cancel-link">Cancel dispatch — opens confirm</button>
            <div className="lst-cancel-demoted-note">
              Requires PIN + "{copy.confirmAffirm}" Noonlight will also call (xxx) xxx-1182.
            </div>
          </div>

          <div className="lst-gated-note">
            <LockIcon />
            Dispatch create/cancel are confirm-gated · not live until Brent approves
          </div>
        </div>
      </div>
    </div>
  );
};

// ── INTRUSION variant — disarm PIN keypad is the legitimate primary ─────────
const IntrusionVariant = ({ view, nowMs }: { view: TakeoverView; nowMs: number }) => {
  const copy = COPY.intrusion;
  const [pin, setPin] = useState('');     // typed-but-DISCARDED — never submitted anywhere
  const [acked, setAcked] = useState(false);

  // Entry-delay countdown (the prominent timer is CORRECT for intrusion).
  let remaining: number | null = null;
  if (view.entryDelayTotal != null && view.entryDelayStartedIso) {
    const started = new Date(view.entryDelayStartedIso).getTime();
    if (!Number.isNaN(started)) {
      remaining = Math.max(0, Math.round(view.entryDelayTotal - (nowMs - started) / 1000));
    }
  }
  const total = view.entryDelayTotal ?? 30;
  const dash = 145;
  const offset = remaining != null ? dash * (1 - remaining / Math.max(total, 1)) : 0;

  // Keypad press updates only the LOCAL pin buffer (capped) — NO service call.
  const press = (k: string) => {
    if (k === 'Clear') { setPin(''); return; }
    if (k === 'Disarm') { /* GATED: render only — wire NO alarm_disarm */ return; }
    setPin((p) => (p.length >= 6 ? p : p + k));
  };

  return (
    <div className="lst-take">
      <div className="lst-modal">
        {/* LEFT — assess: what tripped + entry delay + cameras */}
        <div className="lst-left">
          <div className="lst-type-row">
            <div className="lst-type-glyph"><TypeGlyph type="intrusion" /></div>
            <div>
              <div className="lst-type-kicker"><span className="lst-kdot" />{copy.kicker}</div>
              <div className="lst-type-word">{copy.word}</div>
            </div>
          </div>

          <div className="lst-instruction">
            <div className="lst-instruction-main">{copy.instructionMain}</div>
            <div className="lst-instruction-sub">
              {view.armModeAtTrip ? `${view.armModeAtTrip} · ` : ''}entry delay running. Enter your PIN to disarm, or stay clear and let monitoring proceed.
            </div>
          </div>

          <div className="lst-facts">
            <div className="lst-fact">
              <div className="lst-fact-label">Zone tripped</div>
              <div className="lst-fact-value">{view.initiatingZone ?? '—'}</div>
            </div>
            <div className="lst-fact">
              <div className="lst-fact-label">Time · armed mode</div>
              <div className="lst-fact-value lst-num">
                {fmtClock(view.triggeredAtIso) || '—'}
                {view.armModeAtTrip && <span className="lst-small"> · {view.armModeAtTrip}</span>}
              </div>
            </div>
            <div className="lst-fact lst-multi">
              <div className="lst-fact-label">Zones active</div>
              <div className="lst-fact-value lst-num">{multiplicityText(view)}</div>
            </div>
            <div className="lst-fact">
              <div className="lst-fact-label">Source · freshness</div>
              <div className="lst-fact-value">{view.source} <span className="lst-small">· {view.freshness === 'stale' ? 'stale' : 'live'}</span></div>
            </div>
          </div>

          {remaining != null && (
            <div className="lst-entry-delay">
              <div className="lst-ed-ring">
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
                  <circle cx="28" cy="28" r="23" fill="none" stroke="var(--lst-crit)" strokeWidth="5" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={offset} transform="rotate(-90 28 28)" />
                </svg>
                <div className="lst-ed-num lst-num">{remaining}</div>
              </div>
              <div>
                <div className="lst-ed-head">Entry delay · {remaining}s</div>
                <div className="lst-ed-sub">Disarm before full alarm &amp; dispatch. Pre-alarm tone active.</div>
              </div>
            </div>
          )}

          <div className="lst-left-foot">
            <div className="lst-cam-context">
              <div className="lst-cam-thumb"><span className="lst-cam-na">Camera context · feed unavailable</span></div>
              <div className="lst-cam-thumb"><span className="lst-cam-na">Camera context · feed unavailable</span></div>
            </div>
            <div className="lst-provenance">
              <InfoIcon />
              <span>Supervisory display via Alarmo. Listed/monitored panel remains primary. This is an intrusion event — fire/CO use a separate life-safety takeover.</span>
            </div>
          </div>
        </div>

        {/* RIGHT — disarm PIN keypad (GATED: render only, wire NO alarm_disarm) */}
        <div className="lst-right">
          <div className="lst-keypad-head">
            <div className="lst-keypad-title">Disarm · Enter PIN</div>
            <div className="lst-keypad-sub">alarm_control_panel.alarm_disarm · code required</div>
          </div>
          <div className="lst-pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`lst-pin-dot${i < pin.length ? ' lst-filled' : ''}`} />
            ))}
          </div>
          <div className="lst-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
              <button key={n} type="button" className="lst-key lst-num" onClick={() => press(n)}>{n}</button>
            ))}
            <button type="button" className="lst-key lst-key-fn" onClick={() => press('Clear')}>Clear</button>
            <button type="button" className="lst-key lst-num" onClick={() => press('0')}>0</button>
            <button type="button" className="lst-key lst-key-disarm" onClick={() => press('Disarm')}>Disarm</button>
          </div>
          <div className="lst-ack-row">
            <button type="button" className={`lst-mini-btn${acked ? ' lst-ack-on' : ''}`} onClick={() => setAcked(true)}>
              <div className="lst-mb-t">{acked ? 'Acknowledged' : 'Acknowledge'}</div>
              <div className="lst-mb-n">"I see it" · doesn't disarm</div>
            </button>
            <div className="lst-mini-btn" role="button" aria-disabled="true">
              <div className="lst-mb-t">Silence panel</div>
              <div className="lst-mb-n">local sound only</div>
            </div>
          </div>
          <div className="lst-gated-note">
            <LockIcon />
            Disarm is confirm-gated · live actuation requires Brent approval
          </div>
        </div>
      </div>
    </div>
  );
};

// ── SIGNAL-LOST banner (three-state freshness, state 3) ─────────────────────
const SignalLostBanner = ({ view, nowMs }: { view: TakeoverView; nowMs: number }) => (
  <div className="lst-scope lst-signal-overlay">
    <div className="lst-signal-banner">
      <div className="lst-sb-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9C5BB" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 8.82a15 15 0 0 1 4.17-2.65" /><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" /><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" /><path d="M5 13a10 10 0 0 1 5.24-2.76" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /><line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      </div>
      <div className="lst-sb-text">
        <div className="lst-sb-title">SIGNAL LOST · alarm status UNKNOWN — not "all clear"</div>
        <div className="lst-sb-sub">
          Lost live connection to the alarm backend (WebSocket disconnected).
          {view.lastKnownLabel ? ` Last known: ${view.lastKnownLabel}${view.lastKnownIso ? ` at ${fmtClock(view.lastKnownIso)}` : ''}.` : ''}
          {' '}Do not trust this panel for life-safety until it reconnects.
        </div>
      </div>
      <div className="lst-sb-badge">
        {view.lastKnownIso ? `Last update ${fmtRelative(view.lastKnownIso, nowMs)}` : 'No live feed'}
      </div>
    </div>
  </div>
);

interface Props {
  /** Notifies the parent (App) whether a non-dismissible takeover is active, so
   *  the shell's idle-return can be suppressed. (active = fire/CO/gas/intrusion;
   *  the signal-lost banner does NOT suppress idle — it's a banner, not a modal.) */
  onActiveChange?: (active: boolean) => void;
}

const LifeSafetyTakeover = ({ onActiveChange }: Props) => {
  const view = useLifeSafetyTakeover();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Local clock so relative ages + the entry-delay countdown advance smoothly.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Drive the shell's suppressIdleReturn hook. Idle-return must never navigate
  // away from an active annunciation.
  useEffect(() => { onActiveChange?.(view.active); }, [view.active, onActiveChange]);

  // NO-ALARM: this deployment has no alarm entity at all (bare demo/admin panel).
  // This is NOT the safety case — render nothing. We must never show the
  // life-safety "don't trust this panel" takeover where there is simply no alarm
  // wiring to lose. (Distinct from signal-lost below, which is a KNOWN alarm we
  // can no longer trust and MUST keep firing.)
  if (view.freshness === 'no-alarm') {
    return null;
  }

  // SIGNAL LOST: show the UNKNOWN banner (never "all clear"). No modal, no
  // scope-class type tinting needed — the banner is its own neutral overlay.
  // Fires when a KNOWN alarm's feed drops/disconnects — the real safety case.
  if (view.freshness === 'signal-lost') {
    return <SignalLostBanner view={view} nowMs={nowMs} />;
  }

  if (!view.active) return null;

  const scopeClass = `lst-scope lst-${view.type}`;
  return (
    <div className={scopeClass}>
      <div className="lst-overlay" role="alertdialog" aria-modal="true" aria-label={`${COPY[view.type].word} alarm`}>
        <div className="lst-red-wash" />
        <div className="lst-flash-border" />
        {view.tier === 2
          ? <IntrusionVariant view={view} nowMs={nowMs} />
          : <LifeSafetyVariant view={view} nowMs={nowMs} />}
      </div>
    </div>
  );
};

export default LifeSafetyTakeover;
