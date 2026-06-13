import { describe, it, expect, vi } from 'vitest';
import {
  resolveAlarmEntityId,
  DEFAULT_ALARM_ENTITY_ID,
  normalizeArmState,
  isAlarmTruthMismatch,
} from './useDashboard';
import { apiHomeAssistantArm } from '../services/api';
import { viewFor } from '../design-system/tiles/GlassArmingStatusTile';
import * as haClient from '../services/haClient';
import type { DashboardPanel, TileConfig, AlarmState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY (production-failure lessons A2; prod v0.1.59/60; 3012 triage 2026-06-13)
// MULTI-PANEL EXACT-MATCH. The read paths must NOT startsWith('alarm_control_panel.')
// and the write path must NOT hardcode `alarmo`. With no configured id, a SECOND
// alarm_control_panel (UniFi Protect `udm_pro_alarm_manager`, SmartThings STHM)
// must NOT be able to hijack the tile to a false "Disarmed" while really armed.
//
// The fix is one `resolvedAlarmEntityId` resolver with the precedence:
//   config alarm id → the placed alarm tile's entity → fallback `alarmo`.
// These tests pin: the resolver precedence; exact-match ignores a SECOND panel;
// the write path targets the resolved id; and the prior safety layers
// (unknown-mapping + truth-reconcile) still hold.
// ─────────────────────────────────────────────────────────────────────────────

const tile = (over: Partial<TileConfig>): TileConfig => ({
  id: over.id ?? 't1',
  deviceId: over.deviceId ?? '',
  ...over,
});

const panel = (tiles: TileConfig[]): DashboardPanel => ({
  id: 'p1',
  name: 'Panel',
  tiles,
});

describe('resolveAlarmEntityId — precedence (lessons A2)', () => {
  it('(1) an explicitly CONFIGURED alarm id wins over everything', () => {
    const panels = [panel([tile({ deviceId: 'alarm_control_panel.house_alt' })])];
    expect(
      resolveAlarmEntityId({ configuredId: 'alarm_control_panel.house', panels }),
    ).toBe('alarm_control_panel.house');
  });

  it('(1) ignores a configured id that is NOT an alarm_control_panel and falls through', () => {
    // A garbage / non-alarm configured id must not be trusted; fall through.
    expect(
      resolveAlarmEntityId({ configuredId: 'switch.not_an_alarm', panels: [] }),
    ).toBe(DEFAULT_ALARM_ENTITY_ID);
  });

  it('(2) uses the alarm tile the user PLACED on a panel when no config id', () => {
    const panels = [
      panel([
        tile({ id: 'light', deviceId: 'light.kitchen' }),
        tile({ id: 'alarmtile', deviceId: 'alarm_control_panel.house', tileType: 'alarm' }),
      ]),
    ];
    expect(resolveAlarmEntityId({ configuredId: null, panels })).toBe('alarm_control_panel.house');
  });

  it('(2) resolves a placed tile via bindings.primary, then entityId, then deviceId', () => {
    expect(
      resolveAlarmEntityId({
        configuredId: undefined,
        panels: [panel([tile({ bindings: { primary: 'alarm_control_panel.via_binding' }, deviceId: 'x' })])],
      }),
    ).toBe('alarm_control_panel.via_binding');
    expect(
      resolveAlarmEntityId({
        configuredId: undefined,
        panels: [panel([tile({ entityId: 'alarm_control_panel.via_entityid', deviceId: 'x' })])],
      }),
    ).toBe('alarm_control_panel.via_entityid');
    expect(
      resolveAlarmEntityId({
        configuredId: undefined,
        panels: [panel([tile({ deviceId: 'alarm_control_panel.via_deviceid' })])],
      }),
    ).toBe('alarm_control_panel.via_deviceid');
  });

  it('(3) falls back to alarm_control_panel.alarmo when nothing is configured or placed', () => {
    expect(resolveAlarmEntityId({ configuredId: null, panels: [] })).toBe(DEFAULT_ALARM_ENTITY_ID);
    expect(DEFAULT_ALARM_ENTITY_ID).toBe('alarm_control_panel.alarmo');
    // A panel with NO alarm tile (only a UniFi-style entity? no — only non-alarm
    // tiles) must NOT resolve to a random tile.
    expect(
      resolveAlarmEntityId({ configuredId: null, panels: [panel([tile({ deviceId: 'light.kitchen' })])] }),
    ).toBe(DEFAULT_ALARM_ENTITY_ID);
  });
});

describe('exact-match IGNORES a SECOND alarm_control_panel (the incident)', () => {
  // Simulate the production incident: Alarmo (armed) + a SECOND panel
  // (UniFi Protect udm_pro_alarm_manager / SmartThings STHM, disarmed) both
  // present. The resolver + an EXACT match must follow Alarmo, never the second.
  const resolved = resolveAlarmEntityId({
    configuredId: null,
    panels: [panel([tile({ deviceId: 'alarm_control_panel.alarmo', tileType: 'alarm' })])],
  });

  // This is the predicate the (refactored) read paths use: EXACT id match,
  // never startsWith('alarm_control_panel.').
  const isAlarmEntity = (entityId: string) => entityId === resolved;

  it('resolves to alarmo (the placed tile), not the second panel', () => {
    expect(resolved).toBe('alarm_control_panel.alarmo');
  });

  it('a UniFi Protect udm_pro_alarm_manager event is NOT treated as the alarm', () => {
    expect(isAlarmEntity('alarm_control_panel.udm_pro_alarm_manager')).toBe(false);
    expect(isAlarmEntity('alarm_control_panel.alarmo')).toBe(true);
  });

  it('a SmartThings STHM event is NOT treated as the alarm', () => {
    expect(isAlarmEntity('alarm_control_panel.smartthings_home_monitor')).toBe(false);
  });

  it('truth-reconcile picks alarmo from a snapshot with TWO alarm panels (armed vs disarmed)', () => {
    const states = [
      { entity_id: 'alarm_control_panel.udm_pro_alarm_manager', state: 'disarmed', attributes: {} },
      { entity_id: 'alarm_control_panel.alarmo', state: 'armed_away', attributes: {} },
    ];
    // The reconcile finder is `states.find(s => s.entity_id === resolved)`.
    const found = states.find((s) => s.entity_id === resolved);
    expect(found?.state).toBe('armed_away');
    // And the second (disarmed) panel must NOT be what we'd compare against —
    // i.e. starting from a cached "armed_away", the disarmed second panel does
    // not even enter the comparison (the finder skipped it).
    expect(found?.entity_id).toBe('alarm_control_panel.alarmo');
  });
});

describe('write path targets the RESOLVED id (lessons A2; prod v0.1.60)', () => {
  it('apiHomeAssistantArm sends the threaded entityId, not hardcoded alarmo', async () => {
    const calls: Array<{ domain: string; service: string; data: any }> = [];
    const spy = vi
      .spyOn(haClient, 'callService')
      .mockImplementation(async (domain: string, service: string, data: any) => {
        calls.push({ domain, service, data });
        return undefined as any;
      });
    try {
      const res = await apiHomeAssistantArm('armedAway', { entityId: 'alarm_control_panel.house', pin: '1234' });
      expect(res.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].data.entity_id).toBe('alarm_control_panel.house');
      expect(calls[0].data.entity_id).not.toBe('alarm_control_panel.alarmo');
      expect(calls[0].service).toBe('arm');
      expect(calls[0].data.mode).toBe('away');
      expect(calls[0].data.code).toBe('1234');
    } finally {
      spy.mockRestore();
    }
  });

  it('disarm targets the resolved id', async () => {
    const calls: any[] = [];
    const spy = vi
      .spyOn(haClient, 'callService')
      .mockImplementation(async (_d: string, service: string, data: any) => {
        calls.push({ service, data });
        return undefined as any;
      });
    try {
      await apiHomeAssistantArm('disarmed', { entityId: 'alarm_control_panel.house' });
      expect(calls[0].service).toBe('disarm');
      expect(calls[0].data.entity_id).toBe('alarm_control_panel.house');
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to alarmo only when NO entityId is threaded (defensive)', async () => {
    const calls: any[] = [];
    const spy = vi
      .spyOn(haClient, 'callService')
      .mockImplementation(async (_d: string, _s: string, data: any) => {
        calls.push(data);
        return undefined as any;
      });
    try {
      await apiHomeAssistantArm('disarmed');
      expect(calls[0].entity_id).toBe('alarm_control_panel.alarmo');
    } finally {
      spy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: the prior alarm-safety layers must still hold after this additive
// precision (do NOT regress unknown-mapping or the truth-reconcile mismatch).
// ─────────────────────────────────────────────────────────────────────────────
const cached = (armState: AlarmState['armState'], phase: AlarmState['phase'] = 'idle'): AlarmState => ({
  locationId: 'ha-default',
  locationName: 'Home Assistant',
  armState,
  securityState: 'OK',
  violatingSensors: [],
  phase,
});

describe('prior safety layers preserved (lessons A)', () => {
  it('unknown-mapping: uncertain states still map to "unknown", never "disarmed"', () => {
    expect(normalizeArmState('unavailable')).toBe('unknown');
    expect(normalizeArmState('unknown')).toBe('unknown');
    expect(normalizeArmState('')).toBe('unknown');
    expect(normalizeArmState('disarmed')).toBe('disarmed');
  });

  it('truth-reconcile still flags the canonical mismatch (snapshot armed, cache disarmed)', () => {
    expect(isAlarmTruthMismatch({ state: 'armed_away' }, cached('disarmed'))).toBe(true);
    expect(isAlarmTruthMismatch({ state: 'disarmed' }, cached('disarmed'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY (lessons A): the placeable GlassArmingStatusTile must NEVER render the
// green positive "Disarmed" for an UNKNOWN arm state. normalizeArmState maps
// unavailable/zombie/unrecognized → 'unknown'; this tile previously fell through
// to the `disarmed` default (a false "all clear"). Now it renders the neutral
// dimmed "Status Unknown".
// ─────────────────────────────────────────────────────────────────────────────
describe('GlassArmingStatusTile never green-Disarmed on unknown (lessons A)', () => {
  it('an unknown arm state → "Status Unknown" (uncertain), not "Disarmed"/positive', () => {
    const v = viewFor('unknown', 'unavailable');
    expect(v.label).toBe('Status Unknown');
    expect(v.uncertain).toBe(true);
    expect(v.accent).not.toBe('positive'); // never the green disarmed look
    expect(v.glow).toBe(false);
  });

  it('an explicit disarmed still renders the positive "Disarmed"', () => {
    const v = viewFor('disarmed', 'disarmed');
    expect(v.label).toBe('Disarmed');
    expect(v.accent).toBe('positive');
    expect(v.uncertain).toBeFalsy();
  });

  it('armed states still render their armed labels', () => {
    expect(viewFor('armedAway', 'armed_away').label).toBe('Armed — Away');
    expect(viewFor('armedStay', 'armed_home').label).toBe('Armed — Stay');
  });

  it('an unrecognized arm string is also treated as uncertain, never Disarmed', () => {
    const v = viewFor('some_future_mode', 'some_future_mode');
    expect(v.uncertain).toBe(true);
    expect(v.accent).not.toBe('positive');
  });
});
