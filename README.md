# B-Panels for Home Assistant

[![hacs][hacs-badge]][hacs] [![Validate](https://github.com/brentb2529/b-panels-ha/actions/workflows/validate.yml/badge.svg)](https://github.com/brentb2529/b-panels-ha/actions/workflows/validate.yml)

A premium, fit-to-window **touch wall-panel dashboard** for Home Assistant —
delivered entirely through HACS. B-Panels renders your Home Assistant entities
as a grid of depth-styled "glass" tiles designed for kiosks and wall tablets
(Raspberry Pi, iPad, Fully Kiosk, etc.).

This is the **Home-Assistant-only** edition of B-Panels. It talks to Home
Assistant directly over the websocket API using your existing login — there is
**no separate backend, no database, and no cloud account**. Install it, open it
from the sidebar, and build your panels.

> **Note:** B-Panels is distributed via HACS as a custom integration. It is not
> part of Home Assistant Core and never modifies your HA installation beyond
> adding a sidebar panel.

## Features

- Full-screen, fit-to-window tile dashboards with nested folders/sub-panels.
- Light / dark / ambient-night themes (inherited per dashboard).
- Typed tiles — lights, dimmers, switches, covers/shades, scenes, sensors,
  thermostats/climate, cameras (RTSP/HA camera), alarm panel (Alarmo).
- A **generic capability tile** that renders any unmapped HA domain by
  inferring what it can do (toggle, brightness, position, setpoint, mode,
  media transport, lock, read-only sensor) — so new integrations just work.
- An **HA custom-card tile** escape hatch to embed any Lovelace/HACS card.
- Dashboard layout is stored in Home Assistant's own storage (`.storage`).

## Installation (HACS)

1. In HACS, open the three-dot menu → **Custom repositories**.
2. Add `https://github.com/brentb2529/b-panels-ha` with category
   **Integration**.
3. Search for **B-Panels** in HACS and install it.
4. Restart Home Assistant.
5. Go to **Settings → Devices & Services → Add Integration → B-Panels**.
6. Open **B-Panels** from the sidebar.

## How it works

```
┌────────────────────────────┐     websocket (your HA session)
│  B-Panels SPA (sidebar)     │ ──────────────────────────────────┐
│  React, served by HA        │   get_states / subscribe_entities  │
└────────────────────────────┘   call_service                     ▼
        ▲  iframe panel                                   ┌─────────────────┐
        │                                                 │  Home Assistant │
┌────────────────────────────┐  b_panels/config/get|save │  core + entities│
│ custom_components/b_panels  │ ◄────────────────────────►│  + .storage     │
│  • serves the built SPA     │                           └─────────────────┘
│  • registers sidebar panel  │
│  • config get/save (Store)  │
└────────────────────────────┘
```

The integration (`custom_components/b_panels`) serves the pre-built SPA, adds
the sidebar panel, and exposes two websocket commands (`b_panels/config/get`
and `b_panels/config/save`) so the dashboard can persist its layout. Everything
else — entity state, control, real-time updates — uses Home Assistant's native
websocket API as the signed-in user.

## Development

The frontend is a Vite + React 19 app under [`frontend/`](frontend/).

```bash
cd frontend
npm install
npm run build      # builds the SPA into custom_components/b_panels/frontend
# or, for live dev against a running HA instance:
VITE_HASS_URL="http://homeassistant.local:8123" npm run dev
```

Releases are built automatically: tagging a GitHub release runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
the SPA and attaches `b_panels.zip` (the integration with bundled frontend)
to the release. HACS installs from that zip (`zip_release` in `hacs.json`).

## Brand assets

HACS validation skips the `brands` check until B-Panels' icons are merged into
[home-assistant/brands](https://github.com/home-assistant/brands). Submit the
brand PR, then remove the `ignore: brands` line from `validate.yml`.

## License

[MIT](LICENSE)

[hacs]: https://github.com/hacs/integration
[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
