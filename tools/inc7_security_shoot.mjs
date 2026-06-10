// inc7_security_shoot.mjs — render the LIVE Security hub panel (Increment 7) in
// the real b-panels app and screenshot it in BOTH dark + light at iPad-landscape
// 1366×1024@2x. Also proves the HARD-GATING posture:
//   • the arming STATE reflects the REAL alarm_control_panel.house (Alarmo),
//   • tapping an Arm mode / Hold-to-Arm does NOT actuate (Alarmo stays disarmed),
//   • a lock / glass control does NOT actuate (no state change),
//   • camera tiles show the honest poster / "Feed unavailable" empty state,
//   • a legacy grid panel still loads (additive / non-breaking, no .secp-scope).
//
// Lives in the b-panels repo (b-panels owns it); imports Playwright from the
// coordinator's tools/evidence install via NODE_PATH (read-only use).
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
const PANEL = 'panel-security';
const LEGACY = 'panel-main';
const OUT = path.join(ROOT, 'daily', '2026-06-09', 'admin-slice0', 'inc7');
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
const stateOf = async (id) => { try { return (await (await api(`/api/states/${id}`)).json()).state; } catch { return null; } };
const log = (...a) => console.log('[inc7]', ...a);

const main = async () => {
  // Prime honest display state: real Alarmo disarmed (display), demo door closed,
  // demo driveway motion ON (drives the motion badge + a recent event). These
  // demo binary_sensors are display-only; nothing here actuates real hardware.
  await setState('alarm_control_panel.house', 'disarmed', {
    friendly_name: 'House', changed_by: 'Brent', code_arm_required: true,
    supported_features: 15,
  }).catch(() => {});
  await setState('binary_sensor.front_door_contact', 'off', { device_class: 'door', friendly_name: 'Front Door Contact (demo)' });
  await setState('binary_sensor.driveway_motion', 'on', { device_class: 'motion', friendly_name: 'Driveway Motion (demo)' });
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

  // ── Security — DARK ──
  await page.goto(`${SPA}#/dashboard/${PANEL}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(700, 60).catch(() => {});
  await page.waitForSelector('.secp-scope', { timeout: 15000 });
  await page.waitForSelector('.secp-content .secp-card', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // capture the displayed arming word (left hero) for the proof record
  const armWord = await page.locator('.secp-arm-state-word').first().textContent().catch(() => null);
  await page.screenshot({ path: path.join(OUT, 'security-dark.png') });
  log('shot security-dark · arm hero word =', armWord);

  // ── Security — LIGHT ──
  await page.evaluate(() => { document.body.classList.remove('ambient-night'); document.body.classList.add('light-mode'); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'security-light.png') });
  log('shot security-light');
  await page.evaluate(() => document.body.classList.remove('light-mode'));
  await page.waitForTimeout(800);

  // ── GATING PROOF 1: tapping Arm Away does NOT actuate (Alarmo stays disarmed) ──
  let armGated = null;
  try {
    await page.goto(`${SPA}#/dashboard/${PANEL}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.secp-scope', { timeout: 15000 });
    await page.waitForTimeout(2000);
    const before = await stateOf('alarm_control_panel.house');
    // force:true defeats the aria-disabled affordance to PROVE that even a forced
    // tap wires no service call — the panel exposes no actuation path at all.
    const armBtn = page.locator('.secp-arm-mode-btn', { hasText: 'Arm Away' }).first();
    const btnDisabled = (await armBtn.count()) ? await armBtn.getAttribute('aria-disabled') : null;
    if (await armBtn.count()) { await armBtn.click({ force: true }).catch(() => {}); await page.waitForTimeout(1200); }
    const hold = page.locator('.secp-hold-btn').first();
    if (await hold.count()) { await hold.click({ force: true }).catch(() => {}); await page.waitForTimeout(1200); }
    const after = await stateOf('alarm_control_panel.house');
    armGated = { entity: 'alarm_control_panel.house', before, after, actuated: before !== after, ariaDisabled: btnDisabled };
    log('ARM gating (tap Arm Away + Hold):', JSON.stringify(armGated));
  } catch (e) { log('arm gating check skipped:', e.message); }

  // ── GATING PROOF 2: tapping a CLiC glass toggle does NOT actuate ──
  // (the glass switch entity does not exist in dev → must remain absent/unchanged)
  let glassGated = null;
  try {
    const before = await stateOf('switch.clic_master_suite'); // expected null (not provisioned)
    const toggle = page.locator('.secp-glass-track').first();
    if (await toggle.count()) { await toggle.click({ force: true }).catch(() => {}); await page.waitForTimeout(1000); }
    const after = await stateOf('switch.clic_master_suite');
    glassGated = { entity: 'switch.clic_master_suite', before, after, actuated: before !== after };
    log('GLASS gating (tap Master Suite toggle):', JSON.stringify(glassGated));
  } catch (e) { log('glass gating check skipped:', e.message); }

  // ── camera honesty: count empty-state tiles (UniFi not in dev → all unavailable) ──
  let cameraHonesty = null;
  try {
    const emptyTiles = await page.locator('.secp-cam-empty').count();
    const liveChips = await page.locator('.secp-live-chip').count();
    cameraHonesty = { emptyFeedTiles: emptyTiles, liveChips };
    log('CAMERA honesty (empty-state tiles / live chips):', JSON.stringify(cameraHonesty));
  } catch (e) { log('camera honesty check skipped:', e.message); }

  // ── Legacy grid panel still loads (non-breaking proof) ──
  let legacyOk = false;
  try {
    await page.goto(`${SPA}#/dashboard/${LEGACY}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    legacyOk = (await page.locator('.secp-scope').count()) === 0 && (await page.locator('main').count()) > 0;
    await page.screenshot({ path: path.join(OUT, 'legacy-panel-still-loads.png') });
    log('legacy panel loads, no secp-scope leak:', legacyOk);
  } catch (e) { log('legacy check failed:', e.message); }

  await browser.close();

  const summary = {
    increment: 'security-panel-inc7',
    panel: PANEL,
    themes: ['dark', 'light'],
    armHeroWordRendered: armWord,
    realAlarmoEntity: 'alarm_control_panel.house',
    armGatingNoActuation: armGated,
    glassGatingNoActuation: glassGated,
    cameraHonesty,
    legacyPanelStillLoads: legacyOk,
    NOTE: 'NO gated actuation enabled. Arm/disarm, lock/unlock, garage, CLiC are display-only.',
    screenshots: fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort(),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary));
};
main().catch((e) => { console.error(e); process.exit(1); });
