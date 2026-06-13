import React from 'react';
import { Device, TileConfig } from '../../types';
import { IconShield, IconShieldCheck, IconShieldOff, IconShieldAlert } from '../../components/icons';
import { fluidIcon, fluidTextLg, fluidTextXs } from '../../components/tiles/tileScale';
import GlassCard, { GlassAccent } from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassArmingStatusTile — DISPLAY-ONLY liquid-glass readout of an Alarmo /
// alarm_control_panel arming state. It NEVER arms/disarms (no actuation): per
// the security model, the only honest thing a placeable tile should do is
// reflect the live state. Arm/disarm flows live in the curated Security
// compilation panel with PIN entry, not in a one-tap grid tile.
//
// Live binding: `device.state` for an `alarm_control_panel.*` entity is the
// normalized arm state ('disarmed' | 'armedStay' | 'armedAway') produced by
// `mapHaEntityToInternalDevice`. The raw HA state is carried in
// `capabilityData.rawState` so we can surface 'triggered'/'arming'/'pending'
// truthfully when present.
// ---------------------------------------------------------------------------

interface View {
  label: string;
  icon: typeof IconShield;
  accent: GlassAccent;
  glow: boolean;
  // SAFETY (production-failure lessons A): when the arm state is uncertain
  // (`unknown` — unavailable/zombie/unrecognized) the tile must render the
  // neutral, dimmed "uncertain" look (grey, no glow), NEVER the green positive
  // "Disarmed" — a security surface must never imply "safe" when the truth is
  // unknown. `uncertain` routes through GlassCard's isUnavailable presentation.
  uncertain?: boolean;
}

// Exported for unit testing the SAFETY mapping (never green-Disarmed on unknown).
export const viewFor = (armState: string, rawState: string): View => {
  const raw = String(rawState || '').toLowerCase();
  if (raw === 'triggered') return { label: 'Triggered', icon: IconShieldAlert, accent: 'critical', glow: true };
  if (raw === 'arming') return { label: 'Arming…', icon: IconShield, accent: 'warning', glow: true };
  if (raw === 'pending') return { label: 'Entry delay', icon: IconShieldAlert, accent: 'warning', glow: true };
  switch (armState) {
    case 'armedAway': return { label: 'Armed — Away', icon: IconShieldCheck, accent: 'security', glow: true };
    case 'armedStay': return { label: 'Armed — Stay', icon: IconShieldCheck, accent: 'security', glow: true };
    case 'disarmed': return { label: 'Disarmed', icon: IconShieldOff, accent: 'positive', glow: false };
    // SAFETY: 'unknown' (and any unrecognized state) → neutral "Status Unknown",
    // NEVER an implied-safe green Disarmed. normalizeArmState() produces
    // 'unknown' for unavailable/zombie/unrecognized alarm states (lessons A).
    default: return { label: 'Status Unknown', icon: IconShieldAlert, accent: 'warning', glow: false, uncertain: true };
  }
};

const GlassArmingStatusTile = ({
  device,
  tile,
  isEditor,
  cornerClassName,
}: {
  device: Device;
  tile: TileConfig;
  isEditor?: boolean;
  cornerClassName?: string;
}) => {
  const armState = typeof device.state === 'string' ? device.state : 'disarmed';
  const rawState = String((device.capabilityData as any)?.rawState ?? '');
  const view = viewFor(armState, rawState);
  // SAFETY (lessons A): an uncertain arm state renders the neutral/dimmed
  // "unavailable" presentation (grey, no glow) — never the green Disarmed.
  const isUnavailable = device.isOnline === false || !!view.uncertain;
  const Icon = view.icon;
  const accentVar = `var(--bp-accent-${view.accent === 'security' ? 'security' : view.accent === 'critical' ? 'critical' : view.accent === 'warning' ? 'warning' : 'positive'})`;

  return (
    <GlassCard
      label={tile.label || ''}
      accent={view.accent}
      isActive={view.glow && !isUnavailable}
      isUnavailable={isUnavailable}
      // Display-only: no onClick, no actuation. Editor/lock are irrelevant.
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ gap: 'clamp(0.2rem, 3cqmin, 0.55rem)' }}>
        <Icon
          style={{
            ...fluidIcon(2),
            color: isUnavailable ? 'var(--bp-text-dim)' : accentVar,
            filter: view.glow && !isUnavailable ? `drop-shadow(0 0 9px ${accentVar})` : undefined,
            transition: 'color 250ms ease, filter 250ms ease',
          }}
        />
        <p className="bp-readout" style={{ ...fluidTextLg, fontWeight: 500, color: 'var(--bp-text-primary)' }}>
          {/* Uncertain still shows "Status Unknown" (safety: be explicit about
              the uncertainty); a genuinely offline device shows the em-dash. */}
          {device.isOnline === false && !view.uncertain ? '—' : view.label}
        </p>
        <p className="bp-meta" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>
          Status only
        </p>
      </div>
    </GlassCard>
  );
};

export default GlassArmingStatusTile;
