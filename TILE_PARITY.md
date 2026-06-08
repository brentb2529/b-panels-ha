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

## AKVO Movable Floor (custom `akvo`) — bespoke SAFETY-CRITICAL surface ✅

`DeviceType.AkvoFloor`, one self-driven virtual tile. **Monitor-first**; the
command region is heavily guarded and issues exactly ONE thing. Discovers AKVO
entities dynamically by the `akvo`/`movable_floor` prefix (no hardcoded ids;
each field resolved by id-suffix).

| Field | HA entity | In surface? |
| --- | --- | --- |
| main floor / baja position (m, signed; −=above deck) | `sensor.*_main_floor_position` / `*_baja_position` | ✅ animated SVG cross-section + numeric readout + deck-relative bar |
| motor currents (A) | `sensor.*_main_floor_motor_current` / `*_baja_motor_current` | ✅ live current gauges (animated fill bar) + status chips |
| active configuration | `sensor.*_active_configuration` | ✅ banner + reconcile target |
| system ready / fault / e-stop / moving / comms / ready-for-cmds | `binary_sensor.*_{system_ready,system_fault,emergency_stop,floors_moving,bad_modbus_comm,ready_for_external_commands}` | ✅ status banner (pulse on fault/e-stop) + chips + gate |
| drive faults (main/baja: vfd, overtravel up/down, motor_overload, direction, no_movement, off_speed, position_ref, relative_position) | `binary_sensor.*` | ✅ faults panel (active-first, severity-ranked; safety dots pulse) |
| 14 top-plate faults | `binary_sensor.*` | ✅ faults panel |
| configuration request (GATED COMMAND) | `select.*_configuration_request` | ✅ press-and-hold request, sentinel `—` filtered out |

### Animated cross-section visualization (feat/akvo-anim)

The monitor region now contains a live SVG elevation/cross-section:

- **Floor plate** (`MAIN FLOOR`) positioned at actual `mainFloorPosition` metres relative to the deck line, with smooth CSS transition (1.1 s settle, 0.6 s linear while moving).
- **Water column** fills from deck to pool floor; animated wave pattern at the water surface that drifts faster when `floors_moving` is true.
- **Baja shelf** rendered as a second lighter plate at `bajaPosition` when data is present.
- **Deck line** with dashed reference, deck coping, depth ruler (−1 m / 0 / +1 m / +2 m tick marks), and a left-edge depth callout showing the live numeric value.
- **Motion indicators**: directional chevron arrows pulse above/below the plate while moving; lifting-cable dashed lines animate flow.
- **State color coding**: green (ready) → amber (moving) → orange (comms fault) → red pulse (fault/e-stop). The plate glow and drop-shadow update live.
- **Motor current gauges**: animated horizontal fill bars with color ramp (green → amber → red) at 40 %/70 % of a 20 A full-scale.
- **Live indicator**: ripple-ring dot in the status pill when connection is live.
- All animations use CSS keyframes injected once at first render (no new CSS files).

### Safety boundary

The root `CLAUDE.md` rule is **AKVO is display-only; never wire raw
motion/actuation**. This surface honors that: it renders **no** motion/stop/reset
control (there is none and none must be added). The single sanctioned write is
`select.select_option` on the watchdog-protected configuration-request select —
the gated path the `akvo` integration owns and validates. AKVO is the safety
authority; HA only sends a request it may accept or reject.

`evaluateGate`, `requestConfiguration`, `HoldToRequest` (including `HOLD_MS = 2000`),
and the `onComplete` → `requestConfiguration` call chain are byte-for-byte identical
to the pre-animation implementation.

### Command gate (fail-closed)

Requests are enabled ONLY when ALL hold: `ready_for_external_commands` ON, AND
`system_fault`/`emergency_stop`/`bad_modbus_comm` all OFF, AND `floors_moving`
OFF, AND the request select is available. Any **unknown/absent** safety signal is
treated as NOT safe (fail-closed). When blocked, the UI shows the specific reason
("Emergency stop active" / "System fault active" / "Controller comms fault" /
"Floor is moving" / "AKVO not ready for external commands" / "AKVO offline").
The gate is re-checked in the hook at issue time (defense-in-depth) so a stale
view can't fire.

### Confirm UX

**Press-and-hold (2 s)** per preset — no single tap can issue motion. A progress
fill tracks the hold; releasing early cancels. The active configuration's button
is disabled ("current"). On issue, the surface shows "Requesting `<preset>`…
(AKVO validating)", then "Moving → `<config>`…", reconciled against
`floors_moving` + `active_configuration` (cleared on motion/arrival or a 12 s
timeout). Position/motion/fault are always real state — never optimistic.

### Graceful degradation

Binds via `subscribeEntities` (no polling); stale/reconnect indicator; responsive
wall + mobile (monitor/command reflow); light/dark. If no AKVO entities are
present, an explanatory empty state renders. Absent individual entities show
"unknown"/"--" and the gate fails closed.

Source: `components/tiles/AkvoFloorSurface.tsx`, `hooks/useAkvoFloor.ts`,
`services/akvo.ts` (model + gate + the one gated command; `akvo.ts` and
`useAkvoFloor.ts` are unchanged by feat/akvo-anim).

---

### Build order (each verified for parity before next)
1. **Grouping foundation** (entity→device) — prerequisite for all composites.
2. Litter-Robot composite (verify waste/litter/status stats).
3. CoolMaster + Flair + Jandy pool composites (climate-based).
4. Generator composite + Tempest weather + Sonos player.
5. Keypad / Panic if applicable.
