"""Per-camera Wyze motion binary sensors (see wyze_motion.py)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .wyze_motion import WyzeMotionCoordinator, motion_active


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: WyzeMotionCoordinator | None = hass.data.get(DOMAIN, {}).get("wyze_motion")
    if coordinator is None:
        return
    async_add_entities(
        WyzeMotionSensor(coordinator, mac) for mac in coordinator.cameras
    )


class WyzeMotionSensor(CoordinatorEntity[WyzeMotionCoordinator], BinarySensorEntity):
    """On while the camera's newest Wyze event is under the hold window old."""

    _attr_has_entity_name = True
    _attr_name = "Motion"
    _attr_device_class = BinarySensorDeviceClass.MOTION

    def __init__(self, coordinator: WyzeMotionCoordinator, mac: str) -> None:
        super().__init__(coordinator)
        self._mac = mac
        cam = coordinator.cameras[mac]
        self._attr_unique_id = f"{DOMAIN}_wyze_motion_{mac}"
        # Own device (not wyzeapi's) so a wyzeapi cleanup can never drop it.
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"wyze_{mac}")},
            "name": (cam.nickname or mac).strip(),
            "manufacturer": "WyzeLabs",
            "model": getattr(cam, "product_model", None),
        }

    @property
    def _event(self) -> dict[str, Any] | None:
        return (self.coordinator.data or {}).get(self._mac)

    @property
    def is_on(self) -> bool:
        return motion_active(self._event, self.coordinator.now_ms())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        ev = self._event
        if not ev:
            return {}
        return {
            "last_event": datetime.fromtimestamp(ev["ts"] / 1000, tz=timezone.utc).isoformat(),
            "event_value": ev["value"],
            "tags": ev["tags"],
        }
