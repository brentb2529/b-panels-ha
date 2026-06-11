import { describe, it, expect } from 'vitest';
import {
  intercomReducer,
  initialIntercomState,
  isMicActive,
  isBusy,
  probeMicCapability,
  getInstallId,
  getRoomName,
  setRoomName,
  newCallId,
  shouldHandleSignal,
  stateLabel,
  type IntercomState,
} from './intercom';

// Panel-to-panel intercom — pure state-machine + privacy-guard tests
// (feat/panel-intercom). Covers, per the build brief:
//   • the call/ring/accept state machine (call → ring → accept → connected → end)
//   • signaling message handling (recv-invite/accept/decline/busy/bye/timeout)
//   • the NO-AUTO-ANSWER guard — no path reaches 'connected' without an explicit
//     accept; a bare invite only ever rings
//   • the NO-PASSIVE-MIC guard — micActive is true IFF state === 'connected'
//   • the permission / secure-context (getUserMedia availability) gate
//   • per-device identity helpers

const ringing = (): IntercomState => ({
  state: 'ringing', direction: 'incoming',
  peerId: 'panel-B', peerName: 'Kitchen', callId: 'c1', endReason: null,
});
const calling = (): IntercomState => ({
  state: 'calling', direction: 'outgoing',
  peerId: 'panel-B', peerName: 'Kitchen', callId: 'c1', endReason: null,
});

describe('intercom — call state machine', () => {
  it('places an outgoing call: idle → calling', () => {
    const s = intercomReducer(initialIntercomState, { t: 'call', peerId: 'panel-B', peerName: 'Kitchen', callId: 'c1' });
    expect(s.state).toBe('calling');
    expect(s.direction).toBe('outgoing');
    expect(s.peerId).toBe('panel-B');
    expect(isMicActive(s)).toBe(false); // mic stays OFF while ringing out
  });

  it('an inbound invite rings (never answers): idle → ringing', () => {
    const s = intercomReducer(initialIntercomState, { t: 'recv-invite', from: 'panel-B', fromName: 'Kitchen', callId: 'c1' });
    expect(s.state).toBe('ringing');
    expect(s.direction).toBe('incoming');
    expect(isMicActive(s)).toBe(false); // CRITICAL: ringing does NOT open the mic
  });

  it('callee accepts: ringing → connected (the ONLY edge that opens the mic)', () => {
    const s = intercomReducer(ringing(), { t: 'accept' });
    expect(s.state).toBe('connected');
    expect(isMicActive(s)).toBe(true);
  });

  it('caller connects when the far end accepts our call: calling → connected', () => {
    const s = intercomReducer(calling(), { t: 'recv-accept', callId: 'c1' });
    expect(s.state).toBe('connected');
    expect(isMicActive(s)).toBe(true);
  });

  it('recv-accept for a DIFFERENT callId does not connect', () => {
    const s = intercomReducer(calling(), { t: 'recv-accept', callId: 'OTHER' });
    expect(s.state).toBe('calling');
    expect(isMicActive(s)).toBe(false);
  });

  it('hangup ends a connected call and stops the mic', () => {
    const connected = intercomReducer(ringing(), { t: 'accept' });
    expect(isMicActive(connected)).toBe(true);
    const ended = intercomReducer(connected, { t: 'hangup' });
    expect(ended.state).toBe('ended');
    expect(ended.endReason).toBe('ended');
    expect(isMicActive(ended)).toBe(false); // mic OFF the instant we leave connected
  });

  it('reset clears the transient ended card back to idle', () => {
    const ended = intercomReducer(ringing(), { t: 'decline' });
    expect(ended.state).toBe('ended');
    const idle = intercomReducer(ended, { t: 'reset' });
    expect(idle).toEqual(initialIntercomState);
  });
});

describe('intercom — signaling message handling', () => {
  it('caller sees decline: calling → ended(declined)', () => {
    const s = intercomReducer(calling(), { t: 'recv-decline', callId: 'c1' });
    expect(s.state).toBe('ended');
    expect(s.endReason).toBe('declined');
  });
  it('caller sees busy: calling → ended(busy)', () => {
    const s = intercomReducer(calling(), { t: 'recv-busy', callId: 'c1' });
    expect(s.state).toBe('ended');
    expect(s.endReason).toBe('busy');
  });
  it('either side sees bye: connected → ended(ended)', () => {
    const connected = intercomReducer(ringing(), { t: 'accept' });
    const s = intercomReducer(connected, { t: 'recv-bye', callId: 'c1' });
    expect(s.state).toBe('ended');
    expect(isMicActive(s)).toBe(false);
  });
  it('an unanswered ring/call times out → ended(timeout)', () => {
    expect(intercomReducer(ringing(), { t: 'timeout', callId: 'c1' }).endReason).toBe('timeout');
    expect(intercomReducer(calling(), { t: 'timeout', callId: 'c1' }).endReason).toBe('timeout');
  });
  it('a connection failure → ended(failed)', () => {
    const connected = intercomReducer(ringing(), { t: 'accept' });
    expect(intercomReducer(connected, { t: 'failed', callId: 'c1' }).endReason).toBe('failed');
  });
  it('signals for a stale/unknown callId are ignored', () => {
    expect(intercomReducer(calling(), { t: 'recv-bye', callId: 'STALE' })).toEqual(calling());
    expect(intercomReducer(calling(), { t: 'timeout', callId: 'STALE' })).toEqual(calling());
  });
});

describe('intercom — NO-AUTO-ANSWER guard (privacy critical)', () => {
  it('no sequence of remote signals reaches connected without an explicit accept', () => {
    // Drive the machine with EVERY remote/internal action from a fresh ring and
    // assert none of them (other than a local accept) ever opens the mic.
    let s = intercomReducer(initialIntercomState, { t: 'recv-invite', from: 'panel-B', fromName: 'Kitchen', callId: 'c1' });
    expect(s.state).toBe('ringing');
    const remoteActions = [
      { t: 'recv-invite', from: 'panel-C', fromName: 'Den', callId: 'c2' },
      { t: 'recv-accept', callId: 'c1' },
      { t: 'recv-ice' as any, callId: 'c1' }, // unknown action — reducer ignores
      { t: 'recv-bye', callId: 'OTHER' },
    ] as const;
    for (const a of remoteActions) {
      s = intercomReducer(s, a as any);
      // The only way to connected is a LOCAL accept; assert remote drive can't.
      if (s.state === 'connected') throw new Error('reached connected without an explicit accept!');
    }
    expect(s.state === 'connected').toBe(false);
  });

  it('a second invite while busy does NOT bump us into answering', () => {
    const connected = intercomReducer(ringing(), { t: 'accept' });
    expect(isBusy(connected)).toBe(true);
    const after = intercomReducer(connected, { t: 'recv-invite', from: 'panel-C', fromName: 'Den', callId: 'c2' });
    expect(after).toEqual(connected); // unchanged — still on the first call, no answer
  });

  it('accept is a no-op unless currently ringing (cannot fabricate a connect)', () => {
    expect(intercomReducer(initialIntercomState, { t: 'accept' }).state).toBe('idle');
    expect(intercomReducer(calling(), { t: 'accept' }).state).toBe('calling');
  });
});

describe('intercom — NO-PASSIVE-MIC guard', () => {
  it('micActive is true IFF state === connected, across all states', () => {
    const states: IntercomState['state'][] = ['idle', 'calling', 'ringing', 'connected', 'ended'];
    for (const st of states) {
      const s = { ...initialIntercomState, state: st } as IntercomState;
      expect(isMicActive(s)).toBe(st === 'connected');
    }
  });
});

describe('intercom — secure-context / mic-capability gate', () => {
  it('reports unavailable when mediaDevices is missing (insecure context / iframe-denied)', () => {
    expect(probeMicCapability({} as any)).toEqual({ available: false, reason: 'no-mediadevices' });
  });
  it('reports unavailable when getUserMedia is missing', () => {
    expect(probeMicCapability({ mediaDevices: {} } as any)).toEqual({ available: false, reason: 'no-getusermedia' });
  });
  it('reports available when getUserMedia exists', () => {
    expect(probeMicCapability({ mediaDevices: { getUserMedia: () => {} } } as any)).toEqual({ available: true, reason: 'ok' });
  });
});

describe('intercom — inbound signal addressing (presence broadcast)', () => {
  it('handles a message addressed directly to us', () => {
    expect(shouldHandleSignal('me', { to: 'me', from: 'them' })).toBe(true);
  });
  it('handles a broadcast (to:"*") — REQUIRED for presence discovery', () => {
    expect(shouldHandleSignal('me', { to: '*', from: 'them' })).toBe(true);
  });
  it('ignores a message for a different panel', () => {
    expect(shouldHandleSignal('me', { to: 'someone-else', from: 'them' })).toBe(false);
  });
  it('always ignores our own echo (even a broadcast we sent)', () => {
    expect(shouldHandleSignal('me', { to: '*', from: 'me' })).toBe(false);
    expect(shouldHandleSignal('me', { to: 'me', from: 'me' })).toBe(false);
  });
});

describe('intercom — per-device identity + helpers', () => {
  function memStore(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => (m.has(k) ? m.get(k)! : null),
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  it('getInstallId is stable per device (persists + reuses)', () => {
    const s = memStore();
    const a = getInstallId(s);
    const b = getInstallId(s);
    expect(a).toBe(b);
    expect(a.startsWith('panel-')).toBe(true);
  });

  it('room name falls back, then persists an override', () => {
    const s = memStore();
    expect(getRoomName('Kitchen', s)).toBe('Kitchen');
    setRoomName('Pool House', s);
    expect(getRoomName('Kitchen', s)).toBe('Pool House');
  });

  it('newCallId is unique-ish and prefixed', () => {
    const a = newCallId(); const b = newCallId();
    expect(a).not.toBe(b);
    expect(a.startsWith('call-')).toBe(true);
  });

  it('stateLabel reflects each state', () => {
    expect(stateLabel(ringing())).toMatch(/calling/i);
    expect(stateLabel(intercomReducer(ringing(), { t: 'accept' }))).toMatch(/on air/i);
    expect(stateLabel(intercomReducer(ringing(), { t: 'decline' }))).toMatch(/declined/i);
  });
});
