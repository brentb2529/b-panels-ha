// Headless screenshot of the B-Panels SPA rendered against a live Home Assistant.
//
// The SPA authenticates by reusing HA's session from localStorage['hassTokens'].
// We inject a long-lived token as that AuthData (far-future `expires` so the lib
// never tries to refresh), dismiss the one-time audio-unlock overlay, optionally
// switch panels + theme, and screenshot. No secrets live in this file — the HA
// URL and token come from the environment.
//
// Prereqs: the built SPA is being served locally (see SKILL.md), and Playwright
// + chromium are available. Resolves Playwright from node_modules or the npx cache.
//
// Usage:
//   BPANELS_HA_URL=http://homeassistant.local:8123 \
//   BPANELS_HA_TOKEN="<long-lived token>" \
//   BPANELS_SERVE_URL=http://localhost:8899/b_panels_frontend/index.html \
//   node capture.mjs --out shot.png [--panel "Water Sensors"] [--theme light|dark] [--w 1280] [--h 800] [--wait 9000]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const HA_URL = process.env.BPANELS_HA_URL;
let TOKEN = process.env.BPANELS_HA_TOKEN;
if (!TOKEN && process.env.BPANELS_HA_TOKEN_FILE) {
  try { TOKEN = fs.readFileSync(process.env.BPANELS_HA_TOKEN_FILE, 'utf8').trim(); } catch {}
}
const SERVE_URL = process.env.BPANELS_SERVE_URL || (HA_URL ? `${HA_URL}/b_panels_frontend/index.html` : null);
const OUT = arg('out', 'panel.png');
const PANEL = arg('panel', null);
const THEME = arg('theme', null);          // 'light' | 'dark' | 'ambient'
const W = parseInt(arg('w', '1280'), 10);
const H = parseInt(arg('h', '800'), 10);
const WAIT = parseInt(arg('wait', '9000'), 10);

if (!HA_URL || !TOKEN || !SERVE_URL) {
  console.error('Missing config. Need BPANELS_HA_URL and BPANELS_HA_TOKEN (or BPANELS_HA_TOKEN_FILE), and a served SPA (BPANELS_SERVE_URL).');
  process.exit(1);
}

// Resolve Playwright from node_modules, then the npx cache (~/.npm/_npx/*/node_modules).
function loadChromium() {
  for (const mod of ['playwright', 'playwright-core']) {
    try { return require(mod).chromium; } catch {}
  }
  const npx = path.join(os.homedir(), '.npm', '_npx');
  try {
    for (const d of fs.readdirSync(npx)) {
      const pkg = path.join(npx, d, 'node_modules', 'playwright');
      if (fs.existsSync(pkg)) { try { return require(pkg).chromium; } catch {} }
    }
  } catch {}
  return null;
}

const chromium = loadChromium();
if (!chromium) {
  console.error('Playwright not found. Try: npx -y playwright install chromium');
  process.exit(1);
}

const tokens = JSON.stringify({
  hassUrl: HA_URL,
  clientId: HA_URL + '/',
  expires: Date.now() + 10 * 365 * 24 * 3600 * 1000,
  refresh_token: '',
  access_token: TOKEN,
  expires_in: 315360000,
  token_type: 'Bearer',
});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await ctx.addInitScript((t) => {
  try { localStorage.setItem('hassTokens', t); localStorage.setItem('bPanelsHassTokens', t); } catch {}
}, tokens);
const page = await ctx.newPage();
await page.goto(SERVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(WAIT);                 // WS auth + tiles render
await page.mouse.click(Math.floor(W / 2), Math.floor(H / 2)); // dismiss audio-unlock overlay
await page.waitForTimeout(1500);

if (THEME) {
  await page.evaluate((t) => {
    document.body.classList.remove('light-mode', 'ambient-night');
    if (t === 'light') document.body.classList.add('light-mode');
    if (t === 'ambient') document.body.classList.add('ambient-night');
  }, THEME);
  await page.waitForTimeout(400);
}

if (PANEL) {
  // Panels are reached via the "Dashboards" dropdown or a folder tile of that name.
  try {
    await page.getByText('Dashboards', { exact: false }).first().click({ timeout: 4000 });
    await page.waitForTimeout(700);
    await page.getByText(PANEL, { exact: true }).first().click({ timeout: 4000 });
  } catch {
    try { await page.getByText(PANEL, { exact: true }).first().click({ timeout: 4000 }); } catch {}
  }
  await page.waitForTimeout(2500);
}

await page.screenshot({ path: OUT });
const body = await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\n/g, ' ')).catch(() => '');
console.log(`saved ${OUT}`);
console.log(`body: ${body}`);
await browser.close();
