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
discovers **every** controllable `climate.*` entity live and renders one control
card per zone, grouped by Airzone master/slave topology.

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
| master/slave role | `is_master` / `master_zone` / `slave_zones` (LOCKED, contract v0.2) | ✅ badge + grouping |

Discovery: binds generically to `climate.*`, excludes pool/spa heaters by id
(`/climate\..*(pool|spa)/i`). Controls are optimistic and reconciled against
`subscribeEntities`; offline zones render disabled.

### Master/slave grouping (Airzone topology — LOCKED, ENTITY_CONTRACT v0.2)

The read-only climate attributes `is_master` (bool), `master_zone`
(`"system:zone"`, slaves only), `slave_zones` (`"system:zone"[]`, masters only),
and **`zone_id`** (`"system:zone"`, every zone) are consumed here.

The `"system:zone"` ids in `master_zone`/`slave_zones` are correlated to concrete
`entity_id`s **entirely from entity state**: each `climate.*` entity carries its
own `zone_id` attribute, so `zoneIdMapFromEntities` (in `services/climate.ts`)
builds `entity_id → "system:zone"` straight from the subscribed states. **No
admin / `config/device_registry/list` call is needed** — master/slave grouping
works for non-admin and read-only-token wall-panel kiosks.

The device-registry join (`getClimateZoneIdMap` in `haClient.ts`, identifier
`{entry_id}_{system_zone_id}`) is kept ONLY as a fallback for entities that lack
`zone_id` (older firmware / pre-merge); it runs at most once and only for the
zones still missing an id. If neither path resolves a zone, it degrades to a
standalone tile.

- **Grouping:** a master renders as a card with its resolved slave cards nested
  beneath in a bordered cluster (full-row, sub-grid). The header shows a
  **Master** / **Slave** badge.
- **Standalone:** a zone with no topology attrs, `is_master` true + empty
  `slave_zones`, or a slave whose master can't be resolved, renders exactly as a
  plain card (pre-topology behavior).

### Mode-routing UX decision

A SLAVE zone cannot change its own `hvac_mode` (the integration hard-fails
`set_hvac_mode` on a slave; the routing fix is a separate equipment-gated PR).
Chosen behavior — **route the slave's mode change to the master's `entity_id`**
when the master is resolvable (calling the master works today):

- Slave with resolved master → mode control **stays enabled**; pressing it calls
  `climate.set_hvac_mode` on the **master** entity, with a "via `<master>`" hint.
  The optimistic patch is applied to the master; slaves follow via real state.
- Slave whose master is **unresolved** (master entity not present, or attrs
  missing on older firmware) → mode control is **disabled** and the tile shows
  "Mode follows `<master>`". We never call `set_hvac_mode` on a slave entity.
- Setpoint and fan_mode are always per-slave (those work on slave entities).

### Graceful degradation

When the topology attrs are absent (older Airzone firmware / pre-merge
instances) and the device-registry fallback also can't resolve a zone, that zone
falls through to **standalone** rendering — identical to the pre-topology
surface. Nothing crashes; no zone is dropped. Because the primary correlation is
now the state `zone_id` attribute, this no longer depends on admin rights:
**non-admin / read-only-token kiosks get full grouping**.

**Verify:** the simulated zones appear as cards; a master shows its slaves
nested with a Master badge; a slave's mode button either routes "via master" or
shows "Mode follows master".

Source: `components/tiles/AirControlSurface.tsx` + `RoomClimateTile.tsx`,
`hooks/useClimateZones.ts`, `services/climate.ts` (model + grouping + routing),
`services/haClient.ts` (`getClimateZoneIdMap`).

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
