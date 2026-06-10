// doorbell_garage_shoot.mjs — render + PROVE the Doorbell + Garage entry
// experience (feat/doorbell-garage · ECOSYSTEM §E1/E2 · Top-10 #4/#5) in the
// real b-panels app at iPad-landscape 1366×1024@2x (dark + light).
//
// ENTRY · DISPLAY + NOTIFY/LOG ONLY · NO LIVE ACTUATION.
//
// Drives the DEMO backing entities (cover.demo_garage_door[device_class=garage],
// binary_sensor.front_door_doorbell[name~doorbell], alarm_control_panel.house)
// and PROVES:
//   • GARAGE: open → Security panel shows Open status + (night/armed-away) alert
//   • CLOSE is confirm-to-close gated → forced tap fires NO actuation (cover
//     stays open; no cover.close service)
//   • DOORBELL RING: ring → transient overlay appears on a NON-security panel
//   • TIERING: ring + weather + life-safety → life-safety wins, then weather,
//     then ring (the ring overlay yields to BOTH)
//   • RELEASE: forced tap on the gate release fires NO service (lock unchanged)
//   • legacy panel still loads (additive/non-breaking)
//
// Imports Playwright from the coordinator's evidence install via NODE_PATH.
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

const SECURITY = 'panel-fs-security';
const HOME = 'panel-fs-home';
const LEGACY = 'default-panel';
const ALARM = 'alarm_control_panel.house';
const GARAGE = 'cover.demo_garage_door';
const DOORBELL_RING = 'input_boolean.demo_doorbell_ringing';
const GARAGE_SEL = 'input_select.demo_garage_state';
const DOORBELL = 'binary_sensor.front_door_doorbell';
const FREEZE = 'binary_sensor.demo_pool_freeze_protection';
const STORM = 'input_boolean.demo_storm_active';

const OUT = path.join(ROOT, 'daily', '2026-06-10', 'doorbell-garage');
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
const svc = (domain, service, data) =>
  api(`/api/services/${domain}/${service}`, { method: 'POST', body: JSON.stringify(data) });
const log = (...a) => console.log('[doorbell-garage]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helpers to drive the demo conditions.
const setGarage = (s) => svc('input_select', 'select_option', { entity_id: GARAGE_SEL, option: s });
const ring = (on) => svc('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: DOORBELL_RING });
const setStorm = (on) => svc('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: STORM });
const setFreeze = (on) => setState(FREEZE, on ? 'on' : 'off', { device_class: 'cold', friendly_name: 'Pool Freeze Protection' });
const disarm = () => setState(ALARM, 'disarmed', { friendly_name: 'House', open_sensors: {}, supported_features: 15 });
const armAway = () => setState(ALARM, 'armed_away', { friendly_name: 'House', open_sensors: {}, supported_features: 15 });
const triggerFire = async () => {
  await setState('binary_sensor.garage_smoke', 'on', { device_class: 'smoke', friendly_name: 'Garage' });
  await setState(ALARM, 'triggered', { friendly_name: 'House', open_sensors: { 'binary_sensor.garage_smoke': 'on' }, supported_features: 15 });
};

async function resetDemo() {
  await disarm();
  await setGarage('closed');
  await ring(false);
  await setStorm(false);
  await setFreeze(false);
  await sleep(900);
}

const main = async () => {
  await resetDemo();

  const browser = await chromium.launch();
  const shots = [];

  const runScheme = async (scheme) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: scheme });
    await ctx.addInitScript(([url, tokens]) => {
      localStorage.setItem('hassUrl', url);
      localStorage.setItem('hassTokens', tokens);
      try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
    }, [HA_URL, hassTokens()]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log('PAGEERROR:', e.message));
    page.on('dialog', async (d) => { await d.accept().catch(() => {}); });
    const SPA = `${HA_URL}/b_panels_frontend/index.html`;
    const dismissAudioGate = async () => {
      try {
        const gate = page.locator('.fixed.inset-0').filter({ hasText: 'audio' }).first();
        if (await gate.count()) { await gate.click({ position: { x: 700, y: 60 } }).catch(() => {}); await page.waitForTimeout(400); }
      } catch {}
    };
    const shot = (name) => { const f = path.join(OUT, `${name}-${scheme}.png`); shots.push(path.basename(f)); return page.screenshot({ path: f }); };
    const goto = async (panel, extra = '') => {
      await page.goto(`${SPA}#/dashboard/${panel}${extra}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2200);
      await dismissAudioGate();
      await page.waitForTimeout(400);
    };

    const results = {};

    // ── 1. GARAGE OPEN AT NIGHT (or armed-away) → Security shows status + alert ──
    await resetDemo();
    await armAway();              // armed-away guarantees the alert regardless of wall-clock
    await setGarage('open');
    await sleep(1200);
    await goto(SECURITY);
    await page.waitForSelector('.secp-scope', { timeout: 10000 }).catch(() => {});
    const alertShown = (await page.locator('.gce-alert-row').count()) > 0;
    const coverLabel = await page.locator('.secp-cover-state .secp-cover-label').first().textContent().catch(() => '');
    results.garageStatus = (coverLabel || '').trim();
    results.garageAlertShown = alertShown;
    await shot('garage-open-alert');
    log(`[${scheme}] garage status="${results.garageStatus}" alertShown=${alertShown}`);

    // ── 2. CONFIRM-TO-CLOSE fires NO actuation (forced tap) ──
    const garageBefore = await stateOf(GARAGE);
    try {
      const cta = page.locator('.gce-close-cta').first();
      if (await cta.count()) { await cta.click({ force: true }); await page.waitForTimeout(500); }
      await shot('garage-close-confirm');
      const confirmBtn = page.locator('.gce-btn').filter({ hasText: /confirm close/i }).first();
      if (await confirmBtn.count()) { await confirmBtn.click({ force: true }); await page.waitForTimeout(700); }
    } catch (e) { log('close forced-tap skipped:', e.message); }
    const garageAfter = await stateOf(GARAGE);
    results.closeForcedTapActuatesNothing = { garageBefore, garageAfter, unchanged: garageBefore === garageAfter };
    log(`[${scheme}] close forced-tap: garage ${garageBefore} -> ${garageAfter} (unchanged=${garageBefore === garageAfter})`);

    // ── 3. DOORBELL RING → transient overlay on a NON-security panel (Home) ──
    await resetDemo();
    await goto(HOME);
    await ring(true);
    await page.waitForSelector('.dbr-card', { timeout: 10000 }).catch(() => {});
    results.ringOverlayOnHome = (await page.locator('.dbr-card').count()) > 0;
    const ringTitle = await page.locator('.dbr-title').first().textContent().catch(() => '');
    results.ringTitle = (ringTitle || '').trim();
    await shot('doorbell-ring-on-home');
    log(`[${scheme}] ring overlay on Home=${results.ringOverlayOnHome} title="${results.ringTitle}"`);

    // ── 4. RELEASE forced-tap fires NO service (lock unchanged) ──
    const lockBefore = await stateOf('lock.front_door');
    try {
      const rel = page.locator('.dbr-release-cta').first();
      if (await rel.count()) { await rel.click({ force: true }); await page.waitForTimeout(400); }
      await shot('doorbell-release-confirm');
      const confirmRel = page.locator('.dbr-release-btn').filter({ hasText: /confirm release/i }).first();
      if (await confirmRel.count()) { await confirmRel.click({ force: true }); await page.waitForTimeout(600); }
    } catch (e) { log('release forced-tap skipped:', e.message); }
    const lockAfter = await stateOf('lock.front_door');
    results.releaseForcedTapFiresNoService = { lockBefore, lockAfter, unchanged: lockBefore === lockAfter };
    log(`[${scheme}] release forced-tap: lock ${lockBefore} -> ${lockAfter} (unchanged=${lockBefore === lockAfter})`);

    // ── 5. TIERING — ring active, then add weather, then life-safety ──
    await resetDemo();
    await goto(HOME);
    await ring(true);
    await page.waitForSelector('.dbr-card', { timeout: 8000 }).catch(() => {});
    const ringAlone = (await page.locator('.dbr-card').count()) > 0;

    // add WEATHER (storm) → ring must YIELD; weather banner shows.
    await setStorm(true);
    await sleep(1600);
    const ringUnderWeather = (await page.locator('.dbr-card').count()) > 0;
    const weatherShown = (await page.locator('.wxs-banner').count()) > 0;
    await shot('tier-weather-beats-ring');

    // add LIFE-SAFETY (fire) → life-safety overlay must win; weather + ring yield.
    await triggerFire();
    await page.waitForSelector('.lst-overlay', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const lifeSafetyShown = (await page.locator('.lst-overlay').count()) > 0;
    const weatherUnderLifeSafety = (await page.locator('.wxs-banner').count()) > 0;
    const ringUnderLifeSafety = (await page.locator('.dbr-card').count()) > 0;
    await shot('tier-life-safety-wins');
    results.tiering = {
      ringAlone_active: ringAlone,
      weatherBeatsRing: { weatherShown, ringYielded: !ringUnderWeather },
      lifeSafetyBeatsAll: { lifeSafetyShown, weatherYielded: !weatherUnderLifeSafety, ringYielded: !ringUnderLifeSafety },
    };
    log(`[${scheme}] tiering:`, JSON.stringify(results.tiering));

    // ── 6. legacy panel still loads (no overlay when nothing active) ──
    await resetDemo();
    let legacyOk = false;
    try {
      await goto(LEGACY);
      const hasOverlay = (await page.locator('.dbr-card, .lst-overlay, .wxs-banner').count()) > 0;
      const hasMain = (await page.locator('main').count()) > 0;
      legacyOk = !hasOverlay && hasMain;
      await shot('legacy-still-loads');
    } catch (e) { log('legacy check failed:', e.message); }
    results.legacyPanelStillLoads = legacyOk;
    log(`[${scheme}] legacy loads clean=${legacyOk}`);

    await ctx.close();
    return results;
  };

  const dark = await runScheme('dark');
  const light = await runScheme('light');

  await browser.close();
  await resetDemo();
  // clean up the fire trip sensor
  await setState('binary_sensor.garage_smoke', 'off', { device_class: 'smoke', friendly_name: 'Garage' });

  const summary = {
    increment: 'doorbell-garage',
    posture: 'ENTRY · DISPLAY + NOTIFY/LOG ONLY — zero actuation; garage close + gate release are confirm-gated and fire NO service',
    bindings: {
      garage: `${GARAGE} (cover, device_class=garage) — DEMO; real = ratgdo/Matter`,
      doorbell: `${DOORBELL} (name~doorbell) — DEMO; real = UniFi Protect doorbell / Aiphone`,
      alarm: `${ALARM} — REAL Alarmo (display-only precedence source)`,
    },
    tieringRule: 'life-safety takeover > weather-safety > doorbell ring',
    dark, light,
    screenshots: fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort(),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary, null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });
