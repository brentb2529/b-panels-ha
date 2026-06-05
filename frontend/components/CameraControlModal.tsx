import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { Device, DeviceType } from '../types';
import { IconX, IconActivity, IconUsers, IconVideo, IconMoon, IconChevronRight, IconPower } from './icons';
import { useDashboard, useDashboardActions } from '../hooks/useDashboard';
import * as haClient from '../services/haClient';
import VideoStream from './VideoStream';

// Spotlight camera view + control rail. Opened when a camera tile is enlarged.
// Shows one large live stream, a thumbnail strip to switch cameras, and a rail
// that renders — for the active camera — whatever sibling control/status
// entities the integration exposes (grouped via the HA device registry):
//   - live detection chips (motion / person / vehicle / animal)
//   - a Controls section that AUTO-RENDERS any controllable member entity
//     (toggle / number / select / press) using the generic capability path,
//     so e.g. UniFi Protect's recording-mode / IR / status-light controls
//     appear here with zero per-integration code once HA exposes them.
//   - a Status grid of read-only readouts (recording mode, IR, mic, etc.)
//
// Theming follows the dashboard glass language: var-mapped surfaces, --text,
// semantic accents; adapts to light/dark.

interface Props { device: Device; onClose: () => void; }

const titleCase = (s: string) => s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const humanizeTail = (entityId: string) =>
  titleCase((entityId.split('.').pop() || entityId).replace(/_/g, ' '));

const ON = new Set(['on', 'open', 'home', 'playing', 'locked', 'active', 'true', 'detected']);
const isOn = (s: Device['state']) => s === true || (typeof s === 'string' && ON.has(s.toLowerCase()));

const fmt = (d: Device): string => {
  const data = d.capabilityData || {};
  const raw = d.state;
  if (typeof raw === 'boolean') return raw ? 'On' : 'Off';
  if (raw === '' || raw == null) return '—';
  const str = String(raw);
  if (str === 'unavailable' || str === 'unknown') return '—';
  const num = Number(str);
  if (str.trim() !== '' && !Number.isNaN(num)) return data.unit ? `${num} ${data.unit}` : `${num}`;
  return titleCase(str.replace(/_/g, ' '));
};

// Live detection chips: which member binary_sensors to surface and their icon.
const DETECTIONS: { re: RegExp; label: string; Icon: any }[] = [
  { re: /_motion$/, label: 'Motion', Icon: IconActivity },
  { re: /_person_detected$/, label: 'Person', Icon: IconUsers },
  { re: /_vehicle_detected$/, label: 'Vehicle', Icon: IconVideo },
  { re: /_animal_detected$/, label: 'Animal', Icon: IconActivity },
];

// Read-only status readouts to surface (suffix -> label), in display order.
const STATUS_ROWS: { re: RegExp; label: string }[] = [
  { re: /_recording_mode$/, label: 'Recording' },
  { re: /_infrared_mode$/, label: 'Infrared' },
  { re: /_hdr_mode$/, label: 'HDR' },
  { re: /_status_light$/, label: 'Status light' },
  { re: /_microphone_level$/, label: 'Mic level' },
  { re: /_is_dark$/, label: 'Is dark' },
  { re: /_last_motion_detected$/, label: 'Last motion' },
  { re: /_link_speed$/, label: 'Link' },
  { re: /_storage_used$/, label: 'Storage' },
];

const CameraControlModal = ({ device, onClose }: Props) => {
  const { devices, entityDeviceMap } = useDashboard();
  const { updateDeviceState } = useDashboardActions();

  // All camera devices, deduped to one per physical HA device (prefer the
  // secure high-res channel over the "_insecure" sibling).
  const cameras = useMemo(() => {
    const all = devices.filter(d => d.type === DeviceType.Camera);
    const byDev = new Map<string, Device>();
    const loners: Device[] = [];
    for (const c of all) {
      const dev = entityDeviceMap[c.id];
      if (!dev) { loners.push(c); continue; }
      const existing = byDev.get(dev);
      if (!existing || (/_insecure$/.test(existing.id) && !/_insecure$/.test(c.id))) byDev.set(dev, c);
    }
    return [...byDev.values(), ...loners].sort((a, b) => a.name.localeCompare(b.name));
  }, [devices, entityDeviceMap]);

  const [activeId, setActiveId] = useState(device.id);
  const active = useMemo(() => cameras.find(c => c.id === activeId) || device, [cameras, activeId, device]);

  // Sibling entities of the active camera (same HA device), minus camera entities.
  const members = useMemo(() => {
    const devId = entityDeviceMap[active.id];
    if (!devId) return [] as Device[];
    return devices.filter(d => d.id !== active.id && d.type !== DeviceType.Camera && entityDeviceMap[d.id] === devId);
  }, [devices, entityDeviceMap, active.id]);

  // Strip the device-name words a member shares with the camera so a control
  // reads "Status light", not "G5 Turret Ultra Status light". Computed per
  // member against the camera name (robust to oddly-named siblings).
  const cleanLabel = (m: Device) => {
    const a = active.name.split(' '), w = m.name.split(' ');
    let i = 0;
    while (a[i] !== undefined && a[i] === w[i]) i++;
    return w.slice(i).join(' ').trim() || humanizeTail(m.id);
  };

  // Controls: controllable members, ordered selects -> numbers -> toggles so the
  // primary settings (recording/IR/HDR, mic) sit above the on/off switches.
  const controls = useMemo(() => {
    const order: Record<string, number> = { 'mode-select': 0, number: 1, toggle: 2, press: 3 };
    return members
      .filter(m => m.capabilityData?.controllable === true)
      .sort((a, b) => (order[a.capabilityData?.primary] ?? 9) - (order[b.capabilityData?.primary] ?? 9) || a.name.localeCompare(b.name));
  }, [members]);
  // Live detections: read-only binary_sensor STATE entities only (not the
  // controllable "enable detection" switches that share a similar name).
  const detections = useMemo(() => DETECTIONS
    .map(d => ({ ...d, member: members.find(m => m.capabilityData?.domain === 'binary_sensor' && d.re.test(m.id)) }))
    .filter(d => d.member), [members]);
  // Status: read-only readouts whose concept isn't already a control above.
  const statusRows = useMemo(() => STATUS_ROWS
    .map(s => ({ ...s, member: members.find(m => m.capabilityData?.controllable !== true && s.re.test(m.id) && !controls.some(c => s.re.test(c.id))) }))
    .filter(s => s.member), [members, controls]);

  // Live HLS stream for the active camera.
  const [hls, setHls] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHls(null);
    haClient.getCameraStreamUrl(active.id)
      .then(url => { if (!cancelled) setHls(url); })
      .catch(() => { if (!cancelled) setHls(null); });
    return () => { cancelled = true; };
  }, [active.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Compact, in-style control for one controllable member, by capability.
  const renderControl = (m: Device) => {
    const primary = m.capabilityData?.primary;
    const label = cleanLabel(m);
    const row = (control: React.ReactNode) => (
      <div key={m.id} className="flex items-center justify-between gap-3 py-2">
        <span className="text-sm truncate" style={{ opacity: 0.85 }}>{label}</span>
        {control}
      </div>
    );

    if (primary === 'toggle') {
      const on = isOn(m.state);
      return row(
        <button
          onClick={() => updateDeviceState(m.id, !on)}
          className="px-3 py-1.5 rounded-control text-xs font-bold transition active:scale-95"
          style={{ backgroundColor: on ? 'rgb(var(--accent))' : 'rgb(var(--surface-control))', color: on ? '#fff' : 'rgb(var(--text))' }}
        >{on ? 'On' : 'Off'}</button>
      );
    }
    if (primary === 'number') {
      const val = typeof m.state === 'number' ? m.state : parseFloat(String(m.state)) || 0;
      const d = m.capabilityData || {};
      return row(
        <span className="flex items-center gap-2 w-40">
          <input type="range" className="tp-range w-full" min={d.min ?? 0} max={d.max ?? 100} step={d.step ?? 1}
            defaultValue={val} onMouseUp={(e) => updateDeviceState(m.id, parseFloat((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => updateDeviceState(m.id, parseFloat((e.target as HTMLInputElement).value))}
            style={{ ['--tp-thumb' as any]: 'rgb(var(--accent))' }} />
          <span className="text-xs tabular-nums w-10 text-right">{fmt(m)}</span>
        </span>
      );
    }
    if (primary === 'mode-select') {
      const opts: string[] = Array.isArray(m.capabilityData?.options) ? m.capabilityData!.options : [];
      const cur = String(m.state ?? '');
      const next = () => { if (!opts.length) return; const i = opts.indexOf(cur); updateDeviceState(m.id, opts[(i + 1) % opts.length]); };
      return row(
        <button onClick={next} disabled={opts.length < 2}
          className="px-3 py-1.5 rounded-control text-xs font-bold inline-flex items-center gap-1 transition active:scale-95"
          style={{ backgroundColor: 'rgb(var(--surface-control))', color: 'rgb(var(--text))' }}>
          {titleCase(cur.replace(/_/g, ' ')) || '—'} <IconChevronRight className="w-3.5 h-3.5" />
        </button>
      );
    }
    if (primary === 'press') {
      return row(
        <button onClick={() => updateDeviceState(m.id, 'press')}
          className="px-3 py-1.5 rounded-control text-xs font-bold transition active:scale-95"
          style={{ backgroundColor: 'rgb(var(--surface-control))', color: 'rgb(var(--text))' }}>Press</button>
      );
    }
    return row(<span className="text-xs" style={{ opacity: 0.7 }}>{fmt(m)}</span>);
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full h-full max-w-7xl max-h-[95vh] rounded-tile overflow-hidden flex flex-col"
        style={{ backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--text))', border: '1px solid var(--tile-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--tile-border)' }}>
          <h3 className="text-lg font-bold truncate">{active.name}</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-black/10 active:scale-95 transition" style={{ opacity: 0.7 }} aria-label="Close">
            <IconX className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Main: spotlight stream + thumbnail strip */}
          <div className="flex-1 flex flex-col min-h-0 p-2 gap-2">
            <div className="flex-1 relative bg-black rounded-tile overflow-hidden min-h-0">
              {hls ? <VideoStream streamUrl={hls} /> : (
                <div className="w-full h-full flex items-center justify-center text-sm" style={{ opacity: 0.6 }}>Connecting…</div>
              )}
            </div>
            {cameras.length > 1 && (
              <div className="flex gap-2 overflow-x-auto flex-shrink-0 pb-1">
                {cameras.map(c => (
                  <button key={c.id} onClick={() => setActiveId(c.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-control text-xs font-semibold whitespace-nowrap transition active:scale-95"
                    style={{
                      backgroundColor: c.id === active.id ? 'rgb(var(--accent))' : 'rgb(var(--surface-control))',
                      color: c.id === active.id ? '#fff' : 'rgb(var(--text))',
                    }}>
                    <IconVideo className="w-4 h-4" /> {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rail: detections + controls + status */}
          <div className="lg:w-80 flex-shrink-0 overflow-y-auto p-3 lg:border-l" style={{ borderColor: 'var(--tile-border)' }}>
            {detections.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ opacity: 0.55 }}>Live</p>
                <div className="grid grid-cols-2 gap-2">
                  {detections.map(({ label, Icon, member }) => {
                    const on = isOn(member!.state);
                    return (
                      <div key={label} className="flex items-center gap-2 px-2.5 py-2 rounded-control"
                        style={{ backgroundColor: on ? 'rgb(var(--accent-alert) / 0.18)' : 'rgb(var(--surface-control))' }}>
                        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: on ? 'rgb(var(--accent-alert))' : 'currentColor', opacity: on ? 1 : 0.5 }} />
                        <span className="text-xs font-semibold truncate" style={{ opacity: on ? 1 : 0.7 }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ opacity: 0.55 }}>Controls</p>
              {controls.length > 0 ? (
                <div className="divide-y" style={{ borderColor: 'var(--tile-border)' }}>
                  {controls.map(renderControl)}
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs py-2" style={{ opacity: 0.6 }}>
                  <IconPower className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>No controllable entities exposed. In UniFi Protect, give the integration's user <b>local admin</b> rights — recording mode, IR, HDR, status light, etc. will appear here automatically.</span>
                </div>
              )}
            </div>

            {statusRows.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ opacity: 0.55 }}>Status</p>
                <div className="divide-y" style={{ borderColor: 'var(--tile-border)' }}>
                  {statusRows.map(({ label, member }) => (
                    <div key={label} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-sm truncate" style={{ opacity: 0.7 }}>{label}</span>
                      <span className="text-sm font-semibold tabular-nums">{fmt(member!)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CameraControlModal;
