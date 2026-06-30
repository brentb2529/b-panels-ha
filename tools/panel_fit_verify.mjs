// panel_fit_verify.mjs — verifies the "fit-to-window" fix for ALL 8 compilation
// panels at THREE viewports. For each panel/viewport it screenshots and probes
// the live DOM for: hero visible, every column header visible & on-screen, the
// bottom nav/arming bar pinned & visible, and whether any header/control is
// clipped ABOVE the panel top (the original bug). Display-only render — no
// actuation, no config writes.
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
const TAG = process.argv[2] || 'after';
const OUT = path.join(ROOT, 'daily', '2026-06-30', 'panel-fit', TAG);
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[panel-fit]', ...a);

function hassTokens() {
  return JSON.stringify({
    access_token: TOKEN, token_type: 'Bearer', expires_in: 1800,
    hassUrl: HA_URL, clientId: HA_URL + '/',
    expires: Date.now() + 10 * 365 * 24 * 3600 * 1000, refresh_token: '',
  });
}

const PANELS = [
  { id: 'panel-pool', kind: 'pool', scope: 'pp', hero: 'pp-hero', label: 'pp-card-label' },
  { id: 'panel-home', kind: 'home', scope: 'hp' },
  { id: 'panel-climate', kind: 'climate', scope: 'cp' },
  { id: 'panel-kitchen', kind: 'kitchen', scope: 'kp' },
  { id: 'panel-primary-suite', kind: 'primary-suite', scope: 'ps' },
  { id: 'panel-security', kind: 'security', scope: 'secp' },
  { id: 'panel-lighting', kind: 'lighting', scope: 'ltp' },
  { id: 'panel-house-health', kind: 'house-health', scope: 'hh' },
];

const VIEWPORTS = [
  { w: 1366, h: 1024, tag: '1366x1024-ipad' },
  { w: 1440, h: 810, tag: '1440x810-desktop' },
  { w: 1280, h: 800, tag: '1280x800' },
];

// In-page probe: returns geometry of the panel scope, hero, the bottom nav, and
// every card-label/header within the active panel — plus whether any is clipped
// above the visible panel top or below the nav.
function probe(scopePrefix) {
  const scope = document.querySelector(`.${scopePrefix}-scope`);
  const shell = document.querySelector('.bps-shell');
  const nav = document.querySelector('.bps-switcher');
  const arming = document.querySelector('.bps-arming');
  if (!scope) return { error: 'no scope ' + scopePrefix };
  const vh = window.innerHeight;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), visible: b.bottom > 0 && b.top < vh && b.height > 0 }; };
  // candidate header selectors across panels
  const headerSel = [
    '[class$="-card-label"]', '[class*="-card-label"]',
    '[class*="-col-head"]', '[class*="-column-head"]',
  ].join(',');
  const headers = [...scope.querySelectorAll(headerSel)].map((el) => {
    const b = el.getBoundingClientRect();
    return {
      cls: el.className,
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      onscreen: b.top >= -1 && b.bottom <= vh + 1 && b.height > 0,
      clippedAbove: b.top < 0,
    };
  }).filter((h) => h.bottom !== 0 || h.top !== 0);
  return {
    vh, scope: r(scope), hero: scopePrefix === 'pp' ? r(document.querySelector('.pp-hero')) : null,
    nav: r(nav), arming: r(arming),
    navPinnedBottom: nav ? Math.abs(r(nav).bottom - vh) <= 2 : false,
    headerCount: headers.length,
    headersAllOnscreen: headers.every((h) => h.onscreen),
    anyHeaderClippedAbove: headers.some((h) => h.clippedAbove),
    headers,
  };
}

const main = async () => {
  const browser = await chromium.launch();
  const results = [];
  const SPA = `${HA_URL}/b_panels_frontend/index.html`;

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, colorScheme: 'dark' });
    await ctx.addInitScript(([url, tokens]) => {
      localStorage.setItem('hassUrl', url);
      localStorage.setItem('hassTokens', tokens);
      try { localStorage.setItem('bPanelsHAToken', JSON.parse(tokens).access_token); } catch {}
    }, [HA_URL, hassTokens()]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log('PAGEERROR', e.message));

    for (const p of PANELS) {
      await page.goto(`${SPA}#/dashboard/${p.id}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2200);
      const data = await page.evaluate(probe, p.scope);
      const file = `${p.kind}__${vp.tag}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      const ok = !data.error && data.navPinnedBottom && !data.anyHeaderClippedAbove && data.headerCount > 0 && (data.arming ? data.arming.visible : true);
      results.push({ panel: p.kind, vp: vp.tag, ok, headerCount: data.headerCount, headersAllOnscreen: data.headersAllOnscreen, anyHeaderClippedAbove: data.anyHeaderClippedAbove, navPinnedBottom: data.navPinnedBottom, armingVisible: data.arming?.visible ?? null, heroVisible: data.hero?.visible ?? null, file, error: data.error });
      log(`${p.kind} @ ${vp.tag}: ${ok ? 'PASS' : 'CHECK'} hdrs=${data.headerCount} clippedAbove=${data.anyHeaderClippedAbove} navPinned=${data.navPinnedBottom}`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok);
  log(`DONE — ${results.length} captures, ${fails.length} need review`);
  if (fails.length) log('REVIEW:', JSON.stringify(fails, null, 1));
};
main().catch((e) => { console.error(e); process.exit(1); });
