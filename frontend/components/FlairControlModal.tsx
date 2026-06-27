import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { useDashboard, useDashboardActions } from '../hooks/useDashboard';
import { FlairState, FlairSystemMode } from '../types';
import { IconSnowflake, IconFlame, IconPower, IconHome, IconPlus, IconMinus } from './icons';

const MIN = 45;
const MAX = 95;

// Flair thermostat. Pick a room, adjust its target temperature like a thermostat
// (each Flair room is its own climate entity). System mode (cool/heat/auto/off)
// is set at the structure level — Flair rooms follow the structure mode and only
// carry their own setpoint. Reads the LIVE composite from context each render so
// current temps update in real time; setClimate optimistically reflects changes.
const FlairControlModal = ({ deviceId, onClose }: { deviceId: string; onClose: () => void }) => {
  const { deviceMap } = useDashboard();
  const { setClimate } = useDashboardActions();
  const device = deviceMap.get(deviceId);
  const state = device?.state as FlairState | undefined;
  const rooms = state?.rooms ?? [];

  // Default to the Master room (this lives on the Primary panel), else first online.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && rooms.some(r => r.id === selectedId)) return;
    const master = rooms.find(r => /master/i.test(r.name) || /master/i.test(r.id));
    const online = rooms.find(r => r.isOnline);
    setSelectedId((master || online || rooms[0])?.id ?? null);
  }, [rooms, selectedId]);

  const room = rooms.find(r => r.id === selectedId) || null;
  const sysMode: FlairSystemMode = state?.structure?.systemMode ?? 'auto';

  const adjust = (delta: number) => {
    if (!room) return;
    const base = room.setPointTemp ?? 70;
    const next = Math.max(MIN, Math.min(MAX, Math.round(base + delta)));
    if (next !== room.setPointTemp) setClimate(room.id, { setpoint: next });
  };

  // auto <-> HA heat_cool. off/cool/heat map 1:1.
  const setSystemMode = (m: FlairSystemMode) => {
    if (!state?.structureId) return;
    setClimate(state.structureId, { mode: m === 'auto' ? 'heat_cool' : m });
  };

  const target = room?.setPointTemp ?? null;
  const cur = room?.currentTemp ?? null;
  const accent = sysMode === 'heat' ? '#fb923c' : sysMode === 'cool' ? '#38bdf8' : sysMode === 'off' ? '#9ca3af' : '#34d399';

  const modes: { key: FlairSystemMode; label: string; Icon: any }[] = [
    { key: 'cool', label: 'Cool', Icon: IconSnowflake },
    { key: 'heat', label: 'Heat', Icon: IconFlame },
    { key: 'auto', label: 'Auto', Icon: IconHome },
    { key: 'off', label: 'Off', Icon: IconPower },
  ];

  return (
    <Modal onClose={onClose} size="md" title={`${state?.structureName || 'Flair'} — Climate`}>
      {rooms.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No Flair rooms available.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Room selector */}
          <div className="flex flex-wrap gap-2">
            {rooms.map(r => {
              const sel = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onPointerDown={() => setSelectedId(r.id)}
                  disabled={!r.isOnline}
                  className={`flex items-center gap-2 px-3 py-2 rounded-control border transition-colors disabled:opacity-40 ${sel ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  style={{ touchAction: 'manipulation' }}
                >
                  <span className="text-sm font-semibold text-white">{r.name}</span>
                  <span className="text-xs tabular-nums text-gray-300">{r.currentTemp ?? '--'}°</span>
                  {r.hvacState === 'heating' && <IconFlame className="w-3.5 h-3.5 text-orange-400" />}
                  {r.hvacState === 'cooling' && <IconSnowflake className="w-3.5 h-3.5 text-sky-400" />}
                </button>
              );
            })}
          </div>

          {/* Thermostat for the selected room */}
          <div className="flex items-center justify-between gap-3 bg-black/30 rounded-tile p-5 border border-white/10">
            <button
              onPointerDown={() => adjust(-1)}
              disabled={!room || target == null}
              className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center disabled:opacity-40"
              style={{ touchAction: 'manipulation' }}
              aria-label="Lower temperature"
            >
              <IconMinus className="w-7 h-7 text-white" />
            </button>

            <div className="flex flex-col items-center">
              <span className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">{room?.name || 'Room'} target</span>
              <div className="flex items-baseline" style={{ filter: `drop-shadow(0 0 14px ${accent}66)` }}>
                <span className="text-6xl font-bold text-white tabular-nums" style={{ color: target != null ? accent : '#9ca3af' }}>
                  {target ?? '--'}
                </span>
                <span className="text-2xl text-gray-300 ml-1 font-semibold">°F</span>
              </div>
              <span className="text-xs text-gray-400 tabular-nums">now {cur ?? '--'}°{!room?.isOnline ? ' · offline' : ''}</span>
            </div>

            <button
              onPointerDown={() => adjust(1)}
              disabled={!room || target == null}
              className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center disabled:opacity-40"
              style={{ touchAction: 'manipulation' }}
              aria-label="Raise temperature"
            >
              <IconPlus className="w-7 h-7 text-white" />
            </button>
          </div>

          {/* System mode (structure-level) */}
          <div>
            <span className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">System mode</span>
            <div className="grid grid-cols-4 gap-2 mt-1.5">
              {modes.map(({ key, label, Icon }) => {
                const sel = sysMode === key;
                return (
                  <button
                    key={key}
                    onPointerDown={() => setSystemMode(key)}
                    className={`flex flex-col items-center gap-1 py-2 rounded-control border transition-colors ${sel ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Icon className="w-5 h-5" style={{ color: sel ? accent : '#d1d5db' }} />
                    <span className={`text-xs font-semibold ${sel ? 'text-white' : 'text-gray-300'}`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default FlairControlModal;
