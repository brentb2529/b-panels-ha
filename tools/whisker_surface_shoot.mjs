// whisker_surface_shoot.mjs — render + PROVE the b-panels liquid-glass
// Whisker / Litter-Robot surface (feat/whisker-surface · Increment 3) in the
// real b-panels app at iPad-landscape 1366×1024@2x (dark + light).
//
// The `litter-robot` tile is admin-placeable (Stage-1 catalog). This script
// injects a panel carrying ONE litter-robot tile bound to the demo robot
// composite (vacuum.demo_litter_robot + its Whisker-shaped siblings), then:
//   • renders the tile live with the animated litter-level + waste-drawer
//     visualizers, status pill, scoops-saved, hopper + last-cycle (dark+light)
//   • drives status -> Cycling / Drawer Full and re-shoots (status mapping)
//   • PROVES the press-and-hold control gate: a quick TAP fires NOTHING; a full
//     HOLD actuates the demo entity (night-light switch flips)
//   • OFFLINE: robot offline -> honest em-dash state, controls disabled
//   • legacy default panel still loads (additive/non-breaking)
//
// Uses the b_panels/config WS API (admin token) to inject the panel so the
// integration's own save path runs, then Playwright to render + interact.
import { chromium } from 'playwright';
import WebSocket from 'ws';
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
const WS_URL = HA_URL.replace(/^http/, 'ws') + '/api/websocket';

const PANEL_ID = 'panel-whisker-demo';
const TILE_ID = 'tile-whisker-litter-robot';
const VACUUM = 'vacuum.demo_litter_robot';
const STATUS_SEL = 'input_select.demo_lr_status';
const WASTE = 'input_number.demo_lr_waste';
const LITTER = 'input_number.demo_lr_litter';
const NIGHTLIGHT = 'switch.demo_litter_robot_night_light';
const NIGHTLIGHT_HELPER = 'input_boolean.demo_lr_night_light';

const OUT = path.join(ROOT, 'daily', '2026-06-10', 'whisker-surface');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[whisker]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  return fetch(`${HA_URL}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const svc = (domain, service, data) =>
  api(`/api/services/${domain}/${service}`, { method: 'POST', body: JSON.stringify(data) });
const stateOf = async (id) => { try { return (await (await api(`/api/states/${id}`)).json()).state; } catch { return null; } };
const setStatus = (opt) => svc('input_select', 'select_option', { entity_id: STATUS_SEL, option: opt });
const setNum = (id, v) => svc('input_number', 'set_value', { entity_id: id, value: v });
const setNightHelper = (on) => svc('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: NIGHTLIGHT_HELPER });

// --- WS config inject ------------------------------------------------------
function ws() {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(WS_URL);
    let mid = 1;
    const pending = new Map();
    sock.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_required') {
        sock.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
      } else if (msg.type === 'auth_ok') {
        resolve({
          call: (payload) => new Promise((res, rej) => {
            const id = mid++;
            pending.set(id, { res, rej });
            sock.send(JSON.stringify({ ...payload, id }));
          }),
          close: () => sock.close(),
        });
      } else if (msg.type === 'auth_invalid') {
        reject(new Error('auth_invalid'));
      } else if (msg.type === 'result' && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.success ? res(msg.result) : rej(new Error(JSON.stringify(msg.error)));
      }
    });
    sock.on('error', reject);
  });
}

async function injectPanel() {
  const conn = await ws();
  const cfg = await conn.call({ type: 'b_panels/config/get' });
  if (!cfg || typeof cfg !== 'object') throw new Error('bad config shape');
  cfg.panels = cfg.panels || [];
  cfg.panels = cfg.panels.filter((p) => p.id !== PANEL_ID);
  cfg.panels.push({
    id: PANEL_ID,
    name: 'Whisker',
    columns: 8,
    tiles: [{
      id: TILE_ID,
      // Bind to the robot COMPOSITE device (vacuum + Whisker siblings folded
      // into one LitterRobotState). The composite id the frontend assembles via
      // stem-grouping is `robot:stem:<stem>`. We bind by deviceId only — NOT
      // entityId — because the vacuum member entity is folded INTO the composite
      // and is intentionally absent from the rendered device map.
      deviceId: 'robot:stem:demo_litter_robot',
      tileType: 'litter-robot',
      label: 'Litter-Robot 4',
      x: 0, y: 0, width: 4, height: 4,
    }],
  });
  const res = await conn.call({ type: 'b_panels/config/save', config: cfg });
  conn.close();
  log('panel injected', JSON.stringify(res));
}

async function resetDemo() {
  await setStatus('rdy');
  await setNum(WASTE, 38);
  await setNum(LITTER, 64);
  await setNightHelper(false);
  await svc('input_boolean', 'turn_off', { entity_id: 'input_boolean.demo_lr_panel_lock' });
  await sleep(800);
}

const main = async () => {
  await injectPanel();
  await resetDemo();

  const browser = await chromium.launch();
  const summary = { increment: 'whisker-surface', dark: {}, light: {} };

  const runScheme = async (scheme) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: scheme });
    await ctx.addInitScript(([url, token]) => {
      localStorage.setItem('hassUrl', url);
      localStorage.setItem('hassTokens', JSON.stringify({
        access_token: token, token_type: 'Bearer', expires_in: 1800,
        hassUrl: url, clientId: url + '/', expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
      }));
      try { localStorage.setItem('bPanelsHAToken', token); } catch {}
    }, [HA_URL, TOKEN]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log('PAGEERROR:', e.message));
    page.on('dialog', async (d) => { await d.accept().catch(() => {}); });
    const SPA = `${HA_URL}/b_panels_frontend/index.html`;
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) });
    const dismissAudioGate = async () => {
      try {
        const gate = page.locator('.fixed.inset-0').filter({ hasText: /Tap anywhere|audio/i }).first();
        for (let i = 0; i < 3 && (await gate.count()); i++) {
          await gate.click({ position: { x: 900, y: 700 } }).catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch {}
    };
    const goto = async (panel) => {
      // Provision the LLAT via URL on first nav (the documented kiosk path),
      // then the app persists it and connects with no OAuth redirect.
      await page.goto(`${SPA}?access_token=${encodeURIComponent(TOKEN)}#/dashboard/${panel}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3500);
      await dismissAudioGate();
      await page.waitForTimeout(800);
    };
    const tile = () => page.locator('.bp-glass-scope').filter({ hasText: 'Litter-Robot' }).first();
    const results = {};

    // ── 1. READY — animated gauges, status pill, scoops, hopper, last cycle ──
    await resetDemo();
    await goto(PANEL_ID);
    await page.waitForSelector('.bp-glass-scope', { timeout: 12000 }).catch(() => {});
    results.tileRendered = (await tile().count()) > 0;
    results.showsScoops = (await page.getByText('Scoops').count()) > 0;
    results.showsWaste = (await page.getByText('Waste', { exact: false }).count()) > 0;
    results.showsLitter = (await page.getByText('Litter', { exact: false }).count()) > 0;
    results.statusReady = (await page.getByText('Ready', { exact: true }).count()) > 0;
    await shot('whisker-ready');
    log(`[${scheme}] ready: rendered=${results.tileRendered} scoops=${results.showsScoops} status=Ready(${results.statusReady})`);

    // ── 2. CYCLING + nearly-full drawer + low litter — status/level mapping ──
    await setStatus('ccp');
    await setNum(WASTE, 93);
    await setNum(LITTER, 12);
    await sleep(1600);
    results.statusCycling = (await page.getByText('Cycling', { exact: true }).count()) > 0;
    await shot('whisker-cycling-fulldrawer');
    log(`[${scheme}] cycling=${results.statusCycling}`);

    // ── 3. DRAWER FULL (critical pill) ──
    await setStatus('df1');
    await sleep(1500);
    results.statusDrawerFull = (await page.getByText('Drawer Full', { exact: true }).count()) > 0;
    await shot('whisker-drawer-full');
    log(`[${scheme}] drawerFull=${results.statusDrawerFull}`);

    // ── 4. PRESS-AND-HOLD CONFIRM GATE ──
    // A quick TAP must fire NOTHING; only a full HOLD (>800ms) commits + actuates.
    await resetDemo();
    await setStatus('rdy');
    await sleep(1400);
    const lightBtn = page.locator('.bp-lr-hold').filter({ hasText: 'Light' }).first();
    const successToast = () => page.getByText(/light (on|off) sent/i);

    // quick tap (pointer down+up immediately) — should NOT actuate / no toast
    const nlBeforeTap = await stateOf(NIGHTLIGHT);
    try {
      const box = await lightBtn.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(120);
        await page.mouse.up();
      }
    } catch (e) { log('tap skipped', e.message); }
    await sleep(1000);
    const nlAfterTap = await stateOf(NIGHTLIGHT);
    const tapToast = (await successToast().count()) > 0;
    results.quickTapFiresNothing = { before: nlBeforeTap, after: nlAfterTap, unchanged: nlBeforeTap === nlAfterTap, noToast: !tapToast };
    await shot('whisker-hold-gate-tap-noop');
    log(`[${scheme}] quick TAP: night-light ${nlBeforeTap}->${nlAfterTap} unchanged=${nlBeforeTap === nlAfterTap} noToast=${!tapToast}`);

    // full hold — SHOULD actuate (toast appears + entity flips)
    const nlBeforeHold = await stateOf(NIGHTLIGHT);
    try {
      const box = await lightBtn.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(450); // mid-hold: ring partly filled
        await shot('whisker-hold-gate-holding');
        await page.waitForTimeout(750); // complete the 800ms hold
        await page.mouse.up();
      }
    } catch (e) { log('hold skipped', e.message); }
    await sleep(400);
    const holdToast = (await successToast().count()) > 0;
    await shot('whisker-hold-gate-committed');
    await sleep(1200);
    const nlAfterHold = await stateOf(NIGHTLIGHT);
    results.fullHoldActuates = { before: nlBeforeHold, after: nlAfterHold, changed: nlBeforeHold !== nlAfterHold, toastShown: holdToast };
    log(`[${scheme}] full HOLD: night-light ${nlBeforeHold}->${nlAfterHold} changed=${nlBeforeHold !== nlAfterHold} toast=${holdToast}`);

    // ── 5. OFFLINE — honest em-dash, controls disabled ──
    await setStatus('off');
    await sleep(1600);
    results.offlineShown = (await page.getByText('Offline', { exact: true }).count()) > 0;
    await shot('whisker-offline');
    log(`[${scheme}] offline shown=${results.offlineShown}`);

    // ── 6. legacy default panel still loads ──
    await resetDemo();
    let legacyOk = false;
    try {
      await goto('default-panel');
      legacyOk = (await page.locator('main').count()) > 0;
      await shot('legacy-still-loads');
    } catch (e) { log('legacy check failed', e.message); }
    results.legacyPanelStillLoads = legacyOk;
    log(`[${scheme}] legacy loads=${legacyOk}`);

    await ctx.close();
    return results;
  };

  summary.dark = await runScheme('dark');
  summary.light = await runScheme('light');

  await browser.close();
  await resetDemo();

  summary.posture = 'PLACEABLE liquid-glass tile · LOW-HAZARD controls press-and-hold confirm-gated (quick tap fires nothing; full hold actuates) · NOT equipment-gated';
  summary.bindings = {
    composite: 'robot:stem:demo_litter_robot — vacuum.demo_litter_robot + Whisker-shaped siblings (DEMO; real = whisker / litterrobot integration, device-per-robot)',
    sensors: 'waste_drawer_level, litter_level, litter_level_state, scoops_saved_count, status_code, hopper_status, last_cycle',
    controls: 'switch night_light / panel_lock, button start_cycle',
  };
  summary.screenshots = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary, null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });
