import React from 'react';
import type { PanelDimWindow, PanelMuteWindow } from '../types';

type AnyWindow = PanelDimWindow | PanelMuteWindow;

interface BaseProps {
  /// "Brightness Schedule" or "Mute Schedule" — drives the section heading.
  title: string;
  /// Short hint shown under the title.
  description: string;
  /// Day labels in iPad-local week order (Sun..Sat).
  dayLabels?: string[];
}

interface DimProps extends BaseProps {
  kind: 'dim';
  windows: PanelDimWindow[] | undefined;
  onChange: (next: PanelDimWindow[]) => void;
}

interface MuteProps extends BaseProps {
  kind: 'mute';
  windows: PanelMuteWindow[] | undefined;
  onChange: (next: PanelMuteWindow[]) => void;
}

type Props = DimProps | MuteProps;

const DEFAULT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Inline editor for the per-panel iOS schedules. Used twice in the
/// panel settings: once for brightness (dimSchedule) and once for
/// audio mute (muteSchedule). Browser dashboards and FullyKiosk
/// ignore both fields — only the native iOS BPanels app reads them.
const KioskScheduleEditor: React.FC<Props> = (props) => {
  const labels = props.dayLabels || DEFAULT_DAYS;
  const windows = (props.windows ?? []) as AnyWindow[];

  function setAt(i: number, patch: Partial<AnyWindow>) {
    const next = windows.map((w, idx) => idx === i ? { ...w, ...patch } : w);
    if (props.kind === 'dim') {
      props.onChange(next as PanelDimWindow[]);
    } else {
      props.onChange(next as PanelMuteWindow[]);
    }
  }

  function remove(i: number) {
    const next = windows.filter((_, idx) => idx !== i);
    if (props.kind === 'dim') {
      props.onChange(next as PanelDimWindow[]);
    } else {
      props.onChange(next as PanelMuteWindow[]);
    }
  }

  function add() {
    if (props.kind === 'dim') {
      const next: PanelDimWindow[] = [
        ...(props.windows ?? []),
        { start: '22:00', end: '07:00', brightness: 0.2, days: [] }
      ];
      props.onChange(next);
    } else {
      const next: PanelMuteWindow[] = [
        ...(props.windows ?? []),
        { start: '22:00', end: '07:00', days: [] }
      ];
      props.onChange(next);
    }
  }

  function toggleDay(i: number, day: number) {
    const w = windows[i];
    const current = new Set(w.days ?? []);
    if (current.has(day)) current.delete(day); else current.add(day);
    setAt(i, { days: Array.from(current).sort() });
  }

  return (
    <div className="mt-4 p-3 bg-gray-900/40 rounded-md border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-200">{props.title}</h4>
          <p className="text-xs text-gray-500">{props.description}</p>
        </div>
        <button
          type="button"
          onClick={add}
          className="px-3 py-1 text-xs font-medium bg-brand-blue/30 hover:bg-brand-blue/50 text-brand-blue border border-brand-blue/40 rounded transition-colors"
        >
          + Add Window
        </button>
      </div>

      {windows.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">No windows configured. Tap “Add Window” to create one.</p>
      ) : (
        <div className="space-y-3">
          {windows.map((w, i) => (
            <div key={i} className="p-2 bg-gray-800/60 rounded border border-gray-700/60">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={w.start}
                  onChange={(e) => setAt(i, { start: e.target.value })}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white font-mono"
                  aria-label="start time"
                />
                <span className="text-gray-500 text-xs">→</span>
                <input
                  type="time"
                  value={w.end}
                  onChange={(e) => setAt(i, { end: e.target.value })}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white font-mono"
                  aria-label="end time"
                />
                {props.kind === 'dim' && (
                  <div className="flex items-center gap-2 ml-auto">
                    <label className="text-xs text-gray-400">Brightness</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={(w as PanelDimWindow).brightness}
                      onChange={(e) => setAt(i, { brightness: parseFloat(e.target.value) } as Partial<PanelDimWindow>)}
                      className="w-32"
                    />
                    <span className="text-xs font-mono text-gray-300 w-10 text-right">
                      {Math.round(((w as PanelDimWindow).brightness ?? 0) * 100)}%
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="ml-2 px-2 py-1 text-xs text-red-300 hover:text-red-200 hover:bg-red-900/30 rounded"
                  aria-label="remove window"
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-wrap gap-1 mt-2">
                {labels.map((label, day) => {
                  const active = (w.days ?? []).includes(day);
                  const allDays = !w.days || w.days.length === 0;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(i, day)}
                      className={
                        "px-2 py-0.5 text-xs rounded border transition-colors " +
                        (active
                          ? "bg-brand-blue/40 border-brand-blue/60 text-white"
                          : allDays
                            ? "bg-gray-700/60 border-gray-600 text-gray-300"
                            : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300")
                      }
                      title={active ? "Click to remove" : "Click to include"}
                    >
                      {label}
                    </button>
                  );
                })}
                {(!w.days || w.days.length === 0) && (
                  <span className="text-[10px] text-gray-500 self-center ml-1">(every day)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-500 mt-2">
        iPad local time. Wraparound supported — “22:00 → 07:00” covers overnight.
        Only the native iOS BPanels app reads this; browser panels and FullyKiosk ignore it.
      </p>
    </div>
  );
};

export default KioskScheduleEditor;
