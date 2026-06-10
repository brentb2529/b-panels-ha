// useDoorbellRing — global subscription driving the doorbell ring tier
// (feat/doorbell-garage). The LOWEST tier: yields to life-safety AND
// weather-safety.
//
// DISPLAY + NOTIFY/LOG ONLY — no callService anywhere, by construction. The
// gate/door release the overlay renders is confirm + equipment + security GATED
// and fires NOTHING (UniFi Access not in dev → human-enable only).
//
// Owns ONE subscribeEntities subscription + a 1s tick so the transient ring
// window expires on its own (the overlay auto-dismisses when the ring goes
// stale) without needing a new push.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';
import { projectDoorbellRing, type DoorbellRingView, type EntryConfig } from './entry';

const TICK_MS = 1000;

export function useDoorbellRing(cfg: EntryConfig = {}): DoorbellRingView {
  const [view, setView] = useState<DoorbellRingView>(() => projectDoorbellRing({}, cfg));
  const entsRef = useRef<HassEntities>({});
  const cfgRef = useRef<EntryConfig>(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const reproject = () => {
      if (cancelled) return;
      setView(projectDoorbellRing(entsRef.current, cfgRef.current));
    };

    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          reproject();
        });
      } catch {
        // No feed → projection returns the inert "no doorbell" view (no overlay).
      }
    })();

    const timer = window.setInterval(reproject, TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (unsub) unsub();
    };
  }, []);

  return view;
}
