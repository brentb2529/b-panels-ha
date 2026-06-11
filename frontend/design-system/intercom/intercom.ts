// Panel-to-panel intercom — PURE call state machine + signal reducer
// (feat/panel-intercom · ECOSYSTEM §K2, pairs with §E1 door-station).
//
// INTERCOM · EXPLICIT CALL→RING→ACCEPT · NO PASSIVE MIC · NO AUTO-ANSWER ·
// NO HOME-EQUIPMENT ACTUATION.
//
// This module is the BRAIN of the intercom and is deliberately PURE (no React,
// no WebRTC, no I/O) so the state machine + privacy guards are unit-testable in
// isolation. The hook (useIntercom) wires this to the signaling relay, WebRTC,
// and the UI.
//
// ── PRIVACY MODEL (critical) ──
// A mic between rooms is privacy-sensitive. The machine enforces:
//   • NO transition opens the mic without an explicit human action — `accept()`
//     on the callee, or an outbound `call()` then the peer's accept on the
//     caller. There is NO `ringing → connected` edge that isn't gated by accept.
//   • `micActive` is true IFF state === 'connected'. Every other state → mic off.
//   • An incoming invite auto-EXPIRES (declines itself) after a ring window — it
//     never auto-ANSWERS.
// A test asserts each of these.

export type CallState =
  | 'idle'        // nothing happening — mic off
  | 'calling'     // we placed a call, awaiting accept/decline — mic off
  | 'ringing'     // an invite arrived, awaiting our accept/decline — mic off
  | 'connected'   // accepted both ways — MIC HOT
  | 'ended';      // last call ended/declined/timed-out — mic off (transient)

export type CallDirection = 'outgoing' | 'incoming' | null;

export interface IntercomState {
  state: CallState;
  direction: CallDirection;
  /** the other panel's installation id (peer) */
  peerId: string | null;
  /** the other panel's room label (display) */
  peerName: string | null;
  /** call correlation id (shared by both peers for one call) */
  callId: string | null;
  /** why the call ended (for the transient 'ended' card) */
  endReason: 'declined' | 'busy' | 'ended' | 'timeout' | 'failed' | null;
}

export const initialIntercomState: IntercomState = {
  state: 'idle',
  direction: null,
  peerId: null,
  peerName: null,
  callId: null,
  endReason: null,
};

/** A mic may ONLY be hot while connected. Single source of truth for the guard. */
export const isMicActive = (s: IntercomState): boolean => s.state === 'connected';

/** Is the machine busy (in any non-idle, non-ended call)? Used to reply `busy`. */
export const isBusy = (s: IntercomState): boolean =>
  s.state === 'calling' || s.state === 'ringing' || s.state === 'connected';

// ── Actions ──────────────────────────────────────────────────────────────────
// Local actions (user/hook driven) and remote actions (a signal arrived).
export type IntercomAction =
  // local
  | { t: 'call'; peerId: string; peerName: string; callId: string }
  | { t: 'accept' }
  | { t: 'decline' }
  | { t: 'hangup' }
  | { t: 'reset' }   // clear the transient 'ended' card back to idle
  // remote (a signal addressed to us arrived)
  | { t: 'recv-invite'; from: string; fromName: string | null; callId: string }
  | { t: 'recv-accept'; callId: string }
  | { t: 'recv-decline'; callId: string }
  | { t: 'recv-bye'; callId: string }
  | { t: 'recv-busy'; callId: string }
  // internal
  | { t: 'timeout'; callId: string }
  | { t: 'failed'; callId: string };

const ended = (
  s: IntercomState,
  reason: NonNullable<IntercomState['endReason']>,
): IntercomState => ({
  ...initialIntercomState,
  state: 'ended',
  // keep peer label for the transient "Call ended with X" card
  peerName: s.peerName,
  endReason: reason,
});

/**
 * PURE reducer for the call state machine. Returns the next state; NEVER opens a
 * mic (that's the hook's job, gated on `isMicActive(next)`).
 *
 * Hard invariants (asserted by tests):
 *   • No path reaches 'connected' except via an explicit `accept` (callee) or a
 *     `recv-accept` for our own outgoing call (caller). A bare `recv-invite`
 *     ONLY ever yields 'ringing' — never 'connected'.
 *   • A `recv-invite` while already busy does NOT change state (we reply 'busy'
 *     out-of-band) — it can never bump us into answering.
 */
export function intercomReducer(
  s: IntercomState,
  a: IntercomAction,
): IntercomState {
  switch (a.t) {
    // ── local ──
    case 'call':
      if (isBusy(s)) return s; // can't place a new call mid-call
      return {
        state: 'calling',
        direction: 'outgoing',
        peerId: a.peerId,
        peerName: a.peerName,
        callId: a.callId,
        endReason: null,
      };

    case 'accept':
      // ONLY a ringing call may be accepted — this is the sole edge into the
      // mic-hot 'connected' state, and it requires an explicit user action.
      if (s.state !== 'ringing') return s;
      return { ...s, state: 'connected', direction: 'incoming' };

    case 'decline':
      if (s.state !== 'ringing') return s;
      return ended(s, 'declined');

    case 'hangup':
      if (s.state === 'idle' || s.state === 'ended') return s;
      return ended(s, 'ended');

    case 'reset':
      return s.state === 'ended' ? initialIntercomState : s;

    // ── remote ──
    case 'recv-invite':
      // Busy → ignore (caller gets a 'busy' reply from the hook). NEVER answers.
      if (isBusy(s)) return s;
      return {
        state: 'ringing',
        direction: 'incoming',
        peerId: a.from,
        peerName: a.fromName,
        callId: a.callId,
        endReason: null,
      };

    case 'recv-accept':
      // The far end accepted OUR outgoing call → connect (mic opens on connect).
      if (s.state !== 'calling' || s.callId !== a.callId) return s;
      return { ...s, state: 'connected' };

    case 'recv-decline':
      if (s.callId !== a.callId) return s;
      if (s.state !== 'calling') return s;
      return ended(s, 'declined');

    case 'recv-busy':
      if (s.callId !== a.callId || s.state !== 'calling') return s;
      return ended(s, 'busy');

    case 'recv-bye':
      if (s.callId !== a.callId) return s;
      if (s.state === 'idle' || s.state === 'ended') return s;
      return ended(s, 'ended');

    // ── internal ──
    case 'timeout':
      if (s.callId !== a.callId) return s;
      if (s.state !== 'calling' && s.state !== 'ringing') return s;
      return ended(s, 'timeout');

    case 'failed':
      if (s.callId !== a.callId) return s;
      if (s.state === 'idle' || s.state === 'ended') return s;
      return ended(s, 'failed');

    default:
      return s;
  }
}

// ── Secure-context / mic-capability gate ──────────────────────────────────────
// getUserMedia is unavailable outside a secure context (https or http://localhost)
// AND inside a mic-denied iframe. The client must refuse to even ATTEMPT a mic
// open when it's unavailable, and surface an honest message instead. This pure
// predicate lets the hook + UI gate on it and tests assert it.
export interface MicCapability {
  available: boolean;
  reason:
    | 'ok'
    | 'no-mediadevices'   // not a secure context, or iframe-denied
    | 'no-getusermedia';  // mediaDevices present but getUserMedia missing
}

export function probeMicCapability(nav?: {
  mediaDevices?: { getUserMedia?: unknown };
}): MicCapability {
  const n = nav ?? (typeof navigator !== 'undefined' ? (navigator as any) : undefined);
  const md = n?.mediaDevices;
  if (!md) return { available: false, reason: 'no-mediadevices' };
  if (typeof md.getUserMedia !== 'function')
    return { available: false, reason: 'no-getusermedia' };
  return { available: true, reason: 'ok' };
}

// ── Panel identity (per-DEVICE, like usePanelDefault) ─────────────────────────
// Each physical panel needs a stable id to be addressed by, plus a friendly room
// label. Until the native shell's installation_id is wired through, we derive a
// stable per-device id from localStorage (the iPad's WebView store is per-device
// by construction). The label defaults to the device's home-panel name.

const INSTALL_ID_KEY = 'bPanelsIntercomInstallId';
const ROOM_NAME_KEY = 'bPanelsIntercomRoomName';

export function getInstallId(store?: Storage): string {
  const ls = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  try {
    const existing = ls?.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
  } catch { /* ignore */ }
  const fresh =
    'panel-' +
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4);
  try { ls?.setItem(INSTALL_ID_KEY, fresh); } catch { /* ignore */ }
  return fresh;
}

export function getRoomName(fallback: string, store?: Storage): string {
  const ls = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  try {
    const v = ls?.getItem(ROOM_NAME_KEY);
    if (v && v.trim()) return v.trim();
  } catch { /* ignore */ }
  return fallback;
}

export function setRoomName(name: string, store?: Storage): void {
  const ls = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  try { ls?.setItem(ROOM_NAME_KEY, name); } catch { /* ignore */ }
}

/**
 * Should THIS panel act on an inbound signal? Accept messages addressed directly
 * to us OR broadcasts (`to:"*"`, used by presence); always ignore our own echo.
 * Pure so the broadcast-vs-direct contract is unit-testable (a regression here
 * silently breaks presence discovery).
 */
export const shouldHandleSignal = (
  selfId: string,
  sig: { to: string; from: string },
): boolean => {
  if (sig.from === selfId) return false;          // our own echo
  return sig.to === selfId || sig.to === '*';     // direct OR broadcast
};

/** Generate a fresh call-correlation id. */
export const newCallId = (): string =>
  'call-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** A short human label for the current state (used in the on-air / status copy). */
export const stateLabel = (s: IntercomState): string => {
  switch (s.state) {
    case 'calling': return `Calling ${s.peerName ?? s.peerId ?? 'panel'}…`;
    case 'ringing': return `${s.peerName ?? s.peerId ?? 'A panel'} is calling`;
    case 'connected': return `On air with ${s.peerName ?? s.peerId ?? 'panel'}`;
    case 'ended':
      return s.endReason === 'declined' ? 'Call declined'
        : s.endReason === 'busy' ? 'Panel busy'
        : s.endReason === 'timeout' ? 'No answer'
        : s.endReason === 'failed' ? 'Call failed'
        : 'Call ended';
    default: return 'Idle';
  }
};
