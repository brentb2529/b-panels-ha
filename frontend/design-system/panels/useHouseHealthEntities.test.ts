import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import {
  projectConnectivity,
  projectGenerator,
  projectUps,
  projectNetwork,
  projectSafety,
  projectAttention,
  projectHouseHealth,
  worst,
  EMDASH,
} from './useHouseHealthEntities';

const ent = (state: string, attributes: Record<string, any> = {}, last_changed = '2026-06-10T11:00:00'): any => ({
  entity_id: 'x',
  state,
  attributes,
  last_changed,
  last_updated: last_changed,
  context: { id: '', parent_id: null, user_id: null },
});

const NOW = new Date('2026-06-10T11:00:30').getTime();

describe('worst (status rollup)', () => {
  it('ranks critical > attention > unknown > ok', () => {
    expect(worst('ok', 'attention')).toBe('attention');
    expect(worst('attention', 'critical')).toBe('critical');
    expect(worst('unknown', 'ok')).toBe('unknown');     // unknown never collapses to ok
    expect(worst('ok', 'ok')).toBe('ok');
  });
});

describe('projectConnectivity (online/offline rollup)', () => {
  it('counts real device entities, excludes helper/diagnostic domains', () => {
    const ents = {
      'light.kitchen': ent('on'),
      'climate.living': ent('cool'),
      'switch.pool_body': ent('on'),
      // excluded domains — must NOT count as devices or as offline noise
      'sun.sun': ent('above_horizon'),
      'person.bbensten': ent('unknown'),
      'button.restart': ent('unknown'),
      'script.scene_goodnight': ent('off'),
      'input_boolean.gated_alarm_armed': ent('off'),
    } as unknown as HassEntities;
    const v = projectConnectivity(ents);
    expect(v.total).toBe(3);
    expect(v.online).toBe(3);
    expect(v.offlineCount).toBe(0);
    expect(v.status).toBe('ok');
  });

  it('rolls up an offline/unavailable entity into the offline list (attention)', () => {
    const ents = {
      'light.kitchen': ent('on'),
      'light.patio': ent('unavailable', { friendly_name: 'Patio Lights' }),
      'sensor.temp': ent('unknown'),               // sensor unknown = offline-ish
    } as unknown as HassEntities;
    const v = projectConnectivity(ents);
    expect(v.offlineCount).toBe(2);
    expect(v.status).toBe('attention');
    const patio = v.offline.find((o) => o.id === 'light.patio')!;
    expect(patio.name).toBe('Patio Lights');
    expect(v.online).toBe(1);
  });

  it('flags a device_class:problem sensor that is ON as a fault (critical)', () => {
    const ents = {
      'light.kitchen': ent('on'),
      'binary_sensor.pump_problem': ent('on', { device_class: 'problem', friendly_name: 'Pump Problem' }),
      'binary_sensor.other_problem': ent('off', { device_class: 'problem' }),  // off ⇒ no fault
    } as unknown as HassEntities;
    const v = projectConnectivity(ents);
    expect(v.problemCount).toBe(1);
    expect(v.problems[0].name).toBe('Pump Problem');
    expect(v.status).toBe('critical');     // a fault outranks "everything online"
  });

  it('honest empty snapshot → ok with zero totals (no fabricated state)', () => {
    const v = projectConnectivity({} as HassEntities);
    expect(v.total).toBe(0);
    expect(v.offlineCount).toBe(0);
    expect(v.problemCount).toBe(0);
    expect(v.status).toBe('ok');
  });
});

describe('projectGenerator (absent-source honesty + live projection)', () => {
  it('renders honest not-configured when no generator entities present', () => {
    const v = projectGenerator({} as HassEntities);
    expect(v.configured).toBe(false);
    expect(v.status).toBe('unknown');        // NOT ok — never fake-green
    expect(v.runState).toBe(EMDASH);
    expect(v.source).toBe(EMDASH);
    expect(v.fuel).toBe(EMDASH);
    expect(v.autoMode).toBeNull();
    expect(v.note).toMatch(/not connected|awaiting/i);
  });

  it('projects standby on utility as ok', () => {
    const ents = {
      'sensor.generator_status': ent('standby'),
      'sensor.generator_power_source': ent('utility'),
      'binary_sensor.generator_auto_mode': ent('on'),
      'sensor.generator_fuel_level': ent('78', { unit_of_measurement: '%' }),
    } as unknown as HassEntities;
    const v = projectGenerator(ents);
    expect(v.configured).toBe(true);
    expect(v.status).toBe('ok');
    expect(v.source).toBe('Utility');
    expect(v.autoMode).toBe(true);
    expect(v.fuel).toBe('78%');
    expect(v.onGenerator).toBe(false);
  });

  it('projects running-on-generator as attention', () => {
    const ents = {
      'sensor.generator_status': ent('running'),
      'sensor.generator_power_source': ent('generator'),
    } as unknown as HassEntities;
    const v = projectGenerator(ents);
    expect(v.status).toBe('attention');
    expect(v.onGenerator).toBe(true);
    expect(v.source).toBe('Generator');
    expect(v.runState).toBe('Running');
  });

  it('projects a generator fault as critical', () => {
    const ents = { 'sensor.generator_status': ent('fault') } as unknown as HassEntities;
    const v = projectGenerator(ents);
    expect(v.status).toBe('critical');
    expect(v.note).toMatch(/fault/i);
  });
});

describe('projectUps (absent-source honesty + live projection)', () => {
  it('renders honest not-configured when NUT absent', () => {
    const v = projectUps({} as HassEntities);
    expect(v.configured).toBe(false);
    expect(v.status).toBe('unknown');
    expect(v.battery).toBe(EMDASH);
    expect(v.runtime).toBe(EMDASH);
  });

  it('projects online UPS as ok', () => {
    const ents = {
      'sensor.ups_status': ent('OL'),
      'sensor.ups_battery_charge': ent('100'),
      'sensor.ups_battery_runtime': ent('3600'),  // seconds → 60 min
      'sensor.ups_load': ent('18'),
    } as unknown as HassEntities;
    const v = projectUps(ents);
    expect(v.configured).toBe(true);
    expect(v.status).toBe('ok');
    expect(v.stateLabel).toBe('Online');
    expect(v.battery).toBe('100%');
    expect(v.runtime).toBe('60 min');
    expect(v.load).toBe('18%');
  });

  it('projects on-battery as attention and low-battery as critical', () => {
    const ob = projectUps({ 'sensor.ups_status': ent('OB') } as unknown as HassEntities);
    expect(ob.status).toBe('attention');
    expect(ob.onBattery).toBe(true);
    const lb = projectUps({ 'sensor.ups_status': ent('OB LB') } as unknown as HassEntities);
    expect(lb.status).toBe('critical');
  });
});

describe('projectNetwork (absent-source honesty + live projection)', () => {
  it('renders honest not-configured when UniFi absent', () => {
    const v = projectNetwork({} as HassEntities);
    expect(v.configured).toBe(false);
    expect(v.status).toBe('unknown');
    expect(v.wanUp).toBeNull();
    expect(v.wanLabel).toBe(EMDASH);
    expect(v.clients).toBe(EMDASH);
  });

  it('projects WAN up + clients as ok', () => {
    const ents = {
      'binary_sensor.unifi_wan_status': ent('on'),
      'sensor.unifi_wan_isp': ent('Comcast'),
      'sensor.unifi_clients': ent('32'),
      'sensor.unifi_active_aps': ent('6'),
    } as unknown as HassEntities;
    const v = projectNetwork(ents);
    expect(v.configured).toBe(true);
    expect(v.status).toBe('ok');
    expect(v.wanUp).toBe(true);
    expect(v.wanLabel).toBe('WAN Up');
    expect(v.isp).toBe('Comcast');
    expect(v.clients).toBe('32 clients');
    expect(v.aps).toBe('6 APs');
  });

  it('projects WAN down as critical', () => {
    const v = projectNetwork({ 'binary_sensor.unifi_wan_status': ent('off') } as unknown as HassEntities);
    expect(v.status).toBe('critical');
    expect(v.wanUp).toBe(false);
    expect(v.wanLabel).toBe('WAN Down');
  });
});

describe('projectSafety (freshness + signal-lost, never fake clear)', () => {
  it('known-good live disarmed alarm → ok, fresh', () => {
    const ents = { 'alarm_control_panel.house': ent('disarmed') } as unknown as HassEntities;
    const v = projectSafety(ents, true, NOW - 1000, NOW);
    expect(v.alarmReachable).toBe(true);
    expect(v.freshness).toBe('known-good');
    expect(v.status).toBe('ok');
    expect(v.alarmLabel).toMatch(/Disarmed/);
  });

  it('disconnected feed → signal-lost (critical), NOT all-clear', () => {
    const ents = { 'alarm_control_panel.house': ent('disarmed') } as unknown as HassEntities;
    const v = projectSafety(ents, false, NOW - 1000, NOW);
    expect(v.freshness).toBe('signal-lost');
    expect(v.status).toBe('critical');
    expect(v.note).toMatch(/unknown|NOT confirmed/i);
  });

  it('missing alarm entity → signal-lost (unreachable, critical)', () => {
    const v = projectSafety({} as HassEntities, true, NOW - 1000, NOW);
    expect(v.alarmReachable).toBe(false);
    expect(v.freshness).toBe('signal-lost');
    expect(v.status).toBe('critical');
  });

  it('stale (connected but old) → attention', () => {
    const ents = { 'alarm_control_panel.house': ent('armed_away') } as unknown as HassEntities;
    const v = projectSafety(ents, true, NOW - 60000, NOW);   // > 45s old
    expect(v.freshness).toBe('stale');
    expect(v.status).toBe('attention');
  });

  it('triggered alarm → critical', () => {
    const ents = { 'alarm_control_panel.house': ent('triggered') } as unknown as HassEntities;
    const v = projectSafety(ents, true, NOW - 1000, NOW);
    expect(v.status).toBe('critical');
    expect(v.note).toMatch(/TRIGGERED/);
  });

  it('disarmed with open zones (not-ready helper on) → attention', () => {
    const ents = {
      'alarm_control_panel.house': ent('disarmed'),
      'binary_sensor.security_not_ready': ent('on', { open_list: 'Front Door, Patio Slider' }),
    } as unknown as HassEntities;
    const v = projectSafety(ents, true, NOW - 1000, NOW);
    expect(v.notReady).toBe(true);
    expect(v.openList).toBe('Front Door, Patio Slider');
    expect(v.status).toBe('attention');
  });
});

describe('projectAttention (proactive summary)', () => {
  it('all healthy + monitored sources → "All systems healthy" / ok', () => {
    const conn = projectConnectivity({ 'light.k': ent('on') } as unknown as HassEntities);
    const gen = projectGenerator({ 'sensor.generator_status': ent('standby'), 'sensor.generator_power_source': ent('utility') } as unknown as HassEntities);
    const ups = projectUps({ 'sensor.ups_status': ent('OL') } as unknown as HassEntities);
    const net = projectNetwork({ 'binary_sensor.unifi_wan_status': ent('on') } as unknown as HassEntities);
    const safety = projectSafety({ 'alarm_control_panel.house': ent('disarmed') } as unknown as HassEntities, true, NOW - 1000, NOW);
    const a = projectAttention(conn, gen, ups, net, safety);
    expect(a.overall).toBe('ok');
    expect(a.headline).toMatch(/healthy/i);
  });

  it('absent sources keep overall partially-monitored (unknown), never ok-washed', () => {
    const conn = projectConnectivity({ 'light.k': ent('on') } as unknown as HassEntities);
    const gen = projectGenerator({} as HassEntities);  // absent
    const ups = projectUps({} as HassEntities);        // absent
    const net = projectNetwork({} as HassEntities);    // absent
    const safety = projectSafety({ 'alarm_control_panel.house': ent('disarmed') } as unknown as HassEntities, true, NOW - 1000, NOW);
    const a = projectAttention(conn, gen, ups, net, safety);
    expect(a.overall).toBe('unknown');
    expect(a.headline).toMatch(/Partially monitored/);
    // honest absent notes present, not faked OK
    expect(a.items.some((i) => /Generator.*awaiting/i.test(i.text))).toBe(true);
  });

  it('a fault makes overall critical and floats it to the top of the feed', () => {
    const conn = projectConnectivity({
      'light.k': ent('on'),
      'binary_sensor.leak_problem': ent('on', { device_class: 'problem', friendly_name: 'Leak' }),
    } as unknown as HassEntities);
    const gen = projectGenerator({} as HassEntities);
    const ups = projectUps({} as HassEntities);
    const net = projectNetwork({} as HassEntities);
    const safety = projectSafety({ 'alarm_control_panel.house': ent('disarmed') } as unknown as HassEntities, true, NOW - 1000, NOW);
    const a = projectAttention(conn, gen, ups, net, safety);
    expect(a.overall).toBe('critical');
    expect(a.items[0].status).toBe('critical');
  });
});

describe('projectHouseHealth (composition, read-only)', () => {
  it('composes all five groups from a snapshot', () => {
    const ents = {
      'light.kitchen': ent('on'),
      'alarm_control_panel.house': ent('disarmed'),
    } as unknown as HassEntities;
    const v = projectHouseHealth(ents, true, NOW - 1000, NOW);
    expect(v.connectivity).toBeDefined();
    expect(v.generator.configured).toBe(false);   // absent in this snapshot
    expect(v.ups.configured).toBe(false);
    expect(v.network.configured).toBe(false);
    expect(v.safety.status).toBe('ok');
    expect(v.attention.overall).toBe('unknown');   // partially monitored (absent power/net)
  });
});
