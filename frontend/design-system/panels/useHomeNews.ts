// useHomeNews — subscription driving the Home overview RSS headline ticker
// (feat/home-rss).
//
// Mirrors useWeatherSafety: ONE subscribeEntities subscription + a coarse tick
// (so relative times advance without a new push) projecting a `HomeNewsView`.
//
// DISPLAY-ONLY — no callService anywhere in this hook, by construction. A
// missing/unavailable feed simply yields `present:false` / empty headlines and
// the ticker renders nothing (graceful absence, never an error wall on Home).

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';
import { projectHomeNews, type HomeNewsView, type HomeNewsConfig } from './homeNews';

// Relative times only need minute-resolution; tick once a minute.
const TICK_MS = 60_000;

export function useHomeNews(cfg: HomeNewsConfig = {}): HomeNewsView {
  const [view, setView] = useState<HomeNewsView>(() => projectHomeNews({}, cfg));
  const entsRef = useRef<HassEntities>({});
  const cfgRef = useRef<HomeNewsConfig>(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const reproject = () => {
      if (cancelled) return;
      setView(projectHomeNews(entsRef.current, cfgRef.current));
    };

    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          reproject();
        });
      } catch {
        // No feed → nothing to show. Home stays clean.
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
