"""Config flow for B-Panels.

Single-instance, no user input required to install. The panel and storage are
global, so one config entry is all that's ever needed; the flow exists purely so
the integration is installable from the UI (a HACS expectation).

The OPTIONS flow carries the irrigation subsystem's configuration: a GeoDrops
service-account key and the probe->zone mapping. Both live in the config entry
(HA `.storage`) rather than on disk, so the credential is covered by HA backups
and never lands in `configuration.yaml` or a `/config/*.json` file.
"""

from __future__ import annotations

import json
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import CONF_GEODROPS_PROBES, CONF_GEODROPS_SA, DOMAIN, PANEL_TITLE

_REQUIRED_SA_KEYS = ("client_email", "private_key", "project_id")


def _validate_sa(raw: str) -> tuple[dict[str, Any] | None, str | None]:
    """Parse and sanity-check a service-account JSON blob."""
    raw = (raw or "").strip()
    if not raw:
        return None, None  # clearing the credential is allowed
    try:
        sa = json.loads(raw)
    except ValueError:
        return None, "sa_not_json"
    if not isinstance(sa, dict):
        return None, "sa_not_json"
    missing = [k for k in _REQUIRED_SA_KEYS if not sa.get(k)]
    if missing:
        return None, "sa_missing_keys"
    if sa.get("type") != "service_account":
        return None, "sa_wrong_type"
    return sa, None


def _is_sa_placeholder(raw: str) -> bool:
    """True when the submitted blob is the redacted hint we rendered."""
    raw = (raw or "").strip()
    if not raw:
        return False
    try:
        parsed = json.loads(raw)
    except ValueError:
        return False
    return isinstance(parsed, dict) and set(parsed) == {"_configured_for"}


def _validate_probes(raw: str) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Parse the probe->zone mapping.

    Expected: a JSON list of objects, each at minimum
        {"serial": "<mfgSn>", "zone_id": "front_yard", "label": "Front Yard"}
    optionally with "schedule_entity" and "zone_entities" so the tile can drive
    the right Rachio switch without a second lookup.
    """
    raw = (raw or "").strip()
    if not raw:
        return [], None
    try:
        probes = json.loads(raw)
    except ValueError:
        return None, "probes_not_json"
    if not isinstance(probes, list) or not all(isinstance(p, dict) for p in probes):
        return None, "probes_not_list"
    for p in probes:
        if not p.get("serial") or not p.get("zone_id"):
            return None, "probes_missing_keys"
    return probes, None


class BPanelsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for B-Panels."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> ConfigFlowResult:
        """Create the single config entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is None:
            return self.async_show_form(step_id="user")

        return self.async_create_entry(title=PANEL_TITLE, data={})

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> OptionsFlow:
        return BPanelsOptionsFlow()


class BPanelsOptionsFlow(OptionsFlow):
    """Irrigation subsystem options: GeoDrops credential + probe mapping."""

    async def async_step_init(self, user_input=None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        opts = self.config_entry.options

        if user_input is not None:
            raw_sa = (user_input.get(CONF_GEODROPS_SA) or "").strip()
            # The form pre-fills a redacted placeholder rather than echoing the
            # private key. Submitting it unchanged must mean "keep the existing
            # credential", not "replace it with nonsense".
            if _is_sa_placeholder(raw_sa):
                sa, sa_err = opts.get(CONF_GEODROPS_SA), None
            else:
                sa, sa_err = _validate_sa(raw_sa)
            probes, p_err = _validate_probes(user_input.get(CONF_GEODROPS_PROBES, ""))
            if sa_err:
                errors[CONF_GEODROPS_SA] = sa_err
            if p_err:
                errors[CONF_GEODROPS_PROBES] = p_err
            if not errors:
                return self.async_create_entry(
                    title="",
                    data={
                        **opts,
                        CONF_GEODROPS_SA: sa,
                        CONF_GEODROPS_PROBES: probes,
                    },
                )

        # Never echo the private key back into the form. Show a placeholder so
        # leaving the field untouched is visibly "keep existing", and an empty
        # submit clears it.
        existing_sa = opts.get(CONF_GEODROPS_SA) or {}
        sa_hint = (
            json.dumps({"_configured_for": existing_sa.get("client_email")}, indent=2)
            if existing_sa
            else ""
        )
        schema = vol.Schema(
            {
                vol.Optional(CONF_GEODROPS_SA, description={"suggested_value": sa_hint}):
                    selector.TextSelector(
                        selector.TextSelectorConfig(multiline=True)
                    ),
                vol.Optional(
                    CONF_GEODROPS_PROBES,
                    description={
                        "suggested_value": json.dumps(
                            opts.get(CONF_GEODROPS_PROBES) or [], indent=2
                        )
                    },
                ): selector.TextSelector(selector.TextSelectorConfig(multiline=True)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
