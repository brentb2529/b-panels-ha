// Live state of the panel's voice satellite (HA `assist_satellite.*`), for the
// Switch Pad voice overlay. DISPLAY-ONLY: nothing here starts or controls the
// pipeline — the satellite app (VACA) owns the mic and wake word.
//
// assist_satellite states: idle | listening | processing | responding.
// VACA also publishes what it heard / said as sibling sensors:
//   assist_satellite.vaca_<id>  →  sensor.vaca_<id>_stt  /  sensor.vaca_<id>_tts
// Those are optional; with any other satellite the overlay shows state only.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';

export type VoicePhase = 'idle' | 'listening' | 'processing' | 'responding';

export interface VoiceView {
  phase: VoicePhase;
  visible: boolean;   // overlay shown (active, or lingering after a reply)
  heard: string;      // what the user said (this interaction only)
  reply: string;      // what the assistant answered (this interaction only)
}

export const LINGER_MS = 5000;

export const siblingSensors = (satelliteId: string) => {
  const obj = satelliteId.replace(/^assist_satellite\./, '');
  return { stt: `sensor.${obj}_stt`, tts: `sensor.${obj}_tts` };
};

const PHASES = new Set<VoicePhase>(['idle', 'listening', 'processing', 'responding']);
const clean = (v: unknown) => {
  const s = String(v ?? '').trim();
  return !s || s === 'unknown' || s === 'unavailable' ? '' : s;
};

export interface VoiceSnapshot { phase: VoicePhase; stt: string; tts: string }

export const readSnapshot = (ents: HassEntities, satelliteId: string): VoiceSnapshot => {
  const { stt, tts } = siblingSensors(satelliteId);
  const raw = String(ents[satelliteId]?.state ?? 'idle') as VoicePhase;
  return { phase: PHASES.has(raw) ? raw : 'idle', stt: clean(ents[stt]?.state), tts: clean(ents[tts]?.state) };
};

/**
 * Pure step: given the previous view, the baseline transcript values captured
 * when this interaction started, and a new snapshot, compute the next view.
 * Transcript text only counts once it differs from the baseline, so a stale
 * answer from the previous interaction is never shown.
 */
export const stepVoice = (
  prev: VoiceView,
  base: { stt: string; tts: string },
  snap: VoiceSnapshot,
): VoiceView => {
  const active = snap.phase !== 'idle';
  const heard = snap.stt && snap.stt !== base.stt ? snap.stt : prev.heard;
  const reply = snap.tts && snap.tts !== base.tts ? snap.tts : prev.reply;
  return { phase: snap.phase, visible: active || prev.visible, heard, reply };
};

const HIDDEN: VoiceView = { phase: 'idle', visible: false, heard: '', reply: '' };

export function useVoiceSatellite(satelliteId?: string): VoiceView {
  const [view, setView] = useState<VoiceView>(HIDDEN);
  const base = useRef({ stt: '', tts: '' });
  const lastPhase = useRef<VoicePhase>('idle');
  const linger = useRef<number | null>(null);

  useEffect(() => {
    if (!satelliteId) { setView(HIDDEN); return; }
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          const snap = readSnapshot(ents, satelliteId);
          // A new interaction starts when we leave idle: reset text, remember baseline.
          if (lastPhase.current === 'idle' && snap.phase !== 'idle') {
            base.current = { stt: snap.stt, tts: snap.tts };
            if (linger.current) { window.clearTimeout(linger.current); linger.current = null; }
            setView({ ...HIDDEN });
          }
          // Back to idle: keep the reply on screen briefly, then hide.
          if (lastPhase.current !== 'idle' && snap.phase === 'idle') {
            if (linger.current) window.clearTimeout(linger.current);
            linger.current = window.setTimeout(() => setView((v) => ({ ...v, visible: false })), LINGER_MS);
          }
          lastPhase.current = snap.phase;
          setView((v) => stepVoice(v, base.current, snap));
        });
      } catch { /* no HA connection yet — overlay simply stays hidden */ }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
      if (linger.current) window.clearTimeout(linger.current);
    };
  }, [satelliteId]);

  return view;
}
