# Tile data-parity matrix — original B-Panels → Home Assistant

Goal: each ported tile surfaces the **same data** the original showed, sourced
from Home Assistant integration entities. Status legend: ✅ built & mapped ·
🟡 built, needs runtime verification against real entities · ⛔ not built yet.

---

## Navigation / Home Overview (feat/home-navigation)

Compilation panels built and registered as of this branch:

| DeviceType | File | Registered | Admin label |
| --- | --- | --- | --- |
| `PoolArea` | `PoolCompilationTile.tsx` | ✅ | Pool Area (Compilation Panel) |
| `SecurityArea` | `SecurityCompilationTile.tsx` | ✅ | Security Area (Compilation Panel) |
| `ClimateArea` | `ClimateCompilationTile.tsx` | ✅ | Climate Area (Compilation Panel) |

Navigation layer (added on this branch):

| Component | Route | Purpose |
| --- | --- | --- |
| `HomeOverview` | `/home` | Landing page with 5 area status cards |
| `AreaView` | `/area/:areaKey` | Full-screen area compilation panel wrapper |
| `NavRail` | all nav routes | Persistent left-side 72px icon + label rail |

`/` now redirects to `/home` (previously redirected to first dashboard panel).
Dashboard panels remain accessible via `/dashboard/:panelId` and the header dropdown.

### AreaView route → tile mapping (all 6 routes render with sensible defaults)

| Route | areaKey | DeviceType | Tile | Default device.state | Renders without setup? |
| --- | --- | --- | --- | --- | --- |
| `/home` | — | — | `HomeOverview` | n/a | ✅ |
| `/area/pool` | `pool` | `PoolArea` | `PoolCompilationTile` | `{}` → all DEFAULTS | ✅ |
| `/area/climate` | `climate` | `ClimateArea` | `ClimateCompilationTile` | `{}` → all DEFAULTS | ✅ |
| `/area/security` | `security` | `SecurityArea` | `SecurityCompilationTile` | `{}` → all DEFAULTS | ✅ |
| `/area/lights` | `lights` | `LutronSurface` | `LutronSurface` | self-driven (ignores state) | ✅ |
| `/area/generator` | `generator` | `GeneratorRehlko` | `KohlerGeneratorTile` | `{}` → graceful degradation | ✅ |

**Note:** `generator` maps to `DeviceType.GeneratorRehlko` (KohlerGeneratorTile), NOT `DeviceType.Generator`
(legacy EnergyTrak tile). The legacy tile requires a configured HTTP endpoint and will spin indefinitely
on `device.state = {}`. KohlerGeneratorTile's graceful degradation renders "Generator — loading…"
inside a proper TileWrapper when no `engineState` key is present in state.

### HomeOverview empty/standby card states

All 5 area cards now render as deliberate, clean states when live HA data is absent:

| Area | No-data summary | Dot style |
| --- | --- | --- |
| Pool | "Waiting for controller" | muted ring (offline/idle) |
| Climate | "Zones not yet discovered" | muted ring |
| Security | "Monitoring · Not yet armed" | muted ring |
| Lights | "All off · Lutron ready" | green (LutronSurface is self-driven, always live) |
| Generator | "Standby · Offline" | muted ring |

Dot vocabulary: green glow = active/ok, amber glow = warn, red glow = alert, empty ring = standby/offline.
This makes "not connected" states read as deliberate system states rather than errors.


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

## Mitsubishi City Multi AE-200E Direct (`ae200` custom component) ✅

One composite card per AE-200E controller, auto-discovered by `ae200_` prefix.

| Original field | HA entity | In tile? |
| --- | --- | --- |
| hvac_mode (heat/cool/dry/fan_only/auto/off) | `climate.ae200_*` `hvac_mode` | ✅ mode ring + label |
| fan_mode (AUTO/LOW/MID2/MID1/HIGH) | `climate.ae200_*` `fan_mode` | ✅ fan bar meter + tap-to-cycle |
| swing_mode / AirDirection | `climate.ae200_*` `swing_mode` | ✅ vane angle indicator |
| current_temperature | `climate.ae200_*` | ✅ large readout + delta arc |
| temperature (setpoint) | `climate.ae200_*` | ✅ setpoint + ±0.5 controls |
| min_temp / max_temp | `climate.ae200_*` attributes | ✅ clamped to these bounds |
| inlet return-air temp | `sensor.*_inlet_temperature` | ✅ footer stat |
| outdoor unit temp | `sensor.*_outdoor_temp` | ✅ header chip |
| filter dirty | `binary_sensor.*_filter` (problem) | ✅ pulsing FILTER badge |
| error code | `binary_sensor.*_error` (problem) | ✅ pulsing ERROR badge |

**Composite id:** `ae200:<controllerId>` · **DeviceType:** `AE200`
**Controls:** mode tap-cycle, ±setpoint buttons, fan tap-cycle via `updateDeviceState(entityId, payload)`
**Optimistic + reconcile:** 8 s stale window with PENDING header badge
**Graceful degradation:** renders an empty placeholder card when no `climate.ae200_*` entities found

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

## UniFi Protect / Security — Surface 5 (`unifiprotect` core integration)

| Original field | HA entity | In tile? |
| --- | --- | --- |
| Camera stream (HA-proxied HLS) | `camera.<cam>` via `getCameraStreamUrl` | ✅ live stream + snapshot fallback |
| Camera snapshot | `camera.<cam>` `entity_picture` attr | ✅ shown while stream connects |
| Motion detection | `binary_sensor.<cam>_motion` (class: motion) | ✅ pulse ring overlay |
| Doorbell ring | `binary_sensor.<cam>_doorbell` (class: occupancy) | ✅ amber flash + RING chip |
| Person detection | `binary_sensor.<cam>_person` | ✅ PERSON chip |
| Vehicle detection | `binary_sensor.<cam>_vehicle` | ✅ VEHICLE chip |
| Animal detection | `binary_sensor.<cam>_animal` | ✅ ANIMAL chip |
| Package detection | `binary_sensor.<cam>_package` | ✅ PKG chip |
| License plate detected | `binary_sensor.<cam>_license_plate_detected` | ✅ PLATE chip (boolean only — text gated PII) |
| Doorbell / vehicle / NFC / fingerprint events | `event.<cam>_*` | ✅ recent-events tape |
| Floodlight state | `light.<floodlight>` | ✅ warm glow overlay + FLOOD badge (display only) |
| Floodlight control | — | ⛔ deferred / equipment-gated per ENTITY_CONTRACT |
| Face / biometric data | — | ⛔ deferred / escalate-to-Brent per ENTITY_CONTRACT |
| RTSP credentials | — | ⛔ NEVER surfaced (security hard limit) |
| License plate TEXT | — | ⛔ PII — never surfaced (security hard limit) |

**Discovery**: dynamic — `useUnifiSurface` scans `subscribeEntities` for `camera.*`,
`binary_sensor.*` with UniFi detect suffixes, `event.*`, and `light.*` (floodlight).
Sibling correlation uses the HA entity-registry device map (fallback: name-prefix matching).

**Stale indicator**: amber "STALE" badge appears when no entity update for >2 min.

**Status**: 🟡 built, needs runtime verification against real UniFi Protect entities.

---

### Build order (each verified for parity before next)
1. **Grouping foundation** (entity→device) — prerequisite for all composites.
2. ✅ **IntelliCenter Pool/Spa surface** — `PoolSurfaceTile` + `usePoolSurface`.
3. Litter-Robot composite (verify waste/litter/status stats).
4. CoolMaster + Flair + Jandy pool composites (climate-based).
5. Generator composite + Tempest weather + Sonos player.
6. ✅ **Lutron HomeWorks QSX surface** — `LutronSurface`.
7. Keypad / Panic if applicable.
8. ✅ **Pool Area Compilation Panel** — `PoolCompilationTile` (see section below).

---

## Pool Area Compilation Panel — `DeviceType.PoolArea` / `PoolCompilationTile`

A flagship multi-integration surface that composes three existing surface hooks
into one cohesive, immersive area view. **No new data plumbing** — all entity
wiring is delegated to the three sub-hooks already verified above.

| Sub-surface | Hook | Entities | Status |
| --- | --- | --- | --- |
| IntelliCenter pool/spa controls | `usePoolSurface()` | All bodies/pumps/lights/chemistry/probes | ✅ (delegates to verified hook) |
| AKVO Movable Floor monitor + presets | `useAkvoFloor()` | All akvo binary_sensor/sensor/select entities | ✅ (safety-intact, AKVO is authority) |
| Lutron lights/shades/scenes (area filtered) | `useLutronSurface()` | light.*/cover.*/scene.* filtered by area slug | ✅ (delegates to verified hook) |

**Configurable filters** (set via `device.state` JSON `PoolAreaConfig`):

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `showPool` | boolean | `true` | Show IntelliCenter section |
| `showAkvo` | boolean | `true` | Show AKVO floor section |
| `showLighting` | boolean | `true` | Show Lutron lighting section |
| `lutronAreaFilter` | string[] | `['pool','patio','spa','cabana','outdoor']` | Area name contains-match filter |
| `areaName` | string | `'Pool Area'` | Hero header display name (overridden by `tile.label`) |
| `showQuickActions` | boolean | `true` | Show the one-tap routines bar |
| `quickActions` | QuickAction[] | sensible default set | Routines (heat/body/lights/feature one-tap; floor = guarded hold) |

**Layout (sophisticated / tight / high-def; iPad-landscape first)**: a high-
fidelity CSS gradient-mesh water hero (`PoolHeroScene`, NOT an SVG diagram) is the
centerpiece — deep navy→teal depth, blurred refraction lights, a masked caustic
lattice, one slow specular travel, top sheen + vignette; retina-sharp at 2×. The
AKVO floor reads as an elegant right-edge depth gauge (luminous rule at real
depth, state-colored), with crisp glass HUD chips (temps + body toggles, floor
status/config/depth, lights). Below, a tight full-width instrument grid (`1fr`
tracks, container queries 3/2/1 cols, `data-cols` cap) sized to fit iPad landscape
1366×1024 on one screen.

**Visual instrument widgets (no text rows)**: pump RPM/W/GPM `ArcGauge` dials;
chemistry pH/ORP/Salt `ChemDial` (270° dial with healthy band + in-range color);
SWG% and pump-speed `VisualSlider` (track + fill + stepper beads); lights
`LightSwatchCard` (live hs/CCT color swatch + brightness); shades `ShadeGlyphCard`
(window glyph with shade at real position).

**State-reactive UX**: (1) when `floors_moving`, the hero depth-gauge marker
travels smoothly toward target + glows + shows directional chevrons (up rising /
down lowering), settling at real depth when stopped; (2) when a body is heating,
a warm amber gradient rises through that body's water in the hero (positioned to
the heating body's side) and on its temp readout + deck card.

**Quick-actions / routines bar** (`QuickActionsBar`, between hero and deck):
configurable one-tap routines wired to real services — `heat`/`heatOff`
(water_heater), `body` (e.g. Spa Mode), `feature`, `lights` (IntelliCenter +
area-filtered Lutron). `floor` routines command AKVO motion and are rendered as a
GUARDED press-and-hold (`QuickHoldChip`) — never one-tap.

**STOP control (cancel a running move)**: whenever `floors_moving`, a sticky red
**STOP banner** (`FloorStopBanner`) appears at the top of the surface (above the
hero) plus an inline STOP in the console move-feedback. STOP is **immediate
one-tap** (never gated) and calls `cancelMovement()` → `select.select_option` with
the request select's sentinel ("—") option (`requestSelect.noneOption`), which
clears the active command so AKVO halts. Labelled "STOP FLOOR" + subtext noting
the certified E-stop is on the AKVO controller (not implied here). Starting motion
stays guarded press-and-hold; only stopping is one-tap (asymmetric by design).
`cancelMovement` added to `services/akvo.ts` and `useAkvoFloor`.

---

## Climate Area Compilation Panel — `DeviceType.ClimateArea` / `ClimateCompilationTile`

A flagship multi-integration HVAC dashboard composing three HVAC sources into one
immersive, dark charcoal/slate climate overview. **No new data plumbing** — all
entity wiring delegates to the existing hooks and services.

| Sub-surface | Hook / Source | Entities | Status |
| --- | --- | --- | --- |
| Airzone per-room zones + master/slave clusters | `useClimateZones()` | `climate.*` (Airzone, grouped by topology) | ✅ (delegates to verified hook) |
| Mitsubishi AE-200E City Multi groups | `useDashboard().devices` (DeviceType.AE200) | `climate.ae200_*`, `sensor.*_inlet/outdoor_temp`, `binary_sensor.*_filter/error` | ✅ (reads from existing device state) |
| CoolMaster VRF units | `useDashboard().devices` (DeviceType.CoolMaster) | `climate.l<n>_*`, `sensor.*_error_code`, `binary_sensor.*_clean_filter` | ✅ (reads from existing device state) |

**Configurable filters** (set via `device.state` JSON `ClimateAreaConfig`):

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `showAirzone` | boolean | `true` | Show Airzone section |
| `showAe200` | boolean | `true` | Show AE-200E section |
| `showCoolMaster` | boolean | `true` | Show CoolMaster section |
| `airzoneFilter` | string[] | `[]` | Zone name contains-match filter (empty = all) |
| `ae200Filter` | string[] | `[]` | Controller id/name contains-match filter |
| `coolMasterFilter` | string[] | `[]` | Line id filter (e.g. `['L1']`) |
| `areaName` | string | `'Climate'` | Hero header display name (overridden by `tile.label`) |
| `showQuickActions` | boolean | `true` | Show the one-tap routines bar |
| `quickActions` | ClimateQuickAction[] | sensible default set | Routines fanned out to all three integrations |

**Layout (iPad-landscape 1366×1024 first)**: `climate-comp-root` dark charcoal/slate
base; container-query 3-column balanced grid (`data-cols`). Sections scroll if many
zones.

**Hero** (`ClimateHeroScene`): outdoor temp chip (from AE-200E outdoor sensor, averaged
across controllers); zone count summary (Total / Heating / Cooling / Idle); tinted
heating (amber) / cooling (cyan) thermal-mesh backdrop (`ClimateHeroBackdrop`) — very
slow air-flow gradient drift, fine direction lines, slow specular travel; connection
status chip (Live/Stale/Connecting); glass HUD throughout.

**Quick-actions bar** (`QuickActionsBar`): four default routines fan-out to all three
integrations via `svcAirzoneSetTemp`/`svcAirzoneSetMode`, `haClient.callService`, direct:
- `All → 72°` — `setTargetTemperature` on every active zone/group/unit
- `Comfort` — 74°C/70°H preset per mode
- `Eco / Setback` — 78°C/66°H preset per mode
- `All Off` — `set_hvac_mode: off` across all; master-routed for Airzone

**State-reactive**: ambient tint on outer surface glow and hero backdrop shifts between
heating amber, cooling cyan, and neutral slate based on dominant zone mode count.
Fans animate (`AnimatedFan`) when running; `BuildBar` shows current temp as fraction
of min/max range.

**Light-mode pin**: `body.light-mode .climate-comp-root` overrides `--text` and all
`--glass-l*` tokens with pinned dark context (matching Pool compilation pattern).

**Status**: ✅ built, `npx tsc --noEmit` clean, `npm run build` green.

**AKVO safety (unchanged start path)**: `AkvoSectionContent` AND the quick-action
`floor` path replicate the same `HOLD_MS = 2000` press-and-hold gate +
`evaluateGate` check + single `requestConfiguration()` call (which issues
`select.select_option`) that `AkvoFloorSurface` uses. The hero floor depth gauge
is display-only. Floor motion is never *started* by a bare tap.

**Light-mode legibility**: the tile is a dark water scene in every theme, so a
scoped `body.light-mode .pool-comp-root` block pins light `--text` + the dark
glass recipe inside the tile (light mode only) — labels/values/chips read clearly
over the dark water instead of dark-slate-on-dark. Dark + ambient unchanged.

**Status**: ✅ built (UX iteration: floor-motion, heating gradient, quick-actions,
STOP control, light-mode fix). Needs runtime verification at 1366×1024 @2× of:
light-mode contrast across the whole tile; the STOP banner appearing + one-tap
cancelling while the floor moves; deck fits with minimal scroll; area filter +
all three sub-surfaces populate; depth gauge tracks real AKVO depth.

---

## Security Area Compilation Panel — `DeviceType.SecurityArea` / `SecurityCompilationTile`

Surface 7 — immersive area/function dashboard for cameras and security sensors.
Composes `useUnifiSurface` (camera wall + events) with live `subscribeEntities`
contact/lock sensor discovery into one cohesive, dark surveillance view.

| Sub-surface | Source | Entities | Status |
| --- | --- | --- | --- |
| UniFi camera wall (streams/snapshots) | `useUnifiSurface()` + `UnifiCameraCard` | `camera.*` via HA HLS proxy | 🟡 (delegates to verified hook) |
| Smart-detect chips + doorbell/motion pulses | `useUnifiSurface()` | `binary_sensor.*_motion/doorbell/person/vehicle/animal/package/license_plate_detected` | 🟡 |
| Recent-events timeline (cross-camera) | `useUnifiSurface()` | `event.*_doorbell/vehicle/nfc/fingerprint` | 🟡 |
| Floodlight state display | `useUnifiSurface()` | `light.*flood*` (display only) | 🟡 |
| Contact/lock sensors | `subscribeEntities` direct | `binary_sensor.*` (door/window/motion/opening) + `lock.*` | 🟡 graceful degradation if none |

**SECURITY CONTRACT** (hard limits — not relaxed by this tile):
- No RTSP/RTSPS credentials surfaced. Streams via `getCameraStreamUrl` (HA proxy).
- License plate: boolean indicator only. Plate text = PII, never shown.
- Floodlight: display state + label only. No control wired (equipment-gated).
- No arm/disarm, recording-mode change, siren, or floodlight CONTROL — all deferred.

**Deferred / equipment-gated actions** (explicitly NOT wired, documented in tile header):
- Alarm arm/disarm → AlarmTile/Alarmo path; requires PIN UI + human approval.
- Recording mode toggle → equipment-gated; needs HA service + operator confirm.
- Floodlight on/off → equipment-gated; display state surfaced only.
- Siren/chime → equipment-gated; must coordinate with alarm panel.

**Quick-actions (display/navigation ONLY):**
- "Focus Active Cam" — sets local `focusedCamId` state (no HA service call).
- "All Cameras" — clears focus (local state).
- "Show Events" — `scrollIntoView` on events panel (no HA service call).

**Configurable** (set via `device.state` JSON `SecurityAreaConfig`):

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `areaName` | string | `'Security'` | Hero header display name |
| `showEvents` | boolean | `true` | Show recent-events panel |
| `showSensors` | boolean | `true` | Show contact/lock sensor panel |
| `maxCameras` | number | `0` (all) | Cap cameras shown in wall |

**Layout**: hero (cameras-online count, detection status, last-activity summary,
LIVE indicator) → quick-actions bar → 2-column deck (camera wall left 2fr +
events/sensors panel right 1fr, CQ-responsive to 1col on narrow containers). Calm
dark slate/charcoal backdrop, scanline texture, moving scan line, alert bloom on
detection. Monospaced readouts (JetBrains Mono) for surveillance feel.

**Light-mode legibility**: `body.light-mode .sec-comp-root` scoped block pins
light `--text` + dark glass recipe inside the tile so labels read over the dark
backdrop in all themes (mirrors Pool compilation pattern).

**Sensor filtering**: UniFi-owned `binary_sensor` siblings (motion/doorbell/person/
vehicle/animal/package/license_plate suffixes) are excluded from the sensor panel
to avoid double-counting (they are shown in the camera card chips instead).

**Source**: `components/tiles/SecurityCompilationTile.tsx` (self-contained;
reuses `UnifiCameraCard`, `useUnifiSurface`, and `haClient.subscribeEntities`).
Registration: `types.ts` `DeviceType.SecurityArea`, `tileRegistry.tsx`,
`Admin.tsx` (icon + virtual-device list), `useDashboard.tsx` (empty-object default state).

**Status**: 🟡 built. Needs runtime verification at 1366×1024 @2× of:
- Camera wall populates and streams via HA proxy.
- Smart-detect chips and doorbell flash fire on real events.
- Contact/lock sensors discovered from HA states (verify device_class filter).
- Events timeline updates live across all cameras.
- Floodlight state badge correct; no control exposed.
- Alert state (hero bloom, outer glow, status chip) triggers on motion/detection.
- Light-mode contrast legible (dark override applied).
- Quick-actions are purely navigational (no HA service calls fired).
