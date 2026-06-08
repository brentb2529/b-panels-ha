# Tile data-parity matrix — original B-Panels → Home Assistant

Goal: each ported tile surfaces the **same data** the original showed, sourced
from Home Assistant integration entities. Status legend: ✅ built & mapped ·
🟡 built, needs runtime verification against real entities · ⛔ not built yet.

> Verification method: composite cards group an HA **device's** entities (via
> the entity registry) and render them, so data parity = "every entity of the
> device is surfaced." For each ecosystem below, confirm against
> `Developer Tools → States` that the listed HA entities exist and feed the tile.

---

## Core control / sensor tiles (SmartThings, Lutron, Konnected, generic HA)

| Tile | Original data | HA source | Status |
| --- | --- | --- | --- |
| SwitchTile | on/off (+lock/valve/siren) | `switch`/`light`/`lock`/`valve`/`fan`/`input_boolean` state | ✅ |
| DimmerTile | level 0–100, color, colorTemp | `light` brightness/`rgb_color`/`color_temp_kelvin`; `input_number`/`number` | 🟡 (color/CT control) |
| ShadeTile | position 0–100 | `cover` `current_position` | ✅ |
| ThermostatTile | mode, currentTemp, setpoint | `climate` `hvac_mode`/`current_temperature`/`temperature` | ✅ |
| SceneTile | activate | `scene`/`script`/`automation`/`button` | ✅ |
| SensorTile | temp/motion/contact/occupancy/water/smoke/CO | `sensor`(temperature) / `binary_sensor`(device_class) | ✅ |
| AlarmTile | armState, open sensors, modes, entry delay | Alarmo `alarm_control_panel` + `alarmo/sensors` | ✅ |
| CameraTile / Group | stream | `camera` via HA `camera/stream` (HLS) | ✅ |
| KeypadTile | code/mode string | `sensor`/`select` (lock keypad / Konnected) | ⛔ |
| PanicTile | hold-to-trigger | `switch`/`button` (Noonlight/Konnected siren) | ⛔ |
| AlarmHistoryTile | arming history | local UI history (no HA source) | n/a |

## Litter-Robot / Whisker (`litterrobot`) — composite card

| Original field | HA entity | In tile? |
| --- | --- | --- |
| normalizedStatus / statusText | `vacuum.<r>` state + `sensor.<r>_status_code` | ✅ status |
| wasteLevel % | `sensor.<r>_waste_drawer` (%) | 🟡 stat |
| litterLevel % (LR4) | `sensor.<r>_litter_level` (%) | 🟡 stat |
| petWeight | `sensor.<r>_pet_weight` | 🟡 stat |
| cycleCount | `sensor.<r>_total_cycles` | 🟡 stat |
| sleepModeEnabled | `binary_sensor.<r>_sleeping` / `_sleep_mode` | 🟡 stat |
| nightLight / panelLock | `switch.<r>_night_light_mode` / `_panel_lockout` | 🟡 stat |
| lastSeen | `sensor.<r>_last_seen` | 🟡 stat |

Composite groups all of the above into one card. **Verify:** the robot device's
entities appear as stats.

## Briggs & Stratton generator — composite card ⛔

No official integration. Original fields (status, battery V, grid V, engine hours,
frequency, alarms) map to a generator integration's `sensor`/`binary_sensor`
entities **if present**. Closest analog: `ha-generac` (Generac) entity shape
(`sensor.*_status`, `*_battery_voltage`, `*_run_time`, `binary_sensor.*_connected`).
B&S typically needs genmon→MQTT or a REST/scrape. Tile = composite of whatever
generator entities exist.

## Flair (HACS `flair`) — composite card ⛔

| Original field | HA entity |
| --- | --- |
| room currentTemp / setPoint / hvacState | per-room `climate.<room>` |
| vent percentOpen | `cover.<vent>` `current_position` |
| puck temp/humidity, vent voltage | `sensor.*` (temperature/humidity/voltage) |
| structure systemMode / outsideTemp | structure `climate`/`select` + `sensor` |

## Jandy pool (core `iaqualink`) — composite card ⛔

| Original (Hayward) field | HA (iAqualink) entity |
| --- | --- |
| body waterTemp / targetTemp / heaterState | `climate.pool_heater` / `climate.spa_heater`, `sensor.pool_temperature` |
| pumps isOn/speed | `switch.filter_pump`, `switch.pool_cleaner`, aux `switch.*` |
| lights | `light.pool_light` / `light.spa_light` |
| airTemp | `sensor.air_temperature` |
| (chlorinator/pH/ORP) | only if controller exposes them as `sensor.*` |

## WeatherFlow Tempest (core `weatherflow` / `weatherflow_cloud`) ⛔

temp, feelsLike, humidity, wind speed/gust/dir, pressure, UV, solar, precip,
lightning count/distance, forecast → local `sensor.*` (+ `weather.<station>` from
`weatherflow_cloud` for forecast). Weather tile + composite of station sensors.

## CoolMaster (core `coolmasternet`) — composite card ⛔

per-unit mode/fan/roomTemp/setPoint/errorCode → one `climate.<unit>` per indoor
unit (`hvac_mode`/`fan_mode`/`current_temperature`/`temperature`). Composite groups
the gateway's units.

## Sonos (core `sonos`) — SonosPlayerTile ⛔

playbackState, volume, track (title/artist/album/art), playMode → `media_player.<room>`
state + `volume_level` + `media_title`/`media_artist`/`entity_picture` + `shuffle`/`repeat`.

## Lutron HomeWorks QSX (`lutron_caseta`, core) — LutronSurface ✅

Self-driven surface tile (DeviceType.LutronSurface). Discovers entities dynamically
via subscribeEntities; groups by area token from entity_id slug; graceful degradation
when absent.

Animation/richness pass (feat/lutron-anim) upgrades over v1:
- Light card: live colour/brightness swatch disk scales + glows with level; ambient colour
  halo behind the bulb; power button breathing ring when on; bulb icon drop-shadow glow.
- Brightness slider: fill gradient matches live swatch colour; dragging class adds focus ring.
- CCT strip: improved gradient (warm amber → cool blue); thumb transitions smoothly.
- Shade glyph: translucent light-ray shaft scales with open position; light-leak below shade
  panel; window cross-brace detail; richer fabric stripe + rail shadow.
- Blind slats: smooth cubic-bezier tilt transition; translucent light-leak between slats.
- Scene button: icon circle pulses on hover/press; multi-layer ripple + flash state.
- Keypad LED: activity (green) flash on button press in addition to on/off states.
- Stale state: whole surface dims (opacity) + amber pulsing border ring.
- Cover move buttons: active state highlights opening/closing direction.
- Light/dark theme: full CSS variable set overriding all hardcoded colors for light mode
  (`prefers-color-scheme: light`).
- Mobile reflow: collapse grids to 1–2 columns below 420 px.
- Entity bindings and service calls unchanged.

| Original field | HA entity | In surface? |
| --- | --- | --- |
| Light on/off + level (0–100%) | `light.<area>_<name>` state + `brightness` | ✅ animated dimmer slider + swatch disk + power toggle |
| Light color (HS) | `light.*` `hs_color` | ✅ live colour swatch disk + ambient halo |
| Light color temperature (K) | `light.*` `color_temp_kelvin` / `min/max_color_temp_kelvin` | ✅ CCT slider with warm→cool gradient; halo tinted by K |
| Shade position (0–100%) | `cover.*` `current_position` / `is_closed` | ✅ animated shade glyph; light ray; open/stop/close buttons |
| Blind tilt (0–100%) | `cover.*` `current_tilt_position` | ✅ animated slat tilt with light-leak; tilt-open/close buttons |
| Scene activation | `scene.*` | ✅ tactile scene buttons with ripple + icon-pulse feedback |
| Keypad buttons | `button.<keypad>_<button>` | ✅ grouped by keypad; tap to press |
| Keypad LED state | `binary_sensor.<keypad>_<button>_led` | ✅ glowing amber dot (on) + green flash on press (display-only; LED control deferred) |
| Connection health | live HA subscription | ✅ live/connecting/stale pill |
| Stale indicator | subscribeEntities heartbeat | ✅ dim overlay + amber pulsing border after 30 s silence |

Sources: `services/lutron.ts`, `hooks/useLutronSurface.ts`, `components/tiles/LutronSurface.tsx`.

Binding assumptions:
- Area names are derived from the entity_id slug (all tokens except the last).
  e.g. `light.living_room_overhead` → area "Living Room", device "Overhead".
- LED entities are matched by the convention `binary_sensor.<button_slug>_led`.
  If the convention differs on the actual installation, the LED dot renders "unknown" (dim)
  but the button still works.
- All light/cover entities in HA are shown (no integration-filter); non-Lutron entities
  that share a domain are also displayed. This is acceptable for an opt-in surface tile.
- LED control (writing to binary_sensor or related switch) is explicitly deferred per
  ENTITY_CONTRACT.md; the surface is display-only for LED state.

---

### Build order (each verified for parity before next)
1. **Grouping foundation** (entity→device) — prerequisite for all composites.
2. Litter-Robot composite (verify waste/litter/status stats).
3. CoolMaster + Flair + Jandy pool composites (climate-based).
4. Generator composite + Tempest weather + Sonos player.
5. **Lutron HomeWorks QSX surface** ✅ (this loop).
6. Keypad / Panic if applicable.
