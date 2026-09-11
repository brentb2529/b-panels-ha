"""Irrigation sensor entities.

Every entity is stamped with `bp_irrigation_zone` and `bp_irrigation_field` so
the SPA can regroup them into per-zone documents. It deliberately does NOT key
on entity_id or friendly_name: both move when a device is renamed or reassigned
to an area. Same contract the Generator tile uses for EnergyTrak.

Entities are created for every configured probe regardless of calibration
state, because a probe publishes health telemetry for days before it publishes
a usable moisture reading. A missing reading is reported as unknown, never as
zero - a fabricated zero is worse than an honest gap, and on this system it
would read as "bone dry" and could trigger watering.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    PERCENTAGE,
    SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    UnitOfTemperature,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    ATTR_IRR_FIELD,
    ATTR_IRR_LABEL,
    ATTR_IRR_SCHEDULE_ENTITY,
    ATTR_IRR_ZONE,
    ATTR_IRR_ZONE_ENTITIES,
    DOMAIN,
)
from .irrigation_coordinator import IrrigationCoordinator

MEASUREMENT = SensorStateClass.MEASUREMENT


@dataclass(frozen=True, kw_only=True)
class IrrigationSensorDescription(SensorEntityDescription):
    """A field of the per-zone document."""

    field: str
    value: Callable[[dict[str, Any]], Any] = None  # type: ignore[assignment]


def _get(field: str) -> Callable[[dict[str, Any]], Any]:
    return lambda doc: doc.get(field)


SENSORS: tuple[IrrigationSensorDescription, ...] = (
    # --- soil profile (present only once calibrated) -----------------------
    IrrigationSensorDescription(
        key="moisture", field="moisture", name="Soil moisture",
        native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        icon="mdi:water-percent", value=_get("moisture"),
    ),
    IrrigationSensorDescription(
        key="moisture_index", field="moisture_index", name="Moisture index",
        state_class=MEASUREMENT, icon="mdi:gauge", value=_get("moisture_index"),
    ),
    IrrigationSensorDescription(
        key="depth1", field="depth1", name="Soil moisture depth 1",
        native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        icon="mdi:layers", value=_get("depth1"),
    ),
    IrrigationSensorDescription(
        key="depth2", field="depth2", name="Soil moisture depth 2",
        native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        icon="mdi:layers", value=_get("depth2"),
    ),
    IrrigationSensorDescription(
        key="depth3", field="depth3", name="Soil moisture depth 3",
        native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        icon="mdi:layers", value=_get("depth3"),
    ),
    IrrigationSensorDescription(
        key="temp_surface", field="temp_surface", name="Soil temperature surface",
        native_unit_of_measurement=UnitOfTemperature.FAHRENHEIT,
        device_class=SensorDeviceClass.TEMPERATURE, state_class=MEASUREMENT,
        value=_get("temp_surface"),
    ),
    IrrigationSensorDescription(
        key="temp_depth3", field="temp_depth3", name="Soil temperature depth 3",
        native_unit_of_measurement=UnitOfTemperature.FAHRENHEIT,
        device_class=SensorDeviceClass.TEMPERATURE, state_class=MEASUREMENT,
        value=_get("temp_depth3"),
    ),
    IrrigationSensorDescription(
        key="avg7d", field="avg7d", name="Soil moisture 7d average",
        native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        icon="mdi:chart-line", value=_get("avg7d"),
    ),
    # --- always available, calibrated or not -------------------------------
    IrrigationSensorDescription(
        key="moisture_raw", field="moisture_raw", name="Soil moisture raw",
        native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        icon="mdi:water-outline",
        value=_get("moisture_raw"),
    ),
    IrrigationSensorDescription(
        key="drying_rate", field="drying_rate", name="Drying rate",
        native_unit_of_measurement="pts/d", state_class=MEASUREMENT,
        icon="mdi:trending-down",
        value=lambda d: None if d.get("drying_rate") is None else round(d["drying_rate"], 2),
    ),
    IrrigationSensorDescription(
        key="days_since_run", field="days_since_run", name="Days since watered",
        native_unit_of_measurement=UnitOfTime.DAYS, state_class=MEASUREMENT,
        icon="mdi:calendar-clock",
        value=lambda d: None if d.get("days_since_run") is None else round(d["days_since_run"], 2),
    ),
    IrrigationSensorDescription(
        key="et0_7d", field="et0_7d", name="ET0 7 day",
        native_unit_of_measurement="in", state_class=MEASUREMENT,
        icon="mdi:weather-sunny", value=_get("et0_7d"),
    ),
    IrrigationSensorDescription(
        key="rain_7d", field="rain_7d", name="Rainfall 7 day",
        native_unit_of_measurement="in", state_class=MEASUREMENT,
        icon="mdi:weather-pouring", value=_get("rain_7d"),
    ),
    IrrigationSensorDescription(
        key="deficit", field="deficit", name="Water deficit 7 day",
        native_unit_of_measurement="in", state_class=MEASUREMENT,
        icon="mdi:scale-balance", value=_get("deficit"),
    ),
    # --- probe health ------------------------------------------------------
    IrrigationSensorDescription(
        key="battery", field="battery", name="Probe battery",
        native_unit_of_measurement=PERCENTAGE,
        device_class=SensorDeviceClass.BATTERY, state_class=MEASUREMENT,
        value=_get("battery"),
    ),
    IrrigationSensorDescription(
        key="rssi", field="rssi", name="Probe signal",
        native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
        device_class=SensorDeviceClass.SIGNAL_STRENGTH, state_class=MEASUREMENT,
        entity_registry_enabled_default=False, value=_get("rssi"),
    ),
    IrrigationSensorDescription(
        key="reading_age", field="reading_age", name="Reading age",
        native_unit_of_measurement=UnitOfTime.MINUTES, state_class=MEASUREMENT,
        icon="mdi:clock-alert-outline",
        value=lambda d: None if d.get("reading_age") is None else round(d["reading_age"]),
    ),
    IrrigationSensorDescription(
        key="next_action", field="next_action", name="Probe status",
        icon="mdi:information-outline", value=_get("next_action"),
    ),
    IrrigationSensorDescription(
        key="quality", field="quality", name="Reading quality",
        state_class=MEASUREMENT, icon="mdi:check-decagram",
        entity_registry_enabled_default=False, value=_get("quality"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: IrrigationCoordinator | None = (
        hass.data.get(DOMAIN, {}).get("irrigation_coordinator")
    )
    if coordinator is None or not coordinator.data:
        return
    entities = [
        IrrigationSensor(coordinator, zone_id, desc)
        for zone_id in coordinator.data
        for desc in SENSORS
    ]
    async_add_entities(entities)


class IrrigationSensor(CoordinatorEntity[IrrigationCoordinator], SensorEntity):
    """One field of one zone."""

    _attr_has_entity_name = True
    entity_description: IrrigationSensorDescription

    def __init__(
        self,
        coordinator: IrrigationCoordinator,
        zone_id: str,
        description: IrrigationSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._zone_id = zone_id
        self._attr_unique_id = f"{DOMAIN}_irrigation_{zone_id}_{description.key}"

    @property
    def _doc(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self._zone_id) or {}

    @property
    def name(self) -> str:
        label = self._doc.get("label") or self._zone_id
        return f"{label} {self.entity_description.name}"

    @property
    def available(self) -> bool:
        # The zone document existing is enough. An individual field being
        # absent (uncalibrated probe, null depth) is reported as unknown state
        # rather than by marking the entity unavailable - otherwise the whole
        # tile would blink out during the multi-day calibration window.
        return super().available and bool(self._doc)

    @property
    def native_value(self) -> Any:
        return self.entity_description.value(self._doc)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        doc = self._doc
        attrs: dict[str, Any] = {
            ATTR_IRR_ZONE: self._zone_id,
            ATTR_IRR_FIELD: self.entity_description.field,
            ATTR_IRR_LABEL: doc.get("label") or self._zone_id,
        }
        if doc.get("schedule_entity"):
            attrs[ATTR_IRR_SCHEDULE_ENTITY] = doc["schedule_entity"]
        if doc.get("zone_entities"):
            attrs[ATTR_IRR_ZONE_ENTITIES] = doc["zone_entities"]
        # Carry provenance on the headline sensor so the tile can explain a
        # missing reading instead of just showing a blank.
        if self.entity_description.key == "moisture":
            attrs["calibrated"] = doc.get("calibrated")
            attrs["serial"] = doc.get("serial")
            attrs["last_run"] = doc.get("last_run")
        return attrs

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
