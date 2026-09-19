"""Irrigation analysis: reference ET and soil-trend math.

Kept free of Home Assistant imports so it is unit-testable in isolation.

ET0 is FAO-56 Penman-Monteith (Allen et al., 1998), daily form. Every input is
available from the Tempest station and — importantly — every one of those
entities carries a `state_class`, so Home Assistant keeps LONG-TERM STATISTICS
for them. Rachio's switches do not, which is why irrigation runs need separate
persistence while weather does not.

    air temperature      sensor.*_air_temperature        degF
    relative humidity    sensor.*_relative_humidity      %
    wind speed           sensor.*_wind_speed             mph  -> u2 at 2 m
    solar radiation      sensor.*_solar_radiation        W/m2 -> MJ/m2/day
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Iterable, Sequence

# Station height above ground for the Tempest anemometer (m). FAO-56 wants wind
# at 2 m; a Tempest on a typical pole sits higher, so we correct.
DEFAULT_ANEMOMETER_HEIGHT_M = 2.0

F_TO_C = lambda f: (f - 32.0) * 5.0 / 9.0          # noqa: E731
MPH_TO_MS = 0.44704
MM_TO_IN = 0.0393701


def wind_at_2m(u_ms: float, height_m: float = DEFAULT_ANEMOMETER_HEIGHT_M) -> float:
    """FAO-56 eq.47 logarithmic wind-profile correction."""
    if height_m <= 0 or abs(height_m - 2.0) < 1e-6:
        return u_ms
    return u_ms * 4.87 / math.log(67.8 * height_m - 5.42)


def svp_kpa(t_c: float) -> float:
    """Saturation vapour pressure (FAO-56 eq.11), kPa."""
    return 0.6108 * math.exp(17.27 * t_c / (t_c + 237.3))


def svp_slope(t_c: float) -> float:
    """Slope of the SVP curve (FAO-56 eq.13), kPa/degC."""
    return 4098.0 * svp_kpa(t_c) / ((t_c + 237.3) ** 2)


def psychrometric_kpa(elevation_m: float) -> float:
    """FAO-56 eq.7/8: atmospheric pressure -> psychrometric constant, kPa/degC."""
    p = 101.3 * ((293.0 - 0.0065 * elevation_m) / 293.0) ** 5.26
    return 0.000665 * p


def extraterrestrial_radiation(lat_deg: float, day_of_year: int) -> float:
    """Ra, MJ/m2/day (FAO-56 eq.21). Used only to bound net longwave."""
    phi = math.radians(lat_deg)
    dr = 1.0 + 0.033 * math.cos(2.0 * math.pi * day_of_year / 365.0)
    decl = 0.409 * math.sin(2.0 * math.pi * day_of_year / 365.0 - 1.39)
    x = -math.tan(phi) * math.tan(decl)
    x = max(-1.0, min(1.0, x))
    ws = math.acos(x)
    return (24.0 * 60.0 / math.pi) * 0.0820 * dr * (
        ws * math.sin(phi) * math.sin(decl)
        + math.cos(phi) * math.cos(decl) * math.sin(ws)
    )


def et0_daily(
    *,
    t_mean_c: float,
    t_min_c: float,
    t_max_c: float,
    rh_mean: float,
    u2_ms: float,
    dewpoint_c: float | None = None,
    rs_mj: float,
    lat_deg: float,
    elevation_m: float,
    day_of_year: int,
    albedo: float = 0.23,
) -> float:
    """FAO-56 Penman-Monteith reference ET, mm/day."""
    delta = svp_slope(t_mean_c)
    gamma = psychrometric_kpa(elevation_m)

    es = (svp_kpa(t_max_c) + svp_kpa(t_min_c)) / 2.0
    # FAO-56 ranks ea sources: dewpoint (eq.14) is preferred over RHmean
    # (eq.19), which carries noticeably more error. The Tempest publishes
    # dew_point directly, so prefer it and fall back to RH only if absent.
    if dewpoint_c is not None:
        ea = svp_kpa(dewpoint_c)
    else:
        ea = es * max(0.0, min(100.0, rh_mean)) / 100.0
    ea = min(ea, es)
    vpd = max(0.0, es - ea)

    ra = extraterrestrial_radiation(lat_deg, day_of_year)
    rso = (0.75 + 2e-5 * elevation_m) * ra          # clear-sky radiation
    rns = (1.0 - albedo) * rs_mj

    tmaxk = (t_max_c + 273.16) ** 4
    tmink = (t_min_c + 273.16) ** 4
    cloud = 1.35 * (rs_mj / rso if rso > 0 else 0.0) - 0.35
    cloud = max(0.05, min(1.0, cloud))
    rnl = 4.903e-9 * ((tmaxk + tmink) / 2.0) * (0.34 - 0.14 * math.sqrt(max(ea, 0.0))) * cloud
    rn = max(0.0, rns - rnl)

    num = 0.408 * delta * rn + gamma * (900.0 / (t_mean_c + 273.0)) * u2_ms * vpd
    den = delta + gamma * (1.0 + 0.34 * u2_ms)
    return max(0.0, num / den) if den else 0.0


def et0_daily_inches(**kwargs) -> float:
    return et0_daily(**kwargs) * MM_TO_IN


def drying_rate_per_day(samples: Sequence[tuple[datetime, float]],
                        min_points: int = 4) -> float | None:
    """Slope of the CURRENT DRYING LIMB, points/day (negative = drying).

    Soil moisture is a sawtooth: it steps up sharply when rain or irrigation
    arrives, then decays slowly. Fitting a line across a wetting event measures
    the step, not the drying - on real data a probe that went 0.6 -> 68.9 at
    install produced +12.7 pts/day, which reads as "rapidly wetting" for soil
    that is in fact drying out.

    So we fit only the samples from the most recent maximum onward. If that
    limb is too short to be meaningful (just after a wetting event) we return
    None rather than a number the caller would have to distrust.

    A least-squares slope is used rather than (first - last) / span because
    readings are noisy and a single spurious endpoint would otherwise dominate.
    """
    pts = [(t, v) for t, v in samples if v is not None]
    if len(pts) < min_points:
        return None
    pts.sort(key=lambda p: p[0])
    peak_idx = max(range(len(pts)), key=lambda i: pts[i][1])
    limb = pts[peak_idx:]
    if len(limb) < min_points:
        return None
    pts = limb
    t0 = pts[0][0]
    xs = [(t - t0).total_seconds() / 86400.0 for t, _ in pts]
    ys = [v for _, v in pts]
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    if den <= 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def days_since(ts: datetime | None, now: datetime | None = None) -> float | None:
    if ts is None:
        return None
    now = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0.0, (now - ts).total_seconds() / 86400.0)


def sum_recent(values: Iterable[tuple[datetime, float]], days: float,
               now: datetime | None = None) -> float:
    """Sum values whose timestamp falls within the trailing `days` window."""
    now = now or datetime.now(timezone.utc)
    lo = now - timedelta(days=days)
    return sum(v for t, v in values if v is not None and t >= lo)
