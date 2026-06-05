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
| **RTSP / MediaMTX relay** | Camera stream proxy | camera | HA **camera** entities (HLS via HA `stream`); UniFi Protect, etc. | ✅ covered — native HLS tile + spotlight control modal |
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
`mode-select` · `number` · `press` · `media-transport` · `sensor-readonly` ·
`lock` · `alarm`

A future plugin only needs to expose its data as **HA entities** with the right
domain/`device_class`/attributes; B-Panels then renders it with zero changes.
The only true gaps are devices with **no HA representation at all** (e.g. the
fishing report) — those need either a custom HA sensor/integration that
publishes the data as entity attributes, or a dedicated B-Panels info tile +
plugin data source.

---

## The zero-rework contract — how a new integration flows in

Every HA entity passes through three layers, each with a graceful fallback, so a
**newly-added integration renders (and usually controls) with no code change**:

1. **Map** — `mapHaEntityToInternalDevice` (`frontend/hooks/useDashboard.tsx`).
   Known domains become a bespoke `DeviceType`; everything else becomes
   `DeviceType.Generic` (never dropped). The entity is never discarded.
2. **Infer** — `inferCapabilityProfile` (`frontend/services/haCapabilities.ts`).
   Derives `capabilities` + a `primary` + `controllable` from the domain,
   `device_class`, and attributes. Never throws, never returns null.
3. **Resolve** — `resolveTile` (`frontend/components/tileRegistry.tsx`).
   `bespoke tile for the type` → else `GenericCapabilityTile` (if it has
   capabilities) → else `UnknownTile`.

### What already works automatically (no rework)

| Entity kind | Example new domains | Generic rendering |
| --- | --- | --- |
| Read-only value | `sensor`, `weather`, `air_quality`, `device_tracker` | Value + unit, formatted (`412 W`, `23.5 °C`) |
| On/off control | `switch`, `fan`, `humidifier`, `input_boolean` | Power button, optimistic toggle |
| Numeric setpoint | `number` | Bounded slider (`min`/`max`/`step` + unit) |
| Option picker | `select`, `input_select` | Current option, **tap-to-cycle** |
| Momentary action | `button`, `input_button` | **Press** button → `<domain>.press` |

Command routing for these lives in `HomeAssistantService.setDeviceState`
(`frontend/services/homeassistant.ts`), **allowlisted by domain** — we never
blindly `turn_on`/`turn_off` a domain that doesn't support it.

### Adding richer support is a small, known edit (not a rework)

When a new integration's device deserves a *bespoke* look, or a controllable
domain we don't yet render generically (`fan` % / `humidifier` target /
`water_heater` / `vacuum` / `lawn_mower` / `lock open` / `update` / `text`):

1. **Bespoke tile** — build `MyTile.tsx`, register one line in
   `tileByType` (`tileRegistry.tsx`), and map the domain → `DeviceType` in
   `mapHaEntityToInternalDevice`. No `switch` in `Tile.tsx`, no other edits.
2. **New generic capability** — add the capability to the `Capability` union
   (`types.ts`), emit it from `inferCapabilityProfile`, render a branch in
   `GenericCapabilityTile`, and add the service mapping in `setDeviceState`.
   (This is exactly how `number` / `select` / `press` were added — ~4 small,
   localized edits, no churn to existing tiles.)

> The dividing line: **read-only + the five common controllable patterns are
> free**; anything fancier is a contained ~4-file addition, never a refactor of
> the ingestion module.

---

## Items needing a small re-wire (not just deletion)

- **Cameras** — ✅ done. The RTSP/MediaMTX relay is gone; camera tiles resolve a
  live HLS stream directly from HA's `stream` component (`getCameraStreamUrl`).
  Clicking a camera opens `CameraControlModal` — a spotlight view + thumbnail
  strip across all cameras + a control rail that auto-renders the camera's
  sibling control entities (recording mode, IR, HDR, mic, detections…) via the
  generic capability path, plus live detection chips and read-only status. For
  UniFi Protect, the controllable `switch`/`select`/`number` entities require
  the integration's UniFi account to have **local admin** rights (otherwise HA
  exposes read-only mirrors only); once present they appear in the rail with no
  code change.
- **TTS broadcast / notifications** — re-point at HA `tts` + `media_player`
  (or `notify`) services instead of the api-server fan-out.
- **Alarm** — already HA-native via **Alarmo** (or any `alarm_control_panel`).
  This is the canonical "on-the-fly" example: install Alarmo and the alarm panel
  + entry-delay + sensors appear automatically.
