# B-Panels (HA edition) — architecture & migration notes

This repo is the **public, Home-Assistant-only fork** of the private B-Panels
platform. It shares the *frontend UI* with the original but replaces the entire
Node `api-server` + microservice stack with a thin Home Assistant custom
integration. The two codebases are developed side by side and share no
runtime — nothing here can affect the private platform.

## What changed vs. the original

| Concern | Original (private) | This repo (HA-only) |
| --- | --- | --- |
| Data source | `api-server.js` (Express) proxying SmartThings relay + HA + ~15 microservices | Home Assistant websocket API directly |
| Auth | Custom JWT, admin users, 10-yr device tokens | Home Assistant's own session (signed-in user) |
| Config storage | SQLite `app_config` row | HA `.storage` via `b_panels/config/{get,save}` websocket commands |
| Realtime | SmartThings relay SSE + optional HA WS | `subscribe_entities` over HA WS |
| Deployment | pm2 on Raspberry Pi + AWS relay | HACS install into HA; SPA served by the integration |
| Distribution | Private deploy scripts | HACS custom repository (integration) |

## Repo layout

```
b-panels-ha/
├─ custom_components/b_panels/   # the HACS-installed integration (Python)
│  ├─ __init__.py                # static serve + sidebar panel + config WS cmds
│  ├─ config_flow.py             # single-instance UI setup
│  ├─ const.py  manifest.json  strings.json  translations/
│  └─ frontend/                  # built SPA (generated; shipped in release zip)
├─ frontend/                     # Vite + React 19 source (the dashboard UI)
├─ hacs.json                     # HACS metadata (zip_release)
├─ .github/workflows/            # validate.yml (HACS+hassfest), release.yml (build+zip)
├─ README.md  info.md  LICENSE
```

## The data layer (`frontend/services/haClient.ts`)

Single gateway to Home Assistant, built on `home-assistant-js-websocket`:

- **Auth**: `getAuth()` reusing HA's same-origin session (the SPA is served by
  HA). `VITE_HASS_URL` overrides the host for standalone dev.
- **Reads**: `getStates()`, `subscribeEntities(cb)`.
- **Writes**: `callService(domain, service, data, target)`.
- **Config**: `getDashboardConfig()` / `saveDashboardConfig()` →
  `b_panels/config/get|save` (falls back to `localStorage` in dev).

`services/api.ts` and `services/homeassistant.ts` were re-pointed at this client;
all api-server endpoints were removed.

## Dropped on the HA-only fork

These were SmartThings- or api-server-specific and have **HA-native
equivalents** (configure the device in HA; B-Panels renders the entity):

- SmartThings (devices, STHM home monitor, keypad, alarm history, ST backup)
- Lutron LEAP, Sonos native API, Hayward pool, Flair, CoolMaster, Akvo pool
  floor, Litter-Robot/Whisker, Tempest, EnergyTrak/Generac, Noonlight panic,
  internet-monitor, fishing report, RSS proxy.
- api-server-only ops: panel fleet management, device-token provisioning,
  remote screenshots, cloud backup, monitoring webhooks, TTS broadcast.

> All those physical devices already integrate with Home Assistant. In B-Panels
> they appear as standard HA entities and are rendered by the typed tiles or the
> **generic capability tile**, so functionality is preserved without bespoke
> backends to maintain.

## HACS compliance checklist

- [x] `custom_components/b_panels/` with a complete `manifest.json`
      (`domain`, `name`, `codeowners`, `documentation`, `issue_tracker`,
      `version`, `iot_class`, `integration_type`, `config_flow`).
- [x] `hacs.json` at repo root (`zip_release` + `filename`).
- [x] `config_flow` so it installs from the UI.
- [x] `validate.yml` runs **hacs/action** (category: integration) + **hassfest**.
- [x] `release.yml` builds the SPA and attaches `b_panels.zip` to each release.
- [x] `README.md`, `info.md`, `LICENSE` (MIT).
- [ ] **Repo settings (do on GitHub):** add a description + topics
      (`home-assistant`, `hacs`, `dashboard`, `lovelace`, `kiosk`).
- [ ] **Brand assets:** submit icon/logo PR to `home-assistant/brands`, then
      drop `ignore: brands` from `validate.yml`.
- [ ] Publish a tagged GitHub **release** (HACS pulls the release zip).
