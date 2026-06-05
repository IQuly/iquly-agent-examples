const inputText = await new Response(Bun.stdin.stream()).text();
let input;

try {
  input = JSON.parse(inputText || "{}");
} catch {
  console.error("Invalid JSON input");
  process.exit(1);
}

if (!input || typeof input !== "object" || Array.isArray(input)) {
  input = {};
}

const location = String(input.location ?? "").trim();
const mode =
  input.mode === "forecast" ||
  input.mode === "one_line" ||
  input.mode === "moon" ||
  input.mode === "moon_phase" ||
  input.mode === "moonphase"
    ? input.mode
    : "current";
const units =
  input.units === "us" ||
  input.units === "imperial" ||
  input.units === "fahrenheit" ||
  input.units === "metric" ||
  input.units === "metric_mps"
    ? input.units
    : "auto";
const lang = String(input.lang ?? "").trim();
const moonDate = String(input.date ?? "").trim();

if (!location && mode !== "moon" && mode !== "moon_phase" && mode !== "moonphase") {
  console.error("Missing location");
  process.exit(1);
}

const USER_AGENT = "IQuly Weather Agent/0.2";

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.text();
}

const weatherCodeMap = new Map([
  [0, "Clear sky"],
  [1, "Mainly clear"],
  [2, "Partly cloudy"],
  [3, "Overcast"],
  [45, "Fog"],
  [48, "Rime fog"],
  [51, "Light drizzle"],
  [53, "Moderate drizzle"],
  [55, "Dense drizzle"],
  [56, "Light freezing drizzle"],
  [57, "Dense freezing drizzle"],
  [61, "Slight rain"],
  [63, "Moderate rain"],
  [65, "Heavy rain"],
  [66, "Light freezing rain"],
  [67, "Heavy freezing rain"],
  [71, "Slight snow"],
  [73, "Moderate snow"],
  [75, "Heavy snow"],
  [77, "Snow grains"],
  [80, "Slight rain showers"],
  [81, "Moderate rain showers"],
  [82, "Violent rain showers"],
  [85, "Slight snow showers"],
  [86, "Heavy snow showers"],
  [95, "Thunderstorm"],
  [96, "Thunderstorm with slight hail"],
  [99, "Thunderstorm with heavy hail"],
]);

function resolveWeatherDescription(code) {
  return weatherCodeMap.get(Number(code)) ?? "Unknown";
}

function normalizeUnits(value) {
  if (value === "us" || value === "imperial" || value === "fahrenheit") {
    return {
      outputUnits: "imperial",
      temperatureUnit: "fahrenheit",
      windSpeedUnit: "mph",
      displayTemperatureUnit: "F",
      displayWindUnit: "mph",
    };
  }

  if (value === "metric_mps") {
    return {
      outputUnits: "metric_mps",
      temperatureUnit: "celsius",
      windSpeedUnit: "ms",
      displayTemperatureUnit: "C",
      displayWindUnit: "m/s",
    };
  }

  return {
    outputUnits: "metric",
    temperatureUnit: "celsius",
    windSpeedUnit: "kmh",
    displayTemperatureUnit: "C",
    displayWindUnit: "km/h",
  };
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return number.toFixed(digits);
}

function formatTemperature(value, unitLabel) {
  return `${formatNumber(value, 1)}${unitLabel}`;
}

function formatWind(value, unitLabel) {
  return `${formatNumber(value, 1)} ${unitLabel}`;
}

const countryAbbreviations = new Map([
  ["United Arab Emirates", "UAE"],
  ["United States", "USA"],
  ["United Kingdom", "UK"],
]);

function compactCountryName(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return countryAbbreviations.get(trimmed) ?? trimmed;
}

function buildResolvedLocation(result, fallbackLocation) {
  if (!result || typeof result !== "object") {
    return fallbackLocation;
  }

  const name = typeof result.name === "string" ? result.name.trim() : "";
  const admin1 = typeof result.admin1 === "string" ? result.admin1.trim() : "";
  const country = compactCountryName(result.country);
  const parts = [];

  if (name) {
    parts.push(name);
  }
  if (admin1 && admin1 !== name && admin1 !== country) {
    parts.push(admin1);
  }
  if (country && country !== admin1) {
    parts.push(country);
  }

  return parts.join(", ") || fallbackLocation;
}

function encodeLocation(value) {
  return encodeURIComponent(value.replace(/\s+/g, " ").trim());
}

const locationStopWords = new Set([
  "a",
  "an",
  "and",
  "base",
  "city",
  "in",
  "near",
  "of",
  "on",
  "station",
  "the",
  "weather",
]);
const nonEarthLocationTokens = new Set(["mars", "venus", "jupiter", "saturn", "neptune", "pluto"]);

function locationTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 1 && !locationStopWords.has(token)) ?? [];
}

function hasReasonableLocationMatch(query, result) {
  const queryTokens = locationTokens(query);
  if (queryTokens.length <= 1) {
    return true;
  }

  const resolvedTokens = new Set(
    [result?.name, result?.admin1, result?.country].flatMap((part) => locationTokens(part)),
  );
  const matches = queryTokens.filter((token) => resolvedTokens.has(token));
  return matches.length >= Math.min(2, queryTokens.length);
}

async function resolveLocation(query) {
  if (locationTokens(query).some((token) => nonEarthLocationTokens.has(token))) {
    throw new Error(`Could not confidently resolve location '${query}'`);
  }

  const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodeUrl.searchParams.set("name", query);
  geocodeUrl.searchParams.set("count", "10");
  geocodeUrl.searchParams.set("format", "json");
  if (lang) {
    geocodeUrl.searchParams.set("language", lang);
  }

  const geocodeData = await fetchJson(geocodeUrl);
  const results = Array.isArray(geocodeData?.results) ? geocodeData.results : [];
  if (results[0]) {
    if (!hasReasonableLocationMatch(query, results[0])) {
      throw new Error(`Could not confidently resolve location '${query}'`);
    }
    return results[0];
  }

  const fallbackUrl = new URL(`https://wttr.in/${encodeLocation(query)}`);
  fallbackUrl.searchParams.set("format", "j1");
  if (lang) {
    fallbackUrl.searchParams.set("lang", lang);
  }

  const fallbackData = await fetchJson(fallbackUrl);
  const nearestArea = fallbackData?.nearest_area?.[0];
  const areaName = nearestArea?.areaName?.[0]?.value;
  const region = nearestArea?.region?.[0]?.value;
  const country = nearestArea?.country?.[0]?.value;
  const latitude = Number.parseFloat(nearestArea?.latitude ?? "");
  const longitude = Number.parseFloat(nearestArea?.longitude ?? "");

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Could not resolve location");
  }

  return {
    name: areaName || query,
    admin1: region || "",
    country: country || "",
    latitude,
    longitude,
    timezone: fallbackData?.time_zone?.[0]?.zone ?? "auto",
  };
}

async function resolveMoonPhase() {
  const url = new URL(`https://wttr.in/Moon${moonDate ? `@${moonDate}` : ""}`);
  url.searchParams.set("format", "%m");
  if (lang) {
    url.searchParams.set("lang", lang);
  }

  const rawMoonPhase = (await fetchText(url)).trim();
  const moonPhaseNameByEmoji = {
    "🌑": "New Moon",
    "🌒": "Waxing Crescent",
    "🌓": "First Quarter",
    "🌔": "Waxing Gibbous",
    "🌕": "Full Moon",
    "🌖": "Waning Gibbous",
    "🌗": "Last Quarter",
    "🌘": "Waning Crescent",
  };
  const moonPhaseEmojiByName = Object.fromEntries(
    Object.entries(moonPhaseNameByEmoji).map(([emoji, name]) => [name, emoji]),
  );
  const phaseNames = Object.values(moonPhaseNameByEmoji);
  const plainMoonText = rawMoonPhase
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const parsedName = phaseNames
    .map((name) => ({ name, index: plainMoonText.indexOf(name) }))
    .filter((entry) => entry.index !== -1)
    .sort((a, b) => a.index - b.index)[0]?.name;
  const moonPhase = moonPhaseNameByEmoji[rawMoonPhase]
    ? rawMoonPhase
    : parsedName
      ? moonPhaseEmojiByName[parsedName]
      : "";
  const moonPhaseName = moonPhaseNameByEmoji[moonPhase] || parsedName || "Unknown";
  const summary = moonDate
    ? `${moonDate}: ${moonPhaseName}${moonPhase ? ` ${moonPhase}` : ""}`
    : `Moon phase: ${moonPhaseName}${moonPhase ? ` ${moonPhase}` : ""}`;

  const resolvedUnits = normalizeUnits(units);

  console.log(
    JSON.stringify({
      location: "Moon",
      mode,
      units: resolvedUnits.outputUnits,
      moonPhase,
      moonPhaseName,
      summary,
    }),
  );
}

if (mode === "moon" || mode === "moon_phase" || mode === "moonphase") {
  await resolveMoonPhase();
  process.exit(0);
}

try {
  const resolvedUnits = normalizeUnits(units);
  const resolvedLocation = await resolveLocation(location);
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(resolvedLocation.latitude));
  forecastUrl.searchParams.set("longitude", String(resolvedLocation.longitude));
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_direction_10m",
      "weather_code",
      "is_day",
    ].join(","),
  );
  forecastUrl.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "sunrise",
      "sunset",
    ].join(","),
  );
  forecastUrl.searchParams.set("forecast_days", "3");
  forecastUrl.searchParams.set("temperature_unit", resolvedUnits.temperatureUnit);
  forecastUrl.searchParams.set("wind_speed_unit", resolvedUnits.windSpeedUnit);

  const weatherData = await fetchJson(forecastUrl);
  const current = weatherData?.current;
  const daily = weatherData?.daily;

  if (!current) {
    throw new Error("Weather source returned no current conditions");
  }

  const locationLabel = buildResolvedLocation(resolvedLocation, location);
  const currentResult = {
    condition: resolveWeatherDescription(current.weather_code),
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    windDirection: current.wind_direction_10m,
    isDay: current.is_day,
    time: current.time,
    weatherCode: current.weather_code,
    temperatureUnit: resolvedUnits.displayTemperatureUnit,
    windUnit: resolvedUnits.displayWindUnit,
  };

  const forecast = Array.isArray(daily?.time)
    ? daily.time.slice(0, 3).map((date, index) => ({
        date,
        summary: resolveWeatherDescription(daily.weather_code?.[index]),
        maxTemp: daily.temperature_2m_max?.[index],
        minTemp: daily.temperature_2m_min?.[index],
        sunrise: daily.sunrise?.[index] ?? null,
        sunset: daily.sunset?.[index] ?? null,
        temperatureUnit: resolvedUnits.displayTemperatureUnit,
      }))
    : [];

  const summary =
    mode === "forecast"
      ? `${locationLabel}: ${forecast
          .map(
            (day) =>
              `${day.date} ${day.summary} ${formatTemperature(
                day.minTemp,
                day.temperatureUnit,
              )}-${formatTemperature(day.maxTemp, day.temperatureUnit)}`,
          )
          .join("; ")}`
      : mode === "one_line"
        ? `${locationLabel}: ${currentResult.condition}, ${formatTemperature(
            currentResult.temperature,
            currentResult.temperatureUnit,
          )}, wind ${formatWind(currentResult.windSpeed, currentResult.windUnit)}`
        : `${locationLabel}: ${currentResult.condition}, ${formatTemperature(
            currentResult.temperature,
            currentResult.temperatureUnit,
          )}, feels like ${formatTemperature(
            currentResult.feelsLike,
            currentResult.temperatureUnit,
          )}, humidity ${formatNumber(currentResult.humidity)}%, wind ${formatWind(
            currentResult.windSpeed,
            currentResult.windUnit,
          )}`;

  console.log(
    JSON.stringify({
      location: locationLabel,
      mode,
      units: resolvedUnits.outputUnits,
      summary,
      source: "open-meteo",
      current: currentResult,
      forecast,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
