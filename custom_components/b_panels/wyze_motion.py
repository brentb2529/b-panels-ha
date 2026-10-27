"""Camera motion from Wyze's cloud event list.

Reuses the logged-in `wyzeapy` client owned by the HACS `wyzeapi` integration, so
no second login and no credentials here. One `get_event_list` call per poll
covers every camera. Optional: with no loaded `wyzeapi` entry nothing starts and
B-Panels behaves exactly as before.

`_get_event_list` is a private wyzeapy method (the integration pins
wyzeapy>=0.8,<0.9). It is the same call wyzeapy's own camera update worker
makes; if a wyzeapy release renames it the poll fails loudly (UpdateFailed) and
the sensors go unavailable rather than reading a false "clear".

Event semantics are not fully known: observed `event_value` 13 with tag 101 for
a person walking up to a Trash Cans camera. Every event wyzeapy asks for is
treated as motion, and `event_value`/`tags` are exposed as attributes so the
automation can be narrowed once the codes are mapped.
"""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    WYZE_CLIENT_KEY,
    WYZE_DOMAIN,
    WYZE_EVENT_COUNT,
    WYZE_EVENT_NAME,
    WYZE_MOTION_HOLD_SECONDS,
    WYZE_SCAN_INTERVAL_SECONDS,
)

_LOGGER = logging.getLogger(__name__)


def newest_event_by_mac(events: list[Any]) -> dict[str, dict[str, Any]]:
    """Reduce a raw event list to {mac: newest event summary}."""
    out: dict[str, dict[str, Any]] = {}
    for ev in events:
        mac = getattr(ev, "device_mac", None)
        ts = getattr(ev, "event_ts", None)
        if not mac or ts is None:
            continue
        if mac not in out or ts > out[mac]["ts"]:
            out[mac] = {
                "ts": int(ts),
                "id": getattr(ev, "event_id", None),
                "value": getattr(ev, "event_value", None),
                "tags": list(getattr(ev, "tag_list", None) or []),
            }
    return out


def motion_active(event: dict[str, Any] | None, now_ms: float,
                  hold_s: float = WYZE_MOTION_HOLD_SECONDS) -> bool:
    """True while the newest event is within the hold window.

    A future-dated event (HA clock a little behind Wyze) counts as active; only
    a genuinely old one clears.
    """
    if not event:
        return False
    return (now_ms - event["ts"]) / 1000 < hold_s


def find_wyze_client(hass: HomeAssistant) -> Any | None:
    """The first logged-in wyzeapy client from a loaded wyzeapi entry."""
    for value in (hass.data.get(WYZE_DOMAIN) or {}).values():
        if isinstance(value, dict) and value.get(WYZE_CLIENT_KEY) is not None:
            return value[WYZE_CLIENT_KEY]
    return None


class WyzeMotionCoordinator(DataUpdateCoordinator[dict[str, dict[str, Any]]]):
    """Poll Wyze's event list -> {mac: newest event}."""

    def __init__(self, hass: HomeAssistant, camera_service: Any, cameras: list[Any]) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name="b_panels_wyze_motion",
            update_interval=timedelta(seconds=WYZE_SCAN_INTERVAL_SECONDS),
        )
        self._cs = camera_service
        self.cameras = {c.mac: c for c in cameras}
        self._fired: dict[str, int] = {}
        self._primed = False

    async def _async_update_data(self) -> dict[str, dict[str, Any]]:
        from wyzeapy.types import Event

        try:
            resp = await self._cs._get_event_list(WYZE_EVENT_COUNT)
            events = [Event(e) for e in resp["data"]["event_list"]]
        except Exception as err:  # noqa: BLE001 - auth/network/schema all mean "can't tell"
            raise UpdateFailed(f"Wyze event poll failed: {err}") from err

        latest = newest_event_by_mac(events)
        self._fire_new(latest)
        return latest

    def _fire_new(self, latest: dict[str, dict[str, Any]]) -> None:
        """Fire one bus event per new Wyze event. The first poll only primes."""
        for mac, ev in latest.items():
            cam = self.cameras.get(mac)
            if cam is None:
                continue
            if self._fired.get(mac, 0) >= ev["ts"]:
                continue
            self._fired[mac] = ev["ts"]
            if not self._primed:
                continue
            self.hass.bus.async_fire(WYZE_EVENT_NAME, {
                "mac": mac,
                "camera": (cam.nickname or "").strip(),
                "event_value": ev["value"],
                "tags": ev["tags"],
                "event_ts": ev["ts"],
            })
        self._primed = True

    @staticmethod
    def now_ms() -> float:
        return time.time() * 1000
