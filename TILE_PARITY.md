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

## Kohler / Rehlko standby generator (core `rehlko`) — composite card 🟡

DISPLAY-ONLY. `rehlko` (HA core, silver; successor to the removed `oncue`)
exposes telemetry only — **no control entities** — so the surface renders state
and never commands the unit (start/stop/exercise are equipment-gated, not wired).
Built as a composite (`KohlerGeneratorTile`, `DeviceType.GeneratorRehlko`,
composite id `rehlko:generator`) folded from the generator's prefixed entities by
naming convention (`sensor.generator_*` / `binary_sensor.generator_*`), all via
`subscribeEntities` (no polling). Distinct from the legacy EnergyTrak/genmon
`GeneratorTile` (`DeviceType.Generator`), which polls an HTTP endpoint.

| Surface field | HA entity (rehlko slug) | In tile? |
| --- | --- | --- |
| headline (Standby/Running/Exercising/Offline) | `sensor.generator_engine_state` + `_status` (derived) | ✅ hero |
| power source (On Utility / On Generator) | `sensor.generator_power_source` | ✅ hero pill |
| attention (low oil pressure) | `binary_sensor.generator_oil_pressure` (problem) | ✅ |
| attention (controller offline) | `binary_sensor.generator_connectivity` | ✅ |
| auto mode armed | `binary_sensor.generator_auto_run` | ✅ footer |
| battery V | `sensor.generator_battery_voltage` | ✅ vital |
| load W / % | `sensor.generator_load` / `_load_percent` | ✅ vital (kW≥1000W) |
| output V (avg) | `sensor.generator_voltage` | ✅ vital |
| utility V (avg) | `sensor.generator_utility_voltage` | ✅ modal |
| frequency Hz | `sensor.generator_engine_frequency` | ✅ vital |
| engine rpm | `sensor.generator_engine_speed` | ✅ vital |
| total runtime hrs | `sensor.generator_total_runtime` | ✅ vital |
| coolant/oil/controller temp, oil psi | `sensor.generator_*_temp`, `_oil_pressure` | ✅ modal |
| next exercise / last run / maintenance | `sensor.generator_next_exercise` / `_last_run` / `_*_maintenance` (timestamp) | ✅ footer + modal |
| fuel level | none (NG/LP — no tank sender) | n/a (shows "n/a") |
| **control (start/stop/exercise)** | — none in `rehlko` — | **omitted by design (safety)** |

**Status 🟡:** designed + verified against a clearly-labelled `(preview)` fixture
(`dev-ha/config/packages/kohler_generator_preview.yaml`); promotes to ✅ once the
real `rehlko` account is connected and the entity ids/units are confirmed against
`Developer Tools → States`. The surface shows an amber "Preview data" ribbon
whenever the fixture is in play (lifted from the `(preview)` friendly-name marker).

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

---

### Build order (each verified for parity before next)
1. **Grouping foundation** (entity→device) — prerequisite for all composites.
2. Litter-Robot composite (verify waste/litter/status stats).
3. CoolMaster + Flair + Jandy pool composites (climate-based).
4. Generator composite + Tempest weather + Sonos player.
5. Keypad / Panic if applicable.
