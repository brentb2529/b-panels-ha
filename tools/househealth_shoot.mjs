// househealth_shoot.mjs — House Health "system trust" surface live proof.
//
// Renders the LIVE House Health panel (iPad-landscape 1366×1024@2x) in the real
// b-panels app, dark + light, and proves the honesty design end-to-end:
//   • REAL sources (Alarmo) show live status (life-safety feed fresh, reachable).
//   • ABSENT sources (generator rehlko / UPS NUT / UniFi WAN) show the honest
//     "not configured / awaiting connection" state — NOT a fabricated green.
//   • An INDUCED offline entity appears in the connectivity offline list.
//   • A device_class:problem fault sensor surfaces as a fault (critical).
//   • The legacy grid panel still loads.
// Screenshots + a JSON summary land under daily/2026-06-10/house-health/.
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
const PANEL = 'panel-house-health';
const LEGACY = 'default-panel';
const OUT = path.join(ROOT, 'daily', '2026-06-10', 'house-health');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[househealth]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  return fetch(`${HA_URL}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const setState = (id, state, attributes = {}) =>
  api(`/api/states/${id}`, { method: 'POST', body: JSON.stringify({ state, attributes }) });

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}

// Inject the House Health compilation panel via the integration's own save path.
// `themeMode` drives App.tsx's body.light-mode toggle (the panel CSS keys off it).
async function injectPanel(themeMode = 'dark') {
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
          cfg.panels.unshift({ id: PANEL, name: 'House Health', tiles: [], compilationKind: 'house-health', themeMode, showArmingStatus: true });
          await call({ type: 'b_panels/config/save', config: cfg });
          log(`injected house-health panel (theme=${themeMode}); panels:`, cfg.panels.map((p) => p.id).join(','));
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

// Seed REAL/demo state: Alarmo disarmed (real source), an INDUCED offline light,
// and a device_class:problem fault sensor. Generator/UPS/UniFi are intentionally
// LEFT ABSENT so the panel must render their honest not-configured state.
async function seed() {
  await setState('alarm_control_panel.house', 'disarmed', { friendly_name: 'House', supported_features: 15 });
  // induced offline entity → must show up in the connectivity offline list
  await setState('light.garage_offline_demo', 'unavailable', { friendly_name: 'Garage Lights (demo)' });
  // induced fault sensor → must surface as a fault (critical)
  await setState('binary_sensor.pad_pump_problem_demo', 'on', { friendly_name: 'Pad Pump Problem (demo)', device_class: 'problem' });
}

// Clean up the induced demo entities after the shoot (leave dev tidy).
async function cleanup() {
  for (const id of ['light.garage_offline_demo', 'binary_sensor.pad_pump_problem_demo']) {
    await api(`/api/states/${id}`, { method: 'DELETE' }).catch(() => {});
  }
}

const summary = { ts: new Date().toISOString(), checks: {}, legacyLoads: null, pageErrors: [] };

async function renderAndAssert(ctx, scheme) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') summary.pageErrors.push(`[${scheme}] ` + m.text()); });
  page.on('pageerror', (e) => summary.pageErrors.push(`[${scheme}] PAGEERROR: ` + e.message));

  await page.goto(`${SPA}#/dashboard/${PANEL}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(700, 60).catch(() => {});
  await page.waitForSelector('.hh-scope', { timeout: 15000 });
  await page.waitForSelector('.hh-grid .hh-card', { timeout: 10000 });
  await page.waitForTimeout(1800);   // let live snapshot + freshness settle
  await page.screenshot({ path: path.join(OUT, `househealth-${scheme}.png`) });
  log(`shot househealth-${scheme}`);

  if (scheme === 'dark') {
    // Assertions on the rendered DOM (one pass is enough — same data both themes).
    const checks = await page.evaluate(() => {
      const txt = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent || '');
      const bodyTxt = document.querySelector('.hh-scope')?.textContent || '';
      const absentTitles = txt('.hh-absent-title');
      const offlineNames = txt('.hh-list-name');
      return {
        // honest absent-source states present (generator/ups/wan show "Not configured")
        absentCount: absentTitles.length,
        // induced offline entity surfaced in the offline list
        offlineShowsGarage: offlineNames.some((n) => /Garage Lights \(demo\)/.test(n)),
        // induced fault surfaced
        faultShowsPump: offlineNames.some((n) => /Pad Pump Problem \(demo\)/.test(n)),
        // real source: alarmo reachable + life-safety feed line present, fresh
        alarmoReachable: /Alarmo · Disarmed/.test(bodyTxt),
        feedFresh: /Live · fresh/.test(bodyTxt),
        // never fake-green: the "Not configured" word is present for absent sources
        hasNotConfigured: /Not configured/.test(bodyTxt),
        // hero summary present
        hasHero: !!document.querySelector('.hh-hero-title'),
      };
    });
    summary.checks = checks;
    log('checks:', JSON.stringify(checks));
  }
  await page.close();
}

const ctxInit = ([url, tokens]) => {
  localStorage.setItem('hassUrl', url);
  localStorage.setItem('hassTokens', tokens);
  try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
};

const main = async () => {
  await seed();
  const browser = await chromium.launch();

  // ── DARK ── panel themeMode 'dark' drives the app's default look
  await injectPanel('dark');
  await sleep(1200);
  const darkCtx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await darkCtx.addInitScript(ctxInit, [HA_URL, hassTokens()]);
  await renderAndAssert(darkCtx, 'dark');

  // ── LIGHT ── re-inject with themeMode 'light' so App.tsx toggles body.light-mode
  await injectPanel('light');
  await sleep(1200);
  const lightCtx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await lightCtx.addInitScript(ctxInit, [HA_URL, hassTokens()]);
  await renderAndAssert(lightCtx, 'light');

  // ── Legacy panel still loads ──
  const legacyPage = await darkCtx.newPage();
  await legacyPage.goto(`${SPA}#/dashboard/${LEGACY}`, { waitUntil: 'networkidle', timeout: 30000 });
  await legacyPage.waitForTimeout(2000);
  const legacyHasContent = await legacyPage.evaluate(() => !!document.querySelector('.dashboard, [class*="grid"], .tile, [class*="Tile"]'));
  summary.legacyLoads = legacyHasContent;
  await legacyPage.screenshot({ path: path.join(OUT, 'legacy-panel.png') });
  log('legacy panel loads:', legacyHasContent);

  await browser.close();
  await cleanup();

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('=== SUMMARY ===');
  log(JSON.stringify(summary.checks, null, 2));
  log('legacy loads:', summary.legacyLoads, '· page errors:', summary.pageErrors.length);

  const c = summary.checks;
  const pass = c.alarmoReachable && c.feedFresh && c.hasNotConfigured && c.absentCount >= 3
    && c.offlineShowsGarage && c.faultShowsPump && c.hasHero && summary.legacyLoads;
  summary.pass = pass;
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (!pass) { console.error('HOUSE-HEALTH PROOF FAILED', summary.checks); process.exit(1); }
  log('PROOF PASS');
};

main().catch((e) => { console.error(e); process.exit(1); });
