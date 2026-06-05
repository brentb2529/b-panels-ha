---
name: screenshot-panel
description: Render the B-Panels SPA against the live Home Assistant and screenshot it headlessly — to verify a UI/tile/theme change actually looks right (light & dark) without a physical kiosk. Use when asked to verify, screenshot, or visually check the dashboard/a tile/an alarm state, or before releasing a visual change.
---

# Screenshot the live B-Panels UI

Verify dashboard/tile/theme changes by rendering the real SPA against the live HA
in a headless browser and capturing a screenshot — both light and dark. This is
the project's "did it actually render right?" check; prefer it over guessing.

## Why it works
The SPA reuses HA's session from `localStorage['hassTokens']`. We inject a
long-lived token as that AuthData with a far-future `expires` (so the lib never
attempts a refresh), which lets a headless browser load the panel with live data.

## Secrets — never commit them
`capture.mjs` reads the HA URL + token from the environment ONLY. Do not paste a
token into any tracked file (this repo is public). Keep the long-lived token in a
gitignored file (e.g. `/tmp/ha_tok`) and pass it via env.

## Steps
1. **Build the SPA pointed at HA** (so the WebSocket connects to the real instance):
   ```bash
   cd frontend && VITE_HASS_URL="$BPANELS_HA_URL" npm run build
   ```
2. **Serve the built dir** so `/b_panels_frontend/` resolves (vite `base`):
   ```bash
   rm -rf /tmp/serve && mkdir -p /tmp/serve
   ln -s "$PWD/custom_components/b_panels/frontend" /tmp/serve/b_panels_frontend
   (python3 -m http.server 8899 --directory /tmp/serve >/tmp/serve.log 2>&1 &)
   ```
3. **Capture** (run once per theme; add `--panel "Name"` to navigate first):
   ```bash
   BPANELS_HA_URL="http://<ha-host>:8123" \
   BPANELS_HA_TOKEN_FILE=/tmp/ha_tok \
   BPANELS_SERVE_URL="http://localhost:8899/b_panels_frontend/index.html" \
   node .claude/skills/screenshot-panel/capture.mjs --out /tmp/dark.png  --theme dark
   # ...and --theme light, plus e.g. --panel "Water Sensors"
   ```
4. **Look at the PNG** (Read the image file) and confirm the change. Then stop the
   server: `pkill -f "http.server 8899"; rm -rf /tmp/serve`.

## Flags
`--out <path>` · `--theme light|dark|ambient` · `--panel "<exact name>"` ·
`--w <px>` · `--h <px>` · `--wait <ms>` (raise if tiles are slow to load).

## Notes / gotchas
- Requires Playwright + chromium; the script resolves Playwright from
  `node_modules` or the `npx` cache. If missing: `npx -y playwright install chromium`.
- Rebuild **without** `VITE_HASS_URL` before committing/releasing — the release
  build must use `window.location.origin` (the panel iframe), not a baked URL.
  (The built dir is gitignored and CI rebuilds it, so this only matters locally.)
- A blocking "Tap to enable audio" overlay is auto-dismissed by a center click.
- To drive an alarm state for screenshots without arming the real panel, add a
  temporary dev hook that calls `setAlarmState({ phase, haDelayTotal, haDelayStartedAt, ... })`
  and remove it before release (see git history for the `__bpSimAlarm` scaffold).
