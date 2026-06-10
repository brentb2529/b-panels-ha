import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { projectSecurity, projectArm, SECURITY_ENTITIES } from './useSecurityEntities';

const ent = (state: string, attributes: Record<string, any> = {}, last_changed = '2026-06-09T19:41:00'): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed,
  last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

describe('projectArm (display-only Alarmo state)', () => {
  it('returns Unavailable when the alarm entity is missing/unavailable', () => {
    expect(projectArm(undefined).tone).toBe('unavailable');
    expect(projectArm(ent('unavailable')).tone).toBe('unavailable');
    expect(projectArm(undefined).word).toBe('Unavailable');
  });

  it('maps disarmed with no open sensors → Disarmed / ready', () => {
    const v = projectArm(ent('disarmed', { changed_by: 'Brent' }));
    expect(v.word).toBe('Disarmed');
    expect(v.tone).toBe('ready');
    expect(v.sub).toMatch(/Ready to arm/);
    expect(v.changedBy).toBe('Brent');
  });

  it('maps disarmed WITH open sensors → not ready', () => {
    const v = projectArm(ent('disarmed', { open_sensors: { 'binary_sensor.front_door_contact': 'on' } }));
    expect(v.tone).toBe('notready');
    expect(v.sub).toMatch(/1 sensor open/);
  });

  it('maps each armed mode to the correct tone/word', () => {
    expect(projectArm(ent('armed_home')).tone).toBe('stay');
    expect(projectArm(ent('armed_away')).tone).toBe('away');
    expect(projectArm(ent('armed_night')).tone).toBe('night');
    expect(projectArm(ent('armed_away')).word).toBe('Armed · Away');
  });

  it('maps arming/pending/triggered phases', () => {
    expect(projectArm(ent('arming')).tone).toBe('pending');
    expect(projectArm(ent('pending')).tone).toBe('pending');
    const trig = projectArm(ent('triggered', { open_sensors: { a: 'on', b: 'on' } }));
    expect(trig.tone).toBe('triggered');
    expect(trig.word).toBe('Intrusion');
    expect(trig.sub).toMatch(/2 sensors/);
  });
});

describe('projectSecurity', () => {
  it('returns honest empty/PROPOSED defaults on an empty snapshot', () => {
    const v = projectSecurity({} as HassEntities);
    expect(v.arm.tone).toBe('unavailable');
    // cameras: all four present in the view but NONE has a stream (no fake LIVE)
    expect(v.cameras).toHaveLength(4);
    expect(v.cameras.every((c) => !c.available && !c.hasStream)).toBe(true);
    expect(v.camerasOnline).toBe(0);
    expect(v.motionCount).toBe(0);
    // access rows are GAP (unavailable) with the safe placeholder labels
    expect(v.access).toHaveLength(4);
    const front = v.access.find((a) => a.id === 'lock.front_door')!;
    expect(front.available).toBe(false);
    expect(front.stateLabel).toBe('Locked');
    const garage = v.access.find((a) => a.id === 'cover.garage_door')!;
    expect(garage.kind).toBe('cover');
    expect(garage.stateLabel).toBe('Open'); // placeholder matches exemplar
    // glass rows are PROPOSED placeholders
    expect(v.glass).toHaveLength(4);
    expect(v.glass.find((g) => g.name === 'Master Suite')!.stateLabel).toBe('Clear');
    expect(v.glass.find((g) => g.name === 'Pool Cabana')!.stateLabel).toBe('Private');
    expect(v.glass.find((g) => g.isOverride)!.stateLabel).toBe('Off');
    // no alarm entity → no derived events
    expect(v.events).toHaveLength(0);
  });

  it('only shows a LIVE camera (hasStream) when the camera entity is actually available', () => {
    const ents = {
      'camera.front_door': ent('idle'),               // available → stream
      'camera.driveway': ent('unavailable'),          // not available → empty state
    } as unknown as HassEntities;
    const v = projectSecurity(ents);
    const front = v.cameras.find((c) => c.id === 'camera.front_door')!;
    const drive = v.cameras.find((c) => c.id === 'camera.driveway')!;
    expect(front.hasStream).toBe(true);
    expect(drive.hasStream).toBe(false);
    expect(v.camerasOnline).toBe(1);
  });

  it('flags motion from a demo motion sensor and counts it', () => {
    const ents = {
      'camera.driveway': ent('idle'),
      'binary_sensor.driveway_motion': ent('on'),
    } as unknown as HassEntities;
    const v = projectSecurity(ents);
    const drive = v.cameras.find((c) => c.id === 'camera.driveway')!;
    expect(drive.motion).toBe(true);
    expect(v.motionCount).toBe(1);
  });

  it('builds recent events from the real Alarmo + demo contacts, newest first', () => {
    const ents = {
      [SECURITY_ENTITIES.alarm]: ent('disarmed', { changed_by: 'Brent' }, '2026-06-09T19:41:00'),
      'binary_sensor.front_door_contact': ent('off', {}, '2026-06-09T19:40:00'),
      'binary_sensor.driveway_motion': ent('on', {}, '2026-06-09T19:38:00'),
    } as unknown as HassEntities;
    const v = projectSecurity(ents);
    expect(v.events.length).toBeGreaterThanOrEqual(3);
    expect(v.events[0].text).toMatch(/System disarmed · Brent/);
    // newest first
    expect(v.events[0].ts).toBeGreaterThanOrEqual(v.events[1].ts);
  });

  it('reflects a real unlocked lock / open cover when present (display state)', () => {
    const ents = {
      'lock.front_door': ent('unlocked'),
      'cover.garage_door': ent('closed'),
    } as unknown as HassEntities;
    const v = projectSecurity(ents);
    const front = v.access.find((a) => a.id === 'lock.front_door')!;
    expect(front.available).toBe(true);
    expect(front.stateLabel).toBe('Unlocked');
    expect(front.open).toBe(true);
    const garage = v.access.find((a) => a.id === 'cover.garage_door')!;
    expect(garage.stateLabel).toBe('Closed');
    expect(garage.open).toBe(false);
  });

  it('reflects real CLiC glass on/off (Clear/Private) when present', () => {
    const ents = {
      'switch.clic_master_suite': ent('off'),
      'switch.clic_global_override': ent('on'),
    } as unknown as HassEntities;
    const v = projectSecurity(ents);
    expect(v.glass.find((g) => g.name === 'Master Suite')!.stateLabel).toBe('Private');
    expect(v.glass.find((g) => g.isOverride)!.stateLabel).toBe('On');
  });
});
