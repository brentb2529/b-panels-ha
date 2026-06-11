import React, { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';
import { useTakeoverActive } from '../takeover/takeoverSignal';
import { isLifeSafetyActive, isWeatherSafetyActive } from '../entry/entry';
import { useIntercom } from './useIntercom';
import { stateLabel } from './intercom';
import './intercom.css';

// ---------------------------------------------------------------------------
// IntercomOverlay — the GLOBAL panel-to-panel call surface (feat/panel-intercom).
//
// Mounted ONCE (App.tsx) as a sibling below the doorbell-ring overlay, so an
// incoming call rings on EVERY panel/device. It is a calm, transient call card
// (the doorbell-ring language) — NEVER the red life-safety wash — that YIELDS to
// the two higher tiers:
//     life-safety takeover  >  weather-safety  >  INTERCOM  >  doorbell ring
//
// ── PRIVACY (the whole point) ──
//   • EXPLICIT call → ring → accept. The mic opens ONLY on an Accept tap (callee)
//     or the peer's accept (caller) — there is NO auto-answer (enforced in the
//     reducer + the hook's mic effect).
//   • A persistent ON-AIR indicator shows whenever the mic is hot, plus an
//     always-visible End call control.
//   • Signaling is the AUTHENTICATED HA websocket relay — no unauthenticated
//     endpoint. Zero home-equipment actuation.
//   • If the mic can't open here (insecure http context / iframe-denied), the
//     card stays connected for control but shows an honest "mic unavailable"
//     note instead of opening anything.
// ---------------------------------------------------------------------------

const PhoneGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const MicGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const ShieldGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

interface Props {
  /** Friendly room label for THIS panel (e.g. the device's home-panel name). */
  selfName?: string;
  /** Notifies the parent whether a call card is active (logging / future hook). */
  onActiveChange?: (active: boolean) => void;
  /** Test seam: skip the entity subscription used only for higher-tier yield. */
  disableYieldSubscription?: boolean;
  /** Show the "call a room" launcher when idle (a roster of reachable panels). */
  showLauncher?: boolean;
}

const IntercomOverlay = ({ selfName = 'This Panel', onActiveChange, disableYieldSubscription, showLauncher }: Props) => {
  const ic = useIntercom(selfName);
  const takeoverActive = useTakeoverActive();          // belt-and-suspenders yield
  const [yieldToWeatherOrLife, setYieldToWeatherOrLife] = useState(false);
  const entsRef = useRef<HassEntities>({});

  // Subscribe to entities ONLY to compute the higher-tier yield from the same
  // source of truth the doorbell ring uses (life-safety + weather-safety).
  useEffect(() => {
    if (disableYieldSubscription) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          setYieldToWeatherOrLife(isLifeSafetyActive(ents) || isWeatherSafetyActive(ents));
        });
      } catch { /* no feed → no higher-tier yield from entities (takeover signal still applies) */ }
    })();
    return () => { cancelled = true; if (unsub) unsub(); };
  }, [disableYieldSubscription]);

  const { state } = ic;
  const callActive = state.state !== 'idle';

  useEffect(() => {
    onActiveChange?.(callActive && state.state !== 'ended');
  }, [callActive, state.state, onActiveChange]);

  // Auto-dismiss the transient "ended" card after a moment.
  useEffect(() => {
    if (state.state !== 'ended') return;
    const t = window.setTimeout(() => ic.reset(), 4500);
    return () => window.clearTimeout(t);
  }, [state.state, ic]);

  // Higher tiers own the screen → render nothing (but the hook still holds the
  // call state; the mic effect already stops the track if we left 'connected').
  const suppressed = takeoverActive || yieldToWeatherOrLife;

  // Idle: optionally show the "call a room" launcher (a roster of reachable
  // panels). When not launching, just mount the silent remote-audio sink.
  if (suppressed || !callActive) {
    if (!suppressed && showLauncher) {
      return (
        <div className="ic-scope">
          <audio ref={ic.remoteAudioRef} autoPlay style={{ display: 'none' }} />
          <div className="ic-card" role="dialog" aria-label="Panel intercom — call a room">
            <div className="ic-head">
              <div className="ic-avatar" aria-hidden><PhoneGlyph /></div>
              <div className="ic-head-text">
                <div className="ic-kicker">Intercom</div>
                <div className="ic-launcher-title">Call a room</div>
                <div className="ic-launcher-sub">This panel: {ic.selfName}</div>
              </div>
            </div>
            <div className="ic-launcher" style={{ marginTop: 12 }}>
              {ic.roster.length === 0 ? (
                <div className="ic-room-empty">No other panels online yet.</div>
              ) : (
                <div className="ic-roomgrid">
                  {ic.roster.map((p) => (
                    <button key={p.id} type="button" className="ic-room" onClick={() => ic.call(p.id, p.name)}>
                      <span className="ic-room-icon" aria-hidden><PhoneGlyph /></span>
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="ic-foot">
              <ShieldGlyph />
              Calling rings the other panel · the mic opens only after they accept · signaling is HA-auth gated
            </div>
          </div>
        </div>
      );
    }
    // Always mount the (silent) remote audio sink so the ref is stable.
    return <audio ref={ic.remoteAudioRef} autoPlay style={{ display: 'none' }} />;
  }

  const connected = state.state === 'connected';
  const ringing = state.state === 'ringing';
  const scopeCls = `ic-scope${ringing ? ' ic-ringing' : ''}`;
  const cardCls = `ic-card${connected ? ' ic-connected' : ''}`;

  return (
    <div className={scopeCls}>
      <audio ref={ic.remoteAudioRef} autoPlay style={{ display: 'none' }} />
      <div className={cardCls} role="dialog" aria-label="Panel intercom" aria-live="polite">
        <div className="ic-head">
          <div className="ic-avatar" aria-hidden><PhoneGlyph /></div>
          <div className="ic-head-text">
            <div className="ic-kicker">
              {connected ? 'Intercom · on air'
                : ringing ? 'Intercom · incoming'
                : state.state === 'calling' ? 'Intercom · calling'
                : 'Intercom'}
            </div>
            <div className="ic-title">{state.peerName ?? state.peerId ?? 'Panel'}</div>
            <div className="ic-sub">{stateLabel(state)}</div>

            {/* ON-AIR indicator — persistent + unmistakable while connected. */}
            {connected && (
              ic.micLive ? (
                <div className="ic-onair">
                  <span className="ic-onair-dot" /> <MicGlyph /> On air · mic open
                </div>
              ) : (
                <div className="ic-onair ic-onair-muted" title="Microphone needs HTTPS + a top-level (native kiosk) panel.">
                  <MicGlyph /> Mic unavailable here · control only
                </div>
              )
            )}
          </div>
        </div>

        {/* Actions — explicit, gated. Accept is the ONLY edge that opens the mic. */}
        <div className="ic-actions">
          {ringing && (
            <>
              <button type="button" className="ic-btn ic-btn-decline" onClick={ic.decline}>Decline</button>
              <button type="button" className="ic-btn ic-btn-accept" onClick={ic.accept}>Accept</button>
            </>
          )}
          {(state.state === 'calling' || connected) && (
            <button type="button" className="ic-btn ic-btn-end" onClick={ic.hangup}>
              {connected ? 'End call' : 'Cancel'}
            </button>
          )}
          {state.state === 'ended' && (
            <button type="button" className="ic-btn ic-btn-ghost" onClick={ic.reset}>Dismiss</button>
          )}
        </div>

        <div className="ic-foot">
          <ShieldGlyph />
          Explicit call → ring → accept · no passive mic · no auto-answer · signaling is HA-auth gated · life-safety &amp; weather always outrank this
        </div>
      </div>
    </div>
  );
};

export default IntercomOverlay;
