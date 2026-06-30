import React from 'react';

// ---------------------------------------------------------------------------
// lazyWithRetry — resilient code-split loading for the compilation panels.
//
// WHY: every panel is `React.lazy(() => import(...))`, so each is a separate
// content-hashed chunk (e.g. `LightingPanel-DsrYpW7e.js`). When a new build is
// deployed, the chunk hashes change. A browser/iPad that still holds the OLD
// `index.html` references chunk URLs that no longer exist on the server. The
// next time the user opens a not-yet-loaded panel, `import()` REJECTS with a
// "failed to fetch dynamically imported module" error. `React.Suspense` only
// catches the *pending* promise — a rejection bubbles past it and unmounts the
// whole app (black screen), which is exactly the "click Lights → black page,
// forced hard reload" failure.
//
// FIX: detect a stale-chunk failure and self-heal by reloading ONCE to pull the
// fresh index.html (which points at the current hashes). A sessionStorage guard
// prevents a reload loop if the chunk is genuinely broken (not merely stale).
// We also retry the import once before reloading, to ride out a transient blip.
// ---------------------------------------------------------------------------

const RELOAD_AT = 'bp:chunkReloadAt';
const RELOAD_COUNT = 'bp:chunkReloadCount';
const RELOAD_DEBOUNCE_MS = 10_000;
const MAX_AUTO_RELOADS = 2; // bounded — after this we stop and show a manual Reload, never a loop

// Called when a lazy chunk loads cleanly — clears the recovery budget so the
// next stale deploy gets a fresh set of auto-reload attempts.
export function noteChunkLoadSuccess(): void {
  try { sessionStorage.removeItem(RELOAD_COUNT); sessionStorage.removeItem(RELOAD_AT); } catch { /* ignore */ }
}

// True only while auto-reload attempts remain — lets the boundary decide between
// a transient "Updating…" state and a terminal "tap to retry" affordance.
export function canAutoReload(): boolean {
  try { return Number(sessionStorage.getItem(RELOAD_COUNT) || '0') < MAX_AUTO_RELOADS; } catch { return true; }
}

// Cross-browser detection of a dynamic-import / chunk load failure.
//   Chrome:  "Failed to fetch dynamically imported module: <url>"
//   Firefox: "error loading dynamically imported module: <url>"
//   Safari:  "Importing a module script failed."
//   (legacy/webpack) "ChunkLoadError" / "Loading chunk N failed"
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err && (err as { message?: string }).message) || String(err || '');
  const name = (err && (err as { name?: string }).name) || '';
  return (
    name === 'ChunkLoadError' ||
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /loading chunk \d+ failed/i.test(msg) ||
    /dynamically imported module/i.test(msg)
  );
}

// Reload to recover a stale deploy — bounded by both a debounce window and a
// hard attempt cap so a genuinely-missing/corrupt chunk can never loop forever.
// Returns false (→ boundary shows a manual "Reload" affordance) once exhausted.
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_AT) || '0');
    const count = Number(sessionStorage.getItem(RELOAD_COUNT) || '0');
    const now = Date.now();
    if (count >= MAX_AUTO_RELOADS) return false;        // tried enough — hand off to the human
    if (now - last < RELOAD_DEBOUNCE_MS) return false;  // just reloaded — let that attempt settle
    sessionStorage.setItem(RELOAD_AT, String(now));
    sessionStorage.setItem(RELOAD_COUNT, String(count + 1));
  } catch {
    // sessionStorage unavailable (private mode / kiosk) — fall through and reload anyway, once.
  }
  // Force a fresh document (and fresh index.html → current chunk hashes).
  window.location.reload();
  return true;
}

type Importer<T> = () => Promise<{ default: T }>;

// Drop-in replacement for React.lazy() that survives a stale-chunk deploy.
export function lazyWithRetry<T extends React.ComponentType<unknown>>(
  importer: Importer<T>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      const mod = await importer();
      noteChunkLoadSuccess(); // clean load → reset the recovery budget for next time
      return mod;
    } catch (err) {
      if (isChunkLoadError(err)) {
        // One transient retry (cache-busted by the browser's failed-fetch state)…
        try {
          return await importer();
        } catch (err2) {
          if (isChunkLoadError(err2)) {
            // …still failing → stale deploy. Self-heal by reloading the app.
            const reloading = reloadForStaleChunk();
            if (reloading) {
              // Never resolve — the reload is in flight; keep Suspense fallback up.
              return await new Promise<{ default: T }>(() => {});
            }
          }
          throw err2;
        }
      }
      throw err;
    }
  });
}
