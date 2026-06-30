import React from 'react';
import { isChunkLoadError, reloadForStaleChunk, canAutoReload } from '../services/lazyWithRetry';

// ---------------------------------------------------------------------------
// ChunkErrorBoundary — backstop around the lazy compilation panels.
//
// `lazyWithRetry` self-heals a stale-chunk import rejection by reloading, but a
// boundary is still required because:
//   (a) Suspense does NOT catch render errors — only pending promises. Any throw
//       a panel makes on mount would otherwise unmount the whole app (black
//       screen). This isolates the failure to the panel region.
//   (b) it covers the brief window before the auto-reload navigates away, and
//       any chunk error that surfaces as a render throw rather than an import
//       rejection.
//
// On a chunk-load error it shows a quiet "Updating…" card and triggers the same
// one-shot reload. On any other error it degrades to a small, dismissible
// in-panel message instead of a dead black screen.
// ---------------------------------------------------------------------------

interface Props { label?: string; children: React.ReactNode }
interface State { hasError: boolean; isChunk: boolean; reloading: boolean }

class ChunkErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, isChunk: false, reloading: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, isChunk: isChunkLoadError(error), reloading: false };
  }

  componentDidCatch(error: unknown) {
    console.error('[B-Panels] Panel boundary caught:', this.props.label, error);
    if (isChunkLoadError(error)) {
      // Self-heal a stale deploy: reload to fetch the current index.html. If the
      // auto-reload budget is spent, fall through to a manual Reload affordance
      // (never a stuck "Updating…" or a reload loop).
      const reloading = reloadForStaleChunk();
      this.setState({ reloading });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isChunk) {
        // A reload is in flight (budget remained) → calm updating state.
        if (this.state.reloading || canAutoReload()) {
          return (
            <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '60vh', color: 'rgb(var(--text))' }}>
              <div style={{ opacity: 0.85, fontSize: '0.95rem', letterSpacing: '0.02em' }}>Updating to the latest version…</div>
              <div style={{ opacity: 0.5, fontSize: '0.8rem', marginTop: 6 }}>One moment</div>
            </div>
          );
        }
        // Auto-reload budget exhausted → hand off to the human, never a dead end.
        return (
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '60vh', color: 'rgb(var(--text))' }}>
            <div style={{ opacity: 0.85, fontSize: '0.95rem' }}>Couldn’t finish updating.</div>
            <button
              type="button"
              onClick={() => { try { sessionStorage.removeItem('bp:chunkReloadCount'); } catch { /* ignore */ } window.location.reload(); }}
              style={{ marginTop: 12, padding: '8px 18px', borderRadius: 10, border: '1px solid var(--tile-border)', background: 'transparent', color: 'rgb(var(--text))', cursor: 'pointer' }}
            >
              Tap to reload
            </button>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '60vh', color: 'rgb(var(--text))' }}>
          <div style={{ opacity: 0.85, fontSize: '0.95rem' }}>{this.props.label || 'This panel'} hit a problem.</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 12, padding: '8px 18px', borderRadius: 10, border: '1px solid var(--tile-border)', background: 'transparent', color: 'rgb(var(--text))', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ChunkErrorBoundary;
