import { useEffect, useState } from 'react';
import { AlarmState } from '../types';

// Reconnect-safe countdown for the alarm exit/entry delay.
//
// We never decrement a local counter (that drifts on reconnect, tab-throttling,
// and disagrees across panels). Instead we anchor on Alarmo's `delay` total and
// the entity's `last_changed` (both carried on AlarmState) and recompute the
// remaining seconds from the wall clock on every tick. On reconnect the anchor
// is re-read from fresh state, so the countdown resumes at the correct value
// with zero drift, and every panel shows the same number with no coordination.
//
// Returns { remaining, total }. `remaining` is null when there is no active
// delay anchor (e.g. a generic alarm_control_panel that doesn't expose `delay`,
// or an instant arm) — callers should then show an indeterminate state instead
// of a number.
export function useAlarmCountdown(alarmState: AlarmState | null | undefined): { remaining: number | null; total: number | null } {
    const total = alarmState?.haDelayTotal ?? null;
    const startedAt = alarmState?.haDelayStartedAt ?? null;
    const endMs = (total != null && startedAt) ? Date.parse(startedAt) + total * 1000 : null;

    const compute = (): number | null => {
        if (endMs == null || Number.isNaN(endMs)) return null;
        return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
    };

    const [remaining, setRemaining] = useState<number | null>(compute);

    useEffect(() => {
        if (endMs == null || Number.isNaN(endMs)) {
            setRemaining(null);
            return;
        }
        // Recompute immediately (anchor may have just changed) then tick. 250ms
        // keeps the displayed integer second responsive without a busy loop.
        setRemaining(Math.max(0, Math.ceil((endMs - Date.now()) / 1000)));
        const id = window.setInterval(() => {
            setRemaining(Math.max(0, Math.ceil((endMs - Date.now()) / 1000)));
        }, 250);
        return () => window.clearInterval(id);
    }, [endMs]);

    return { remaining, total };
}
