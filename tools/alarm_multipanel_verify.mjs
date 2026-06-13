// alarm_multipanel_verify.mjs — LIVE proof of the P0 alarm multi-panel
// resolution fix (feat/alarm-multipanel-fix; production-failure lessons A2).
//
// Provisions TWO alarm_control_panel demo entities in the dev HA:
//   • alarm_control_panel.alarmo                 → armed_away  (the REAL panel)
//   • alarm_control_panel.udm_pro_alarm_manager  → disarmed    (the imposter,
//        UniFi Protect; same family as SmartThings STHM)
// Places an alarm tile bound to alarmo on a transient dashboard panel, renders
// the real b-panels SPA, and asserts the AlarmTile resolves to alarmo (ARMED),
// is NOT hijacked to the imposter's "Disarmed", then flips alarmo → unavailable
// and asserts "Unknown" (never the green Disarmed look). Restores the original
// b_panels config afterward. Demo entities + transient config only — no real
// hardware, no arm/disarm actuation (display-only render).
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
const OUT = path.join(ROOT, 'daily', '2026-06-13', 'alarm-multipanel');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[alarm-mp]', ...a);

const ALARMO = 'alarm_control_panel.alarmo';
const IMPOSTER = 'alarm_control_panel.udm_pro_alarm_manager';
const PANEL_ID = 'amp-verify-panel';

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

// ── b_panels config WS (get/save) via a short-lived HA websocket ─────────────
import { WebSocket } from 'ws';
function wsConfig(action, payload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`);
    let id = 1;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
      } else if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ id, type: action, ...payload }));
      } else if (msg.id === id && msg.type === 'result') {
        ws.close();
        msg.success ? resolve(msg.result) : reject(new Error(JSON.stringify(msg.error)));
      } else if (msg.type === 'auth_invalid') {
        ws.close(); reject(new Error('auth_invalid'));
      }
    });
    ws.on('error', reject);
  });
}

// The placeable alarm tile is the design-system GlassArmingStatusTile: its
// readout is `p.bp-readout` ("Armed — Away" | "Disarmed" | "Status Unknown" | …).
const armWordOf = async (page) =>
  (await page.locator('p.bp-readout').first().textContent().catch(() => null))?.trim() ?? null;

const main = async () => {
  const results = { steps: [] };

  // 0) Provision the two alarm panels (the incident setup).
  await setState(ALARMO, 'armed_away', { friendly_name: 'Alarmo', supported_features: 15, code_arm_required: false });
  await setState(IMPOSTER, 'disarmed', { friendly_name: 'UDM Pro Alarm Manager', supported_features: 3 });
  await new Promise((r) => setTimeout(r, 800));
  log('provisioned: alarmo=armed_away, udm_pro=disarmed');

  // 1) Back up the current b_panels config, then write a transient panel with an
  //    alarm tile bound to alarmo (exercises resolver precedence step 2).
  const original = await wsConfig('b_panels/config/get', {});
  fs.writeFileSync(path.join(OUT, 'config-backup.json'), JSON.stringify(original, null, 2));
  const cfg = JSON.parse(JSON.stringify(original?.config ?? original ?? {}));
  cfg.panels = cfg.panels || [];
  cfg.panels = cfg.panels.filter((p) => p.id !== PANEL_ID);
  cfg.panels.push({
    id: PANEL_ID, name: 'Alarm MP Verify', columns: 4, rowHeight: 160, themeMode: 'dark', showTileBorders: true,
    tiles: [{ id: 'amp-alarm-tile', deviceId: ALARMO, entityId: ALARMO, tileType: 'alarm', label: 'Security', x: 0, y: 0, width: 2, height: 2 }],
    highlights: [],
  });
  const saveRev = await wsConfig('b_panels/config/save', { config: cfg, client_rev: (original?.config?._rev ?? original?._rev) });
  log('transient panel saved (rev result):', JSON.stringify(saveRev));
  await new Promise((r) => setTimeout(r, 600));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctx.addInitScript(([url, tokens]) => {
    localStorage.setItem('hassUrl', url);
    localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
  }, [HA_URL, hassTokens()]);
  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if (/\[HA TRUTH\]|error|fail|exception/i.test(t)) log('PAGE:', t); });
  page.on('pageerror', (e) => log('PAGEERROR:', e.message));
  const SPA = `${HA_URL}/b_panels_frontend/index.html`;

  try {
    // 2) Render with BOTH panels present → tile must resolve to alarmo (ARMED),
    //    NOT the imposter's Disarmed.
    await page.goto(`${SPA}#/dashboard/${PANEL_ID}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    const word1 = await armWordOf(page);
    await page.screenshot({ path: path.join(OUT, '01-two-panels-resolves-alarmo-armed.png') });
    const step1ok = word1 === 'Armed — Away';
    results.steps.push({ step: 'two_panels_resolve_alarmo', shown: word1, expected: 'Armed — Away', pass: step1ok });
    log(`STEP1 tile shows "${word1}" (expect "Armed — Away") →`, step1ok ? 'PASS' : 'FAIL');

    // 3) Imposter blips disarmed AGAIN (the exact hijack event). Must NOT change.
    await setState(IMPOSTER, 'disarmed', { friendly_name: 'UDM Pro Alarm Manager', supported_features: 3, _blip: Date.now() });
    await page.waitForTimeout(2500);
    const word2 = await armWordOf(page);
    const step2ok = word2 === 'Armed — Away';
    results.steps.push({ step: 'imposter_blip_ignored', shown: word2, expected: 'Armed — Away', pass: step2ok });
    log(`STEP2 after imposter disarmed blip, tile shows "${word2}" →`, step2ok ? 'PASS (not hijacked)' : 'FAIL (HIJACKED)');

    // 4) Flip the RESOLVED entity (alarmo) → unavailable → must show "Unknown",
    //    never the green Disarmed look (safety: never imply safe).
    await setState(ALARMO, 'unavailable', { friendly_name: 'Alarmo' });
    await page.waitForTimeout(3000);
    const word3 = await armWordOf(page);
    await page.screenshot({ path: path.join(OUT, '02-resolved-unavailable-shows-unknown.png') });
    const step3ok = word3 === 'Status Unknown';
    results.steps.push({ step: 'resolved_unavailable_unknown', shown: word3, expected: 'Status Unknown', pass: step3ok });
    log(`STEP3 alarmo→unavailable, tile shows "${word3}" (expect "Status Unknown") →`, step3ok ? 'PASS' : 'FAIL');

    // 5) Restore alarmo to armed → tile recovers to Armed Away (truth-reconcile / push).
    await setState(ALARMO, 'armed_away', { friendly_name: 'Alarmo', supported_features: 15 });
    await page.waitForTimeout(3000);
    const word4 = await armWordOf(page);
    const step4ok = word4 === 'Armed — Away';
    results.steps.push({ step: 'recovers_to_armed', shown: word4, expected: 'Armed — Away', pass: step4ok });
    log(`STEP4 alarmo back armed, tile shows "${word4}" →`, step4ok ? 'PASS' : 'FAIL');
  } finally {
    await browser.close();
    // Restore the ORIGINAL config (drop the transient verify panel).
    try {
      const restore = JSON.parse(JSON.stringify(original?.config ?? original ?? {}));
      const cur = await wsConfig('b_panels/config/get', {});
      await wsConfig('b_panels/config/save', { config: restore, client_rev: (cur?.config?._rev ?? cur?._rev) });
      log('restored original b_panels config');
    } catch (e) { log('config restore WARNING:', e.message); }
  }

  results.writePathTargetsResolvedId =
    'verified by unit test alarmMultipanel.test.ts (apiHomeAssistantArm sends options.entityId, not hardcoded alarmo)';
  results.allPass = results.steps.every((s) => s.pass);
  results.screenshots = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
  log('SUMMARY', JSON.stringify(results, null, 2));
  if (!results.allPass) process.exit(2);
};
main().catch((e) => { console.error(e); process.exit(1); });
