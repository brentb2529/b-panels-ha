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
import { findAlarmEntity, projectTakeover, type TakeoverView } from './lifeSafety';

const STALE_AFTER_MS = 45000;
// Re-project on a coarse tick so relative ages ("40s ago"), the entry-delay
// countdown, and the stale→signal-lost flip advance even with no new HA push.
const TICK_MS = 1000;

// Sticky "an alarm entity exists in this deployment" latch. Once we've seen an
// alarm_control_panel.* in the live feed, we remember it for the session so a
// later page reload (which starts with an empty feed + a momentarily-down socket)
// still treats a real disconnect as signal-lost, not a false "no alarm". On a
// deployment that genuinely has no alarm (bare demo/admin panel) this never sets,
// so those panels stay quiet. sessionStorage (not local) so it does not leak a
// false "alarm expected" across truly different deployments/long-dead sessions.
const ALARM_SEEN_KEY = 'bpanels.lifeSafety.alarmSeen';
const readAlarmSeen = (): boolean => {
  try { return window.sessionStorage.getItem(ALARM_SEEN_KEY) === '1'; } catch { return false; }
};
const persistAlarmSeen = () => {
  try { window.sessionStorage.setItem(ALARM_SEEN_KEY, '1'); } catch { /* private mode — ignore */ }
};

export function useLifeSafetyTakeover(): TakeoverView {
  const alarmSeenRef = useRef<boolean>(readAlarmSeen());
  const [view, setView] = useState<TakeoverView>(() =>
    projectTakeover({}, true, null, Date.now(), STALE_AFTER_MS, alarmSeenRef.current));

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
        alarmSeenRef.current,
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
          // Latch "an alarm exists here" the first time we actually see the
          // entity in the feed (even unavailable — its presence proves wiring).
          // From then on a dropped feed reads signal-lost, never no-alarm.
          if (!alarmSeenRef.current && findAlarmEntity(ents)) {
            alarmSeenRef.current = true;
            persistAlarmSeen();
          }
          reproject();
        });
      } catch {
        // Subscription failed → not connected. If an alarm was previously seen
        // this session (alarmSeenRef latched / persisted), projectTakeover reads
        // 'signal-lost' (UNKNOWN, never "all clear") — the real safety case. On a
        // deployment that never had an alarm it reads 'no-alarm' (quiet), so a
        // bare panel doesn't flash a false "don't trust this panel" takeover.
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
