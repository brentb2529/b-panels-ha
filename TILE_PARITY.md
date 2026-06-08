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

## CoolMaster (core `coolmasternet`) — composite card ✅

One `CoolMasterTile` per indoor unit, auto-discovered from `climate.*` entities.

| Original field | HA entity | In tile? |
| --- | --- | --- |
| hvac_mode (cool/heat/auto/fan/dry/off) | `climate.<unit>` state | ✅ mode selector |
| current_temperature | `climate.<unit>` attr `current_temperature` | ✅ thermal ring (current arc) |
| setPoint / temperature | `climate.<unit>` attr `temperature` | ✅ thermal ring (target arc) + ±0.5 step controls |
| fan_mode + fan_modes (incl. `top` / FAN_TOP) | `climate.<unit>` attrs | ✅ fan mode pills + turbine animation |
| swing_mode + swing_modes (when supported) | `climate.<unit>` attrs | ✅ swing pills + vane animation (when present) |
| temperature_unit | `climate.<unit>` attr `temperature_unit` | ✅ °C / °F auto-read |
| error_code | `sensor.<unit>_error_code` | ✅ fault badge (pulsing alert) |
| clean_filter | `binary_sensor.<unit>_clean_filter` | ✅ filter badge (pulsing warn) |
| reset filter timer | `button.<unit>_reset_filter` | ✅ reset button (button.press) |

**Architecture:** `useCoolMasterSurface.ts` discovers entities by entity_id heuristic
(`climate.l<n>_<digits>` or integration platform hint) and groups sibling entities.
One `Device` per unit with `type: DeviceType.CoolMaster`; member entity_ids hidden
from generic tile list. Raw entity snapshot (`rawEntitiesRef`) used for attribute
metadata not forwarded by the standard entity mapper.

**Verify:** After install, check `Developer Tools → States` for `climate.l1_*` (or
equivalent) entities; CoolMasterTile cards should appear per unit in the tile picker.

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
