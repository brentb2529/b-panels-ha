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

## Pentair IntelliCenter — Pool / Spa surface (`PoolSurfaceTile`) ✅

Self-driven composite tile (`DeviceType.IntelliCenterPool`). Resolves all entities
at runtime via `usePoolSurface` (hooks into `subscribeEntities`, matches on
`OBJTYPE`/`OBJNAM` extra-state-attributes — no literal `entity_id` binding).

| Data field | HA entity (selection) | In tile? | Notes |
|---|---|---|---|
| Pool / Spa water temp | `sensor` OBJTYPE=BODY + LSTTMP | ✅ | From standalone LSTTMP sensor; falls back to water_heater `current_temperature` |
| Air / water / solar probe temp | `sensor` OBJTYPE=SENSE, class=temperature | ✅ | Probe section; sname-based label |
| Pump RPM | `sensor` OBJTYPE=PUMP, unit=rpm | ✅ | Arc gauge |
| Pump power (W) | `sensor` OBJTYPE=PUMP, class=power | ✅ | Arc gauge + sparkline |
| Pump flow (GPM) | `sensor` OBJTYPE=PUMP, unit=gpm | ✅ | Arc gauge (VSF only) |
| Pump running | `binary_sensor` OBJTYPE=PUMP, class=running | ✅ | Animated dot |
| Freeze protection | `binary_sensor` class=cold | ✅ | Header badge |
| Salt (ppm) | `sensor` OBJTYPE=CHEM/ICHLOR, unit=ppm | ✅ | Chem stat card |
| pH | `sensor` OBJTYPE=CHEM/ICHEM, class=ph | ✅ | Chem stat card (color-coded) |
| ORP (mV) | `sensor` OBJTYPE=CHEM/ICHEM, unit=mV | ✅ | Chem stat card (color-coded) |
| Body run switch | `switch` OBJTYPE=BODY | ✅ | Toggle pill per body |
| Water heater (heating-only bodies) | `water_heater` OBJTYPE=BODY | ✅ | Mode pill, target temp display |
| Climate (UltraTemp cooling bodies) | `climate` OBJTYPE=BODY | ✅ | PROPOSED; mode toggle (conditional) |
| Pool/spa light | `light` OBJTYPE=CIRCUIT light/lightshow | ✅ | Toggle + FX chip row (effect_list) |
| Water feature switches | `switch` OBJTYPE=CIRCUIT/CIRCGRP | ✅ | Control pill per feature |
| SWG output % | `number` OBJTYPE=CHEM/ICHLOR, unit=% | ✅ | Inline –/+ control per body |
| Pump speed setpoint | `number` OBJTYPE=PMPCIRC | ✅ | Inline –/+ control |
| Body max temp setpoint | `number` OBJTYPE=BODY + HITMP | 🟡 | Resolved, displayed in body header; editable control deferred (low traffic) |
| pH/ORP tank level | `sensor` OBJTYPE=CHEM/ICHEM + PHTNK/ORPTNK | ⛔ | PROPOSED/DIAGNOSTIC — deferred |
| SWG cell life | — | ⛔ | NOT-PRODUCED by integration (G4) |
| Pump energy (kWh) | HA-side Riemann helper | ⛔ | PROPOSED/coordinator work |

**Binding assumptions:**
- Entity detection: entities with `OBJNAM` + `OBJTYPE` in `extra_state_attributes` (all IntelliCenter entities).
- Fallback: entity_id substring `intellicenter` also matches.
- Temperature unit: read dynamically from `unit_of_measurement` (°F or °C per panel mode).
- Body↔heater matching: fuzzy slug match on body `friendly_name` prefix — works for standard "Pool"/"Spa" names; custom names with non-standard prefixes may not auto-associate.
- Climate entities (UltraTemp only): present only when `body_supports_cooling()` is true; tile degrades gracefully when absent.
- Stale indicator: yellow dot in header if last entity update > 90 s (one IntelliCenter keepalive cycle).
- No `rgb_color` binding — IntelliCenter lights are ONOFF + `effect`/`effect_list` only.

**Verification needed (runtime, against real hardware):**
- Confirm OBJTYPE attribute key casing in integration output (`OBJTYPE` vs `objtype`).
- Confirm body↔water_heater slug matching covers user-customized names.
- Confirm VSF pump GPM gauge renders (hardware-dependent).

---

### Build order (each verified for parity before next)
1. **Grouping foundation** (entity→device) — prerequisite for all composites.
2. ✅ **IntelliCenter Pool/Spa surface** — `PoolSurfaceTile` + `usePoolSurface` (this PR).
3. Litter-Robot composite (verify waste/litter/status stats).
4. CoolMaster + Flair composites (climate-based).
5. Generator composite + Tempest weather + Sonos player.
6. Keypad / Panic if applicable.
