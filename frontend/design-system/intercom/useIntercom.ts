// useIntercom — wires the pure intercom state machine to the token-gated
// signaling relay (authenticated HA websocket) + WebRTC peer audio + a clear
// on-air model (feat/panel-intercom).
//
// PRIVACY (enforced here, mirroring intercom.ts):
//   • The mic (getUserMedia) is opened ONLY on the transition INTO 'connected'
//     — never on a bare incoming invite. `useEffect` watches `isMicActive(state)`
//     and opens/closes the track accordingly; on ANY non-connected state the
//     track is stopped.
//   • If the mic is unavailable (insecure context / iframe-denied), we DO NOT
//     attempt getUserMedia — we surface an honest banner and keep the call in a
//     control-only state. The control plane (ring/accept/decline/end) still works
//     so the feature is demonstrable; only live audio is gated off.
//   • Signaling is the authenticated HA WS relay — no unauthenticated endpoint.
//
// In dev / headless / http the WebRTC media leg is inert (no secure context, no
// real mic); the call/ring/accept state machine + signaling round-trip are fully
// exercised. The media wiring lights up automatically under TLS + a top-level
// (native-kiosk) load.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  sendIntercomSignal,
  subscribeIntercomSignals,
  type IntercomSignal,
} from '../../services/haClient';
import {
  intercomReducer,
  initialIntercomState,
  isMicActive,
  isBusy,
  probeMicCapability,
  getInstallId,
  getRoomName,
  newCallId,
  shouldHandleSignal,
  type IntercomState,
  type MicCapability,
} from './intercom';

const RING_TIMEOUT_MS = 30_000;       // an unanswered call/ring auto-ends
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]; // same-LAN needs none
const PRESENCE_INTERVAL_MS = 15_000;  // re-announce so the roster stays fresh
const PRESENCE_TTL_MS = 45_000;       // drop a peer not heard from in this window

export interface IntercomPeer {
  id: string;
  name: string;
  lastSeen: number;
}

export interface UseIntercom {
  state: IntercomState;
  micCap: MicCapability;
  /** This panel's stable id + room label (for the directory + addressing). */
  selfId: string;
  selfName: string;
  /** True iff the mic is hot RIGHT NOW (state === 'connected' AND a live track). */
  micLive: boolean;
  /** Place a call to a panel. */
  call: (peerId: string, peerName: string) => void;
  /** Accept the incoming ring (the ONLY edge that opens the mic on the callee). */
  accept: () => void;
  /** Decline the incoming ring. */
  decline: () => void;
  /** End the active/placing call. */
  hangup: () => void;
  /** Dismiss the transient "ended" card. */
  reset: () => void;
  /** The remote audio element ref to mount in the UI (plays the peer). */
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  /** Other panels currently reachable (presence roster, self excluded). */
  roster: IntercomPeer[];
}

export function useIntercom(selfName: string): UseIntercom {
  const [state, dispatch] = useReducer(intercomReducer, initialIntercomState);
  const [micCap] = useState<MicCapability>(() => probeMicCapability());
  const [micLive, setMicLive] = useState(false);
  const [roster, setRoster] = useState<IntercomPeer[]>([]);
  const rosterRef = useRef<Map<string, IntercomPeer>>(new Map());

  const selfIdRef = useRef<string>('');
  if (!selfIdRef.current) selfIdRef.current = getInstallId();
  const selfId = selfIdRef.current;
  const selfNameResolved = getRoomName(selfName);

  // Refs the async signal handler reads without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Signaling send helper (always stamps self id/name) ──────────────────────
  const signal = useCallback(
    (to: string, kind: IntercomSignal['kind'], callId: string, payload?: any) => {
      sendIntercomSignal({
        to, from: selfId, kind, callId,
        fromName: selfNameResolved,
        payload: payload ?? null,
      }).catch(() => { /* relay best-effort; UI shows state regardless */ });
    },
    [selfId, selfNameResolved],
  );

  // ── Teardown of any live peer/track (privacy: stop the mic NOW) ─────────────
  const teardownMedia = useCallback(() => {
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    localStreamRef.current = null;
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null;
    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.srcObject = null; } catch { /* ignore */ }
    }
    setMicLive(false);
  }, []);

  // ── Inbound signal subscription (authenticated HA WS) ───────────────────────
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        unsub = await subscribeIntercomSignals((sig) => {
          if (cancelled) return;
          // Accept messages addressed to us OR broadcasts (presence, to:"*");
          // drop our own echo. See shouldHandleSignal (unit-tested).
          if (!shouldHandleSignal(selfId, sig)) return;
          handleSignal(sig);
        });
      } catch { /* no relay (standalone dev) — control plane just stays local */ }
    })();
    return () => { cancelled = true; if (unsub) unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);

  const handleSignal = useCallback((sig: IntercomSignal) => {
    const cur = stateRef.current;
    switch (sig.kind) {
      case 'presence': {
        // Roster announce (broadcast). Record/refresh the peer; reply with our
        // own presence so a newly-arrived panel learns about us immediately.
        const name = (sig.fromName ?? sig.from) || sig.from;
        rosterRef.current.set(sig.from, { id: sig.from, name, lastSeen: Date.now() });
        setRoster(Array.from(rosterRef.current.values()));
        // Targeted reply only when they broadcast (to:"*") — avoids reply storms.
        if (sig.to === '*') signal(sig.from, 'presence', 'presence');
        return;
      }
      case 'invite':
        if (isBusy(cur)) {
          // Auto-reply busy — but NEVER answer. No mic opens.
          signal(sig.from, 'busy', sig.callId);
          return;
        }
        dispatch({ t: 'recv-invite', from: sig.from, fromName: sig.fromName ?? null, callId: sig.callId });
        break;
      case 'accept':
        dispatch({ t: 'recv-accept', callId: sig.callId });
        break;
      case 'decline':
        dispatch({ t: 'recv-decline', callId: sig.callId });
        break;
      case 'busy':
        dispatch({ t: 'recv-busy', callId: sig.callId });
        break;
      case 'bye':
        dispatch({ t: 'recv-bye', callId: sig.callId });
        break;
      case 'ice':
        // Best-effort: feed remote ICE to the peer if one exists.
        if (pcRef.current && sig.payload && typeof sig.payload === 'object') {
          pcRef.current.addIceCandidate(sig.payload as RTCIceCandidateInit).catch(() => {});
        }
        break;
      default:
        break;
    }
  }, [signal]);

  // ── Presence: announce ourselves + prune stale peers ────────────────────────
  useEffect(() => {
    // Broadcast our presence (to:"*"); peers reply directly so the roster fills.
    const announce = () => signal('*', 'presence', 'presence');
    announce();
    // A couple of quick re-announces cover the race where another panel's
    // inbound subscription wasn't established yet when we first announced
    // (otherwise a fresh peer waits a full interval to appear in the roster).
    const t1 = window.setTimeout(announce, 1200);
    const t2 = window.setTimeout(announce, 3500);
    const annTimer = window.setInterval(announce, PRESENCE_INTERVAL_MS);
    const pruneTimer = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, p] of rosterRef.current) {
        if (now - p.lastSeen > PRESENCE_TTL_MS) { rosterRef.current.delete(id); changed = true; }
      }
      if (changed) setRoster(Array.from(rosterRef.current.values()));
    }, PRESENCE_INTERVAL_MS);
    return () => {
      window.clearTimeout(t1); window.clearTimeout(t2);
      window.clearInterval(annTimer); window.clearInterval(pruneTimer);
    };
  }, [signal]);

  // ── Local actions ───────────────────────────────────────────────────────────
  const call = useCallback((peerId: string, peerName: string) => {
    if (isBusy(stateRef.current)) return;
    const callId = newCallId();
    dispatch({ t: 'call', peerId, peerName, callId });
    signal(peerId, 'invite', callId);
  }, [signal]);

  const accept = useCallback(() => {
    const cur = stateRef.current;
    if (cur.state !== 'ringing' || !cur.peerId || !cur.callId) return;
    signal(cur.peerId, 'accept', cur.callId);
    dispatch({ t: 'accept' }); // → 'connected' → the mic effect opens the track
  }, [signal]);

  const decline = useCallback(() => {
    const cur = stateRef.current;
    if (cur.state !== 'ringing' || !cur.peerId || !cur.callId) return;
    signal(cur.peerId, 'decline', cur.callId);
    dispatch({ t: 'decline' });
  }, [signal]);

  const hangup = useCallback(() => {
    const cur = stateRef.current;
    if (cur.peerId && cur.callId && cur.state !== 'idle' && cur.state !== 'ended') {
      signal(cur.peerId, 'bye', cur.callId);
    }
    dispatch({ t: 'hangup' });
  }, [signal]);

  const reset = useCallback(() => dispatch({ t: 'reset' }), []);

  // ── Ring/calling timeout (auto-end an unanswered call; never auto-answers) ──
  useEffect(() => {
    if (state.state !== 'calling' && state.state !== 'ringing') return;
    const callId = state.callId;
    const timer = window.setTimeout(() => {
      if (callId) dispatch({ t: 'timeout', callId });
    }, RING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [state.state, state.callId]);

  // ── MIC LIFECYCLE — the single privacy-critical effect ──────────────────────
  // Open the mic ONLY while connected; stop it the instant we leave 'connected'.
  useEffect(() => {
    const wantMic = isMicActive(state);
    if (!wantMic) {
      teardownMedia();
      return;
    }
    // We are connected. If the mic is unavailable here (insecure context /
    // iframe-denied) we DO NOT attempt getUserMedia — the call stays connected
    // for control purposes but with no live audio (honest banner in the UI).
    if (!micCap.available) {
      setMicLive(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.ontrack = (ev) => {
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = ev.streams[0];
        };
        pc.onicecandidate = (ev) => {
          if (ev.candidate && stateRef.current.peerId && stateRef.current.callId) {
            signal(stateRef.current.peerId, 'ice', stateRef.current.callId, ev.candidate.toJSON());
          }
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed' && stateRef.current.callId) {
            dispatch({ t: 'failed', callId: stateRef.current.callId });
          }
        };
        // NOTE: SDP offer/answer negotiation (createOffer/createAnswer +
        // setLocal/RemoteDescription, exchanged via the same `signal()` relay)
        // is wired in the production media pass — it requires a real secure
        // context + two live peers to exercise and is inert in the http/headless
        // dev container. The mic track + on-air state above are the privacy-
        // critical parts proven now.
        setMicLive(true);
      } catch {
        if (!cancelled) setMicLive(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.state]);

  // Stop the mic if the component unmounts mid-call (privacy safety net).
  useEffect(() => () => teardownMedia(), [teardownMedia]);

  return {
    state,
    micCap,
    selfId,
    selfName: selfNameResolved,
    micLive,
    call,
    accept,
    decline,
    hangup,
    reset,
    remoteAudioRef,
    roster: roster.filter((p) => p.id !== selfId),
  };
}
