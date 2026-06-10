// inc16_f1_pool_gating_proof.mjs — F-1 fix proof (b-panels Increment 16).
//
// VERIFICATION / forced-tap repro. Issues ZERO gated actuation by the panel.
// The pool body (switch.pool_body, OBJTYPE=BODY) is EQUIPMENT-GATED: running it
// drives the pool pump. Pre-fix, the Home overview rendered a LIVE quick-toggle
// that issued switch.turn_on/off on it (F-1). This proof re-renders the Home
// panel (iPad-landscape, dark) and FORCE-TAPS the pool-body control + the
// surrounding card; it asserts switch.pool_body state is UNCHANGED (the F-1
// repro must now FAIL to actuate), and that no actuating "Toggle pool body"
// button exists anymore. Screenshot + log under daily/2026-06-09/admin-slice0/inc16/.
// Dev HA entity state is restored afterward.
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
const POOL_BODY = 'switch.pool_body';
const OUT = path.join(ROOT, 'daily', '2026-06-09', 'admin-slice0', 'inc16');
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
const log = (...a) => console.log('[inc16]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPA = `${HA_URL}/b_panels_frontend/index.html`;
const results = { test: 'F-1 Home pool-body gating', issuedActuation: false };

const main = async () => {
  // Seed the pool body to a KNOWN state ('on') so a leaked turn_off would flip it.
  await setState(POOL_BODY, 'on', { friendly_name: 'Pool Body' });
  await sleep(600);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctx.addInitScript(([url, tokens]) => {
    localStorage.setItem('hassUrl', url);
    localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
  }, [HA_URL, hassTokens()]);

  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', async (d) => { await d.dismiss().catch(() => {}); });

  await page.goto(`${SPA}#/dashboard/panel-home`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2400);
  // dismiss any audio gate
  try {
    const gate = page.locator('.fixed.inset-0').filter({ hasText: /audio/i }).first();
    if (await gate.count()) { await gate.click({ position: { x: 700, y: 60 } }).catch(() => {}); await page.waitForTimeout(300); }
  } catch {}

  const rendered = (await page.locator('.hp-card').count()) > 0;
  log('Home rendered:', rendered, 'pool cards:', await page.locator('.hp-pool').count());

  // The pre-fix actuating control no longer exists.
  const liveTogglePresent = (await page.locator('button[aria-label="Toggle pool body"]').count()) > 0;
  results.liveToggleButtonPresent = liveTogglePresent;
  // The gated affordance IS present.
  const gatedPresent = (await page.locator('.hp-pool .hp-toggle-inline.gated').count()) > 0;
  results.gatedAffordancePresent = gatedPresent;

  const before = await stateOf(POOL_BODY);
  log('switch.pool_body BEFORE forced-tap:', before);

  // Screenshot the gated Home pool card BEFORE any tap (a tap on the card may
  // navigate to the Pool panel, which is harmless but would change the view).
  await page.screenshot({ path: path.join(OUT, 'home-pool-body-gated.png') });
  try {
    const card = page.locator('.hp-pool').first();
    if (await card.count()) await card.screenshot({ path: path.join(OUT, 'home-pool-card-gated.png') });
  } catch {}

  // Forced-tap each pool-body target. The body control bubbles to the card's
  // navigate-to-Pool onClick, so we RE-LOAD Home before each target to ensure
  // every tap actually lands on the gated control (not on the Pool panel).
  const reloadHome = async () => {
    await page.goto(`${SPA}#/dashboard/panel-home`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    try {
      const gate = page.locator('.fixed.inset-0').filter({ hasText: /audio/i }).first();
      if (await gate.count()) { await gate.click({ position: { x: 700, y: 60 } }).catch(() => {}); await page.waitForTimeout(200); }
    } catch {}
  };
  const targets = [
    '.hp-pool .hp-toggle-inline.gated',
    '.hp-pool .hp-toggle-static',
    '.hp-pool .hp-toggle-lbl',
    '.hp-pool .hp-toggle-lock',
    'button[aria-label="Toggle pool body"]', // legacy actuating control (must be gone)
  ];
  let taps = 0;
  for (const sel of targets) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.click({ force: true, noWaitAfter: true }).catch(() => {});
      taps++;
      await page.waitForTimeout(700);
    }
    await reloadHome(); // fresh Home for the next target
  }
  results.forcedTaps = taps;
  await page.waitForTimeout(1200);

  const after = await stateOf(POOL_BODY);
  log('switch.pool_body AFTER forced-tap:', after);
  results.before = before;
  results.after = after;
  results.unchanged = before === after;
  results.consoleErrors = errors.filter(e => !/audio|favicon|manifest|download the React DevTools/i.test(e));

  await browser.close();
  // Restore dev HA entity state.
  await setState(POOL_BODY, before ?? 'off', { friendly_name: 'Pool Body' });

  results.PASS = results.unchanged && !results.liveToggleButtonPresent && results.gatedAffordancePresent;
  results.screenshots = fs.readdirSync(OUT).filter(f => f.endsWith('.png')).sort();
  fs.writeFileSync(path.join(OUT, 'inc16-f1-proof.json'), JSON.stringify(results, null, 2));
  log('RESULT', JSON.stringify(results, null, 2));
  if (!results.PASS) process.exitCode = 2;
};
main().catch((e) => { console.error(e); process.exit(1); });
