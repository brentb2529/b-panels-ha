// useLifeSafetyTakeover — the GLOBAL, unconditional subscription that drives the
// life-safety takeover overlay (Increment 10).
//
// Mounted ONCE at the top of the render tree (above the scoped router), this hook
// keeps an always-on subscription to the HA entity feed + the WS connection
// liveness, and projects a `TakeoverView` every push / tick. It is the mechanism
// the FIRE_LIFE_SAFETY_REVIEW §5 + §8.3 require: a global WS subscription, active
// on every route/panel including PIN-locked / scoped ones, feeding a top-of-tree
// non-dismissible overlay.
//
// DISPLAY + ANNUNCIATION ONLY — no callService anywhere. The overlay it feeds
// renders gated controls (disarm / silence / cancel) that issue ZERO actuation.

import { useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities, subscribeConnectionState } from '../../services/haClient';
import { projectTakeover, type TakeoverView } from './lifeSafety';

const STALE_AFTER_MS = 45000;
// Re-project on a coarse tick so relative ages ("40s ago"), the entry-delay
// countdown, and the stale→signal-lost flip advance even with no new HA push.
const TICK_MS = 1000;

export function useLifeSafetyTakeover(): TakeoverView {
  const [view, setView] = useState<TakeoverView>(() =>
    projectTakeover({}, true, null, Date.now(), STALE_AFTER_MS));

  const entsRef = useRef<HassEntities>({});
  const connectedRef = useRef<boolean>(true);
  const lastSeenRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubEnts: (() => void) | null = null;
    let unsubConn: (() => void) | null = null;

    const reproject = () => {
      if (cancelled) return;
      setView(projectTakeover(
        entsRef.current,
        connectedRef.current,
        lastSeenRef.current,
        Date.now(),
        STALE_AFTER_MS,
      ));
    };

    (async () => {
      try {
        unsubConn = await subscribeConnectionState((connected) => {
          if (cancelled) return;
          connectedRef.current = connected;
          // On reconnect, re-evaluate immediately so a takeover that occurred
          // during the outage re-asserts itself (review §0.3).
          reproject();
        });
      } catch {
        connectedRef.current = false;
      }
      try {
        unsubEnts = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          lastSeenRef.current = Date.now();
          connectedRef.current = true; // a push means we're live
          reproject();
        });
      } catch {
        // Subscription failed → signal-lost (handled by projectTakeover: no
        // entity + not connected → 'signal-lost', which reads UNKNOWN not clear).
        connectedRef.current = false;
        reproject();
      }
    })();

    const timer = window.setInterval(reproject, TICK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (unsubEnts) unsubEnts();
      if (unsubConn) unsubConn();
    };
  }, []);

  return view;
}
