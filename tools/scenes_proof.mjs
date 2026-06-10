// scenes_proof.mjs — Signature whole-house scenes (H1) live proof.
//
// Renders the LIVE Home overview panel (iPad-landscape 1366×1024@2x) in the real
// b-panels app and proves the safety design end-to-end:
//   • triggers scenes LIVE (Goodnight, Entertain) and confirms low-hazard actors
//     actually change (lights/shades/Sonos/HVAC),
//   • FORCED-CHECK: snapshots every GATED actor before/after each scene and
//     asserts ZERO changed (no arm/lock/AKVO/pool-body/CLiC/garage actuation),
//   • opens the richer scene experience modal and shows the gated finishing step,
//   • confirms the legacy grid panel still loads.
// Screenshots + a JSON summary land under daily/2026-06-10/scenes/.
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
const WS = HA_URL.replace('http', 'ws') + '/api/websocket';
const SPA = `${HA_URL}/b_panels_frontend/index.html`;
const PANEL = 'panel-home';
const LEGACY = 'default-panel';
const OUT = path.join(ROOT, 'daily', '2026-06-10', 'scenes');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[scenes]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  return fetch(`${HA_URL}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const setState = (id, state, attributes = {}) =>
  api(`/api/states/${id}`, { method: 'POST', body: JSON.stringify({ state, attributes }) });
const getState = async (id) => { try { return await (await api(`/api/states/${id}`)).json(); } catch { return null; } };
const callService = (d, s, body) => api(`/api/services/${d}/${s}`, { method: 'POST', body: JSON.stringify(body) });

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}

// The six GATED actors a scene must NEVER touch. Forced-check snapshots these.
const GATED = [
  'input_boolean.gated_alarm_armed',
  'input_boolean.gated_front_door_locked',
  'input_boolean.gated_garage_open',
  'input_boolean.gated_clic_privacy',
  'input_boolean.gated_pool_body',
  'input_boolean.gated_akvo_floor_move',
];

async function snapshotGated() {
  const snap = {};
  for (const id of GATED) {
    const e = await getState(id);
    snap[id] = e ? { state: e.state, lc: e.last_changed } : null;
  }
  return snap;
}
function diffGated(before, after) {
  const changed = [];
  for (const id of GATED) {
    const b = before[id], a = after[id];
    if (!b || !a) continue;
    if (b.state !== a.state || b.lc !== a.lc) changed.push({ id, before: b.state, after: a.state });
  }
  return changed;
}

// Inject the Home compilation panel via the integration's own save path.
async function injectHomePanel() {
  const { default: WebSocket } = await import('ws');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS, { maxPayload: 8 * 1024 * 1024 });
    let mid = 0;
    const pending = new Map();
    const call = (payload) => new Promise((res, rej) => {
      mid += 1; payload.id = mid; pending.set(mid, { res, rej });
      ws.send(JSON.stringify(payload));
    });
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_required') { ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN })); return; }
      if (msg.type === 'auth_ok') {
        try {
          const cfg = await call({ type: 'b_panels/config/get' });
          cfg.panels = (cfg.panels || []).filter((p) => p.id !== PANEL);
          cfg.panels.unshift({ id: PANEL, name: 'Home', tiles: [], compilationKind: 'home', themeMode: 'dark', showArmingStatus: true });
          await call({ type: 'b_panels/config/save', config: cfg });
          log('injected home panel; panels:', cfg.panels.map((p) => p.id).join(','));
          ws.close(); resolve();
        } catch (e) { ws.close(); reject(e); }
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
        msg.success ? res(msg.result) : rej(new Error(JSON.stringify(msg.error)));
      }
    });
    ws.on('error', reject);
  });
}

// Seed the Home overview demo entities the panel rolls up (pool chem, alarm,
// door/motion, weather). Lights/covers/climate/scripts are REAL (package).
async function seedHome() {
  await setState('sensor.hd_pool_water_temperature', '88', { friendly_name: 'Pool Water', unit_of_measurement: '°F' });
  await setState('sensor.hd_pool_ph', '7.5', { friendly_name: 'Pool pH' });
  await setState('sensor.hd_pool_salt', '3100', { friendly_name: 'Pool Salt', unit_of_measurement: 'ppm' });
  await setState('switch.pool_body', 'on', { friendly_name: 'Pool Body' });
  await setState('alarm_control_panel.house', 'disarmed', { friendly_name: 'House', code_arm_required: true, supported_features: 15 });
  await setState('binary_sensor.front_door', 'off', { friendly_name: 'Front Door', device_class: 'door' });
  await setState('binary_sensor.patio_slider', 'off', { friendly_name: 'Patio Slider', device_class: 'door' });
  await setState('binary_sensor.great_room_motion', 'off', { friendly_name: 'Great Room Motion', device_class: 'motion' });
  // a rich starting light/climate state so Goodnight visibly winds it down
  for (const L of ['great_room_lights', 'kitchen_house_lights', 'office_lights', 'patio_lights', 'foyer_lights']) {
    await callService('light', 'turn_on', { entity_id: `light.${L}`, brightness_pct: 80 });
  }
  await callService('cover', 'set_cover_position', { entity_id: 'cover.master_shade', position: 100 });
  await callService('climate', 'set_hvac_mode', { entity_id: ['climate.living_zone', 'climate.primary_zone', 'climate.kitchen_zone'], hvac_mode: 'cool' });
}

const summary = { ts: new Date().toISOString(), scenes: {}, forcedCheck: {}, legacyLoads: null, pageErrors: [] };

const main = async () => {
  await seedHome();
  await injectHomePanel();
  await sleep(1000);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctx.addInitScript(([url, tokens]) => {
    localStorage.setItem('hassUrl', url);
    localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
  }, [HA_URL, hassTokens()]);

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') summary.pageErrors.push(m.text()); });
  page.on('pageerror', (e) => summary.pageErrors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async (d) => { await d.accept().catch(() => {}); });

  // ── Render Home ──
  await page.goto(`${SPA}#/dashboard/${PANEL}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2200);
  await page.mouse.click(700, 60).catch(() => {});
  await page.waitForSelector('.hp-scope', { timeout: 15000 });
  await page.waitForSelector('.hp-scenes .hp-pill', { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '01-home-scenes.png') });
  log('shot 01-home-scenes');

  // ── Scene experience modal (open Goodnight details — shows the gated step) ──
  const goodnightInfo = page.locator('.hp-pill-group', { hasText: 'Goodnight' }).locator('.hp-pill-info');
  await goodnightInfo.click();
  await page.waitForSelector('.hp-scene-modal', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '02-goodnight-experience.png') });
  log('shot 02-goodnight-experience (low-hazard list + gated step)');
  // expand the gated finishing step
  await page.locator('.hp-scene-gated-cta').click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('.hp-scene-btn.danger').click().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '03-gated-step-confirm-only.png') });
  log('shot 03-gated-step-confirm-only (acknowledged, no live actuation)');
  // close modal
  await page.locator('.hp-scene-modal-x').click().catch(() => {});
  await page.waitForTimeout(400);

  // Reset low-hazard demo entities to a contrasting baseline so each scene's
  // before→after diff is unambiguous. (Does NOT touch any gated actor.)
  const resetBaseline = async () => {
    for (const L of ['great_room_lights', 'kitchen_house_lights', 'office_lights', 'patio_lights', 'foyer_lights', 'theater_lights']) {
      await callService('light', 'turn_on', { entity_id: `light.${L}`, brightness_pct: 80 });
    }
    for (const L of ['pool_lights', 'landscape_lights', 'master_lights']) {
      await callService('light', 'turn_off', { entity_id: `light.${L}` });
    }
    for (const [c, p] of [['master_shade', 100], ['great_room_shade', 100], ['patio_shade', 100], ['theater_shade', 100]]) {
      await callService('cover', 'set_cover_position', { entity_id: `cover.${c}`, position: p });
    }
    await callService('input_select', 'select_option', { entity_id: 'input_select.sig_media_state', option: 'idle' });
    await callService('climate', 'set_temperature', { entity_id: ['climate.kitchen_zone', 'climate.living_zone', 'climate.primary_zone'], temperature: 74 });
    await sleep(900);
  };

  // ── LIVE trigger: Goodnight (tap the pill) + forced gated-check ──
  const runScene = async (name, lowChecks) => {
    await resetBaseline();
    const gatedBefore = await snapshotGated();
    const before = {};
    for (const c of lowChecks) before[c.id] = await getState(c.id);
    const pill = page.locator('.hp-pill-group', { hasText: name }).locator('.hp-pill').first();
    await pill.click();
    await page.waitForTimeout(2600);
    const after = {};
    for (const c of lowChecks) after[c.id] = await getState(c.id);
    const gatedAfter = await snapshotGated();
    const gatedChanged = diffGated(gatedBefore, gatedAfter);
    const lowResults = lowChecks.map((c) => {
      const b = before[c.id], a = after[c.id];
      const read = (e) => c.attr ? e?.attributes?.[c.attr] : e?.state;
      return { id: c.id, attr: c.attr || 'state', before: read(b), after: read(a), changed: String(read(b)) !== String(read(a)) };
    });
    summary.scenes[name] = { lowHazardActuated: lowResults, gatedActorsChanged: gatedChanged, gatedActorCount: GATED.length };
    log(`scene ${name}: low-hazard changes →`, JSON.stringify(lowResults.map((r) => `${r.id}:${r.before}→${r.after}`)));
    log(`scene ${name}: GATED actors changed → ${gatedChanged.length} (must be 0)`);
    return gatedChanged.length === 0;
  };

  const goodnightOk = await runScene('Goodnight', [
    { id: 'light.great_room_lights' },                      // → off
    { id: 'cover.master_shade', attr: 'current_position' }, // → 0
    { id: 'light.master_lights' },                          // → on (bedside, dim)
    { id: 'climate.kitchen_zone', attr: 'temperature' },    // → 68
  ]);
  await page.screenshot({ path: path.join(OUT, '04-after-goodnight.png') });

  const entertainOk = await runScene('Entertain', [
    { id: 'light.pool_lights' },                          // → on
    { id: 'light.landscape_lights' },                     // → on
    { id: 'cover.patio_shade', attr: 'current_position' },// → 60
    { id: 'input_select.sig_media_state' },               // → playing (Sonos)
  ]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '05-after-entertain.png') });

  summary.forcedCheck = {
    gatedActors: GATED,
    goodnightZeroGatedActuation: goodnightOk,
    entertainZeroGatedActuation: entertainOk,
    pass: goodnightOk && entertainOk,
  };

  // ── Legacy panel still loads ──
  await page.goto(`${SPA}#/dashboard/${LEGACY}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2200);
  const legacyHasContent = await page.evaluate(() => !!document.querySelector('.dashboard, [class*="grid"], .tile, [class*="Tile"]'));
  summary.legacyLoads = legacyHasContent;
  await page.screenshot({ path: path.join(OUT, '06-legacy-panel.png') });
  log('legacy panel loads:', legacyHasContent);

  await browser.close();

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('=== SUMMARY ===');
  log('forced-check pass (zero gated actuation):', summary.forcedCheck.pass);
  log('legacy loads:', summary.legacyLoads);
  log('page errors:', summary.pageErrors.length);
  log('wrote', path.join(OUT, 'summary.json'));

  if (!summary.forcedCheck.pass) { console.error('FORCED-CHECK FAILED — a scene actuated a gated actor'); process.exit(1); }
};

main().catch((e) => { console.error(e); process.exit(1); });
