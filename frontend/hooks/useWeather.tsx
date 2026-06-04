
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IconSun, IconCloud, IconCloudRain, IconCloudSnow, IconCloudLightning, IconCloudSun } from '../components/icons';
import { useDashboard } from './useDashboard';
import { WeatherData, ForecastDay } from '../types';

const WEATHER_CACHE_KEY = 'homeTileWeatherCache';
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

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
  const { weatherZipCode } = useDashboard();

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

  }, [weatherZipCode, fetchFromOpenMeteo]);

  return { weather, loading, error, isTempest: false };
};
