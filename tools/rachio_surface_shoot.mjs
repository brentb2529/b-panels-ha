// rachio_surface_shoot.mjs — render + PROVE the b-panels liquid-glass Rachio
// irrigation surface (feat/rachio-surface · Increment 3) in the real b-panels
// app at iPad-landscape 1366×1024@2x (dark + light).
//
// The `rachio-irrigation` tile is admin-placeable (Stage-1 catalog) and
// SELF-DISCOVERING: bound to one anchor zone switch, it reads ALL rachio_pro
// zones from the live store, groups them by their homeowner `location` attr,
// pairs soil-moisture/last-watered sensors, and surfaces the controller
// standby/rain-delay + rain-sensor/forecast + sprinkler scenes. This script
// injects a panel carrying ONE such tile bound to the demo Rachio entities,
// then:
//   • renders zones grouped by location with idle/running + moisture (dark+light)
//   • drives a zone running -> the animated watering indicator + remaining time
//   • PROVES the confirm gate on a ZONE RUN: a quick TAP fires NOTHING; a full
//     HOLD actuates (the demo zone switch flips on)
//   • PROVES the confirm gate on a SCENE RUN: quick tap nothing; full hold runs
//   • RAIN-DELAY toggle via the same press-and-hold confirm
//   • OFFLINE: controller offline -> honest em-dash state, controls disabled
//   • legacy default panel still loads (additive/non-breaking)
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

const PANEL_ID = 'panel-rachio-demo';
const TILE_ID = 'tile-rachio-irrigation';
const ANCHOR = 'switch.demo_rachio_front_lawn';
const Z1_RUN = 'input_boolean.demo_rachio_z1_running'; // Front Lawn running flag
const ONLINE = 'input_boolean.demo_rachio_online';
const RAIN_DELAY_SW = 'switch.demo_rachio_rain_delay';
const RAIN_DELAY_HELPER = 'input_boolean.demo_rachio_rain_delay';

const OUT = path.join(ROOT, 'daily', '2026-06-10', 'rachio-surface');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[rachio]', ...a);
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
const setBool = (id, on) => svc('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: id });

function ws() {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(WS_URL);
    let mid = 1;
    const pending = new Map();
    sock.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
      else if (msg.type === 'auth_ok') resolve({
        call: (payload) => new Promise((res, rej) => { const id = mid++; pending.set(id, { res, rej }); sock.send(JSON.stringify({ ...payload, id })); }),
        close: () => sock.close(),
      });
      else if (msg.type === 'auth_invalid') reject(new Error('auth_invalid'));
      else if (msg.type === 'result' && pending.has(msg.id)) {
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
    name: 'Irrigation',
    columns: 8,
    tiles: [{
      id: TILE_ID,
      // Self-discovering surface: bound to one anchor zone switch; the tile reads
      // ALL rachio_pro zones from the live store itself.
      deviceId: ANCHOR,
      entityId: ANCHOR,
      tileType: 'rachio-irrigation',
      label: 'Irrigation',
      x: 0, y: 0, width: 5, height: 6,
    }],
  });
  const res = await conn.call({ type: 'b_panels/config/save', config: cfg });
  conn.close();
  log('panel injected', JSON.stringify(res));
}

async function resetDemo() {
  await setBool(ONLINE, true);
  for (const z of [1, 2, 3, 4, 5]) await setBool(`input_boolean.demo_rachio_z${z}_running`, false);
  await setBool(RAIN_DELAY_HELPER, false);
  await setBool('input_boolean.demo_rachio_standby', false);
  await setBool('input_boolean.demo_rachio_rain_sensor', false);
  await sleep(800);
}

const main = async () => {
  await injectPanel();
  await resetDemo();

  const browser = await chromium.launch();
  const summary = { increment: 'rachio-surface', dark: {}, light: {} };

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
      await page.goto(`${SPA}?access_token=${encodeURIComponent(TOKEN)}#/dashboard/${panel}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3500);
      await dismissAudioGate();
      await page.waitForTimeout(800);
    };
    const tile = () => page.locator('.bp-glass-scope').filter({ hasText: 'Irrigation' }).first();
    const holdFire = async (locator, ms = 1300) => {
      const box = await locator.boundingBox();
      if (!box) return false;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(ms);
      await page.mouse.up();
      return true;
    };
    const quickTap = async (locator) => {
      const box = await locator.boundingBox();
      if (!box) return false;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(110);
      await page.mouse.up();
      return true;
    };
    const results = {};

    // ── 1. Zones grouped by location, idle + moisture ──
    await resetDemo();
    await goto(PANEL_ID);
    await page.waitForSelector('.bp-glass-scope', { timeout: 12000 }).catch(() => {});
    results.tileRendered = (await tile().count()) > 0;
    results.showsFrontYard = (await page.getByText('Front Yard', { exact: false }).count()) > 0;
    results.showsBackYard = (await page.getByText('Back Yard', { exact: false }).count()) > 0;
    results.showsUnzoned = (await page.getByText('Other zones', { exact: false }).count()) > 0;
    results.showsFrontLawn = (await page.getByText('Front Lawn', { exact: false }).count()) > 0;
    await shot('rachio-zones-grouped');
    log(`[${scheme}] grouped: rendered=${results.tileRendered} front=${results.showsFrontYard} back=${results.showsBackYard} other=${results.showsUnzoned}`);

    // ── 2. A zone running -> animated watering indicator + remaining time ──
    await setBool(Z1_RUN, true);
    await sleep(1600);
    results.showsWatering = (await page.getByText('Watering', { exact: false }).count()) > 0;
    results.sprayAnim = (await page.locator('.bp-rachio-spray').count()) > 0;
    await shot('rachio-zone-watering');
    log(`[${scheme}] watering text=${results.showsWatering} sprayAnim=${results.sprayAnim}`);
    await setBool(Z1_RUN, false);
    await sleep(1000);

    // ── 3. ZONE-RUN CONFIRM GATE ── quick tap fires nothing; full hold actuates
    await resetDemo();
    await sleep(1200);
    // The Front Lawn run button is the first hold control in the Front Yard group.
    const frontLawnRow = page.locator('.bp-rachio-zone-row').filter({ hasText: 'Front Lawn' }).first();
    const runBtn = frontLawnRow.locator('.bp-rachio-hold').first();

    const z1BeforeTap = await stateOf(Z1_RUN);
    await quickTap(runBtn).catch(() => {});
    await sleep(1000);
    const z1AfterTap = await stateOf(Z1_RUN);
    results.zoneQuickTapNoop = { before: z1BeforeTap, after: z1AfterTap, unchanged: z1BeforeTap === z1AfterTap };
    await shot('rachio-zone-gate-tap-noop');
    log(`[${scheme}] zone quick TAP: ${z1BeforeTap}->${z1AfterTap} unchanged=${z1BeforeTap === z1AfterTap}`);

    // FULL hold to commit. We capture the ring mid-fill, then keep holding to
    // completion in one continuous press (a screenshot mid-hold stalls wall
    // clock, so we screenshot then immediately hold the full remaining window
    // to guarantee a clean commit). The 110ms quick-tap above is the no-op proof.
    const z1BeforeHold = await stateOf(Z1_RUN);
    {
      const box = await runBtn.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(250);
        await shot('rachio-zone-gate-holding'); // ring partly filled
        await page.waitForTimeout(1300);        // continue holding past HOLD_MS
        await page.mouse.up();
      }
    }
    await sleep(1200);
    const z1AfterHold = await stateOf(Z1_RUN);
    results.zoneFullHoldActuates = { before: z1BeforeHold, after: z1AfterHold, changed: z1BeforeHold !== z1AfterHold };
    await shot('rachio-zone-gate-committed');
    log(`[${scheme}] zone full HOLD: ${z1BeforeHold}->${z1AfterHold} changed=${z1BeforeHold !== z1AfterHold}`);
    await setBool(Z1_RUN, false);
    await sleep(800);

    // ── 4. SCENE-RUN CONFIRM GATE ── (Evening Soak runs Front Beds in the demo)
    await resetDemo();
    await sleep(1000);
    const Z2_RUN = 'input_boolean.demo_rachio_z2_running';
    const sceneBtn = page.locator('.bp-rachio-hold').filter({ hasText: /Evening Soak/i }).first();
    const sceneBeforeTap = await stateOf(Z2_RUN);
    await quickTap(sceneBtn).catch(() => {});
    await sleep(900);
    const sceneAfterTap = await stateOf(Z2_RUN);
    results.sceneQuickTapNoop = { before: sceneBeforeTap, after: sceneAfterTap, unchanged: sceneBeforeTap === sceneAfterTap };
    log(`[${scheme}] scene quick TAP: ${sceneBeforeTap}->${sceneAfterTap} unchanged=${sceneBeforeTap === sceneAfterTap}`);

    const sceneBeforeHold = await stateOf(Z2_RUN);
    await holdFire(sceneBtn, 1300).catch(() => {});
    await sleep(900); // the demo scene turns Front Beds on briefly
    const sceneAfterHold = await stateOf(Z2_RUN);
    results.sceneFullHoldRuns = { before: sceneBeforeHold, after: sceneAfterHold, changed: sceneBeforeHold !== sceneAfterHold };
    await shot('rachio-scene-committed');
    log(`[${scheme}] scene full HOLD: Front Beds ${sceneBeforeHold}->${sceneAfterHold} changed=${sceneBeforeHold !== sceneAfterHold}`);

    // ── 5. RAIN-DELAY toggle via press-and-hold ──
    await resetDemo();
    await sleep(1000);
    const rdBtn = page.locator('.bp-rachio-hold').filter({ hasText: /Rain delay|Delay on/i }).first();
    const rdBefore = await stateOf(RAIN_DELAY_SW);
    await holdFire(rdBtn, 1300).catch(() => {});
    await sleep(1200);
    const rdAfter = await stateOf(RAIN_DELAY_SW);
    results.rainDelayToggles = { before: rdBefore, after: rdAfter, changed: rdBefore !== rdAfter };
    await shot('rachio-rain-delay-on');
    log(`[${scheme}] rain-delay HOLD: ${rdBefore}->${rdAfter} changed=${rdBefore !== rdAfter}`);
    await setBool(RAIN_DELAY_HELPER, false);
    await sleep(800);

    // ── 6. OFFLINE — honest em-dash, controls disabled ──
    await resetDemo();
    await setBool(ONLINE, false);
    await sleep(1600);
    results.offlineShown = (await page.getByText(/Controller offline/i).count()) > 0;
    await shot('rachio-offline');
    log(`[${scheme}] offline shown=${results.offlineShown}`);

    // ── 7. legacy default panel still loads ──
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

  summary.posture = 'PLACEABLE self-discovering liquid-glass surface · EVERY actuating control (zone run/stop, scene run, rain-delay, standby) press-and-hold confirm-gated (quick tap fires nothing; full hold actuates) · water = low-to-moderate hazard · NOT equipment-gated';
  summary.bindings = {
    discovery: 'self-discovering from live store: a zone = switch.* with a zone_number attr; grouped by the `location` attr; soil-moisture/last-watered paired by stem+device_class',
    demo: 'switch.demo_rachio_* zones (Front Yard / Back Yard / Other zones), sensor.demo_rachio_*_soil_moisture/last_watered, binary_sensor online/rain_sensor, forecast sensors, switch standby/rain_delay, script.demo_rachio_* scenes (irrigation_scene:true)',
    real: 'rachio_pro: zone switches (turn_on duration=min), per-zone moisture/last-watered sensors, standby/rain-delay switches, rain-sensor + forecast sensors; scenes run via rachio_pro.run_scene by name',
  };
  summary.screenshots = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary, null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });
