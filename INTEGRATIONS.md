# B-Panels (HA edition) — integrations roadmap & removed-service registry

B-Panels HA-only is **entity-driven**: it subscribes to every Home Assistant
entity, infers each entity's capabilities, and renders it with a typed tile or
the generic capability tile. **Any device exposed by a HA core integration or a
HACS integration shows up automatically** — no per-service code in B-Panels.

This document records the bespoke backends that the original (private) B-Panels
platform ran through its `api-server` + microservices, which have been **removed**
from this fork because they cannot work without that backend. For each, it lists:

- **What it provided** — the data/control surface.
- **Tile / capability shape** — how B-Panels rendered it.
- **HA-native / HACS path** — how to get equivalent data today, so the device
  shows up via the entity-driven model.
- **Plugin note** — what a future B-Panels plugin (or HACS wiring) would supply
  if no HA integration exists.

> Rule of thumb: if a HA (core or HACS) integration exposes the device as
> entities, **nothing is needed in B-Panels** — it renders automatically. Only
> features with *no* HA entity representation need a future plugin.

---

## Removed services

| Service | What it provided | Tile / capability shape | HA-native / HACS path | Status |
| --- | --- | --- | --- | --- |
| **SmartThings** | Device list + state, STHM home monitor, alarm history | switch/dimmer/shade/sensor/thermostat/alarm | Each device's own HA integration → entities. STHM → **Alarmo** (HACS) or any `alarm_control_panel`. | ✅ covered by HA entities |
| **Lutron LEAP** | Caséta/RA3 lights & shades | dimmer / shade | HA **Lutron Caséta** integration → `light` / `cover` | ✅ covered |
| **Sonos** (node-sonos-http-api) | Player transport, sources, grouping | media-transport | HA **Sonos** integration → `media_player` | ✅ covered |
| **Noonlight** | Panic / professional dispatch | panic button | HA **Noonlight** integration (see sibling repo `hass-noonlight`) → `switch`/`binary_sensor` | ✅ covered |
| **RTSP / MediaMTX relay** | Camera stream proxy | camera | HA **camera** entities (HLS/WebRTC via HA `stream`) | ⚠️ needs camera-tile rework (see below) |
| **EnergyTrak / Generac** | Generator/energy telemetry | sensor-readonly | HA **Generac** integration → `sensor` | ✅ covered |
| **Whisker / Litter-Robot** | Robot status & cycle control | sensor + toggle | HA **Litter-Robot** integration → `vacuum`/`sensor`/`switch` | ✅ covered |
| **Tempest (WeatherFlow)** | Local weather station | sensor-readonly / weather | HA **WeatherFlow Tempest** integration → `weather`/`sensor` | ✅ covered |
| **Hayward pool (OmniLogic)** | Pool equipment control | toggle / setpoint | HA **OmniLogic** integration → `switch`/`climate`/`sensor` | ✅ covered |
| **Flair** | Smart vents / pucks | climate / setpoint | HA **Flair** integration → `climate`/`cover`/`sensor` | ✅ covered |
| **CoolMaster** | Mini-split HVAC | climate | HA **CoolMasterNet** integration → `climate` | ✅ covered |
| **PoolFloor (Akvo)** | In-floor cleaning controller | mode-select | Modbus / custom HA integration → `select`/`switch` | ⚠️ plugin if no integration |
| **Internet Monitor** | Up/down + latency health | sensor-readonly | HA **SpeedTest.net** / **Internet Monitor** integrations → `sensor`/`binary_sensor` | ✅ covered |
| **Fishing Report** | Tide/solunar/fishing forecast | custom info tile | No HA equivalent | 🔌 plugin needed |
| **Monitoring webhooks** | Outbound health pings | — (no tile) | HA **automations** + `notify` | n/a (server feature) |
| **TTS broadcast** | Fan-out TTS to all panels | — (action) | HA `tts` + `media_player` services | ⚠️ re-wire to HA `tts` |
| **Cloud / SmartThings backup** | Config backup to S3/GDrive | admin-only | HA built-in **Backups** | ✅ removed (v0.1.1) |

Legend: ✅ already works via HA entities · ⚠️ needs a small B-Panels re-wire ·
🔌 needs a future plugin (no HA data source).

---

## Capability vocabulary (the contract a plugin/entity must satisfy)

A device renders in B-Panels when it maps to one of these capabilities
(inferred from HA domain + `device_class` + attributes in
`frontend/services/haCapabilities.ts`):

`toggle` · `brightness` · `color` · `colorTemp` · `position` · `setpoint` ·
`mode-select` · `media-transport` · `sensor-readonly` · `lock` · `alarm`

A future plugin only needs to expose its data as **HA entities** with the right
domain/`device_class`/attributes; B-Panels then renders it with zero changes.
The only true gaps are devices with **no HA representation at all** (e.g. the
fishing report) — those need either a custom HA sensor/integration that
publishes the data as entity attributes, or a dedicated B-Panels info tile +
plugin data source.

---

## Items needing a small re-wire (not just deletion)

- **Cameras** — drop the RTSP/MediaMTX relay; use HA `camera` entities and HA's
  `stream` component (HLS) or WebRTC. Camera tiles should resolve the stream via
  HA, not a relay `cloudEndpoint`.
- **TTS broadcast / notifications** — re-point at HA `tts` + `media_player`
  (or `notify`) services instead of the api-server fan-out.
- **Alarm** — already HA-native via **Alarmo** (or any `alarm_control_panel`).
  This is the canonical "on-the-fly" example: install Alarmo and the alarm panel
  + entry-delay + sensors appear automatically.
