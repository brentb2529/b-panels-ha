// inc10_takeover_shoot.mjs — render + PROVE the LIFE-SAFETY TAKEOVER (Increment
// 10) in the real b-panels app at iPad-landscape 1366×1024@2x (dark).
//
// SAFETY-CRITICAL · GATED · DISPLAY + ANNUNCIATION ONLY.
//
// The takeover is driven by the REAL alarm_control_panel.house state + its
// open_sensors attribute. This script forces that entity to `triggered` with
// different device_class open_sensors to exercise each type-branch, then PROVES:
//   • FIRE      — smoke device_class → red EVACUATE takeover
//   • CO        — carbon_monoxide → GET TO FRESH AIR takeover
//   • INTRUSION — door device_class → disarm PIN keypad + entry-delay countdown
//   • FIRE OVER POOL — same fire takeover rendered while ON the Pool panel
//     (proves the global override of panel scoping)
//   • SIGNAL-LOST — simulate feed loss → "status UNKNOWN, not all clear" banner
//   • FORCED TAPS on the disarm keypad + cancel link actuate NOTHING (the alarm
//     entity stays `triggered`, never disarmed; no service fires)
//   • IDLE-RETURN is suppressed during a takeover
//   • a legacy grid panel still loads when NOT triggered (additive/non-breaking)
//
// Lives in the b-panels repo; imports Playwright from the coordinator's
// tools/evidence install via NODE_PATH (read-only use).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(os.homedir(), 'bensten-ha');
const GATE_ENV = path.join(ROOT, 'dev-ha', '.gate.env');
function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}
const env = readEnv(GATE_ENV);
const HA_URL = (env.HA_URL || 'http://localhost:8123').replace(/\/$/, '');
const TOKEN = env.HA_TOKEN;
const POOL = 'panel-pool';
const LEGACY = 'panel-main';
const HOME = 'panel-home';
const ALARM = 'alarm_control_panel.house';
const OUT = path.join(ROOT, 'daily', '2026-06-09', 'admin-slice0', 'inc10');
fs.mkdirSync(OUT, { recursive: true });

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}
async function api(p, opts = {}) {
  return fetch(`${HA_URL}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const setState = (id, state, attributes = {}) =>
  api(`/api/states/${id}`, { method: 'POST', body: JSON.stringify({ state, attributes }) });
const getState = async (id) => { try { return await (await api(`/api/states/${id}`)).json(); } catch { return null; } };
const stateOf = async (id) => { const e = await getState(id); return e ? e.state : null; };
const log = (...a) => console.log('[inc10]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Provision a triggering sensor (device_class drives the branch) + flip the
// real alarm panel to `triggered` carrying that sensor in open_sensors.
async function provisionSensor(id, deviceClass, friendly) {
  await setState(id, 'on', { device_class: deviceClass, friendly_name: friendly });
}
async function trigger(openSensors, extra = {}) {
  await setState(ALARM, 'triggered', {
    friendly_name: 'House', changed_by: 'Brent', code_arm_required: true,
    supported_features: 15, open_sensors: openSensors, ...extra,
  });
}
async function disarm() {
  await setState(ALARM, 'disarmed', {
    friendly_name: 'House', changed_by: 'Brent', code_arm_required: true,
    supported_features: 15, open_sensors: {},
  });
}

const main = async () => {
  await disarm();
  await sleep(800);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctx.addInitScript(([url, tokens]) => {
    localStorage.setItem('hassUrl', url);
    localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
  }, [HA_URL, hassTokens()]);

  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if (/error|fail|exception/i.test(t)) log('PAGE:', t); });
  page.on('pageerror', (e) => log('PAGEERROR:', e.message));
  page.on('dialog', async (d) => { await d.accept().catch(() => {}); });

  const SPA = `${HA_URL}/b_panels_frontend/index.html`;
  const dismissAudioGate = async () => {
    try {
      const gate = page.locator('.fixed.inset-0').filter({ hasText: 'audio' }).first();
      if (await gate.count()) { await gate.click({ position: { x: 700, y: 60 } }).catch(() => {}); await page.waitForTimeout(400); }
    } catch {}
  };
  const waitTakeover = async (type) => {
    await page.waitForSelector(`.lst-scope.lst-${type} .lst-overlay`, { timeout: 12000 });
    await page.waitForTimeout(1500);
  };

  // Land on Home (idle param shortened so we can prove idle-return is suppressed).
  await page.goto(`${SPA}#/dashboard/${HOME}?idle=4`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await dismissAudioGate();

  // ── FIRE: smoke device_class, two zones (multiplicity / spreading) ──
  await provisionSensor('binary_sensor.garage_smoke', 'smoke', 'Garage');
  await provisionSensor('binary_sensor.kitchen_smoke', 'smoke', 'Kitchen');
  await trigger({ 'binary_sensor.garage_smoke': 'on', 'binary_sensor.kitchen_smoke': 'on' });
  await waitTakeover('fire');
  await page.screenshot({ path: path.join(OUT, 'takeover-fire.png') });
  const fireWord = await page.locator('.lst-type-word').first().textContent().catch(() => '');
  log('FIRE takeover shown; headline =', JSON.stringify(fireWord));

  // ── PROOF: idle-return is SUPPRESSED during the takeover ──
  // idle was set to 4s. Wait well past it and confirm we did NOT navigate away
  // from Home (the takeover is up; the shell must not yank the view).
  await page.waitForTimeout(6000);
  const urlDuringTakeover = page.url();
  const stillHome = urlDuringTakeover.includes(HOME);
  log('idle-return suppressed (still on home after 6s, idle=4s):', stillHome, urlDuringTakeover);

  // ── PROOF: forced taps on cancel actuate NOTHING ──
  const alarmBeforeTaps = await stateOf(ALARM);
  try {
    const cancel = page.locator('.lst-cancel-link').first();
    if (await cancel.count()) { await cancel.click({ force: true }).catch(() => {}); await page.waitForTimeout(600); }
    const ack = page.locator('.lst-ack-btn').first();
    if (await ack.count()) { await ack.click({ force: true }).catch(() => {}); await page.waitForTimeout(600); }
  } catch (e) { log('fire forced-tap skipped:', e.message); }
  const alarmAfterTaps = await stateOf(ALARM);
  log('fire forced-tap actuates nothing:', { alarmBeforeTaps, alarmAfterTaps, unchanged: alarmBeforeTaps === alarmAfterTaps });

  // ── CO: carbon_monoxide device_class ──
  await disarm(); await sleep(700);
  await provisionSensor('binary_sensor.hall_co', 'carbon_monoxide', 'Hall');
  await provisionSensor('binary_sensor.master_co', 'carbon_monoxide', 'Master');
  await trigger({ 'binary_sensor.hall_co': 'on', 'binary_sensor.master_co': 'on' });
  await waitTakeover('co');
  await page.screenshot({ path: path.join(OUT, 'takeover-co.png') });
  log('CO takeover shown');

  // ── INTRUSION: door device_class + entry delay ──
  await disarm(); await sleep(700);
  await provisionSensor('binary_sensor.front_door_trip', 'door', 'Front Door');
  await trigger({ 'binary_sensor.front_door_trip': 'on' }, { arm_mode: 'armed_away', delay: 30 });
  await waitTakeover('intrusion');
  await page.screenshot({ path: path.join(OUT, 'takeover-intrusion.png') });
  log('INTRUSION takeover shown (disarm keypad + entry delay)');

  // ── PROOF: forced taps on disarm keypad + Disarm key actuate NOTHING ──
  const intrBefore = await stateOf(ALARM);
  try {
    for (const n of ['1', '2', '3', '4']) {
      const k = page.locator('.lst-key', { hasText: new RegExp(`^${n}$`) }).first();
      if (await k.count()) await k.click({ force: true }).catch(() => {});
    }
    const disarmKey = page.locator('.lst-key-disarm').first();
    if (await disarmKey.count()) { await disarmKey.click({ force: true }).catch(() => {}); await page.waitForTimeout(800); }
  } catch (e) { log('intrusion forced-tap skipped:', e.message); }
  const intrAfter = await stateOf(ALARM);
  log('DISARM keypad forced-tap actuates nothing:', { intrBefore, intrAfter, stillTriggered: intrAfter === 'triggered', unchanged: intrBefore === intrAfter });

  // ── FIRE OVER POOL: navigate to the Pool panel, then trigger fire → the
  //    whole-house takeover must override the pool surface (global override). ──
  await disarm(); await sleep(700);
  await page.goto(`${SPA}#/dashboard/${POOL}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await dismissAudioGate();
  await page.waitForSelector('.plp-scope, .pool-scope, [class*="pool"]', { timeout: 8000 }).catch(() => {});
  await provisionSensor('binary_sensor.garage_smoke', 'smoke', 'Garage');
  await trigger({ 'binary_sensor.garage_smoke': 'on' });
  await waitTakeover('fire');
  await page.screenshot({ path: path.join(OUT, 'takeover-fire-over-pool.png') });
  const overlayOnPool = (await page.locator('.lst-scope.lst-fire .lst-overlay').count()) > 0;
  log('FIRE-over-POOL global override proven:', overlayOnPool);

  // ── SIGNAL-LOST: simulate feed loss. The alarm entity goes unavailable AND we
  //    let the freshness flip to signal-lost → "status UNKNOWN, not all clear". ──
  await setState(ALARM, 'unavailable', { friendly_name: 'House' });
  await sleep(1500);
  // The freshness uses WS connectivity + entity availability. Setting the entity
  // unavailable yields signal-lost in the projection. Reload onto a non-security
  // panel so the banner is what's visible.
  await page.goto(`${SPA}#/dashboard/${HOME}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await dismissAudioGate();
  await page.waitForSelector('.lst-signal-banner', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const signalLostShown = (await page.locator('.lst-signal-banner').count()) > 0;
  const bannerText = await page.locator('.lst-sb-title').first().textContent().catch(() => '');
  await page.screenshot({ path: path.join(OUT, 'takeover-signal-lost.png') });
  log('SIGNAL-LOST banner shown:', signalLostShown, '| text:', JSON.stringify(bannerText));

  // ── Restore + PROOF: legacy panel still loads when NOT triggered ──
  await disarm(); await sleep(800);
  let legacyOk = false;
  try {
    await page.goto(`${SPA}#/dashboard/${LEGACY}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await dismissAudioGate();
    const hasTakeover = (await page.locator('.lst-overlay, .lst-signal-banner').count()) > 0;
    const hasMain = (await page.locator('main').count()) > 0;
    legacyOk = !hasTakeover && hasMain;
    await page.screenshot({ path: path.join(OUT, 'legacy-panel-still-loads.png') });
    log('legacy panel loads, no takeover when not triggered:', legacyOk);
  } catch (e) { log('legacy check failed:', e.message); }

  // ── Not-ready pill PROOF: open a perimeter contact → shell pill "Not Ready" ──
  let notReadyProof = null;
  try {
    await api('/api/services/input_boolean/turn_on', { method: 'POST', body: JSON.stringify({ entity_id: 'input_boolean.snr_front_door' }) });
    await sleep(1800);
    const helper = await getState('binary_sensor.security_not_ready');
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2000);
    await dismissAudioGate();
    notReadyProof = { helperState: helper?.state, openList: helper?.attributes?.open_list };
    log('not-ready helper proof:', JSON.stringify(notReadyProof));
    await api('/api/services/input_boolean/turn_off', { method: 'POST', body: JSON.stringify({ entity_id: 'input_boolean.snr_front_door' }) });
  } catch (e) { log('not-ready proof skipped:', e.message); }

  await browser.close();
  await disarm();

  const summary = {
    increment: 'takeover-inc10',
    posture: 'DISPLAY + ANNUNCIATION ONLY — zero gated actuation; driven by REAL alarm_control_panel.house + open_sensors',
    typeBranch: 'device_class smoke/heat→fire · carbon_monoxide→CO · gas→gas · door/window/motion→intrusion · absent→evacuate',
    fireHeadline: fireWord,
    idleReturnSuppressed: stillHome,
    fireForcedTapActuatesNothing: { alarmBeforeTaps, alarmAfterTaps, unchanged: alarmBeforeTaps === alarmAfterTaps },
    disarmKeypadForcedTapActuatesNothing: { intrBefore, intrAfter, stillTriggered: intrAfter === 'triggered' },
    fireOverPoolGlobalOverride: overlayOnPool,
    signalLostBannerShown: signalLostShown,
    signalLostBannerText: bannerText,
    legacyPanelStillLoads: legacyOk,
    securityNotReadyHelper: notReadyProof,
    screenshots: fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort(),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary, null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });
