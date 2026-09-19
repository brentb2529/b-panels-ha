"""Durable Rachio irrigation-run history.

WHY THIS EXISTS: Rachio zone/schedule entities are plain switches with no
`state_class`, so Home Assistant keeps **no long-term statistics** for them.
A run exists only as a recorder state change and disappears at the purge
horizon (10 days on this system). Irrigation history cannot be reconstructed
afterwards, and without it you cannot separate soil response to rain from soil
response to watering — which is the whole point of the analysis.

So we listen to state changes ourselves and persist completed runs to HA's
`Store` (`.storage`), which is backup-covered and immune to recorder purge.

A restart mid-run loses only that run's start; we tolerate that rather than
persisting on every state change, because writes are the expensive part and a
single missed run is far cheaper than constant I/O.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    IRRIGATION_RUN_RETENTION_DAYS,
    IRRIGATION_STORAGE_KEY,
    IRRIGATION_STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

_IGNORE = {"unavailable", "unknown"}


class IrrigationRunStore:
    """Capture and persist Rachio zone/schedule runs."""

    def __init__(self, hass: HomeAssistant, entity_prefix: str = "switch.") -> None:
        self._hass = hass
        self._store: Store = Store(hass, IRRIGATION_STORAGE_VERSION, IRRIGATION_STORAGE_KEY)
        self._runs: list[dict[str, Any]] = []
        self._open: dict[str, datetime] = {}
        self._unsub = None
        self._entity_prefix = entity_prefix
        self._dirty = False

    # ------------------------------------------------------------- lifecycle
    async def async_load(self) -> None:
        data = await self._store.async_load()
        if isinstance(data, dict):
            self._runs = list(data.get("runs") or [])
        self._prune()
        _LOGGER.debug("irrigation store loaded: %d runs", len(self._runs))

    async def async_start(self, entity_ids: list[str]) -> None:
        """Begin tracking. Safe to call again with a new entity list."""
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not entity_ids:
            _LOGGER.debug("irrigation store: no entities to track")
            return
        self._unsub = async_track_state_change_event(
            self._hass, entity_ids, self._handle
        )
        _LOGGER.debug("irrigation store tracking %d entities", len(entity_ids))

    async def async_stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if self._dirty:
            await self.async_save()

    # ---------------------------------------------------------------- capture
    @callback
    def _handle(self, event: Event[EventStateChangedData]) -> None:
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if new is None:
            return
        eid = new.entity_id
        new_s = (new.state or "").lower()
        old_s = (old.state or "").lower() if old else None

        # unavailable/unknown are transport noise, not state transitions; a
        # reload would otherwise close every open run with a bogus duration.
        if new_s in _IGNORE:
            return

        if new_s == "on" and old_s != "on":
            self._open[eid] = new.last_changed or datetime.now(timezone.utc)
            return

        if new_s == "off" and old_s == "on":
            start = self._open.pop(eid, None)
            if start is None:
                return
            end = new.last_changed or datetime.now(timezone.utc)
            minutes = (end - start).total_seconds() / 60.0
            if minutes <= 0:
                return
            self._append({
                "entity_id": eid,
                "name": eid.split(".", 1)[-1],
                "is_schedule": "schedule" in eid,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "minutes": round(minutes, 1),
            })

    def _append(self, run: dict[str, Any]) -> None:
        key = (run["entity_id"], run["start"])
        if any((r["entity_id"], r["start"]) == key for r in self._runs[-50:]):
            return
        self._runs.append(run)
        self._dirty = True
        self._hass.async_create_task(self.async_save())

    # ------------------------------------------------------------------ read
    def runs_for(self, entity_ids: list[str], days: float | None = None
                 ) -> list[dict[str, Any]]:
        want = set(entity_ids)
        lo = (datetime.now(timezone.utc) - timedelta(days=days)) if days else None
        out = []
        for r in self._runs:
            if r["entity_id"] not in want:
                continue
            if lo is not None and _parse(r["start"]) < lo:
                continue
            out.append(r)
        return out

    def last_run(self, entity_ids: list[str]) -> datetime | None:
        runs = self.runs_for(entity_ids)
        if not runs:
            return None
        return max(_parse(r["start"]) for r in runs)

    # ----------------------------------------------------------------- write
    async def async_save(self) -> None:
        self._prune()
        await self._store.async_save({"runs": self._runs})
        self._dirty = False

    async def async_seed(self, runs: list[dict[str, Any]]) -> int:
        """Merge externally-rescued runs (e.g. a pre-deploy recorder export).

        Deduped on (entity_id, start), so re-seeding is harmless.
        """
        have = {(r["entity_id"], r["start"]) for r in self._runs}
        added = 0
        for r in runs:
            key = (r.get("entity_id"), r.get("start"))
            if not all(key) or key in have:
                continue
            self._runs.append(r)
            have.add(key)
            added += 1
        if added:
            self._runs.sort(key=lambda r: r["start"])
            await self.async_save()
        return added

    def _prune(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=IRRIGATION_RUN_RETENTION_DAYS)
        before = len(self._runs)
        self._runs = [r for r in self._runs if _parse(r["start"]) >= cutoff]
        self._runs.sort(key=lambda r: r["start"])
        if len(self._runs) != before:
            self._dirty = True


def _parse(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
