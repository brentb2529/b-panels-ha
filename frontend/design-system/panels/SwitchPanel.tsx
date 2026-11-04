import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, Lamp, Fan, Plug, Sparkles, Play, Power, type LucideIcon } from 'lucide-react';
import type { DashboardPanel } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import {
  useSwitchPadEntities, type SwitchView, type SwitchIcon, type SwitchPadView, MAX_SWITCHES,
} from './useSwitchPadEntities';
import { useVoiceSatellite, type VoiceView } from './useVoiceSatellite';
import './switchPanel.css';

// ---------------------------------------------------------------------------
// SwitchPanel — compact "Switch Pad" compilation panel (compilationKind
// 'switches') for small portrait wall panels (YC-SM55P 5.5", 720×1280).
//
// Same liquid-glass identity as the iPad compilation panels (Cormorant hero
// title over a sky wash, DM Sans body, frosted cards), scaled for a 5" screen:
// a short hero with the room name + clock, then 4 or 6 large tap targets in a
// 2-column grid, and an "All Off" bar. No bottom area-switcher — these panels
// are single-room by design.
//
// Entities come from the panel's own tiles[] (see useSwitchPadEntities), so
// each small panel is configured in the normal admin tile editor.
//
// Scoping: all markup under `.swp-scope`, all CSS namespaced `swp-*`.
// ---------------------------------------------------------------------------

const ICONS: Record<SwitchIcon, LucideIcon> = {
  light: Lightbulb, lamp: Lamp, fan: Fan, outlet: Plug, scene: Sparkles, script: Play, power: Power,
};

const fmtTime = (d: Date) => {
  let h = d.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return { hm: `${h}:${String(d.getMinutes()).padStart(2, '0')}`, ampm };
};
const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// Optimistic feedback: a tapped toggle flips immediately and settles when HA
// confirms (or reverts after PENDING_MS if HA never does).
const PENDING_MS = 4000;

interface ViewProps {
  title: string;
  eyebrow: string;
  view: Omit<SwitchPadView, 'status'> & { status: SwitchPadView['status'] };
  now: Date;
  pending?: Record<string, boolean>; // entityId → optimistic on/off
  fired?: string | null;              // momentary just-fired entityId
  onActivate: (s: SwitchView) => void;
  onAllOff: () => void;
  voice?: VoiceView;                  // live voice-satellite state (overlay)
}

const VOICE_LABEL: Record<VoiceView['phase'], string> = {
  idle: 'Done', listening: 'Listening…', processing: 'Thinking…', responding: 'Speaking…',
};

// Voice overlay — slides up over the bottom of the pad while the panel's
// satellite is active, and lingers briefly with the reply. Display-only.
const VoiceOverlay = ({ v }: { v: VoiceView }) => (
  <div className={`swp-voice${v.visible ? ' swp-voice-on' : ''} swp-voice-${v.phase}`} aria-live="polite" aria-hidden={!v.visible}>
    <div className="swp-voice-card">
      <div className="swp-voice-mark" aria-hidden>
        <span className="swp-vm-ring" /><span className="swp-vm-ring swp-vm-ring2" />
        <span className="swp-vm-arc" />
        <span className="swp-vm-bars"><i /><i /><i /><i /></span>
        <span className="swp-vm-core" />
      </div>
      <div className="swp-voice-text">
        <div className="swp-voice-state">{VOICE_LABEL[v.phase]}</div>
        {v.heard && <div className="swp-voice-heard">“{v.heard}”</div>}
        {v.reply && <div className="swp-voice-reply">{v.reply}</div>}
      </div>
    </div>
  </div>
);

const SwitchCard = ({
  s, optimisticOn, fired, onActivate,
}: { s: SwitchView; optimisticOn?: boolean; fired: boolean; onActivate: () => void }) => {
  const Icon = ICONS[s.icon];
  const on = optimisticOn ?? s.on;
  const interactive = s.available && s.kind !== 'display';
  const lit = s.kind === 'toggle' ? on : fired;
  let detail = s.detail;
  if (optimisticOn !== undefined && optimisticOn !== s.on) detail = optimisticOn ? 'Turning on…' : 'Turning off…';
  if (fired) detail = s.domain === 'scene' ? 'Scene set' : 'Running';

  return (
    <button
      type="button"
      className={[
        'swp-card',
        lit ? 'swp-on' : '',
        !s.available ? 'swp-unavail' : '',
        s.kind === 'display' ? 'swp-display' : '',
      ].join(' ')}
      disabled={!interactive}
      onClick={onActivate}
      aria-pressed={s.kind === 'toggle' ? on : undefined}
      aria-label={`${s.name}: ${detail}`}
    >
      <div className="swp-card-top">
        <span className="swp-ico"><Icon size={22} strokeWidth={1.6} /></span>
        {s.kind === 'toggle' && <span className="swp-toggle" aria-hidden><span className="swp-thumb" /></span>}
        {s.kind === 'momentary' && <span className="swp-chip">{s.domain === 'scene' ? 'Scene' : 'Run'}</span>}
        {s.gated && <span className="swp-chip swp-chip-gated">Locked</span>}
        {!s.gated && s.requirePin && <span className="swp-chip">PIN</span>}
      </div>
      <div className="swp-card-text">
        <div className="swp-name">{s.name}</div>
        <div className="swp-detail num">{detail}</div>
      </div>
      {s.domain === 'light' && (
        <div className="swp-level" aria-hidden>
          <div className="swp-level-fill" style={{ width: on ? `${s.brightness ?? 100}%` : 0 }} />
        </div>
      )}
    </button>
  );
};

export const SwitchPanelView = ({ title, eyebrow, view, now, pending = {}, fired = null, onActivate, onAllOff, voice }: ViewProps) => {
  const { hm, ampm } = fmtTime(now);
  const n = view.switches.length;
  const anyOn = view.switches.some((s) => s.kind === 'toggle' && (pending[s.entityId] ?? s.on));
  const onCount = view.switches.filter((s) => s.kind === 'toggle' && s.available && (pending[s.entityId] ?? s.on)).length;

  return (
    <div className="swp-scope">
      {view.status === 'stale' && <div className="swp-stale">Live feed stale — reconnecting…</div>}

      <header className="swp-hero">
        <div className="swp-hero-canvas" />
        <div className="swp-hero-cloud swp-c1" />
        <div className="swp-hero-cloud swp-c2" />
        <div className="swp-hero-vignette" />
        <div className="swp-hero-inner">
          <div className="swp-hero-left">
            <div className="swp-eyebrow">{eyebrow}</div>
            <h1 className="swp-title">{title}</h1>
            <div className="swp-pill">
              <span className={`swp-dot${onCount ? '' : ' swp-dot-off'}`} />
              {view.toggleCount ? `${onCount} of ${view.toggleCount} on` : `${n} controls`}
            </div>
          </div>
          <div className="swp-clock">
            <div className="swp-time num">{hm}<span className="swp-ampm">{ampm}</span></div>
            <div className="swp-date">{fmtDate(now)}</div>
          </div>
        </div>
      </header>

      {n === 0 ? (
        <div className="swp-empty">
          <div className="swp-empty-title">No switches yet</div>
          <p>Add up to {MAX_SWITCHES} light, switch, fan or scene tiles to this panel in Admin. They appear here in tile order.</p>
        </div>
      ) : (
        <main className={`swp-grid swp-n${n}`}>
          {view.switches.map((s) => (
            <SwitchCard
              key={s.key}
              s={s}
              optimisticOn={pending[s.entityId]}
              fired={fired === s.entityId}
              onActivate={() => onActivate(s)}
            />
          ))}
        </main>
      )}

      {view.toggleCount > 1 && (
        <footer className="swp-footer">
          <button type="button" className="swp-alloff" disabled={!anyOn} onClick={onAllOff}>
            <Power size={18} strokeWidth={1.6} />
            <span>All Off</span>
          </button>
        </footer>
      )}

      {voice && <VoiceOverlay v={voice} />}
    </div>
  );
};

const SwitchPanel = ({ panel }: { panel: DashboardPanel }) => {
  const { requestPin } = useDashboard();
  const pad = useSwitchPadEntities(panel.tiles);
  const voice = useVoiceSatellite(panel.voiceSatelliteId);
  const [now, setNow] = useState(() => new Date());
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [fired, setFired] = useState<string | null>(null);
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { Object.values(timers.current).forEach((t) => window.clearTimeout(t)); }, []);

  // Drop optimistic entries once HA reports the target state.
  useEffect(() => {
    setPending((p) => {
      let changed = false;
      const next = { ...p };
      for (const s of pad.switches) {
        if (s.entityId in next && next[s.entityId] === s.on) { delete next[s.entityId]; changed = true; }
      }
      return changed ? next : p;
    });
  }, [pad.switches]);

  const run = (s: SwitchView) => {
    if (s.kind === 'toggle') {
      const target = !(pending[s.entityId] ?? s.on);
      setPending((p) => ({ ...p, [s.entityId]: target }));
      window.clearTimeout(timers.current[s.entityId]);
      timers.current[s.entityId] = window.setTimeout(() => {
        setPending((p) => { const { [s.entityId]: _, ...rest } = p; return rest; });
      }, PENDING_MS);
      pad.actions.activate({ ...s, on: !target });
    } else if (s.kind === 'momentary') {
      setFired(s.entityId);
      window.clearTimeout(timers.current.__fired);
      timers.current.__fired = window.setTimeout(() => setFired(null), 1400);
      pad.actions.activate(s);
    }
  };

  const onActivate = (s: SwitchView) => {
    if (s.gated || !s.available || s.kind === 'display') return;
    if (s.requirePin) requestPin(() => run(s));
    else run(s);
  };

  const view = useMemo(() => ({ ...pad, status: pad.status }), [pad]);
  const eyebrow = panel.parentId ? 'Wall Panel' : `Wall Panel · ${pad.switches.length} controls`;

  return (
    <SwitchPanelView
      title={panel.name}
      eyebrow={eyebrow}
      view={view}
      now={now}
      pending={pending}
      fired={fired}
      onActivate={onActivate}
      onAllOff={pad.actions.allOff}
      voice={panel.voiceSatelliteId ? voice : undefined}
    />
  );
};

export default SwitchPanel;
