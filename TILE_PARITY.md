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

## Air Control surface (per-room climate, e.g. Airzone) — bespoke marquee 🟡

A dedicated multi-zone surface (`DeviceType.AirControl`, one virtual tile) that
discovers **every** controllable `climate.*` entity live and renders one
independent control card per zone. Multi-master safe: each zone is read and
commanded on its own entity — no master↔zone attribute is consulted (that row
is still `PROPOSED` in the contract).

| Per-room field | HA source | In tile? |
| --- | --- | --- |
| room name | `climate.*` `friendly_name` (else humanized entity_id) | ✅ header |
| current temperature | `climate` `current_temperature` | ✅ |
| current humidity | `climate` `current_humidity`, else paired `sensor.<zone>_humidity` | ✅ (if present) |
| target setpoint | `climate` `temperature` (range → midpoint, stepping disabled) | ✅ large |
| hvac_mode | `climate` state + `hvac_modes` | ✅ tap-to-cycle → `climate.set_hvac_mode` |
| fan_mode | `climate` `fan_mode` + `fan_modes` (feature-gated) | ✅ tap-to-cycle → `climate.set_fan_mode` |
| hvac_action / running | `climate` `hvac_action` | ✅ running badge |
| setpoint ± | `climate` `target_temp_step`/`min_temp`/`max_temp` | ✅ → `climate.set_temperature` |

Discovery: binds generically to `climate.*`, excludes pool/spa heaters by id
(`/climate\..*(pool|spa)/i`). Controls are optimistic and reconciled against
`subscribeEntities`; offline zones render disabled. **Verify:** the simulated
zones (`climate.living_room`, `climate.primary_suite`, `climate.kitchen`,
`climate.office`) appear as independent cards once created in the dev instance.

Source: `components/tiles/AirControlSurface.tsx` + `RoomClimateTile.tsx`,
`hooks/useClimateZones.ts`, `services/climate.ts` (model + command wiring).

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
