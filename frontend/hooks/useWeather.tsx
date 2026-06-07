
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IconSun, IconCloud, IconCloudRain, IconCloudSnow, IconCloudLightning, IconCloudSun } from '../components/icons';
import { useDashboard } from './useDashboard';
import * as haClient from '../services/haClient';
import { WeatherData, ForecastDay } from '../types';

// HA weather `condition` string -> description + icon (parity with the Tempest
// display in the original). Mirrors mapWeatherCode but for HA's condition enum.
const mapHaCondition = (cond: string): { description: string; icon: React.ReactNode } => {
  const p = { className: 'w-6 h-6 text-white' };
  switch ((cond || '').toLowerCase()) {
    case 'sunny': case 'clear-night': return { description: 'Clear', icon: <IconSun {...p} /> };
    case 'partlycloudy': return { description: 'Partly cloudy', icon: <IconCloudSun {...p} /> };
    case 'cloudy': return { description: 'Cloudy', icon: <IconCloud {...p} /> };
    case 'fog': return { description: 'Fog', icon: <IconCloud {...p} /> };
    case 'rainy': case 'pouring': return { description: 'Rain', icon: <IconCloudRain {...p} /> };
    case 'snowy': case 'snowy-rainy': return { description: 'Snow', icon: <IconCloudSnow {...p} /> };
    case 'lightning': case 'lightning-rainy': return { description: 'Thunderstorm', icon: <IconCloudLightning {...p} /> };
    case 'windy': case 'windy-variant': return { description: 'Windy', icon: <IconCloudSun {...p} /> };
    default: return { description: cond ? cond.charAt(0).toUpperCase() + cond.slice(1) : 'Cloudy', icon: <IconCloud {...p} /> };
  }
};

const WEATHER_CACHE_KEY = 'homeTileWeatherCache';
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// WeatherFlow/Tempest LOCAL (UDP) devices expose NO weather entity — only sensors
// named sensor.<st|sk|ar>_<serial>_<measure> (st = Tempest, sk = Sky, ar = Air).
// To show hyperlocal CURRENT conditions in the header (temp + real-time activity
// like lightning/rain that a cloud forecast can't see), we read those sensors
// directly. Returns null when no local station is present (then we keep the cloud
// weather entity's current). Detected by the serial-named air_temperature sensor
// (device_class temperature) — no attribution exists on local UDP sensors.
export const readLocalTempest = (states: any[]) => {
  const tempSensor = (states || []).find(s =>
    /^sensor\.(st|sk|ar)_\d+_air_temperature$/.test(s.entity_id) &&
    s.attributes?.device_class === 'temperature' &&
    s.state !== 'unavailable' && s.state !== 'unknown');
  if (!tempSensor) return null;
  const prefix = tempSensor.entity_id.replace(/air_temperature$/, ''); // sensor.st_<serial>_
  const byId: Record<string, any> = {};
  for (const s of states) if (s.entity_id.startsWith(prefix)) byId[s.entity_id] = s;
  const num = (m: string) => { const v = parseFloat(byId[prefix + m]?.state); return Number.isFinite(v) ? v : undefined; };
  const raw = (m: string) => byId[prefix + m]?.state;
  const temperature = num('air_temperature');
  if (temperature === undefined) return null;
  return {
    temperature,
    humidity: num('relative_humidity'),
    windSpeed: num('wind_speed'),
    windGust: num('wind_gust'),
    uvIndex: num('uv_index'),
    lightningCount: num('lightning_count'),
    precipType: raw('precipitation_type'),          // 'none' | 'rain' | 'hail'
    precipIntensity: num('precipitation_intensity'),
  };
};

// WMO Weather interpretation codes mapping (for Open-Meteo fallback)
const mapWeatherCode = (code: number): { description: string; icon: React.ReactNode } => {
  const iconProps = { className: "w-6 h-6 text-white" };
  switch (code) {
    case 0: return { description: 'Clear sky', icon: <IconSun {...iconProps} /> };
    case 1:
    case 2:
    case 3: return { description: 'Partly cloudy', icon: <IconCloudSun {...iconProps} /> };
    case 45:
    case 48: return { description: 'Fog', icon: <IconCloud {...iconProps} /> };
    case 51:
    case 53:
    case 55:
    case 56:
    case 57: return { description: 'Drizzle', icon: <IconCloudRain {...iconProps} /> };
    case 61:
    case 63:
    case 65:
    case 66:
    case 67: return { description: 'Rain', icon: <IconCloudRain {...iconProps} /> };
    case 71:
    case 73:
    case 75:
    case 77: return { description: 'Snow', icon: <IconCloudSnow {...iconProps} /> };
    case 80:
    case 81:
    case 82: return { description: 'Rain showers', icon: <IconCloudRain {...iconProps} /> };
    case 85:
    case 86: return { description: 'Snow showers', icon: <IconCloudSnow {...iconProps} /> };
    case 95:
    case 96:
    case 99: return { description: 'Thunderstorm', icon: <IconCloudLightning {...iconProps} /> };
    default: return { description: 'Cloudy', icon: <IconCloud {...iconProps} /> };
  }
};

const buildWeatherDataFromCache = (cachedData: any): WeatherData => {
    const { icon: currentIcon } = mapWeatherCode(cachedData.current.weather_code);
    const forecast = cachedData.forecast.map((day: any) => ({
        ...day,
        icon: mapWeatherCode(day.weather_code).icon,
    }));

    return {
        temperature: cachedData.current.temperature,
        description: cachedData.current.description,
        icon: currentIcon,
        forecast,
        sunrise: cachedData.daily?.sunrise,
        sunset: cachedData.daily?.sunset,
    };
};


export const useWeather = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Once we've ever loaded weather, keep showing the last-known value through
  // transient refresh failures instead of flashing "Weather unavailable".
  const hasDataRef = useRef(false);
  const [isTempest, setIsTempest] = useState(false);
  // lightning_count is cumulative; remember the last count + when it last rose so
  // we only show "lightning" for a window after a real strike, not all day.
  const lightningRef = useRef<{ count: number; since: number } | null>(null);
  const { weatherZipCode, weatherEntityId } = useDashboard();

  // Prefer a Home Assistant weather entity (e.g. a Tempest station) — the
  // user's real local weather — over the Open-Meteo fallback.
  const fetchFromHa = useCallback(async (): Promise<WeatherData | null> => {
    let states: any[];
    try { states = await haClient.getStates(); } catch { return null; }
    const weatherEnts = (states || []).filter(s => s.entity_id.startsWith('weather.'));
    if (!weatherEnts.length) return null;
    // A weather entity is only usable if it's actually reporting — a station that
    // has gone 'unavailable'/'unknown' (e.g. a Tempest that dropped offline) has
    // no temperature, which previously surfaced as a bogus 0°. So we prefer
    // usable entities and gracefully fall back, instead of blindly using the
    // selected one. Order of preference:
    //   1) the explicitly-selected entity, IF usable
    //   2) a usable Tempest/WeatherFlow station
    //   3) any usable weather entity
    //   4) last resort: the selected/first entity even if not usable
    const isUsable = (s: any) =>
      s && s.state !== 'unavailable' && s.state !== 'unknown' &&
      typeof s.attributes?.temperature === 'number';
    const selected = weatherEntityId ? weatherEnts.find(s => s.entity_id === weatherEntityId) : undefined;
    const w =
      (selected && isUsable(selected) ? selected : undefined) ||
      weatherEnts.find(s => isUsable(s) && /tempest|weatherflow/i.test(s.attributes?.attribution || '')) ||
      weatherEnts.find(isUsable) ||
      selected ||
      weatherEnts[0];
    const a = w.attributes || {};
    const cond = String(w.state || '');
    const tempest = /tempest|weatherflow/i.test(a.attribution || '');

    // Day/night for the `auto` theme. HA weather entities (incl. Tempest) carry
    // no sunrise/sunset, so the canonical source is the `sun.sun` entity:
    //   state === 'above_horizon' → daytime. Its next_rising / next_setting
    // attributes give the upcoming transitions, which we also surface so the
    // forecast popover / theme can show approximate sun times.
    const sun = (states || []).find(s => s.entity_id === 'sun.sun');
    let isDaytime: boolean | undefined;
    let sunrise: string | undefined;
    let sunset: string | undefined;
    if (sun) {
      isDaytime = sun.state === 'above_horizon';
      // next_setting is today's sunset while it's day; next_rising is today's
      // sunrise while it's night. The other bound is the next day's, which is
      // close enough for display.
      sunset = sun.attributes?.next_setting;
      sunrise = sun.attributes?.next_rising;
    }

    let forecast: ForecastDay[] = [];
    try {
      const fcRaw = await haClient.getWeatherForecast(w.entity_id);
      forecast = fcRaw.slice(0, 7).map((d: any) => {
        const dt = new Date(d.datetime);
        return {
          date: d.datetime,
          dayOfWeek: dt.toLocaleDateString('en-US', { weekday: 'short' }),
          icon: mapHaCondition(d.condition).icon,
          highTemp: Math.round(d.temperature ?? 0),
          lowTemp: Math.round(d.templow ?? d.temperature ?? 0),
        };
      });
    } catch { /* forecast best-effort */ }

    const m = mapHaCondition(cond);
    const result: WeatherData = {
      temperature: Math.round(a.temperature ?? 0),
      feelsLike: a.apparent_temperature,
      humidity: a.humidity,
      description: m.description,
      icon: m.icon,
      forecast,
      isDaytime,
      sunrise,
      sunset,
      windSpeed: a.wind_speed,
      windGust: a.wind_gust_speed,
      windDirection: a.wind_bearing,
      pressure: a.pressure,
      uvIndex: a.uv_index,
      stationName: a.friendly_name,
    };
    setIsTempest(tempest);

    // Hyperlocal overlay: if a LOCAL Tempest station is present, use its live
    // sensors for the CURRENT temp + activity (lightning/rain), while keeping the
    // selected entity's FORECAST (local UDP has no forecast). This is what makes
    // the header read the user's own station, not the regional cloud forecast.
    const local = readLocalTempest(states);
    if (local) {
      const now = Date.now();
      const prev = lightningRef.current;
      const cnt = local.lightningCount ?? 0;
      if (prev == null) lightningRef.current = { count: cnt, since: 0 };           // first read: don't fire
      else if (cnt > prev.count) lightningRef.current = { count: cnt, since: now }; // new strike(s)
      else lightningRef.current = { count: cnt, since: prev.since };
      const lightningActive = lightningRef.current.since > 0 && (now - lightningRef.current.since) < 30 * 60 * 1000;
      const raining = (local.precipType && local.precipType !== 'none') || (local.precipIntensity ?? 0) > 0;

      // Activity overrides the sky condition; otherwise keep the forecast's sky icon.
      let act = m;
      if (lightningActive) act = mapHaCondition('lightning');
      else if (raining) act = mapHaCondition(local.precipType === 'hail' ? 'snowy-rainy' : 'rainy');

      result.temperature = Math.round(local.temperature);
      if (local.humidity !== undefined) result.humidity = local.humidity;
      if (local.windSpeed !== undefined) result.windSpeed = local.windSpeed;
      if (local.windGust !== undefined) result.windGust = local.windGust;
      if (local.uvIndex !== undefined) result.uvIndex = local.uvIndex;
      result.description = act.description;
      result.icon = act.icon;
      result.stationName = 'Tempest (local)';
      setIsTempest(true);
    }

    return result;
  }, [weatherEntityId]);

  // Fetch from Open-Meteo
  const fetchFromOpenMeteo = useCallback(async () => {
    let coords: { latitude: number; longitude: number; } | null = null;

    // 1. Get location, preferring ZIP code
    if (weatherZipCode && /^\d{5}$/.test(weatherZipCode)) {
        try {
            const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${weatherZipCode}&count=1&language=en&format=json`);
            if (!geoResponse.ok) throw new Error('Geocoding API failed.');
            const geoData = await geoResponse.json();
            if (geoData.results && geoData.results.length > 0) {
                coords = { latitude: geoData.results[0].latitude, longitude: geoData.results[0].longitude };
            } else {
                throw new Error(`ZIP code ${weatherZipCode} not found.`);
            }
        } catch (zipError: any) {
            console.warn(`ZIP code lookup failed: ${zipError.message}`);
            throw zipError;
        }
    } else {
       try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        } catch (geoError: any) {
          console.warn(`Geolocation failed: ${geoError.message}. Falling back to IP-based location.`);
          try {
            const response = await fetch('https://ipinfo.io/json');
            if (!response.ok) throw new Error(`IP lookup failed with status ${response.status}`);
            const data = await response.json();
            if (data.loc) {
              const [lat, lon] = data.loc.split(',');
              coords = { latitude: parseFloat(lat), longitude: parseFloat(lon) };
            } else {
              throw new Error('Location data not found in IP lookup response');
            }
          } catch (ipError: any) {
            console.error("IP-based location fallback also failed:", ipError);
            throw new Error("Could not determine location.");
          }
        }
    }

    if (!coords) {
      throw new Error("Could not determine location.");
    }

    // 2. Fetch weather data using coordinates
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&timezone=auto`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`Weather API failed with status ${response.status}`);

    const data = await response.json();
    if (!data.current || !data.daily) throw new Error('Invalid weather data received');

    const { description, icon } = mapWeatherCode(data.current.weather_code);

    const forecast: ForecastDay[] = data.daily.time.map((dateStr: string, index: number) => {
        const date = new Date(dateStr + 'T00:00:00');
        return {
            date: dateStr,
            dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'short' }),
            icon: mapWeatherCode(data.daily.weather_code[index]).icon,
            highTemp: Math.round(data.daily.temperature_2m_max[index]),
            lowTemp: Math.round(data.daily.temperature_2m_min[index]),
        };
    }).slice(0, 7);

    const sunrise = data.daily.sunrise?.[0];
    const sunset = data.daily.sunset?.[0];

    const newWeather: WeatherData = {
      temperature: Math.round(data.current.temperature_2m),
      description,
      icon,
      forecast,
      sunrise,
      sunset,
    };

    // Cache the result
    const cacheableData = {
        current: {
            temperature: newWeather.temperature,
            description,
            weather_code: data.current.weather_code,
        },
        forecast: data.daily.time.slice(0, 7).map((date: string, i: number) => ({
            date,
            dayOfWeek: newWeather.forecast[i].dayOfWeek,
            weather_code: data.daily.weather_code[i],
            highTemp: newWeather.forecast[i].highTemp,
            lowTemp: newWeather.forecast[i].lowTemp,
        })),
        daily: {
            sunrise: sunrise,
            sunset: sunset,
        },
        timestamp: Date.now()
    };
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cacheableData));

    return newWeather;
  }, [weatherZipCode]);

  useEffect(() => {
    const fetchWeather = async () => {
      // Only show the loading state before the first successful load — on
      // background refreshes we keep the current value to avoid flicker.
      if (!hasDataRef.current) setLoading(true);

      // Prefer the HA weather entity (Tempest) — the user's real station.
      try {
        const haData = await fetchFromHa();
        if (haData) {
          setWeather(haData);
          setError(null);
          hasDataRef.current = true;
          setLoading(false);
          return;
        }
      } catch (e) {
        console.warn('[Weather] HA weather fetch failed, falling back:', e);
      }

      // Check cache first for Open-Meteo data
      const cachedWeather = localStorage.getItem(WEATHER_CACHE_KEY);
      if (cachedWeather) {
        try {
          const data = JSON.parse(cachedWeather);
          if (Date.now() - data.timestamp < CACHE_DURATION) {
            setWeather(buildWeatherDataFromCache(data));
            setError(null);
            hasDataRef.current = true;
            setLoading(false);
            return;
          }
        } catch (e) {
          console.warn("Could not load weather from cache:", e);
          localStorage.removeItem(WEATHER_CACHE_KEY);
        }
      }

      // Fetch from Open-Meteo
      try {
        const openMeteoData = await fetchFromOpenMeteo();
        if (openMeteoData) {
          setWeather(openMeteoData);
          setError(null);
          hasDataRef.current = true;
        }
      } catch (err: any) {
        console.error("Weather fetch error:", err);
        // Only surface the error if we have nothing to show; otherwise keep
        // the last-known weather on screen.
        if (!hasDataRef.current) setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();

    // Auto-refresh weather data periodically.
    const intervalId = setInterval(fetchWeather, CACHE_DURATION);
    return () => clearInterval(intervalId);

  }, [weatherZipCode, fetchFromOpenMeteo, fetchFromHa]);

  return { weather, loading, error, isTempest };
};
