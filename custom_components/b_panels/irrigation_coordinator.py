"""Irrigation coordinator: GeoDrops soil + Tempest ET0 + Rachio history.

Polls GeoDrops every 30 minutes (their publish grid; faster only burns quota)
and assembles one document per zone for the sensor platform to publish.

Deliberately NOT emitting a water/hold verdict yet. Thresholds set before the
probes finish calibrating would be guesses, and we already learned that lesson
once with hand-picked soil thresholds on the previous probes. This reports
soil trend, ET0, rain, deficit and days-since-run; the verdict layer lands when
there is calibrated data to tune against.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import GEODROPS_SCAN_INTERVAL_MINUTES
from .geodrops import GeoDropsClient, GeoDropsError
from . import irrigation_math as im
from .irrigation_store import IrrigationRunStore

_LOGGER = logging.getLogger(__name__)

C_TO_F = lambda c: None if c is None else c * 9.0 / 5.0 + 32.0   # noqa: E731


class IrrigationCoordinator(DataUpdateCoordinator[dict[str, dict[str, Any]]]):
    """One poll -> {zone_id: {field: value}} for the sensor platform."""

    def __init__(
        self,
        hass: HomeAssistant,
        service_account: dict[str, Any],
        probes: list[dict[str, Any]],
        store: IrrigationRunStore,
        weather: dict[str, str] | None = None,
        latitude: float | None = None,
        elevation_m: float | None = None,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name="b_panels_irrigation",
            update_interval=timedelta(minutes=GEODROPS_SCAN_INTERVAL_MINUTES),
        )
        self._client = GeoDropsClient(async_get_clientsession(hass), service_account)
        self._probes = probes
        self._store = store
        self._weather = weather or {}
        self._lat = latitude if latitude is not None else hass.config.latitude
        self._elev = elevation_m if elevation_m is not None else float(hass.config.elevation or 0)

    @property
    def serials(self) -> list[str]:
        return [p["serial"] for p in self._probes if p.get("serial")]

    async def _async_update_data(self) -> dict[str, dict[str, Any]]:
        try:
            rows = await self._client.fetch_readings(self.serials)
        except GeoDropsError as err:
            raise UpdateFailed(f"GeoDrops query failed: {err}") from err

        by_serial: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            by_serial.setdefault(r.get("mfgSn"), []).append(r)

        et0_7d, rain_7d = await self._async_weather_totals()
        now = dt_util.utcnow()
        out: dict[str, dict[str, Any]] = {}

        for probe in self._probes:
            sn = probe.get("serial")
            zone_id = probe.get("zone_id")
            if not sn or not zone_id:
                continue
            series = by_serial.get(sn) or []
            doc: dict[str, Any] = {
                "label": probe.get("label") or zone_id,
                "serial": sn,
                "schedule_entity": probe.get("schedule_entity"),
                "zone_entities": probe.get("zone_entities") or [],
                "online": bool(series),
                "et0_7d": et0_7d,
                "rain_7d": rain_7d,
            }

            if series:
                newest = series[-1]
                # qcn >= 1 is exactly equivalent to "moisturePct is usable"
                # across the whole upstream table. Never publish a moisture
                # number the upstream considers unusable.
                usable = [r for r in series if (r.get("qcn") or -1) >= 1]
                cal = usable[-1] if usable else None

                doc.update({
                    "calibrated": cal is not None,
                    "device_id": newest.get("deviceId"),
                    "moisture_raw": newest.get("moistureRawPct"),
                    "rssi": newest.get("deviceRssiDbM"),
                    "battery": newest.get("miscBattPercent"),
                    "battery_poor": newest.get("miscIsBattPoorQuality"),
                    "sync_delay": newest.get("miscSensorSyncDelayHour"),
                    "next_action": (newest.get("nextAction") or "").strip(",") or None,
                    "err_code": newest.get("qcnErrCode"),
                    "raining": newest.get("isRaining"),
                    # Device clocks can run minutes ahead; clamp rather than
                    # surfacing a negative age.
                    "reading_age": max(
                        0.0, (now - newest["date"]).total_seconds() / 60.0
                    ) if newest.get("date") else None,
                })

                # Trend uses raw before calibration and the calibrated series
                # after, so the tile shows a slope from day one.
                trend_key = "moisturePct" if cal is not None else "moistureRawPct"
                doc["drying_rate"] = im.drying_rate_per_day(
                    [(r["date"], r.get(trend_key)) for r in series if r.get("date")]
                )

                if cal is not None:
                    doc.update({
                        "moisture": cal.get("moisturePct"),
                        "moisture_index": cal.get("moistureIndex"),
                        "quality": cal.get("qcn"),
                        "avg7d": cal.get("avg7dMoisturePct"),
                        "avg30d": cal.get("avg30dMoisturePct"),
                        "temp_surface": C_TO_F(cal.get("temperatureCSurface")),
                        "temp_depth1": C_TO_F(cal.get("temperatureCDepth1")),
                        "temp_depth2": C_TO_F(cal.get("temperatureCDepth2")),
                        "temp_depth3": C_TO_F(cal.get("temperatureCDepth3")),
                    })
                    # A single depth can be null on an otherwise healthy row;
                    # qcnDepthN == 0 marks it. Publish the rest regardless.
                    for i in (1, 2, 3):
                        q = cal.get(f"qcnDepth{i}")
                        doc[f"depth{i}"] = (
                            cal.get(f"moisturePctDepth{i}") if (q or 0) >= 1 else None
                        )
            else:
                doc["calibrated"] = False

            targets = [t for t in (
                [probe.get("schedule_entity")] + list(probe.get("zone_entities") or [])
            ) if t]
            last = self._store.last_run(targets) if targets else None
            doc["last_run"] = last.isoformat() if last else None
            doc["days_since_run"] = im.days_since(last, now)
            doc["skips_7d"] = None  # filled by the skip-inference layer later

            if et0_7d is not None and rain_7d is not None:
                doc["deficit"] = round(max(0.0, et0_7d - rain_7d), 2)

            out[zone_id] = doc

        return out

    # ------------------------------------------------------------- weather
    async def _async_weather_totals(self) -> tuple[float | None, float | None]:
        """7-day ET0 (in) and rainfall (in) from Tempest long-term statistics.

        Weather entities carry a `state_class`, so HA retains statistics for
        them indefinitely - unlike Rachio's switches. That is why weather needs
        no separate persistence and irrigation runs do.
        """
        if not self._weather:
            return None, None
        try:
            from homeassistant.components.recorder import get_instance
            from homeassistant.components.recorder.statistics import (
                statistics_during_period,
            )
        except ImportError:
            return None, None

        end = dt_util.utcnow()
        start = end - timedelta(days=7)
        ids = {v for v in self._weather.values() if v}
        if not ids:
            return None, None

        def _fetch():
            return statistics_during_period(
                self.hass, start, end, ids, "day",
                None, {"mean", "min", "max", "change"},
            )

        try:
            stats = await get_instance(self.hass).async_add_executor_job(_fetch)
        except Exception as err:  # noqa: BLE001 - recorder may be unavailable
            _LOGGER.debug("statistics unavailable: %s", err)
            return None, None

        rain = None
        rain_id = self._weather.get("precipitation")
        if rain_id and rain_id in stats:
            rain = round(sum(max(r.get("change") or 0.0, 0.0) for r in stats[rain_id]), 2)

        et0 = self._et0_from_stats(stats)
        return et0, rain

    def _et0_from_stats(self, stats: dict[str, list[dict[str, Any]]]) -> float | None:
        need = ("air_temperature", "relative_humidity", "wind_speed", "solar_radiation")
        ids = {k: self._weather.get(k) for k in need}
        if not all(ids.values()) or not all(i in stats for i in ids.values()):
            return None

        def day_map(sid: str) -> dict[Any, dict[str, Any]]:
            return {r["start"]: r for r in stats[sid]}

        temp = day_map(ids["air_temperature"])
        rh = day_map(ids["relative_humidity"])
        wind = day_map(ids["wind_speed"])
        solar = day_map(ids["solar_radiation"])
        dew_id = self._weather.get("dew_point")
        dew = day_map(dew_id) if dew_id and dew_id in stats else {}

        total = 0.0
        days = 0
        for day, t in temp.items():
            if day not in rh or day not in wind or day not in solar:
                continue
            t_max = t.get("max")
            t_min = t.get("min")
            t_mean = t.get("mean")
            if None in (t_max, t_min, t_mean):
                continue
            # Tempest reports degF / mph / W-m2; FAO-56 wants degC / m-s / MJ-day.
            rs_mj = (solar[day].get("mean") or 0.0) * 0.0864
            u2 = im.wind_at_2m((wind[day].get("mean") or 0.0) * im.MPH_TO_MS)
            dp = dew.get(day, {}).get("mean")
            when = day if isinstance(day, datetime) else datetime.fromtimestamp(
                float(day), tz=timezone.utc
            )
            try:
                total += im.et0_daily_inches(
                    t_mean_c=im.F_TO_C(t_mean),
                    t_min_c=im.F_TO_C(t_min),
                    t_max_c=im.F_TO_C(t_max),
                    rh_mean=rh[day].get("mean") or 50.0,
                    u2_ms=u2,
                    dewpoint_c=im.F_TO_C(dp) if dp is not None else None,
                    rs_mj=rs_mj,
                    lat_deg=self._lat,
                    elevation_m=self._elev,
                    day_of_year=when.timetuple().tm_yday,
                )
                days += 1
            except (TypeError, ValueError, ZeroDivisionError) as err:
                _LOGGER.debug("ET0 skipped for %s: %s", day, err)
        return round(total, 2) if days else None
