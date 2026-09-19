// Panel self-telemetry: report browser memory back to Home Assistant.
//
// WHY THIS EXISTS: the Fire-tablet kiosks were dying overnight. Fully Kiosk's
// `free_memory` showed device RAM decaying ~900 MB over 24-46 h until Android's
// low-memory killer terminated the app, which then restarted with ~1150 MB free
// (confirmed 2026-09-18 across 7 outages on two panels). Device RAM cannot tell
// us WHOSE memory it is: the WebView renderer is a separate process, and long
// Chrome/WebView kiosk sessions leak on their own regardless of page code.
//
// `performance.memory` reports the JS heap of THIS page only. So:
//   * JS heap grows in step with device RAM  -> the leak is in our SPA.
//   * JS heap flat while device RAM falls    -> it is the WebView/native side,
//                                               and fixing our JS will not help.
// That is the one measurement that distinguishes the two, and we had none.
//
// Chromium-only (`performance.memory` is non-standard and absent on Safari/
// Firefox), which is fine: the Fire tablets are the devices we need this from.
// Reporting is best-effort — a failed POST must never disturb the panel.

import { useEffect } from 'react';

const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const ENDPOINT = '/api/b_panels/heartbeat';

const KEY = 'bp_installation_id';

/** Stable per-device id so samples from one panel form one series. */
function installationId(): string {
    try {
        let id = localStorage.getItem(KEY);
        if (!id) {
            id = `panel-${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem(KEY, id);
        }
        return id;
    } catch {
        return 'panel-unknown';
    }
}

function sample(): Record<string, unknown> | null {
    const mem = (performance as any)?.memory;
    if (!mem) return null;
    const mb = (n: number) => Math.round(n / 1048576);
    return {
        jsHeapUsedMb: mb(mem.usedJSHeapSize),
        jsHeapTotalMb: mb(mem.totalJSHeapSize),
        jsHeapLimitMb: mb(mem.jsHeapSizeLimit),
        // Counting live DOM nodes is cheap and catches the other common kiosk
        // leak: detached/duplicated subtrees that never get collected.
        domNodes: document.getElementsByTagName('*').length,
        listeners: (performance as any)?.eventCounts?.size ?? null,
        uptimeMin: Math.round(performance.now() / 60000),
    };
}

export function usePanelTelemetry(enabled = true): void {
    useEffect(() => {
        if (!enabled) return;
        const iid = installationId();

        const report = () => {
            const s = sample();
            if (!s) return; // non-Chromium: nothing useful to send
            const body = JSON.stringify({
                installationId: iid,
                kind: 'memory',
                url: location.pathname,
                ...s,
            });
            // keepalive so a sample still goes out if the page is being torn
            // down - that is exactly the sample we most want.
            fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true,
            }).catch(() => { /* best-effort; never disturb the panel */ });
        };

        report();
        const id = setInterval(report, REPORT_INTERVAL_MS);
        return () => clearInterval(id);
    }, [enabled]);
}
