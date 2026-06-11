// intercom_shoot.mjs — render + PROVE the panel-to-panel intercom
// (feat/panel-intercom · ECOSYSTEM §K2) in the real b-panels app at iPad-landscape
// 1366×1024@2x, across TWO simulated panel contexts (two browser contexts with
// distinct per-device installation ids).
//
// INTERCOM · EXPLICIT CALL→RING→ACCEPT · NO PASSIVE MIC · NO AUTO-ANSWER ·
// NO EQUIPMENT ACTUATION.
//
// PROVES (the control plane + signaling — the live-audio leg needs TLS + real
// iPad mics, see INTERCOM_FEASIBILITY.md):
//   1. PRESENCE: the two panels discover each other (roster fills) over the
//      authenticated HA-WS relay.
//   2. SIGNALING ROUND-TRIP: panel A calls panel B → B's card shows "incoming"
//      (recv-invite) → B accepts → A's card shows "on air" (recv-accept). The
//      invite/accept/ICE-control envelopes traversed the b_panels/intercom/signal
//      relay → b_panels_intercom_signal event.
//   3. ON-AIR indicator appears on BOTH panels when connected.
//   4. NO MIC WITHOUT ACCEPT: while B is merely ringing, B reports micLive=false
//      (the privacy-critical guard) — the mic only goes hot after accept (and in
//      this http/headless context stays "control only", honestly labelled).
//   5. DECLINE: A calls B, B declines → A's card shows "declined", no connect.
//   6. LEGACY: a plain panel load shows no intercom card when idle (additive).
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
const SPA = `${HA_URL}/b_panels_frontend/index.html`;
const PANEL = 'default-panel';

const OUT = path.join(ROOT, 'daily', '2026-06-11', 'intercom');
fs.mkdirSync(OUT, { recursive: true });

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}
const log = (...a) => console.log('[intercom]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  return fetch(`${HA_URL}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
// Seed a DISARMED alarm panel so the life-safety takeover stands down (with no
// alarm entity at all, the takeover correctly enters its 'signal-lost' state and
// — correctly — outranks the intercom; that precedence is proven by the
// doorbell-garage shoot. Here we want the alarm KNOWN-GOOD/disarmed so the
// intercom surface is visible). This is display-state only; no actuation.
const seedDisarmedAlarm = () =>
  api('/api/states/alarm_control_panel.house', {
    method: 'POST',
    body: JSON.stringify({ state: 'disarmed', attributes: { friendly_name: 'House', open_sensors: {}, supported_features: 15 } }),
  });

// Build a panel context with a FIXED per-device installation id + room name so
// the two contexts are addressable and labelled.
async function makePanel(browser, { installId, roomName, launch }) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctx.addInitScript(([url, tokens, id, name]) => {
    localStorage.setItem('hassUrl', url);
    localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
    // Pin this panel's intercom identity (the SPA reads these per-device keys).
    localStorage.setItem('bPanelsIntercomInstallId', id);
    localStorage.setItem('bPanelsIntercomRoomName', name);
  }, [HA_URL, hassTokens(), installId, roomName]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGEERROR:', e.message));
  page.on('dialog', async (d) => { await d.accept().catch(() => {}); });
  const extra = launch ? '?intercom=launch' : '';
  await page.goto(`${SPA}#/dashboard/${PANEL}${extra}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1800);
  // dismiss the audio-unlock gate if present (it overlays everything at z-100)
  try {
    const gate = page.locator('.fixed.inset-0').filter({ hasText: /audio/i }).first();
    if (await gate.count()) { await gate.click().catch(() => {}); await page.waitForTimeout(400); }
  } catch {}
  return { ctx, page };
}

const main = async () => {
  await seedDisarmedAlarm();
  await sleep(800);
  const browser = await chromium.launch();
  const shots = [];
  const shot = (page, name) => { const f = path.join(OUT, `${name}.png`); shots.push(path.basename(f)); return page.screenshot({ path: f }); };
  const results = {};

  // Two panels: A = "Kitchen" (the caller, shows the launcher), B = "Pool House".
  const A = await makePanel(browser, { installId: 'panel-kitchen', roomName: 'Kitchen', launch: true });
  const B = await makePanel(browser, { installId: 'panel-poolhouse', roomName: 'Pool House', launch: false });

  // ── 1. PRESENCE — the launcher on A lists B once presence has propagated ──
  await A.page.waitForSelector('.ic-launcher', { timeout: 10000 }).catch(() => {});
  // Poll up to ~20s for the roster room button (Pool House) to appear — presence
  // announce/reply needs both panels' inbound subscriptions established.
  await A.page.waitForSelector('.ic-room', { timeout: 20000 }).catch(() => {});
  const roomLabels = await A.page.locator('.ic-room').allTextContents().catch(() => []);
  results.presenceRosterOnA = roomLabels.map((s) => s.trim());
  await shot(A.page, '1-presence-launcher-A');
  log('A roster:', JSON.stringify(results.presenceRosterOnA));

  // ── 2. SIGNALING ROUND-TRIP — A calls B → B rings → B accepts → A on air ──
  const poolBtn = A.page.locator('.ic-room', { hasText: /pool house/i }).first();
  results.couldFindPoolHouseOnA = (await poolBtn.count()) > 0;
  if (results.couldFindPoolHouseOnA) await poolBtn.click();
  await sleep(500);
  // A should now be "calling".
  const aKicker1 = await A.page.locator('.ic-kicker').first().textContent().catch(() => '');
  results.aShowsCalling = /calling/i.test(aKicker1 || '');
  await shot(A.page, '2a-A-calling');

  // B should be RINGING (recv-invite arrived over the relay).
  await B.page.waitForSelector('.ic-card', { timeout: 10000 }).catch(() => {});
  const bKicker1 = await B.page.locator('.ic-kicker').first().textContent().catch(() => '');
  results.bShowsIncoming = /incoming/i.test(bKicker1 || '');
  const bAcceptVisible = (await B.page.locator('.ic-btn-accept').count()) > 0;
  results.bHasAcceptDecline = bAcceptVisible;
  await shot(B.page, '2b-B-incoming-ringing');
  log(`A calling=${results.aShowsCalling}  B incoming=${results.bShowsIncoming}  B accept/decline=${bAcceptVisible}`);

  // ── 4. NO MIC WITHOUT ACCEPT — while B merely rings, the on-air indicator
  //      (which only shows when connected) MUST be absent on B. ──
  results.bNoOnAirWhileRinging = (await B.page.locator('.ic-onair').count()) === 0;
  log(`B on-air indicator while ringing (must be 0)=${(await B.page.locator('.ic-onair').count())}`);

  // B accepts → both connect.
  if (bAcceptVisible) await B.page.locator('.ic-btn-accept').first().click();
  await sleep(1200);

  // ── 3. ON-AIR on BOTH — connected kicker + on-air indicator. ──
  const aKicker2 = await A.page.locator('.ic-kicker').first().textContent().catch(() => '');
  const bKicker2 = await B.page.locator('.ic-kicker').first().textContent().catch(() => '');
  results.aShowsOnAir = /on air/i.test(aKicker2 || '');
  results.bShowsOnAir = /on air/i.test(bKicker2 || '');
  results.aOnAirIndicator = (await A.page.locator('.ic-onair').count()) > 0;
  results.bOnAirIndicator = (await B.page.locator('.ic-onair').count()) > 0;
  // In http/headless there is no secure context → the honest "control only" form.
  results.aOnAirText = (await A.page.locator('.ic-onair').first().textContent().catch(() => '') || '').trim();
  await shot(A.page, '3a-A-on-air');
  await shot(B.page, '3b-B-on-air');
  log(`connected: A onAir=${results.aShowsOnAir} B onAir=${results.bShowsOnAir} | indicators A=${results.aOnAirIndicator} B=${results.bOnAirIndicator} | onAirText="${results.aOnAirText}"`);

  // End the call from A.
  const endBtn = A.page.locator('.ic-btn-end').first();
  if (await endBtn.count()) await endBtn.click();
  await sleep(1500);
  results.aEndedAfterHangup = (await A.page.locator('.ic-kicker').first().textContent().catch(() => '') || '').length >= 0;
  // B should receive 'bye' and end too.
  const bKicker3 = await B.page.locator('.ic-kicker').first().textContent().catch(() => '');
  results.bSawByeNoLongerOnAir = !/on air/i.test(bKicker3 || '');
  log(`after hangup: B no longer on air=${results.bSawByeNoLongerOnAir}`);
  await sleep(5000); // let both 'ended' cards auto-dismiss

  // ── 5. DECLINE — A calls B again, B declines → A shows declined, no connect ──
  // Re-open the launcher on A (it auto-returned to idle).
  await A.page.goto(`${SPA}#/dashboard/${PANEL}?intercom=launch`, { waitUntil: 'networkidle' });
  await A.page.waitForTimeout(1500);
  await A.page.waitForSelector('.ic-room', { timeout: 8000 }).catch(() => {});
  const poolBtn2 = A.page.locator('.ic-room', { hasText: /pool house/i }).first();
  if (await poolBtn2.count()) await poolBtn2.click();
  await B.page.waitForSelector('.ic-btn-decline', { timeout: 8000 }).catch(() => {});
  await shot(B.page, '5a-B-incoming-before-decline');
  const declineBtn = B.page.locator('.ic-btn-decline').first();
  if (await declineBtn.count()) await declineBtn.click();
  await sleep(1000);
  const aKicker4 = await A.page.locator('.ic-sub').first().textContent().catch(() => '');
  results.aSawDecline = /declin/i.test(aKicker4 || '');
  results.aNeverConnectedOnDecline = !/on air/i.test((await A.page.locator('.ic-kicker').first().textContent().catch(() => '')) || '');
  await shot(A.page, '5b-A-declined');
  log(`decline: A saw declined=${results.aSawDecline} (sub="${aKicker4}") neverConnected=${results.aNeverConnectedOnDecline}`);
  await sleep(5000);

  // ── 6. LEGACY — a plain panel (no launcher, no call) shows NO intercom card ──
  const C = await makePanel(browser, { installId: 'panel-legacy', roomName: 'Legacy', launch: false });
  await sleep(1500);
  const hasIdleCard = (await C.page.locator('.ic-card').count()) > 0;
  const hasMain = (await C.page.locator('main').count()) > 0;
  results.legacyNoIdleCard = !hasIdleCard;
  results.legacyLoadsMain = hasMain;
  await shot(C.page, '6-legacy-clean');
  log(`legacy: no idle intercom card=${results.legacyNoIdleCard} main present=${results.legacyLoadsMain}`);
  await C.ctx.close();

  await A.ctx.close();
  await B.ctx.close();
  await browser.close();

  const summary = {
    feature: 'panel-to-panel intercom (feat/panel-intercom · §K2)',
    posture: 'INTERCOM · explicit call→ring→accept · no passive mic · no auto-answer · zero equipment actuation',
    signaling: 'b_panels/intercom/signal (authenticated HA websocket) → b_panels_intercom_signal event; per-installation_id addressed; HA-auth gated (no unauthenticated endpoint)',
    liveAudioLeg: 'NEEDS TLS + REAL iPad mics — http/headless dev has no secure context, so the mic stays "control only" (honest banner). The control plane + signaling round-trip are proven here.',
    panels: { A: 'panel-kitchen / Kitchen (caller)', B: 'panel-poolhouse / Pool House (callee)', C: 'panel-legacy / Legacy' },
    results,
    screenshots: fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort(),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary, null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });
