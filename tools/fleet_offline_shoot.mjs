// fleet_offline_shoot.mjs — exercise the AGE-BASED OFFLINE fleet pill (Polish #3).
//
// The admin fleet view's online/stale pills were already verified; the OFFLINE
// state was only exercised via the graceful `online:false` shutdown branch, not
// the *freshness threshold* path (a heartbeat that is very old / absent lastSeen
// → freshness_for() returns 'offline' once age ≥ HEARTBEAT_OFFLINE_AFTER_S=300s).
//
// This shoot posts a kiosk heartbeat, then lets it AGE past the 300s offline
// threshold (the heartbeat POST always stamps lastSeen=now server-side, so the
// only honest way to drive the age path end-to-end is to wait it out), and
// confirms:
//   • the fleet card renders the OFFLINE pill for that panel, and
//   • the section rollup reads "… N offline".
// Also re-confirms an online + stale panel alongside it (mixed rollup).
//
// Screenshots + JSON summary land under daily/2026-06-11/polish/.
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
const OUT = path.join(ROOT, 'daily', '2026-06-11', 'polish');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[fleet-offline]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}

async function withWs(fn) {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
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
        try { const r = await fn(call); ws.close(); resolve(r); }
        catch (e) { ws.close(); reject(e); }
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

const summary = { ts: new Date().toISOString(), checks: {}, pageErrors: [], fleetStatuses: {} };

const getKioskToken = () => withWs(async (call) => (await call({ type: 'b_panels/kiosk/info' }))?.token);

const heartbeat = (kioskTok, body) =>
  fetch(`${HA_URL}/api/b_panels/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-BPanels-Kiosk-Token': kioskTok },
    body: JSON.stringify(body),
  });

// HEARTBEAT_OFFLINE_AFTER_S = 300 (see fleet.py). Add headroom for the wait.
const OFFLINE_WAIT_MS = 308_000;

async function main() {
  const kioskTok = await getKioskToken();
  log('kiosk token provisioned:', kioskTok ? `${kioskTok.slice(0, 6)}…` : 'MISSING');

  // Post the panel that will AGE to offline FIRST, then let the clock run.
  await heartbeat(kioskTok, {
    installationId: 'kiosk-darkroom', name: 'Dark Room iPad', version: '1.3.9',
    ip: '192.168.1.77', online: true, battery: 41, currentPanelName: 'Home', screenState: 'on',
  });
  log(`posted kiosk-darkroom — aging it past the ${OFFLINE_WAIT_MS / 1000}s offline threshold…`);

  // A fresh ONLINE panel so the rollup is mixed (online + offline).
  await heartbeat(kioskTok, {
    installationId: 'kiosk-foyer', name: 'Foyer iPad', version: '1.4.1',
    ip: '192.168.1.10', online: true, battery: 90, currentPanelName: 'Home', screenState: 'on',
  });

  await sleep(OFFLINE_WAIT_MS);

  // Re-beat the foyer so it stays ONLINE (its first beat would now be stale).
  await heartbeat(kioskTok, {
    installationId: 'kiosk-foyer', name: 'Foyer iPad', version: '1.4.1',
    ip: '192.168.1.10', online: true, battery: 90, currentPanelName: 'Home', screenState: 'on',
  });

  // ── fleet/get over the admin WS: confirm darkroom is offline by AGE ──
  const fleetRes = await withWs(async (call) => call({ type: 'b_panels/fleet/get' }));
  const byId = Object.fromEntries((fleetRes.panels || []).map((p) => [p.installationId, p]));
  summary.fleetStatuses = {
    darkroom: byId['kiosk-darkroom']?.status,
    darkroomAgeS: byId['kiosk-darkroom']?.lastSeenAgeS,
    foyer: byId['kiosk-foyer']?.status,
  };
  log('fleet/get statuses:', JSON.stringify(summary.fleetStatuses));

  // ── render the admin Fleet Status tab ──
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

  await page.goto(`${SPA}#/admin`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Fleet Status/i }).click();
  await page.waitForSelector('.fleet-scope', { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'fleet-offline-full.png'), fullPage: true });
  await page.screenshot({ path: path.join(OUT, 'fleet-offline-viewport.png') });

  const checks = await page.evaluate(() => {
    const body = document.querySelector('.fleet-scope')?.textContent || '';
    const pills = Array.from(document.querySelectorAll('.fleet-scope .fl-pill')).map((e) => e.textContent || '');
    const offlinePillCount = pills.filter((p) => /Offline/i.test(p)).length;
    // the Panel Fleet section sub-rollup line
    const sub = document.querySelector('.fleet-scope h3')?.parentElement?.parentElement?.textContent || '';
    return {
      showsDarkroom: /Dark Room iPad/.test(body),
      showsFoyer: /Foyer iPad/.test(body),
      hasOfflinePill: pills.some((p) => /Offline/i.test(p)),
      offlinePillCount,
      hasOnlinePill: pills.some((p) => /Online/i.test(p)),
      rollupSaysOffline: /\b1 offline\b|\b[1-9]\d* offline\b/i.test(body),
      rollupText: (body.match(/\d+ online · \d+ stale · \d+ offline \(\d+ known\)/) || [''])[0],
    };
  });
  summary.checks = checks;
  log('DOM checks:', JSON.stringify(checks, null, 2));

  await browser.close();

  const c = summary.checks;
  const pass =
    summary.fleetStatuses.darkroom === 'offline' &&
    c.showsDarkroom && c.hasOfflinePill && c.rollupSaysOffline;
  summary.pass = pass;
  fs.writeFileSync(path.join(OUT, 'fleet-offline-summary.json'), JSON.stringify(summary, null, 2));
  log(pass ? 'PASS — age-based offline pill + rollup verified' : 'FAIL — see summary');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
