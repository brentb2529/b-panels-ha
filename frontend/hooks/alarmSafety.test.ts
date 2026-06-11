import { describe, it, expect } from 'vitest';
import { normalizeArmState, isAlarmTruthMismatch, getDefaultConfig } from './useDashboard';
import type { AlarmState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// STALE-SAVED-CONFIG GATING (production-failure lessons B). HA is the sole
// backend (same-origin, always-on); the multi-provider/demo gates are vestigial
// and must be HA-only at RUNTIME. These pin the defaults the runtime relies on.
// ─────────────────────────────────────────────────────────────────────────────
describe('HA-only config defaults (lessons B)', () => {
  it('ships demo mode OFF and the alarm provider as HA', () => {
    const cfg: any = getDefaultConfig();
    expect(cfg.useDemoMode).toBe(false);   // else updateDeviceState no-ops → controls do nothing
    expect(cfg.primaryAlarmProvider).toBe('ha');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY (production-failure lessons A — alarm false-"Disarmed").
// These assert the two proven root-fixes:
//   1. normalizeArmState NEVER returns 'disarmed' for an uncertain state — it
//      returns 'unknown' (rendered neutral grey "Status Unknown"), so a zombie
//      socket / absent entity can never imply "safe" while the house is armed.
//   2. isAlarmTruthMismatch flags a DEFINITE mismatch between a request/response
//      getStates() snapshot and the cached state, which drives forceReconnect().
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeArmState — never false-"disarmed" (lessons A)', () => {
  it('maps unavailable/unknown/empty/unrecognized → "unknown", NOT "disarmed"', () => {
    expect(normalizeArmState('unavailable')).toBe('unknown');
    expect(normalizeArmState('unknown')).toBe('unknown');
    expect(normalizeArmState('')).toBe('unknown');
    expect(normalizeArmState(undefined)).toBe('unknown');
    expect(normalizeArmState('some_future_alarmo_mode')).toBe('unknown');
    // The whole point: none of these are the implied-safe "disarmed".
    for (const raw of ['unavailable', 'unknown', '', undefined, 'garbage']) {
      expect(normalizeArmState(raw)).not.toBe('disarmed');
    }
  });

  it('passes through only EXPLICIT disarmed/armed_* states', () => {
    expect(normalizeArmState('disarmed')).toBe('disarmed');
    expect(normalizeArmState('armed_away')).toBe('armedAway');
    expect(normalizeArmState('armed_home')).toBe('armedStay');
    expect(normalizeArmState('armed_night')).toBe('armedStay');
    expect(normalizeArmState('armed_vacation')).toBe('armedAway');
    expect(normalizeArmState('armed_custom_bypass')).toBe('armedStay');
  });

  it('resolves transient triggered/arming/pending mode from the arm string', () => {
    // arming/pending themselves are not arm modes; the WS handler resolves the
    // destination from arm_mode, but the raw "armed_*" still normalizes correctly.
    expect(normalizeArmState('ARMED_STAY')).toBe('armedStay');
    expect(normalizeArmState('armedAway')).toBe('armedAway');
  });
});

const cached = (armState: AlarmState['armState'], phase: AlarmState['phase'] = 'idle'): AlarmState => ({
  locationId: 'ha-default',
  locationName: 'Home Assistant',
  armState,
  securityState: 'OK',
  violatingSensors: [],
  phase,
});

describe('isAlarmTruthMismatch — truth-reconcile mismatch → reconnect (lessons A)', () => {
  it('NEVER flags a mismatch on first mount / null cache', () => {
    expect(isAlarmTruthMismatch({ state: 'armed_away' }, null)).toBe(false);
  });

  it('does NOT flag when the snapshot agrees with the cache', () => {
    expect(isAlarmTruthMismatch({ state: 'disarmed' }, cached('disarmed'))).toBe(false);
    expect(isAlarmTruthMismatch({ state: 'armed_away' }, cached('armedAway'))).toBe(false);
  });

  it('FLAGS the canonical incident: snapshot armed, cache says disarmed', () => {
    // The exact failure: panel cached "Disarmed" but the alarm is really armed.
    expect(isAlarmTruthMismatch({ state: 'armed_away' }, cached('disarmed'))).toBe(true);
    expect(isAlarmTruthMismatch({ state: 'armed_home' }, cached('disarmed'))).toBe(true);
  });

  it('FLAGS a phase mismatch (e.g. snapshot triggered, cache idle/armed)', () => {
    expect(isAlarmTruthMismatch({ state: 'triggered' }, cached('armedAway', 'idle'))).toBe(true);
    expect(isAlarmTruthMismatch({ state: 'pending' }, cached('armedAway', 'idle'))).toBe(true);
  });

  it('resolves a transient snapshot arm mode from arm_mode attribute', () => {
    // arming with arm_mode away while cache thinks disarmed → mismatch.
    expect(
      isAlarmTruthMismatch({ state: 'arming', attributes: { arm_mode: 'away' } }, cached('disarmed')),
    ).toBe(true);
  });

  it('does NOT thrash on an uncertain snapshot (unavailable) — freshness handles it', () => {
    expect(isAlarmTruthMismatch({ state: 'unavailable' }, cached('armedAway'))).toBe(false);
    expect(isAlarmTruthMismatch({ state: 'unknown' }, cached('disarmed'))).toBe(false);
  });

  it('does NOT flag when the entity is absent from the snapshot', () => {
    expect(isAlarmTruthMismatch(undefined, cached('armedAway'))).toBe(false);
    expect(isAlarmTruthMismatch({ state: undefined }, cached('armedAway'))).toBe(false);
  });
});
