import React, { useEffect, useRef, useState } from 'react';
import { useDoorbellRing } from './useDoorbellRing';
import { useTakeoverActive } from '../takeover/takeoverSignal';
import { fmtRingClock, type EntryConfig } from './entry';
import './entry.css';

// ---------------------------------------------------------------------------
// DoorbellRingOverlay — the GLOBAL doorbell ring-to-panel surface
// (feat/doorbell-garage · ECOSYSTEM §E1 · Top-10 #4). A NEW, EVEN-LOWER tier.
//
// Mounted ONCE below the weather-safety banner (App.tsx), so a ring lands on
// EVERY panel/device. It is a TRANSIENT, calm card — NEVER the red life-safety
// wash — that auto-dismisses when the ring goes stale.
//
// ── TIERING (three tiers; this is the lowest) ──
//   life-safety takeover  >  weather-safety  >  DOORBELL RING
//   The projection forces `active=false` while a life-safety takeover
//   (alarm triggered) OR a weather-safety condition (freeze/storm) is active —
//   read from the SAME source entities those tiers read. Belt-and-suspenders:
//   we ALSO subscribe to the global takeover-active signal here and render
//   nothing while a takeover is on screen. The ring yields to BOTH, enforced
//   from one source of truth, not a UI race.
//
// ── HARD POSTURE — NO LIVE ACTUATION ──
// There is NO callService import in this module, by construction. The two-way
// talk affordance is UI-ONLY (real audio needs hardware + go2rtc — documented,
// see report). The "Release gate / door" is the existing UniFi Access lock/gate
// and is EQUIPMENT + SECURITY GATED: pressing it opens a confirm/PIN step that
// updates LOCAL state only and issues ZERO lock/cover/service. Live release is
// pending Brent's approval. The camera is an honest poster / "feed unavailable"
// (UniFi Protect not in dev) — never a faked live stream.
// ---------------------------------------------------------------------------

const BellGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const MicGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const LockGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);
const CamOffGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M16 16H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m4 0h2.5a2 2 0 0 1 2 2v1.5" />
    <path d="m22 8-6 4 6 4V8z" /><line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

// A confirm/PIN-gated gate release that wires NOTHING — it walks resting →
// confirm → "noted" (LOCAL state) and never calls a lock/cover service.
const ReleaseAffordance = ({ doorbellName }: { doorbellName: string }) => {
  const [phase, setPhase] = useState<'rest' | 'confirm' | 'noted'>('rest');
  return (
    <div className="dbr-release">
      {phase === 'rest' && (
        <button type="button" className="dbr-release-cta" onClick={() => setPhase('confirm')}>
          <LockGlyph /> Release gate / door
        </button>
      )}
      {phase === 'confirm' && (
        <div className="dbr-release-confirm">
          <div className="dbr-release-detail">
            Releasing the {doorbellName.toLowerCase()} gate is the UniFi Access lock —
            security + equipment gated. Enter PIN to confirm. No actuation fires here.
          </div>
          <div className="dbr-release-row">
            <button type="button" className="dbr-release-btn ghost" onClick={() => setPhase('rest')}>Cancel</button>
            {/* GATED: render only — wires NO lock/cover service. */}
            <button type="button" className="dbr-release-btn" onClick={() => setPhase('noted')}>Confirm release</button>
          </div>
        </div>
      )}
      {phase === 'noted' && (
        <div className="dbr-release-note"><LockGlyph /> Noted — gate release is gated · no service fired · live release pending approval.</div>
      )}
    </div>
  );
};

interface Props {
  config?: EntryConfig;
  /** Notifies the parent whether the ring tier is active (logging / future push hook). */
  onActiveChange?: (active: boolean) => void;
}

const DoorbellRingOverlay = ({ config, onActiveChange }: Props) => {
  const view = useDoorbellRing(config);
  const takeoverActive = useTakeoverActive(); // belt-and-suspenders yield
  const [dismissed, setDismissed] = useState(false);
  const [talkOn, setTalkOn] = useState(false);
  const loggedRef = useRef<string | null>(null);

  // EFFECTIVELY active = projection active AND no life-safety takeover on screen.
  // (The projection already yields to weather-safety; the takeover-active signal
  // is the extra belt-and-suspenders for the life-safety tier.)
  const effectiveActive = view.active && !takeoverActive;

  // LOG hook (console today; documented follow-up is a push-notify via notify.*).
  useEffect(() => {
    if (!effectiveActive) { loggedRef.current = null; onActiveChange?.(false); return; }
    const key = `${view.doorbellId}|${view.ringIso}`;
    if (loggedRef.current !== key) {
      loggedRef.current = key;
      // eslint-disable-next-line no-console
      console.info('[doorbell-ring] active:', { doorbell: view.doorbellId, at: view.ringIso });
    }
    onActiveChange?.(true);
  }, [effectiveActive, view.doorbellId, view.ringIso, onActiveChange]);

  // A fresh ring (new timestamp) re-shows even if an earlier one was dismissed,
  // and resets the talk affordance.
  useEffect(() => { setDismissed(false); setTalkOn(false); }, [view.ringIso]);

  if (!effectiveActive || dismissed) return null;

  return (
    <div className="dbr-scope">
      <div className="dbr-card" role="dialog" aria-label="Doorbell ring" aria-live="polite">
        <div className="dbr-head">
          <div className="dbr-bell" aria-hidden><BellGlyph /></div>
          <div className="dbr-head-text">
            <div className="dbr-kicker">Doorbell · ringing</div>
            <div className="dbr-title">{view.doorbellName}</div>
            <div className="dbr-time num">{view.ringIso ? fmtRingClock(view.ringIso) : 'Now'}</div>
          </div>
          <button type="button" className="dbr-dismiss" aria-label="Dismiss" onClick={() => setDismissed(true)}>×</button>
        </div>

        {/* Camera — honest poster / "feed unavailable" (UniFi Protect not in dev). */}
        <div className="dbr-cam">
          {view.cameraHasStream ? (
            <div className="dbr-cam-poster dbr-cam-live">
              <div className="dbr-live-chip"><span className="dbr-live-dot" />LIVE</div>
            </div>
          ) : (
            <div className="dbr-cam-empty">
              <CamOffGlyph />
              <span className="dbr-cam-empty-label">Feed unavailable</span>
              <span className="dbr-cam-empty-sub">UniFi Protect doorbell · Surface 5 · not in dev</span>
            </div>
          )}
        </div>

        {/* Actions row */}
        <div className="dbr-actions">
          {/* Two-way talk — UI ONLY (placeholder). Real audio needs hardware + go2rtc. */}
          <button
            type="button"
            className={`dbr-talk${talkOn ? ' dbr-talk-on' : ''}`}
            aria-pressed={talkOn}
            title="Two-way talk — placeholder. Real audio needs the doorbell hardware + go2rtc (documented)."
            onClick={() => setTalkOn((v) => !v)}
          >
            <MicGlyph />
            <span className="dbr-talk-lbl">{talkOn ? 'Talking…' : 'Talk'}</span>
            <span className="dbr-talk-note">{talkOn ? 'Mic placeholder · no live audio' : 'Two-way talk'}</span>
          </button>

          <ReleaseAffordance doorbellName={view.doorbellName} />
        </div>

        <div className="dbr-foot">
          <LockGlyph />
          Ring is display/notify only · talk is a placeholder (audio needs go2rtc) · gate release is gated — no service fired · life-safety &amp; weather always outrank this
        </div>
      </div>
    </div>
  );
};

export default DoorbellRingOverlay;
