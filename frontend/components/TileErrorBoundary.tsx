import React from 'react';
import { IconAlertTriangle } from './icons';

// Isolates a single tile's render failure so one bad entity / malformed state
// can't unmount the whole dashboard (React's default on an uncaught render
// error). Renders a small on-style fallback in place of the broken tile.
interface Props { label?: string; cornerClassName?: string; children: React.ReactNode }
interface State { hasError: boolean }

class TileErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Surface in the console for debugging; the UI degrades gracefully.
    console.error('[B-Panels] Tile crashed:', this.props.label, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className={`bg-gray-700 rounded-tile h-full w-full flex flex-col items-center justify-center text-center p-2 overflow-hidden ${this.props.cornerClassName || ''}`}
          style={{ color: 'rgb(var(--text))', border: '1px solid var(--tile-border)' }}
        >
          <IconAlertTriangle className="w-6 h-6 text-amber-500 mb-1" />
          <p className="text-xs font-semibold" style={{ opacity: 0.8 }}>{this.props.label || 'Tile'} error</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default TileErrorBoundary;
