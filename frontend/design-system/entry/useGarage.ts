// useGarage — global subscription driving the garage status + proactive alerts
// (feat/doorbell-garage). DISPLAY + NOTIFY/LOG ONLY — no callService anywhere in
// this module, by construction. Close is confirm-to-close gated in the UI and
// fires NOTHING (ratgdo/Matter not in dev; equipment-gated → human-enable only).
//
// Owns ONE subscribeEntities subscription + a coarse 1s tick so the "open for
// ~Nm" age + the time-of-day "open at night" alert re-evaluate without a new
// push.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';
import { projectGarage, type GarageView, type EntryConfig } from './entry';

const TICK_MS = 1000;

export function useGarage(cfg: EntryConfig = {}): GarageView {
  const [view, setView] = useState<GarageView>(() => projectGarage({}, cfg));
  const entsRef = useRef<HassEntities>({});
  const cfgRef = useRef<EntryConfig>(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const reproject = () => {
      if (cancelled) return;
      // nowMs flows from Date.now() inside the projection unless cfg pins it.
      setView(projectGarage(entsRef.current, cfgRef.current));
    };

    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          reproject();
        });
      } catch {
        // No feed → projection returns the inert "no garage connected" view.
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
