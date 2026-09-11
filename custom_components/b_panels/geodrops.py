"""GeoDrops soil-probe reader — BigQuery over REST, no third-party SDK.

GeoDrops sensors have NO local/LAN interface. The vendor's sanctioned API is
their public BigQuery dataset ("access our BigQuery programming API directly").
The community integration path uses google-cloud-bigquery inside AppDaemon plus
an MQTT hop; we deliberately avoid both. `google-cloud-bigquery` is a heavy,
*blocking* dependency that would need executor juggling inside HA's event loop,
and it is not present in the HA image. Everything below is built from libraries
Home Assistant already ships:

    PyJWT + cryptography   sign the service-account assertion
    aiohttp                token exchange + query, natively async

So this adds ZERO requirements to manifest.json and runs on HA OS unchanged.

Data-shape notes earned from 384,937 rows across 166 devices — see also
docs/GEODROPS.md:
  * `date` is the true reading time on a 30-minute grid. `createdAtOrigin` is a
    BATCH marker, identical for every row of a batch; never order or key on it.
  * Rows are REWRITTEN IN PLACE — nulls get backfilled hours later — so always
    re-read a trailing window rather than appending past a high-water mark.
  * `qcn >= 1` is exactly equivalent to `moisturePct IS NOT NULL`, with zero
    exceptions table-wide. That is the usable-reading gate.
  * A single depth may be null on an otherwise healthy row; `qcnDepthN == 0`
    marks it. Publish the rest of the row anyway.
  * Device clocks can run a few minutes ahead of ours; never reject a
    future-dated row (clamp the age instead).
  * `moisturePct` is a calibrated transform of `moistureRawPct` (raw 69 -> 86),
    so thresholds belong on moisturePct, never raw.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import time
from typing import Any

import aiohttp
import jwt

_LOGGER = logging.getLogger(__name__)

TABLE = "geodrops-prod.db_public.p_sensor_unified"
TOKEN_URI = "https://oauth2.googleapis.com/token"
BQ_QUERY_URL = "https://bigquery.googleapis.com/bigquery/v2/projects/{project}/queries"
SCOPE = "https://www.googleapis.com/auth/bigquery.readonly"

# Trailing re-read window. It serves two purposes and the wider one wins:
#   1. Backfill. Rows are rewritten in place, so we must re-read far enough
#      back to pick up nulls that have since been filled. A batch delivers ~6
#      readings at once with the oldest ~3h old, so 6h would suffice alone.
#   2. Trend. The drying rate is a least-squares slope over this window, and 6h
#      of a 30-minute grid is only ~12 points - short enough that normal diurnal
#      movement dominates and the slope can come out POSITIVE on soil that is
#      steadily drying. 48h spans two full day/night cycles and yields a stable
#      rate consistent with what the same data shows over multi-day spans.
# Cost is unchanged in practice: the partition filter below still prunes to 2
# days, so the bytes scanned are the same.
LOOKBACK_HOURS = 48
PARTITION_DAYS = 2          # prunes partitions; keeps each poll ~10 MB
_TOKEN_SKEW = 60            # refresh this many seconds before expiry

SQL = f"""
SELECT mfgSn, deviceId, date,
       moisturePct, moistureRawPct, moistureIndex,
       moisturePctDepth1, moisturePctDepth2, moisturePctDepth3,
       qcn, qcnDepth1, qcnDepth2, qcnDepth3, qcnErrCode,
       temperatureCSurface, temperatureCDepth1, temperatureCDepth2, temperatureCDepth3,
       avg7dMoisturePct, avg30dMoisturePct,
       isRaining, weatherPrecipMmHr,
       deviceRssiDbM, miscBattPercent, miscIsBattPoorQuality,
       miscSensorSyncDelayHour, nextAction
FROM `{TABLE}`
WHERE mfgSn IN UNNEST(@sn)
  AND createdAtOrigin >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @pdays DAY)
  AND date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
ORDER BY mfgSn, date
"""


class GeoDropsError(Exception):
    """Raised for auth/query failures so the coordinator can mark unavailable."""


class GeoDropsClient:
    """Minimal async BigQuery reader for the GeoDrops public dataset."""

    def __init__(self, session: aiohttp.ClientSession, service_account: dict[str, Any]):
        self._session = session
        self._sa = service_account
        self._project = service_account.get("project_id")
        self._token: str | None = None
        self._token_exp: float = 0.0
        self._lock = asyncio.Lock()

    # ---------------------------------------------------------------- auth
    def _signed_assertion(self) -> str:
        """Build the RS256 JWT the token endpoint exchanges for a bearer token.

        Signing is CPU-bound but sub-millisecond, so it stays on the loop
        rather than paying for an executor round-trip.
        """
        now = int(time.time())
        claims = {
            "iss": self._sa["client_email"],
            "scope": SCOPE,
            "aud": self._sa.get("token_uri", TOKEN_URI),
            "iat": now,
            "exp": now + 3600,
        }
        return jwt.encode(claims, self._sa["private_key"], algorithm="RS256")

    async def _access_token(self) -> str:
        async with self._lock:
            if self._token and time.time() < self._token_exp - _TOKEN_SKEW:
                return self._token
            data = {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": self._signed_assertion(),
            }
            async with self._session.post(
                self._sa.get("token_uri", TOKEN_URI), data=data,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                body = await resp.json(content_type=None)
                if resp.status != 200:
                    raise GeoDropsError(
                        f"token exchange failed {resp.status}: "
                        f"{body.get('error_description') or body}"
                    )
            self._token = body["access_token"]
            self._token_exp = time.time() + int(body.get("expires_in", 3600))
            return self._token

    # --------------------------------------------------------------- query
    @staticmethod
    def _coerce(value: str | None, bq_type: str) -> Any:
        """BigQuery REST returns every cell as a string (or null)."""
        if value is None:
            return None
        t = bq_type.upper()
        try:
            if t in ("INTEGER", "INT64"):
                return int(value)
            if t in ("FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"):
                return float(value)
            if t in ("BOOLEAN", "BOOL"):
                return value.lower() == "true"
            if t == "TIMESTAMP":
                # epoch seconds, possibly fractional
                return datetime.datetime.fromtimestamp(
                    float(value), tz=datetime.timezone.utc
                )
        except (TypeError, ValueError):
            return None
        return value

    async def query(self, sql: str, params: list[dict[str, Any]] | None = None,
                    timeout_ms: int = 30000) -> list[dict[str, Any]]:
        token = await self._access_token()
        payload: dict[str, Any] = {
            "query": sql,
            "useLegacySql": False,
            "timeoutMs": timeout_ms,
        }
        if params:
            payload["parameterMode"] = "NAMED"
            payload["queryParameters"] = params

        url = BQ_QUERY_URL.format(project=self._project)
        async with self._session.post(
            url, json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=aiohttp.ClientTimeout(total=timeout_ms / 1000 + 15),
        ) as resp:
            body = await resp.json(content_type=None)
            if resp.status != 200:
                err = (body.get("error") or {}).get("message") or body
                raise GeoDropsError(f"query failed {resp.status}: {err}")

        if not body.get("jobComplete", False):
            raise GeoDropsError("query did not complete within timeoutMs")

        fields = (body.get("schema") or {}).get("fields") or []
        names = [f["name"] for f in fields]
        types = [f.get("type", "STRING") for f in fields]
        out: list[dict[str, Any]] = []
        for row in body.get("rows") or []:
            cells = row.get("f") or []
            out.append({
                names[i]: self._coerce(cells[i].get("v"), types[i])
                for i in range(min(len(names), len(cells)))
            })
        bytes_billed = int(body.get("totalBytesBilled") or 0)
        _LOGGER.debug("GeoDrops query: %d rows, %.1f MB billed",
                      len(out), bytes_billed / 1e6)
        return out

    async def fetch_readings(self, serials: list[str]) -> list[dict[str, Any]]:
        """Raw rows for the trailing window, oldest first per serial."""
        if not serials:
            return []
        params = [
            {"name": "sn", "parameterType": {"type": "ARRAY",
                                             "arrayType": {"type": "STRING"}},
             "parameterValue": {"arrayValues": [{"value": s} for s in serials]}},
            {"name": "hours", "parameterType": {"type": "INT64"},
             "parameterValue": {"value": str(LOOKBACK_HOURS)}},
            {"name": "pdays", "parameterType": {"type": "INT64"},
             "parameterValue": {"value": str(PARTITION_DAYS)}},
        ]
        return await self.query(SQL, params)
