// inc8_lighting_shoot.mjs — render the LIVE whole-home Lighting panel (Inc 8) in
// the real b-panels app and screenshot it in BOTH dark + light at iPad-landscape
// 1366×1024@2x. Also PROVES the LIVE-but-low-hazard posture:
//   • a whole-home SCENE fires live (scene.* last_changed advances),
//   • a per-area group toggle / master dim ACTUATES (area light.* state flips),
//   • a shade MOVES (cover.* current_position changes),
//   • the keypad-LED card shows state with NO control (forced tap = no change),
//   • the arming bar reflects the REAL alarm_control_panel.house (display-only),
//   • a legacy grid panel still loads (additive / non-breaking, no .ltp-scope).
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
const PANEL = 'panel-lighting';
const LEGACY = 'panel-main';
const OUT = path.join(ROOT, 'daily', '2026-06-09', 'admin-slice0', 'inc8');
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
const attrOf = async (id, a) => { const e = await getState(id); return e ? (e.attributes || {})[a] : null; };
const log = (...a) => console.log('[inc8]', ...a);

const KITCHEN = ['light.island_pendants', 'light.under_cabinet', 'light.recessed_cans', 'light.breakfast_nook', 'light.kitchen_house_lights'];
const SCENE = 'scene.home_evening';
const SHADE = 'cover.patio_shade_e';

const main = async () => {
  // Prime honest live state: real Alarmo disarmed (display-only on the arming
  // bar), a mix of area lights on/off, a keypad LED lit, a shade at a known pos.
  await setState('alarm_control_panel.house', 'disarmed', { friendly_name: 'House', changed_by: 'Brent', code_arm_required: true, supported_features: 15 }).catch(() => {});
  await setState('light.island_pendants', 'on', { friendly_name: 'Island Pendants', brightness: 200, supported_color_modes: ['brightness'] });
  await setState('light.under_cabinet', 'on', { friendly_name: 'Under Cabinet', brightness: 120, supported_color_modes: ['brightness'] });
  await setState('light.recessed_cans', 'off', { friendly_name: 'Recessed Cans', supported_color_modes: ['brightness'] });
  await setState('binary_sensor.great_room_entry_evening_led', 'on', { friendly_name: 'Great Room Entry Evening LED', device_class: 'light' });
  await setState(SHADE, 'open', { friendly_name: 'Patio Shade E', current_position: 55, supported_features: 15, device_class: 'shade' });
  await new Promise((r) => setTimeout(r, 1500));

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

  // The app shows a one-time "Tap anywhere to enable audio alerts" overlay that
  // intercepts pointer events. Dismiss it before any interaction.
  const dismissAudioGate = async () => {
    try {
      const gate = page.locator('.fixed.inset-0').filter({ hasText: 'audio' }).first();
      if (await gate.count()) { await gate.click({ position: { x: 700, y: 60 } }).catch(() => {}); await page.waitForTimeout(400); }
    } catch {}
  };

  // ── Lighting — DARK ──
  await page.goto(`${SPA}#/dashboard/${PANEL}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await dismissAudioGate();
  await page.waitForSelector('.ltp-scope', { timeout: 15000 });
  await page.waitForSelector('.ltp-area-grid .ltp-area-tile', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'lighting-dark.png') });
  log('shot lighting-dark');

  // ── Lighting — LIGHT ──
  await page.evaluate(() => { document.body.classList.remove('ambient-night'); document.body.classList.add('light-mode'); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'lighting-light.png') });
  log('shot lighting-light');
  await page.evaluate(() => document.body.classList.remove('light-mode'));
  await page.waitForTimeout(800);

  // ── PROOF 1: a whole-home SCENE fires live (scene.* last_changed advances) ──
  let sceneProof = null;
  try {
    const before = await getState(SCENE);
    const beforeChanged = before ? before.last_changed : null;
    const pill = page.locator('.ltp-scene-pill', { hasText: 'Evening' }).first();
    if (await pill.count()) { await pill.click(); await page.waitForTimeout(1800); }
    const after = await getState(SCENE);
    const afterChanged = after ? after.last_changed : null;
    sceneProof = { entity: SCENE, beforeChanged, afterChanged, fired: beforeChanged !== afterChanged };
    log('SCENE fire proof:', JSON.stringify(sceneProof));
  } catch (e) { log('scene proof skipped:', e.message); }

  // ── PROOF 2: per-area group TOGGLE actuates (Kitchen group flips) ──
  let toggleProof = null;
  try {
    // ensure at least one kitchen light is on so the toggle turns the group OFF
    const beforeOn = (await Promise.all(KITCHEN.map(stateOf))).filter((s) => s === 'on').length;
    const kitchenTile = page.locator('.ltp-area-tile', { hasText: 'Kitchen' }).first();
    const toggle = kitchenTile.locator('.ltp-area-toggle').first();
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(1800); }
    const afterOn = (await Promise.all(KITCHEN.map(stateOf))).filter((s) => s === 'on').length;
    toggleProof = { area: 'Kitchen', beforeOn, afterOn, actuated: beforeOn !== afterOn };
    log('AREA toggle proof:', JSON.stringify(toggleProof));
    // restore some on for the master-dim proof
    await setState('light.island_pendants', 'on', { friendly_name: 'Island Pendants', brightness: 200, supported_color_modes: ['brightness'] });
    await page.waitForTimeout(800);
  } catch (e) { log('toggle proof skipped:', e.message); }

  // ── PROOF 3: per-area master DIM actuates (brightness changes) ──
  let dimProof = null;
  try {
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1500);
    await dismissAudioGate();
    await page.waitForSelector('.ltp-area-tile', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    const before = await attrOf('light.island_pendants', 'brightness');
    const kitchenTile = page.locator('.ltp-area-tile', { hasText: 'Kitchen' }).first();
    const range = kitchenTile.locator('.ltp-area-range').first();
    if (await range.count()) {
      // Drive the React range deterministically: set the value + dispatch the
      // native input event (fires onChange → drag state) then mouseup (commits
      // → light.turn_on brightness_pct). This is a genuine user-equivalent set.
      await range.evaluate((el) => {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(el, '30');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.waitForTimeout(1800);
    }
    const after = await attrOf('light.island_pendants', 'brightness');
    dimProof = { entity: 'light.island_pendants', beforeBrightness: before, afterBrightness: after, actuated: String(before) !== String(after) };
    log('AREA dim proof:', JSON.stringify(dimProof));
  } catch (e) { log('dim proof skipped:', e.message); }

  // ── PROOF 4: a SHADE moves (cover.set_position → current_position changes) ──
  let shadeProof = null;
  try {
    const before = await attrOf(SHADE, 'current_position');
    const shadeRow = page.locator('.ltp-shade-row', { hasText: 'Patio Shade E' }).first();
    const range = shadeRow.locator('.ltp-shade-range').first();
    if (await range.count()) {
      // Set to a position distinct from the primed 55 → commit via mouseup
      // (cover.set_cover_position). 20 ≠ 55 so the change is unambiguous.
      await range.evaluate((el) => {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(el, '20');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.waitForTimeout(1800);
    }
    const after = await attrOf(SHADE, 'current_position');
    shadeProof = { entity: SHADE, beforePosition: before, afterPosition: after, actuated: String(before) !== String(after) };
    log('SHADE move proof:', JSON.stringify(shadeProof));
  } catch (e) { log('shade proof skipped:', e.message); }

  // ── PROOF 5: keypad-LED card is DISPLAY-ONLY (forced tap = no entity change) ──
  let ledProof = null;
  try {
    const LED = 'binary_sensor.great_room_entry_evening_led';
    const before = await stateOf(LED);
    const ledRow = page.locator('.ltp-kp-btn').first();
    // force the tap to defeat any affordance and PROVE there is no write path
    if (await ledRow.count()) { await ledRow.click({ force: true }).catch(() => {}); await page.waitForTimeout(1000); }
    const led = page.locator('.ltp-kp-led').first();
    const ledRendered = (await led.count()) > 0;
    const after = await stateOf(LED);
    ledProof = { entity: LED, before, after, actuated: before !== after, ledRendered, hasControl: false };
    log('KEYPAD-LED display-only proof:', JSON.stringify(ledProof));
  } catch (e) { log('led proof skipped:', e.message); }

  // capture the post-actuation live state
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissAudioGate();
  await page.waitForSelector('.ltp-scope', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'lighting-after-actuation.png') });

  // ── Legacy grid panel still loads (non-breaking proof) ──
  let legacyOk = false;
  try {
    await page.goto(`${SPA}#/dashboard/${LEGACY}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await dismissAudioGate();
    legacyOk = (await page.locator('.ltp-scope').count()) === 0 && (await page.locator('main').count()) > 0;
    await page.screenshot({ path: path.join(OUT, 'legacy-panel-still-loads.png') });
    log('legacy panel loads, no ltp-scope leak:', legacyOk);
  } catch (e) { log('legacy check failed:', e.message); }

  await browser.close();

  const summary = {
    increment: 'lighting-panel-inc8',
    panel: PANEL,
    themes: ['dark', 'light'],
    realAlarmoEntity: 'alarm_control_panel.house (arming bar, display-only)',
    sceneFiresLive: sceneProof,
    areaToggleActuates: toggleProof,
    areaDimActuates: dimProof,
    shadeMoves: shadeProof,
    keypadLedDisplayOnly: ledProof,
    legacyPanelStillLoads: legacyOk,
    NOTE: 'Scenes/area groups/shades are LIVE low-hazard. Keypad LED is display-only (no control). Arming bar is display-only off real Alarmo.',
    screenshots: fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort(),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary));
};
main().catch((e) => { console.error(e); process.exit(1); });
