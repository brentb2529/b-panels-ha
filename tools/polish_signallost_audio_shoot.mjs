// polish_signallost_audio_shoot.mjs — Polish #1 (Signal-Lost branches) + #2 (audio overlay).
//
// SAFETY-ADJACENT (#1): proves the life-safety Signal-Lost takeover now
// distinguishes:
//   (a) NO alarm entity in this deployment at all (bare panel) → NO false
//       "don't trust this panel" takeover (quiet / no-alarm), vs
//   (b) an alarm that WAS present and then went stale/disconnected → STILL fires
//       Signal-Lost (the real safety case — must be preserved).
//
// #2: the audio-unlock affordance no longer covers content (it's a small,
// dismissible bottom-left pill, and audio auto-arms on first gesture).
//
// Renders iPad-landscape 1366×1024@2x. Screenshots land under daily/2026-06-11/polish/.
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
const OUT = path.join(ROOT, 'daily', '2026-06-11', 'polish');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('[polish-sl-audio]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALARM = 'alarm_control_panel.house';

async function api(p, opts = {}) {
  return fetch(`${HA_URL}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const setState = (id, state, attributes = {}) =>
  api(`/api/states/${id}`, { method: 'POST', body: JSON.stringify({ state, attributes }) });
const delState = (id) => api(`/api/states/${id}`, { method: 'DELETE' }).catch(() => {});

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}

// Does the SIGNAL-LOST banner ("SIGNAL LOST · alarm status UNKNOWN") show?
const signalLostShown = (page) => page.evaluate(() =>
  /SIGNAL LOST/i.test(document.querySelector('.lst-signal-banner')?.textContent || ''));
// Is the (small) audio pill present, and does it cover the screen center?
const audioProbe = (page) => page.evaluate(() => {
  const pill = Array.from(document.querySelectorAll('div')).find((d) =>
    /enable audio alerts/i.test(d.textContent || '') && getComputedStyle(d).position === 'fixed');
  const out = { present: !!pill, blocksCenter: false, rect: null };
  if (pill) {
    const r = pill.getBoundingClientRect();
    out.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    // does it intersect the viewport center? (old full-screen modal would)
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    out.blocksCenter = r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy;
    // full-screen overlay heuristic: covers > 60% of the viewport
    out.coversMost = (r.width * r.height) > (window.innerWidth * window.innerHeight * 0.6);
  }
  return out;
});

const summary = { ts: new Date().toISOString(), pageErrors: [], checks: {} };

async function main() {
  // Ensure a clean slate: no alarm entity present.
  await delState(ALARM);
  await sleep(500);

  const browser = await chromium.launch();

  // ── CASE (a): NO alarm entity → NO false Signal-Lost takeover ──────────────
  // Fresh context (clean sessionStorage → alarm never "seen").
  const ctxA = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctxA.addInitScript(([url, tokens]) => {
    localStorage.setItem('hassUrl', url); localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
  }, [HA_URL, hassTokens()]);
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', (e) => summary.pageErrors.push('A PAGEERROR: ' + e.message));
  await pageA.goto(`${SPA}#/`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageA.waitForTimeout(3000);

  summary.checks.noAlarm_signalLostShown = await signalLostShown(pageA);   // expect FALSE
  summary.checks.noAlarm_audio = await audioProbe(pageA);                  // small pill, no block
  await pageA.screenshot({ path: path.join(OUT, 'signallost-A-no-alarm.png') });
  log('CASE A (no alarm): signalLostShown =', summary.checks.noAlarm_signalLostShown,
      '| audio =', JSON.stringify(summary.checks.noAlarm_audio));

  // ── CASE (b): alarm present → then DROPPED → Signal-Lost STILL fires ───────
  const ctxB = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctxB.addInitScript(([url, tokens]) => {
    localStorage.setItem('hassUrl', url); localStorage.setItem('hassTokens', tokens);
    try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
  }, [HA_URL, hassTokens()]);
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => summary.pageErrors.push('B PAGEERROR: ' + e.message));

  // 1) Bring the alarm ONLINE first so the panel LATCHES "an alarm exists here".
  await setState(ALARM, 'disarmed', { friendly_name: 'House Alarm' });
  await pageB.goto(`${SPA}#/`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageB.waitForTimeout(2500);
  summary.checks.present_signalLostShown = await signalLostShown(pageB);   // expect FALSE (known-good)
  await pageB.screenshot({ path: path.join(OUT, 'signallost-B1-alarm-present.png') });
  log('CASE B1 (alarm present, known-good): signalLostShown =', summary.checks.present_signalLostShown);

  // 2) Now the alarm goes UNAVAILABLE (feed dropped). Signal-Lost MUST fire —
  //    this is the real safety case (a known alarm we can no longer trust).
  await setState(ALARM, 'unavailable', { friendly_name: 'House Alarm' });
  await pageB.waitForTimeout(3000);
  summary.checks.dropped_signalLostShown = await signalLostShown(pageB);   // expect TRUE
  await pageB.screenshot({ path: path.join(OUT, 'signallost-B2-alarm-dropped.png') });
  log('CASE B2 (alarm DROPPED → unavailable): signalLostShown =', summary.checks.dropped_signalLostShown);

  // ── #2: audio overlay non-blocking on a fresh kiosk load (also captured on A) ──
  // The first real gesture ANYWHERE auto-arms audio (and the pill disappears once
  // unlocked). Click center-screen to prove (1) the click reaches content — the
  // old full-screen modal would have swallowed it — and (2) audio then unlocks
  // and the hint goes away. We click the page body, not the pill, on purpose.
  summary.checks.audioPillTappable = await pageA.getByRole('button', { name: /Enable audio alerts/i }).count() > 0;
  await pageA.mouse.click(683, 512); // viewport center — must NOT be intercepted by a modal
  await pageA.waitForTimeout(800);
  summary.checks.audioGoneAfterGesture = !(await audioProbe(pageA)).present;
  log('audio pill present initially =', summary.checks.audioPillTappable,
      '| gone after a center-screen gesture (auto-unlock) =', summary.checks.audioGoneAfterGesture);

  // ── legacy panel still loads ──
  const legacyPage = await ctxA.newPage();
  await legacyPage.goto(`${SPA}#/dashboard/default-panel`, { waitUntil: 'networkidle', timeout: 30000 });
  await legacyPage.waitForTimeout(2000);
  summary.checks.legacyLoads = await legacyPage.evaluate(() =>
    !!document.querySelector('.dashboard, [class*="grid"], .tile, [class*="Tile"]'));
  await legacyPage.screenshot({ path: path.join(OUT, 'legacy-panel.png') });
  log('legacy loads:', summary.checks.legacyLoads);

  await browser.close();

  // cleanup demo alarm
  await delState(ALARM);

  const c = summary.checks;
  const pass =
    c.noAlarm_signalLostShown === false &&         // (a) no false takeover
    c.noAlarm_audio.present === true &&             // small pill present
    c.noAlarm_audio.coversMost !== true &&          // does NOT cover the screen
    c.present_signalLostShown === false &&          // known-good = quiet
    c.dropped_signalLostShown === true &&           // (b) REAL safety case fires
    c.audioGoneAfterGesture === true &&             // first gesture auto-unlocks
    c.legacyLoads === true;
  summary.pass = pass;
  fs.writeFileSync(path.join(OUT, 'signallost-audio-summary.json'), JSON.stringify(summary, null, 2));
  log(pass ? 'PASS — absent quiet, dropped fires, audio non-blocking, legacy loads' : 'FAIL — see summary');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
