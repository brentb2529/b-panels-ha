// useWeatherSafety — global subscription driving the Freeze + Storm protection
// tier (feat/freeze-storm).
//
// Mirrors useLifeSafetyTakeover's shape: a single always-on subscribeEntities
// subscription + a coarse tick (so the storm "expires in ~Nm" countdown and the
// freeze "since" advance with no new push), projecting a `WeatherSafetyView`.
//
// DISPLAY + NOTIFY/LOG ONLY — no callService anywhere in this tier, by
// construction. The view yields to a life-safety takeover via the projection's
// `suppressedByLifeSafety` (computed from the same alarm entity the takeover
// reads) — so precedence is one source of truth, not a UI race.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';
import { projectWeatherSafety, type WeatherSafetyView, type WeatherSafetyConfig } from './weatherSafety';

const TICK_MS = 1000;

export function useWeatherSafety(cfg: WeatherSafetyConfig = {}): WeatherSafetyView {
  const [view, setView] = useState<WeatherSafetyView>(() => projectWeatherSafety({}, cfg));
  const entsRef = useRef<HassEntities>({});
  const cfgRef = useRef<WeatherSafetyConfig>(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const reproject = () => {
      if (cancelled) return;
      setView(projectWeatherSafety(entsRef.current, cfgRef.current));
    };

    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          reproject();
        });
      } catch {
        // No feed → nothing active (the projection returns inert). This tier is
        // NOT life-safety — a lost feed here simply means no banner, which is
        // correct (the life-safety takeover owns the signal-lost story).
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
