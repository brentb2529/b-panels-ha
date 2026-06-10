import React, { useEffect, useMemo, useState } from 'react';
import { useSecurityEntities, type ArmTone } from './useSecurityEntities';
import PanelShell from '../shell/PanelShell';
import './securityPanel.css';

// ---------------------------------------------------------------------------
// SecurityPanel — Increment 7 "design-tiles first" Security hub.
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-security-v12(-light).html
// (the recolored deep-indigo "sapphire" Security identity) into a real in-app
// panel. Three columns: Alarm/arming (left), Cameras·UniFi Protect (center),
// Access & Locks + CLiC glass (right), plus the persistent arming bar +
// bottom area-switcher.
//
// ── SAFETY POSTURE — the most heavily gated panel in the set ──
// ONLY the arming STATE binds to a real entity. Two display-only reads of the
// REAL Alarmo panel:
//   • the persistent arming bar (via useDashboard alarmState/armingState), and
//   • the left card's big arming hero (via useSecurityEntities → projectArm of
//     alarm_control_panel.house).
// EVERYTHING actionable here — Arm Home/Away/Night, Bypass, Hold-to-Arm,
// lock/unlock, garage open/close, every CLiC glass toggle — is EQUIPMENT +
// SECURITY GATED or PROPOSED/GAP. They are rendered faithfully WITH the
// gated/"requires authorization" treatment but wire NO live actuation: there
// are NO alarm_arm_*/alarm_disarm/lock/cover/switch service calls anywhere in
// this panel. Cameras (UniFi Protect, Surface 5) are not in dev → honest
// PROPOSED posters + the defined "Feed unavailable" empty state, never a faked
// live stream. Access/Locks (Surface 5a) + CLiC (Surface 6) are not in dev →
// honest display-only GAP/PROPOSED rows.
//
// Scoping: all markup lives under `.secp-scope` and all CSS is namespaced
// `secp-*`, so this panel never restyles the legacy dashboard or any prior
// panel. Mounted only for compilationKind 'security' (see Dashboard.tsx).
// ---------------------------------------------------------------------------

// ── shield icon variants keyed by tone ──────────────────────────────────────
const ShieldGlyph = ({ tone, size = 32 }: { tone: ArmTone; size?: number }) => {
  const stroke =
    tone === 'away' ? 'var(--sem-armed-away)'
    : tone === 'stay' || tone === 'night' ? 'var(--sem-armed-stay)'
    : tone === 'pending' ? 'var(--sem-pending)'
    : tone === 'triggered' ? 'var(--sem-triggered)'
    : tone === 'notready' ? 'var(--sem-notready)'
    : tone === 'unavailable' ? 'var(--sem-notready)'
    : 'var(--sem-ready)';
  const inner =
    tone === 'away' || tone === 'night' ? <path d="M9 12h6" />
    : tone === 'triggered' ? (<><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16" x2="12.01" y2="16" /></>)
    : tone === 'pending' ? <circle cx="12" cy="12" r="2.5" />
    : <polyline points="9 12 11 14 15 10" />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      {inner}
    </svg>
  );
};

// ── persistent arming bar (display-only) — derives from the REAL Alarmo ──────
// Mirrors PrimarySuitePanel's proven ArmingBar: reads useDashboard()'s
// alarmState/armingState and only colours + labels itself. Offers NO control.


// ── arm mode buttons (GATED — display-only, no actuation) ────────────────────
const ARM_MODES: { label: string; icon: React.ReactNode }[] = [
  { label: 'Arm Home', icon: (<svg className="secp-arm-mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-security)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>) },
  { label: 'Arm Away', icon: (<svg className="secp-arm-mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-security)" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="8" width="20" height="14" rx="2" /><path d="M6.5 8V6a5.5 5.5 0 0 1 11 0v2" /><path d="M12 13v3" /></svg>) },
  { label: 'Arm Night', icon: (<svg className="secp-arm-mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-security)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 3a6.364 6.364 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>) },
  { label: 'Bypass', icon: (<svg className="secp-arm-mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>) },
];

// A small gated affordance: shows the "requires authorization" lock treatment
// and, on tap, flashes a "gated" hint — but NEVER calls a service.
const useGatedHint = () => {
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(null), 1600);
    return () => window.clearTimeout(t);
  }, [hint]);
  return [hint, setHint] as const;
};

// ── camera tile (display-only, honest) ──────────────────────────────────────
const CameraTile = ({ cam }: { cam: ReturnType<typeof useSecurityEntities>['cameras'][number] }) => {
  if (!cam.hasStream) {
    return (
      <div className="secp-cam secp-cam-empty" title={`${cam.name} · feed unavailable`}>
        <div className="secp-cam-empty-state">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M16 16H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m4 0h2.5a2 2 0 0 1 2 2v1.5" />
            <path d="m22 8-6 4 6 4V8z" /><line x1="2" y1="2" x2="22" y2="22" />
          </svg>
          <span className="secp-cam-empty-label">Feed unavailable</span>
        </div>
        <div className="secp-cam-bar">
          <div className="secp-cam-namewrap">
            <span className="secp-cam-name dim">{cam.name}</span>
            <span className="secp-cam-asof num dim">{cam.asOf}</span>
          </div>
          <div className="secp-cam-status dim" />
        </div>
      </div>
    );
  }
  return (
    <div className={`secp-cam secp-cam-${cam.poster}`} title={cam.name}>
      <div className="secp-live-chip"><span className="secp-live-dot" />LIVE</div>
      {cam.motion && <div className="secp-motion-badge">Motion</div>}
      <div className="secp-cam-bar">
        <div className="secp-cam-namewrap">
          <span className="secp-cam-name">{cam.name}</span>
          <span className="secp-cam-asof num">{cam.asOf}</span>
        </div>
        <div className={`secp-cam-status${cam.motion ? ' motion' : ''}`} />
      </div>
    </div>
  );
};

const LockIcon = () => (
  <svg className="secp-lock-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

const SecurityPanel = () => {
  const s = useSecurityEntities();
  const [armHint, setArmHint] = useGatedHint();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const heroDetail = useMemo(() => {
    const camPart = `${s.camerasOnline} camera${s.camerasOnline === 1 ? '' : 's'} online`;
    const motionPart = s.motionCount > 0 ? `${s.motionCount} motion` : 'No motion';
    const clear = s.arm.tone === 'ready' ? 'All clear' : s.arm.sub;
    return `${clear} · ${camPart} · ${motionPart}`;
  }, [s.camerasOnline, s.motionCount, s.arm.tone, s.arm.sub]);

  const armWordColor =
    s.arm.tone === 'away' ? 'var(--sem-armed-away)'
    : s.arm.tone === 'stay' || s.arm.tone === 'night' ? 'var(--sem-armed-stay)'
    : s.arm.tone === 'triggered' ? 'var(--sem-triggered)'
    : s.arm.tone === 'pending' ? 'var(--sem-pending)'
    : s.arm.tone === 'notready' ? 'var(--sem-notready)'
    : 'var(--sem-ready)';

  const heroTone =
    s.arm.tone === 'away' ? 'secp-hero-away'
    : s.arm.tone === 'stay' || s.arm.tone === 'night' ? 'secp-hero-stay'
    : s.arm.tone === 'triggered' ? 'secp-hero-triggered'
    : s.arm.tone === 'notready' ? 'secp-hero-notready'
    : '';

  return (
    <PanelShell kind="security">
    <div className="secp-scope">
      {s.status === 'stale' && <div className="secp-stale">Live feed stale — reconnecting…</div>}

      {/* ── Hero ── */}
      <div className="secp-hero">
        <div className="secp-hero-canvas" />
        <div className="secp-hero-vignette" />
        <div className="secp-hero-title-block">
          <div className="secp-hero-eyebrow">Cameras · Sensors · Access</div>
          <div className="secp-hero-title">Security</div>
          <div className="secp-hero-sub">
            <div className={`secp-arm-status-hero ${heroTone}`}>
              <span className="secp-arm-hero-dot" style={{ background: armWordColor }} />
              {s.arm.word}
            </div>
            <span className="secp-hero-detail">{heroDetail}</span>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="secp-content">

        {/* LEFT — Alarm / arming (real STATUS, gated controls) */}
        <div className="secp-card secp-arm-card">
          <div className="secp-card-label">
            <span>Alarm · Alarmo</span>
            <span className="secp-tag" title="Arm/disarm is security + equipment gated">Gated</span>
          </div>

          {/* LIVE state display — bound to the REAL Alarmo entity (display-only) */}
          <div className="secp-arm-state-display">
            <div className="secp-arm-state-icon-wrap" data-tone={s.arm.tone}>
              <ShieldGlyph tone={s.arm.tone} size={32} />
            </div>
            <div className="secp-arm-state-word" style={{ color: armWordColor }}>{s.arm.word}</div>
            <div className="secp-arm-state-sub">{s.arm.sub}</div>
          </div>

          {/* Arm mode buttons — GATED, display-only (no actuation) */}
          <div className="secp-arm-modes">
            {ARM_MODES.map((m) => (
              <button
                key={m.label}
                type="button"
                className={`secp-arm-mode-btn${m.label === 'Bypass' ? ' secp-arm-mode-muted' : ''}`}
                aria-disabled="true"
                title="Requires authorization · arm/disarm is gated (display-only)"
                onClick={() => setArmHint(m.label)}
              >
                {m.icon}
                <span className="secp-arm-mode-label">{m.label}</span>
              </button>
            ))}
          </div>

          {/* Hold-to-Arm — GATED, faithful resting affordance, no actuation */}
          <button
            type="button"
            className="secp-hold-btn"
            aria-disabled="true"
            title="Hold 1.5s · Alarmo PIN required · confirm-gated (display-only)"
            onClick={() => setArmHint('Hold to Arm Away')}
          >
            <span className="secp-hold-btn-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Hold to Arm Away
            </span>
            <span className="secp-hold-affordance" />
          </button>
          <div className="secp-hold-note">
            {armHint ? `${armHint} · requires authorization — not enabled` : 'Hold 1.5s · Alarmo PIN required · confirm-gated'}
          </div>

          {/* Recent events — display (Alarmo changed_by/last_changed + sensors) */}
          <div className="secp-events">
            <div className="secp-events-label">Recent</div>
            {s.events.length === 0 && <div className="secp-event-empty">No recent events</div>}
            {s.events.map((e, i) => (
              <div className="secp-event-row" key={i}>
                <span className={`secp-event-dot tone-${e.tone}`} />
                <span className="secp-event-text">{e.text}</span>
                <span className="secp-event-time num">{e.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER — Cameras · UniFi Protect (display-only, honest) */}
        <div className="secp-card secp-cam-card">
          <div className="secp-card-label">
            <span>Cameras · UniFi Protect</span>
            <span className="secp-tag" title="UniFi Protect not yet in contract">Proposed</span>
          </div>

          <div className="secp-cam-grid">
            {s.cameras.map((c) => <CameraTile key={c.id} cam={c} />)}
          </div>

          <div className="secp-cam-summary">
            <div className="secp-cam-sum-item">
              <span className="secp-cam-sum-dot positive" />
              <span className="num">{s.camerasOnline} of {s.camerasTotal} online</span>
            </div>
            <div className="secp-cam-sum-item attention">
              <span className="secp-cam-sum-dot attention" />
              <span className="num">{s.motionCount} motion detected</span>
            </div>
            <span className="secp-cam-sum-note">Protect via HA proxy</span>
          </div>

          <div className="secp-doorbell">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            <span className="secp-doorbell-label">{s.doorbell.label}</span>
            <span className="secp-doorbell-meta">event.doorbell</span>
          </div>
        </div>

        {/* RIGHT — Access & Locks + CLiC glass (GAP / PROPOSED, display-only) */}
        <div className="secp-card secp-locks-card">
          <div className="secp-card-label">
            <span>Access &amp; Locks</span>
            <span className="secp-tag" title="UniFi Access not yet in contract">Surface 5a · Gap</span>
          </div>

          {s.access.map((a) => (
            <div className="secp-entry secp-proposed-row" key={a.id}>
              <div className="secp-entry-info">
                <div className="secp-entry-name">{a.name}</div>
                <div className="secp-entry-meta">{a.meta}</div>
              </div>
              {a.kind === 'cover' ? (
                <div className={`secp-cover-btn${a.open ? ' secp-cover-open' : ''}`} title="Open/close is gated (display-only)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={a.open ? 'var(--sem-notready)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V8l9-5 9 5v13" /><path d="M3 13h18" /><path d="M3 17h18" /></svg>
                  <span className="secp-cover-label">{a.stateLabel}</span>
                  <div className="secp-cover-affordance">
                    <svg className="secp-cover-chevron" width="11" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="3" strokeLinecap="round"><polyline points="6 15 12 9 18 15" /></svg>
                    <svg className="secp-cover-chevron" width="11" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="3" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
              ) : (
                <div className={`secp-lock-btn${a.open ? ' secp-unlocked-state' : ' secp-locked-state'}`} title="Unlock is security + equipment gated (display-only)">
                  <LockIcon />
                  <span className="secp-lock-label">{a.stateLabel}</span>
                </div>
              )}
            </div>
          ))}

          <div className="secp-access-note">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <span>Access locks &amp; garage cover are PROPOSED (Surface 5a). Unlock/open is security + equipment gated — read-only until ratified.</span>
          </div>

          {/* CLiC privacy glass — PROPOSED (HC-108), display-only toggles */}
          <div className="secp-glass-section">
            <div className="secp-glass-label">CLiC Privacy Glass</div>
            {s.glass.map((g) => (
              <div className="secp-glass-row" key={g.id} title="CLiC toggle is equipment gated (display-only)">
                <span className="secp-glass-name">{g.name}</span>
                <div className="secp-glass-toggle-wrap">
                  <span className={`secp-glass-state ${g.clear ? 'clear' : g.isOverride ? 'off' : 'private'}`}>{g.stateLabel}</span>
                  <div className={`secp-glass-track ${g.clear ? 'secp-glass-on' : 'secp-glass-off'}`}>
                    <div className="secp-glass-thumb" />
                  </div>
                </div>
              </div>
            ))}
            <div className="secp-glass-note">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              HC-108 · PROPOSED · Equipment commissioning pending
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom switcher ── */}
      
    </div>
    </PanelShell>
  );
};

export default SecurityPanel;
