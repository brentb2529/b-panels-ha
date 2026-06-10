import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDashboard } from '../../hooks/useDashboard';
import { usePanelDefault } from './usePanelDefault';
import type { DashboardPanel } from '../../types';
import './shell.css';

// ---------------------------------------------------------------------------
// PanelShell — the app-wide navigation shell (Increment 9).
//
// The single shared chrome consumed by ALL 7 compilation panels. It unifies
// what each panel previously duplicated (its own ArmingBar + BottomSwitcher)
// into ONE component, and adds the v1.3 nav model: the "Go Anywhere" sheet, a
// per-DEVICE default + 2-min idle-return, and the "⌂ THIS PANEL'S HOME" badge.
//
//   <PanelShell kind="lighting"> …panel body… </PanelShell>
//
// Non-breaking: the body is rendered verbatim — the panel bodies are unchanged.
// Each panel just drops its private switcher/arming bar and wraps itself here.
//
// LEAST-PRIVILEGE: nav targets are resolved by matching the existing panel
// `compilationKind` (falling back to name regex for legacy installs). There is
// NO runtime read of the HA area registry — the Rooms list is the set of
// curated room-view panels already present in the config (kitchen / primary-
// suite today), exactly as NAV_MODEL_v13 §7 requires.
// ---------------------------------------------------------------------------

export type ShellKind =
  | 'home' | 'kitchen' | 'primary-suite'
  | 'pool' | 'climate' | 'security' | 'lighting';

// Which kinds are ROOM views vs whole-home FUNCTION panels (the two orthogonal
// nav axes in the model). Home is the all-house landing — neither a room nor a
// function tab, it's the "Home" entry.
const ROOM_KINDS: ShellKind[] = ['kitchen', 'primary-suite'];
const FUNCTION_KINDS: ShellKind[] = ['pool', 'climate', 'security', 'lighting'];

// Accent per kind for the active-tab underline + function-card glyph (cool palette).
const KIND_ACCENT: Record<string, { color: string; rgb: string }> = {
  room: { color: 'var(--bps-accent-room)', rgb: 'var(--bps-accent-room-rgb)' },
  pool: { color: 'var(--bps-accent-pool)', rgb: 'var(--bps-accent-pool-rgb)' },
  climate: { color: 'var(--bps-accent-climate)', rgb: 'var(--bps-accent-climate-rgb)' },
  security: { color: 'var(--bps-accent-security)', rgb: 'var(--bps-accent-security-rgb)' },
  lighting: { color: 'var(--bps-accent-lights)', rgb: 'var(--bps-accent-lights-rgb)' },
};

// Display label per kind (room labels come from the panel name; functions fixed).
const KIND_LABEL: Record<string, string> = {
  pool: 'Pool & Spa', climate: 'Climate', security: 'Security', lighting: 'Lighting',
};

// The canonical Rooms grid from the v1.3 model. Rooms WITHOUT a curated panel
// are still SHOWN (so the homeowner sees the whole house) but rendered as inert
// stubs — curation, not a fabricated navigation target.
const CANONICAL_ROOMS = [
  'Kitchen', 'Family Room', 'Dining', 'Primary Suite',
  'Office', 'Guest Room', 'Patio', 'Garage',
];

// ── shared SVG glyphs (lifted from the per-panel switchers) ──────────────────
const Glyph = {
  home: (s: string) => (<svg viewBox="0 0 24 24" fill="none" stroke={s} strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>),
  rooms: (s: string) => (<svg viewBox="0 0 24 24" fill="none" stroke={s} strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>),
  pool: (s: string) => (<svg viewBox="0 0 24 24" fill="none" stroke={s} strokeWidth="1.5" strokeLinecap="round"><path d="M2 12h2c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 7 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41h.34c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 13 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.42.41H16c.55 0 1.05-.22 1.41-.59A2 2 0 0 1 19 11c.55 0 1.05.22 1.41.59.37.36.87.41 1.59.41" /></svg>),
  climate: (s: string) => (<svg viewBox="0 0 24 24" fill="none" stroke={s} strokeWidth="1.5" strokeLinecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>),
  security: (s: string) => (<svg viewBox="0 0 24 24" fill="none" stroke={s} strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>),
  lighting: (s: string) => (<svg viewBox="0 0 24 24" fill="none" stroke={s} strokeWidth="1.5" strokeLinecap="round"><line x1="9" y1="18" x2="15" y2="18" /><line x1="10" y1="22" x2="14" y2="22" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg>),
};
const FN_GLYPH: Record<string, (s: string) => React.ReactNode> = {
  pool: Glyph.pool, climate: Glyph.climate, security: Glyph.security, lighting: Glyph.lighting,
};

// ── Persistent arming indicator (display-only — derives from REAL Alarmo) ────
// Identical state machine to the per-panel ArmingBar that all 7 panels carried;
// reads useDashboard()'s alarmState/armingState and only colours + labels.
// Offers NO control (arm/disarm stays in the gated Security panel).
const ArmingBar = () => {
  const { alarmState, armingState } = useDashboard();
  const phase = alarmState?.phase ?? 'idle';
  const arm = alarmState?.armState ?? 'disarmed';

  let cls = 'bps-arm-ready';
  let state = 'Disarmed · Ready';
  let sub = 'All sensors clear · ready to arm';
  let pulse = true;

  if (!alarmState) {
    cls = 'bps-arm-notready'; state = 'Alarm · Unavailable'; sub = 'No alarm panel connected'; pulse = false;
  } else if (phase === 'triggered' || alarmState.securityState === 'VIOLATION') {
    cls = 'bps-arm-triggered'; state = 'Intrusion';
    sub = alarmState.trigger?.name ? `Triggered · ${alarmState.trigger.name}` : 'Alarm triggered';
  } else if (phase === 'arming') {
    cls = 'bps-arm-pending'; state = 'Arming'; sub = 'Exit delay · leave now'; pulse = true;
  } else if (phase === 'pending') {
    cls = 'bps-arm-pending'; state = 'Pending'; sub = 'Entry delay · disarm now'; pulse = true;
  } else if (arm === 'armedAway') {
    cls = 'bps-arm-away'; state = 'Armed · Away'; sub = 'Perimeter + interior armed'; pulse = false;
  } else if (arm === 'armedStay') {
    cls = 'bps-arm-stay'; state = 'Armed · Stay'; sub = 'Perimeter armed · home'; pulse = true;
  } else if (armingState === 'not_ready') {
    cls = 'bps-arm-notready'; state = 'Disarmed · Not Ready';
    const open = alarmState.haOpenSensors ? Object.keys(alarmState.haOpenSensors).length : 0;
    sub = open > 0 ? `${open} sensor${open === 1 ? '' : 's'} open` : 'Some sensors open';
  }

  return (
    <div className={`bps-arming ${cls}`} title={`Alarm: ${state}`}>
      <div className="bps-arming-shield">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
      </div>
      <div className="bps-arming-text">
        <span className="bps-arming-state"><span className={`bps-arming-dot${pulse ? ' pulse' : ''}`} />{state}</span>
        <span className="bps-arming-sub">{sub}</span>
      </div>
    </div>
  );
};

// Resolve the panel id for a given compilationKind (preferred) or a name regex
// (legacy fallback). Returns undefined if no such panel exists → nav item is inert.
const usePanelResolver = () => {
  const { panels } = useDashboard();
  return useMemo(() => {
    const byKind = (kind: string) => panels.find((p) => p.compilationKind === kind);
    const byName = (re: RegExp) => panels.find((p) => re.test(p.name));
    return {
      forKind: (kind: string, nameRe: RegExp): DashboardPanel | undefined => byKind(kind) ?? byName(nameRe),
      panels,
    };
  }, [panels]);
};

interface ShellProps {
  kind: ShellKind;
  children: React.ReactNode;
  /** LIFE-SAFETY HOOK: pass true from a future takeover overlay to suppress
   *  idle-return (idle must never outrank a life-safety annunciation). */
  suppressIdleReturn?: boolean;
}

const PanelShell = ({ kind, children, suppressIdleReturn = false }: ShellProps) => {
  const { panels, activePanelId } = useDashboard();
  const navigate = useNavigate();
  const resolver = usePanelResolver();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Per-device default + idle-return for THIS rendered panel.
  const { isThisPanelHome, setThisPanelAsHome, deviceDefaultPanelId } =
    usePanelDefault(activePanelId, suppressIdleReturn);

  const isRoom = ROOM_KINDS.includes(kind);
  const navAccent = KIND_ACCENT[isRoom ? 'room' : kind] ?? KIND_ACCENT.room;

  // Resolve sibling panel ids for the bottom switcher (preferred: by kind).
  const homeId = resolver.forKind('home', /home|overview|main/i)?.id;
  const poolId = resolver.forKind('pool', /pool/i)?.id;
  const climateId = resolver.forKind('climate', /climate|air/i)?.id;
  const securityId = resolver.forKind('security', /security|alarm/i)?.id;
  const lightsId = resolver.forKind('lighting', /light/i)?.id;

  // The room name of the CURRENT panel (for the "Back to <room>" affordance).
  const currentName = panels.find((p) => p.id === activePanelId)?.name ?? 'here';

  const NavLink = ({ to, label, glyph, isActive, divider }: {
    to?: string; label: string; glyph: (s: string) => React.ReactNode; isActive?: boolean; divider?: boolean;
  }) => {
    const stroke = isActive ? navAccent.color : 'var(--bps-text-primary)';
    const cls = `bps-nav${isActive ? ' active' : ''}${divider ? ' bps-nav-divider' : ''}`;
    const style = isActive
      ? ({ ['--bps-nav-accent' as any]: navAccent.color, ['--bps-nav-accent-rgb' as any]: navAccent.rgb })
      : undefined;
    const inner = (<><span className="bps-nav-ico">{glyph(stroke)}</span><span className="bps-nav-label">{label}</span></>);
    if (label === 'Rooms') {
      // Rooms tab opens the Go Anywhere sheet (it's the area-nav hub).
      return <button type="button" className={cls} style={style} onClick={() => setSheetOpen(true)}>{inner}</button>;
    }
    return to
      ? <Link className={cls} style={style} to={`/dashboard/${to}`}>{inner}</Link>
      : <button className={cls} style={style} type="button">{inner}</button>;
  };

  return (
    <div className="bps-shell">
      <div className="bps-shell-body">{children}</div>

      {/* ── Persistent bottom switcher ── */}
      <nav className="bps-switcher">
        <ArmingBar />
        <NavLink to={homeId} label="Home" glyph={Glyph.home} isActive={kind === 'home'} />
        <NavLink label="Rooms" glyph={Glyph.rooms} isActive={isRoom} />
        <NavLink to={poolId} label="Pool" glyph={Glyph.pool} isActive={kind === 'pool'} divider />
        <NavLink to={climateId} label="Climate" glyph={Glyph.climate} isActive={kind === 'climate'} />
        <NavLink to={securityId} label="Security" glyph={Glyph.security} isActive={kind === 'security'} />
        <NavLink to={lightsId} label="Lights" glyph={Glyph.lighting} isActive={kind === 'lighting'} />
        <button type="button" className="bps-rooms-hub" onClick={() => setSheetOpen(true)} aria-label="Open all rooms and functions">
          <div className="bps-rh-grid"><span /><span /><span /><span /></div>
          <span className="bps-rh-label">All Rooms</span>
        </button>
      </nav>

      {sheetOpen && (
        <GoAnywhereSheet
          onClose={() => setSheetOpen(false)}
          navigate={(id) => { setSheetOpen(false); navigate(`/dashboard/${id}`); }}
          currentPanelId={activePanelId}
          currentName={currentName}
          deviceDefaultPanelId={deviceDefaultPanelId}
          isThisPanelHome={isThisPanelHome}
          setThisPanelAsHome={setThisPanelAsHome}
          resolver={resolver}
        />
      )}
    </div>
  );
};

// ── "Go Anywhere" sheet — Rooms grid + Function panels row (exemplar v13) ────
const GoAnywhereSheet = ({
  onClose, navigate, currentPanelId, currentName, deviceDefaultPanelId, isThisPanelHome, setThisPanelAsHome, resolver,
}: {
  onClose: () => void;
  navigate: (panelId: string) => void;
  currentPanelId: string | null;
  currentName: string;
  deviceDefaultPanelId: string | null;
  isThisPanelHome: boolean;
  setThisPanelAsHome: () => void;
  resolver: ReturnType<typeof usePanelResolver>;
}) => {
  const { panels } = resolver;

  // Build the Rooms grid: each canonical room is matched to a curated room-view
  // panel (compilationKind in ROOM_KINDS, or a name match) when one exists; else
  // it's a SHOWN-BUT-INERT stub (curation, not a fabricated target).
  const roomPanels = panels.filter((p) => p.compilationKind && ROOM_KINDS.includes(p.compilationKind as ShellKind));
  const rooms = CANONICAL_ROOMS.map((label) => {
    const match = roomPanels.find((p) => p.name.toLowerCase().includes(label.toLowerCase()))
      ?? panels.find((p) => !p.compilationKind && p.name.toLowerCase() === label.toLowerCase());
    return { label, panel: match };
  });

  // Function panels row — the whole-home compilations.
  const functions = FUNCTION_KINDS.map((kind) => {
    const panel = panels.find((p) => p.compilationKind === kind);
    return { kind, label: KIND_LABEL[kind], panel };
  });

  const defaultName = deviceDefaultPanelId
    ? (panels.find((p) => p.id === deviceDefaultPanelId)?.name ?? null)
    : null;

  return (
    <div className="bps-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Go anywhere" onClick={onClose}>
      <div className="bps-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bps-sheet-head">
          <div>
            <div className="bps-sheet-eyebrow">Bensten Residence · Go Anywhere</div>
            <div className="bps-sheet-title">All Rooms &amp; Functions</div>
          </div>
          <button type="button" className="bps-sheet-back" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            Back to {currentName}
          </button>
        </div>

        {/* curation-not-restriction explainer */}
        <div className="bps-sheet-explain">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          <span>
            This panel lands on <b>{defaultName ?? currentName}</b> and returns there when idle — your local
            scenes &amp; lights are always one walk-up away. From here this panel can open <b>every room and
            every function</b> and control all of it.
          </span>
        </div>

        {/* Rooms grid */}
        <div className="bps-sheet-section-label">Rooms <span>· {rooms.length} areas</span></div>
        <div className="bps-rooms-grid">
          {rooms.map(({ label, panel }) => {
            const isHome = !!panel && panel.id === deviceDefaultPanelId;
            const isCurrent = !!panel && panel.id === currentPanelId;
            const stub = !panel;
            return (
              <button
                key={label}
                type="button"
                className={`bps-room-card${isHome ? ' is-home' : ''}${stub ? ' is-stub' : ''}`}
                disabled={stub}
                onClick={() => panel && navigate(panel.id)}
                title={stub ? `${label} — no curated room page yet` : `Go to ${label}`}
              >
                {isHome && <span className="bps-home-badge">Home</span>}
                <span className="bps-room-name">{label}</span>
                <span className="bps-room-meta">
                  <span className="bps-room-dot" />
                  {stub ? 'no page yet' : isCurrent ? 'here now' : 'room view'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Function panels row */}
        <div className="bps-sheet-section-label">Function Panels <span>· whole-home</span></div>
        <div className="bps-fn-row">
          {functions.map(({ kind, label, panel }) => {
            const accent = KIND_ACCENT[kind] ?? KIND_ACCENT.room;
            const stub = !panel;
            const glyph = FN_GLYPH[kind] ?? Glyph.rooms;
            return (
              <button
                key={kind}
                type="button"
                className={`bps-fn-card${stub ? ' is-stub' : ''}`}
                style={{ ['--bps-fn-color' as any]: accent.color, ['--bps-fn-rgb' as any]: accent.rgb }}
                disabled={stub}
                onClick={() => panel && navigate(panel.id)}
                title={stub ? `${label} — not configured` : `Go to ${label}`}
              >
                <span className="bps-fn-ico">{glyph(accent.color)}</span>
                <div>
                  <div className="bps-fn-name">{label}</div>
                  <div className="bps-fn-sub">{stub ? 'not configured' : 'whole-home'}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="bps-sheet-foot">
          <span className="bps-foot-note">
            {defaultName ? `Returns to ${defaultName} after idle` : 'No device home set'}
            {' · '}
            {isThisPanelHome
              ? '⌂ this panel is this device’s home'
              : (
                <button type="button" className="bps-sheet-back" style={{ padding: '4px 10px', marginLeft: 6 }} onClick={setThisPanelAsHome}>
                  Set {currentName} as this device’s home
                </button>
              )}
          </span>
          <span className="bps-foot-note">Trusted panel · full house access · no PIN</span>
        </div>
      </div>
    </div>
  );
};

export default PanelShell;
