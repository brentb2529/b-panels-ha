# GeoDrops irrigation subsystem — design & deploy recipe

Reads GeoDrops soil probes and publishes them as Home Assistant entities, so the
B-Panels irrigation tile can render them and automations can trigger on them.

**Everything runs inside Home Assistant.** No AppDaemon, no MQTT broker, no
external poller, no developer machine in the loop.

---

## 1. Why BigQuery, and why REST

GeoDrops probes have **no local/LAN interface**. They talk WiFi to GeoDrops'
cloud; the vendor's sanctioned programmatic access is their public BigQuery
dataset (GeoDrops staff: *"access our BigQuery programming API directly to
control any irrigation system you desire"*). There is no official HA
integration; staff say one is gated on ">50% user adoption of our new AI Model"
with no date.

The community integration uses `google-cloud-bigquery` inside an AppDaemon
add-on plus an MQTT hop into HA. We use neither:

| | community path | this |
| --- | --- | --- |
| runtime | AppDaemon add-on | HA core (custom component) |
| transport | BigQuery SDK -> MQTT -> HA | BigQuery REST -> HA entities |
| new deps | google-cloud-bigquery, paho-mqtt, Mosquitto | **none** |
| blocking? | yes (SDK is sync) | no (aiohttp, natively async) |

`google-cloud-bigquery` is absent from the HA image, heavy, and **blocking** —
it would need executor juggling inside the event loop. We build on what HA
already ships (verified in `ghcr.io/home-assistant/home-assistant:stable`):

    PyJWT 2.12.1 + cryptography 48.0.0   sign the service-account assertion
    aiohttp 3.13.5                       token exchange + query

So `manifest.json` `requirements` stays `[]`.

Flow: RS256 JWT -> `oauth2.googleapis.com/token` -> bearer token (cached ~1h)
-> `POST bigquery.googleapis.com/bigquery/v2/projects/{project}/queries`.
Measured in-container: auth 0.14 s, query ~1.0 s, ~10 MB billed per poll.

---

## 2. Data-shape gotchas (hard-won; do not re-derive)

Measured across 384,937 rows / 166 devices in `geodrops-prod.db_public.p_sensor_unified`:

- **`date` is the reading time**, on a clean 30-minute grid.
  **`createdAtOrigin` is a BATCH marker** — identical across every row of a
  batch. Never order or key on it. (`createdAt`/`date_written` are processing
  and landing times.)
- **Rows are rewritten in place.** Nulls get backfilled hours later, so poll a
  **trailing window** (6 h) — never append past a high-water mark, or the first
  nulls you see become permanent.
- **`qcn >= 1` ⟺ `moisturePct IS NOT NULL`**, zero exceptions table-wide.
  That is the usable-reading gate. `qcn` -1 and 0 are always null; 1 and 2 are
  always populated (2 is the normal good state).
- **A probe can be online but uncalibrated for days.** New probes sit at
  `nextAction='ATT_SS_NEW,'` with every derived field null. Publish health
  telemetry anyway; never emit 0 for a missing moisture reading.
- **Calibration takes ~6 days** (median across 29 observed transitions;
  p25 4.0, p75 10.1, max 41). ~12% of devices never calibrate at all.
- **The "never happened" sentinel for calibration timestamps is
  `2023-01-01T00:00:00Z`** — NOT Unix epoch. Do not date-compare; use `qcn`.
- **A single depth may be null on a healthy row**, flagged by `qcnDepthN == 0`.
  Publish the rest of the row.
- **Device clocks can run minutes ahead.** Clamp reading age at 0; never reject
  a future-dated row.
- **`moisturePct` is a calibrated transform of `moistureRawPct`** (raw 69 -> 86).
  Thresholds belong on `moisturePct`. Never on raw.
- Partition expiry is 60 days, so `MIN(date)` per device is censored — it is not
  a device's install date.

---

## 3. Deploy recipe (dev -> production)

Deploy target is the production Home Assistant instance. Host, probe serials
and the probe->zone mapping are site-specific and deliberately kept OUT of
this public repo - see the gitignored `ops-private/geodrops/`.

### 3.1 One-time: Google Cloud

1. <https://console.cloud.google.com> -> new project (e.g. `geodrops-ha`).
2. **APIs & Services -> Library -> BigQuery API -> Enable.**
3. **IAM & Admin -> Service Accounts -> Create** (e.g. `geodrops-reader`).
4. Grant **BigQuery Job User** (`roles/bigquery.jobUser`). This is the role that
   matters — it lets the account *run* queries billed to your project. Read
   access to GeoDrops' data comes from their dataset being public, not from
   anything you grant. (BigQuery Data Viewer is harmless to add.)
5. **Keys -> Add key -> JSON.** This download is the only copy.

Cost: ~10 MB per poll. At 30-minute polling that is ~15 GB/month against a
1 TB/month free tier — about 1.5%.

### 3.2 Credentials live in Home Assistant, never on disk

Paste the service-account JSON into the B-Panels **options flow**. It is stored
in the config entry (HA `.storage`), so it is included in HA backups and never
sits in `configuration.yaml` or a `/config/*.json` file.

> Do **not** commit the key, and do not place it in the repo. If one is ever
> dropped in the working tree, move it out and rotate it.

### 3.3 Enable each probe's public API

In the GeoDrops app, enable public-API publishing **per probe**. A probe that is
not enabled does not appear in the dataset at all. App state maps directly:
- *"Soil Profile Scheduled"* -> nothing published yet
- *"Soil Profiling"* -> rows appear, but only `moistureRawPct` and
  `temperatureCSurface` are populated
- calibrated -> `qcn >= 1`, full profile

### 3.4 Deploy

1. `git pull` on the production HA's `custom_components/b_panels` (HACS update,
   or direct copy).
2. Restart Home Assistant.
3. Settings -> Devices & Services -> **B-Panels -> Configure** -> paste the
   service-account JSON and the probe serial -> zone mapping.
4. Confirm `sensor.*` entities carrying `bp_irrigation_zone` appear.

No add-ons, no broker, no host packages. Works identically on HA OS, Container
and Core.

### 3.5 Dev/test loop

A local HA container is the fastest loop. If it mounts a **different clone** of
this repo than the one you edit (easy to end up with), sync the component into
the mounted path before restarting, or you will test stale code:

    rsync -a --delete \
      "$CANONICAL_CLONE/custom_components/b_panels/" \
      "$MOUNTED_CLONE/custom_components/b_panels/"
    docker restart "$HA_CONTAINER"

Verify which clone is mounted with `docker inspect "$HA_CONTAINER"` and compare
`git log -1` in each - a container quietly running a months-old checkout looks
exactly like a change that "did not work".

For headless screenshots the SPA must be built with `VITE_HASS_URL` pointing at
the dev instance. **Rebuild without it before committing** - a release build
must use `window.location.origin`, or deployed kiosks will try to reach the
developer laptop.

---

## 4. Probe -> zone mapping

The real mapping lives in `ops-private/geodrops/probe_zone_map.json`, which is
gitignored.

> **Do not commit probe serials.** The GeoDrops dataset is PUBLIC: anyone with a
> serial can query that probe's full history - watering times, local weather and
> 7/30-day patterns that indicate occupancy. The serial is not a secret to
> GeoDrops, but publishing which serials are *yours* links that data to you.

Shape of each entry:

```json
{
  "serial": "<mfgSn from the GeoDrops app>",
  "zone_id": "front_yard",
  "label": "Front Yard",
  "schedule_entity": "switch.<controller>_<schedule>",
  "zone_entities": ["switch.<controller>_<zone>"]
}
```

Two probes may share one schedule - same irrigation, different zones, which is
what makes zone-level variation observable.

## 5. Known gap: Rachio skips are invisible

Rachio emits skips only via webhooks (`WEATHER_INTELLIGENCE_SKIP`,
`RAIN_DELAY_EVENT`), and HA's `rachio` integration does **not** subscribe to
them — its `LISTEN_EVENT_TYPES` is `DEVICE_STATUS_EVENT`, `ZONE_STATUS_EVENT`,
`RAIN_DELAY_EVENT`, `RAIN_SENSOR_DETECTION_EVENT`, `SCHEDULE_STATUS_EVENT`.

So a skipped schedule produces **no signal at all** — "due but skipped" and
"not due" are both silence. `boxwood_weekly_schedule` has saturation skip and
rain skip enabled, which is why it shows zero runs while `Enabled=True`.

Worse, **Rachio zone/schedule switches carry no `state_class`, so HA keeps NO
long-term statistics for them.** Runs exist only as recorder state changes and
vanish at the purge horizon (~10 days). Irrigation history cannot be
reconstructed after that — capture it continuously.

Mitigations, in order of fidelity:
1. **Cadence inference** (`ops-private/geodrops/infer_skips.py`) — works
   retroactively, but only for FIXED schedules. `front_grass_schedule` is FLEX
   ("as needed"), so its skips are structurally not inferable.
2. **Own Rachio webhook** — real skip reasons, but only from switch-on forward,
   needs a public endpoint (Nabu Casa) and risks colliding with the webhook HA
   already registers.

---

## 6. Implementation map

| File | Role |
| --- | --- |
| `custom_components/b_panels/geodrops.py` | BigQuery REST client (JWT -> OAuth -> query), no SDK |
| `custom_components/b_panels/irrigation_math.py` | FAO-56 Penman-Monteith ET0, drying-limb slope |
| `custom_components/b_panels/irrigation_store.py` | Durable Rachio run history (HA `Store`) |
| `custom_components/b_panels/irrigation_coordinator.py` | 30-min poll, assembles per-zone documents |
| `custom_components/b_panels/sensor.py` | Publishes `bp_irrigation_*` stamped entities |
| `custom_components/b_panels/config_flow.py` | Options flow: SA key + probe mapping |
| `frontend/services/irrigationEntities.ts` | Regroups entities -> per-zone documents |
| `frontend/hooks/useIrrigationZones.ts` | One `subscribeEntities` subscription |
| `frontend/components/tiles/IrrigationTile.tsx` | The tile (report-only, no verdict yet) |

Irrigation is **optional**: with no service account configured the poller never
starts and B-Panels behaves exactly as before. The Rachio run store starts
regardless, because that history is perishable.

### Two bugs worth not reintroducing

**Drying rate must be fit to the drying limb only.** Soil moisture is a
sawtooth — a sharp step up on rain/irrigation, then slow decay. Fitting a line
across a wetting event measures the step: on real data a probe that went
0.6 -> 68.9 at install reported **+12.7 pts/day**, i.e. "rapidly wetting", for
soil that was drying. `drying_rate_per_day()` therefore fits only from the most
recent maximum onward, and returns None when that limb is too short.

**The trend window must be wider than the backfill window.** A 6 h lookback
(enough for backfill) is only ~12 points on a 30-minute grid — short enough for
normal diurnal movement to dominate and produce a POSITIVE slope on drying
soil. `LOOKBACK_HOURS = 48` spans two day/night cycles. Partition pruning means
the wider window costs no extra bytes.

### Verification performed

- BigQuery REST proven **inside** `ghcr.io/home-assistant/home-assistant:stable`:
  auth 0.14 s, query ~1.0 s, 39 rows, correct type coercion (INTEGER/FLOAT/
  BOOLEAN/TIMESTAMP), token caching confirmed.
- ET0 validated against the **FAO-56 worked example 18**: 3.89 mm/day vs the
  published 3.9. (Deriving `ea` from RHmean instead of dewpoint gives 4.11 —
  ~5% high — which is why dewpoint is preferred when available.)
- 68 entities published across 4 zones on the dev instance; uncalibrated probes
  correctly report `unknown` rather than 0.
- `tsc --noEmit` clean; `vite build` clean.

> Pre-existing, unrelated: `frontend/services/energytrakEntities.test.ts`
> imports `vitest`, which is not in `devDependencies`, so that file does not
> typecheck and the suite cannot run.
