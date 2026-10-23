import type { Activity, AirQualitySnapshot, LocationResult, OutdoorPlace, WeatherReading, WeatherSnapshot } from "./types";

const TIMEOUT_MS = clamp(Number(process.env.OUTDOORIQ_HTTP_TIMEOUT_MS) || 9000, 1500, 30000);
const NOMINATIM_AGENT = process.env.OUTDOORIQ_USER_AGENT || "OutdoorIQ/1.0 (open outdoor recommendations; contact: configure OUTDOORIQ_USER_AGENT)";
const GEOCODE_TTL_MS = 10 * 60 * 1000;
const geocodeCache = new Map<string, { until: number; results: LocationResult[] }>();
const nearbyCache = new Map<string, { until: number; results: OutdoorPlace[] }>();
const nearbyFailureCache = new Map<string, { until: number; message: string; kind: "unavailable" | "no-match" }>();
const NEARBY_TTL_MS = 3 * 60 * 1000;
const NEARBY_FAILURE_TTL_MS = 20 * 1000;
let lastNominatimRequest = 0;

export class ProviderError extends Error {
  constructor(message: string, readonly provider?: string, readonly status?: number, readonly kind: "unavailable" | "no-match" = "unavailable") {
    super(message);
    this.name = "ProviderError";
  }
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function finite(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

async function requestJson(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": NOMINATIM_AGENT, "Accept": "application/json", ...(init.headers || {}) } });
    if (!response.ok) throw new ProviderError(`Provider returned HTTP ${response.status}`, new URL(url).hostname, response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError("Provider request timed out", new URL(url).hostname);
    throw new ProviderError(error instanceof Error ? error.message : "Provider network request failed", new URL(url).hostname);
  } finally { clearTimeout(timer); }
}

export function normalizePlaceQuery(raw: string): string {
  const value = raw.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (value.length < 2) throw new Error("Enter at least two characters to search for a place.");
  if (value.length > 120) throw new Error("Place searches must be 120 characters or fewer.");
  return value;
}

function openMeteoLocations(data: any): LocationResult[] {
  if (!Array.isArray(data?.results)) return [];
  return data.results.flatMap((row: any) => {
    const latitude = finite(row.latitude), longitude = finite(row.longitude);
    if (latitude === null || longitude === null || !text(row.name)) return [];
    const region = text(row.admin1) || text(row.admin2);
    const displayName = [text(row.name), region, text(row.country)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
    return [{ id: `om:${row.id ?? `${latitude},${longitude}`}`, name: String(row.name), displayName, latitude, longitude, country: text(row.country), region, kind: text(row.feature) || text(row.admin1), source: "Open-Meteo Geocoding" }];
  });
}

function nominatimLocations(data: any): LocationResult[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: any) => {
    const latitude = finite(row.lat), longitude = finite(row.lon);
    if (latitude === null || longitude === null) return [];
    const address = row.address || {};
    const name = text(row.name) || text(row.display_name?.split(",")[0]) || "Place";
    return [{ id: `osm:${row.place_id ?? `${latitude},${longitude}`}`, name, displayName: text(row.display_name) || name, latitude, longitude, country: text(address.country), region: text(address.state) || text(address.city), kind: text(row.type) || text(row.class), source: "OpenStreetMap Nominatim" }];
  });
}

async function waitForNominatimSlot() {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequest));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastNominatimRequest = Date.now();
}

export async function geocodePlaces(raw: string): Promise<LocationResult[]> {
  const query = normalizePlaceQuery(raw);
  const key = query.toLocaleLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && cached.until > Date.now()) return cached.results;
  const errors: unknown[] = [];
  let results: LocationResult[] = [];
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=7&language=en&format=json`;
    results = openMeteoLocations(await requestJson(url));
  } catch (error) { errors.push(error); }
  if (!results.length) {
    try {
      await waitForNominatimSlot();
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=7&q=${encodeURIComponent(query)}`;
      results = nominatimLocations(await requestJson(url, { headers: { "Accept-Language": "en" } }));
    } catch (error) { errors.push(error); }
  }
  if (!results.length && errors.length === 2) throw new ProviderError("Location search services are temporarily unavailable. Please try again shortly.", "geocoding");
  geocodeCache.set(key, { until: Date.now() + GEOCODE_TTL_MS, results });
  return results;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const radians = (n: number) => n * Math.PI / 180;
  const dLat = radians(bLat - aLat), dLon = radians(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function classify(tags: Record<string, string>): { categories: string[]; activityTypes: Activity[]; name: string; description?: string } {
  const categories = new Set<string>();
  const kind = tags.leisure || tags.highway || tags.route || tags.natural || tags.landuse || tags.amenity || tags.tourism;
  if (tags.leisure === "park" || tags.leisure === "garden" || tags.leisure === "nature_reserve") categories.add("Park");
  if (["path", "footway", "track", "pedestrian"].includes(tags.highway)) categories.add("Walking path");
  if (tags.highway === "cycleway" || tags.route === "bicycle") categories.add("Cycle route");
  if (tags.route === "hiking" || tags.sac_scale) categories.add("Hiking trail");
  if (tags.leisure === "sports_centre" || tags.leisure === "pitch" || tags.leisure === "stadium" || tags.sport) categories.add(tags.sport ? `${tags.sport} facility` : "Sports facility");
  if (tags.natural === "wood" || tags.landuse === "forest") categories.add("Green space");
  if (tags.tourism === "viewpoint") categories.add("Viewpoint");
  if (tags.amenity === "fitness_centre") categories.add("Fitness centre");
  if (tags.leisure === "track") categories.add("Athletics track");
  if (!categories.size && kind) categories.add(String(kind).replaceAll("_", " "));
  const activityTypes: Activity[] = ["walking"];
  if (tags.highway === "cycleway" || tags.route === "bicycle" || tags.bicycle === "designated" || tags.sport === "cycling") activityTypes.push("cycling");
  if (["path", "footway", "track"].includes(tags.highway) || tags.route === "hiking" || tags.leisure === "park" || tags.natural === "wood" || tags.landuse === "forest") activityTypes.push("hiking");
  if (["cycleway", "path", "track"].includes(tags.highway) || tags.leisure === "track" || tags.leisure === "park" || ["sports_centre", "pitch", "stadium"].includes(tags.leisure) || tags.sport === "running" || tags.sport === "athletics") activityTypes.push("running");
  const fallbackName = categories.has("Park") ? "Unnamed park" : categories.has("Walking path") ? "Unnamed walking path" : categories.has("Cycle route") ? "Unnamed cycle route" : categories.has("Hiking trail") ? "Unnamed hiking trail" : categories.values().next().value || "Outdoor place";
  const name = text(tags.name) || fallbackName;
  const desc = [tags.surface && `Surface: ${tags.surface}`, tags.access && `Access: ${tags.access}`].filter(Boolean).join(" · ");
  return { categories: [...categories], activityTypes: [...new Set(activityTypes)], name, description: desc || undefined };
}

function closestGeometryPoint(originLat: number, originLon: number, item: any): { latitude: number; longitude: number; distanceKm: number } | null {
  const groups: any[][] = [];
  if (Array.isArray(item.geometry)) groups.push(item.geometry);
  if (Array.isArray(item.members)) for (const member of item.members) if (Array.isArray(member.geometry)) groups.push(member.geometry);
  let best: { latitude: number; longitude: number; distanceKm: number } | null = null;
  const consider = (lat: number, lon: number) => {
    const distanceKm = haversineKm(originLat, originLon, lat, lon);
    if (!best || distanceKm < best.distanceKm) best = { latitude: lat, longitude: lon, distanceKm };
  };
  const lonScale = 111.32 * Math.cos(originLat * Math.PI / 180), latScale = 110.574;
  for (const group of groups) {
    const points = group.flatMap((point: any) => {
      const lat = finite(point?.lat), lon = finite(point?.lon);
      return lat === null || lon === null ? [] : [{ lat, lon }];
    });
    points.forEach(point => consider(point.lat, point.lon));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const ax = (a.lon - originLon) * lonScale, ay = (a.lat - originLat) * latScale;
      const bx = (b.lon - originLon) * lonScale, by = (b.lat - originLat) * latScale;
      const vx = bx - ax, vy = by - ay;
      const t = clamp(-(ax * vx + ay * vy) / (vx * vx + vy * vy || 1), 0, 1);
      consider(a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon));
    }
  }
  return best;
}

function overpassPlaces(data: any, latitude: number, longitude: number, radiusKm: number): OutdoorPlace[] {
  if (!Array.isArray(data?.elements)) return [];
  const seen = new Set<string>();
  return data.elements.flatMap((item: any) => {
    const tags = item.tags && typeof item.tags === "object" ? item.tags as Record<string, string> : {};
    const mappedOutdoorTag = ["park", "garden", "nature_reserve", "sports_centre", "pitch", "stadium", "track"].includes(tags.leisure)
      || ["path", "footway", "cycleway", "track", "pedestrian"].includes(tags.highway)
      || ["hiking", "bicycle"].includes(tags.route)
      || ["wood", "scrub"].includes(tags.natural)
      || tags.tourism === "viewpoint" || tags.amenity === "fitness_centre" || Boolean(tags.sport);
    if (!mappedOutdoorTag) return [];
    const centerLat = finite(item.lat ?? item.center?.lat), centerLon = finite(item.lon ?? item.center?.lon);
    const centerDistance = centerLat === null || centerLon === null ? null : haversineKm(latitude, longitude, centerLat, centerLon);
    const geometryPoint = closestGeometryPoint(latitude, longitude, item);
    const useGeometryPoint = Boolean(geometryPoint && (centerDistance === null || geometryPoint.distanceKm < centerDistance));
    const lat = useGeometryPoint ? geometryPoint!.latitude : centerLat;
    const lon = useGeometryPoint ? geometryPoint!.longitude : centerLon;
    const distance = useGeometryPoint ? geometryPoint!.distanceKm : centerDistance;
    if (lat === null || lon === null || distance === null) return [];
    const key = `${String(tags.name || "").toLowerCase()}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    if (distance > radiusKm) return [];
    const classified = classify(tags);
    return [{ id: `osm:${item.type}:${item.id}`, name: classified.name, latitude: lat, longitude: lon, distanceKm: Math.round(distance * 100) / 100, categories: classified.categories, activityTypes: classified.activityTypes, source: "OpenStreetMap" as const, openingHours: text(tags.opening_hours), surface: text(tags.surface), description: classified.description }];
  });
}

function nominatimNearbyPlaces(data: any, latitude: number, longitude: number, radiusKm: number, activity: Activity): OutdoorPlace[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data.flatMap((row: any) => {
    const lat = finite(row.lat), lon = finite(row.lon);
    if (lat === null || lon === null) return [];
    const distanceKm = haversineKm(latitude, longitude, lat, lon);
    if (distanceKm > radiusKm) return [];
    const tags = { ...(row.extratags || {}) } as Record<string, string>;
    const type = String(row.type || "").toLowerCase();
    const klass = String(row.class || "").toLowerCase();
    const parks = ["park", "garden", "nature_reserve"];
    const leisure = ["park", "garden", "nature_reserve", "sports_centre", "pitch", "stadium", "track"];
    const highways = ["path", "footway", "cycleway", "track", "pedestrian"];
    if (klass === "leisure" && leisure.includes(type)) tags.leisure ||= type;
    if (highways.includes(type) && (klass === "highway" || type === "cycleway")) tags.highway ||= type;
    if (type === "trail") tags.route ||= "hiking";
    if (klass === "route" && ["hiking", "bicycle"].includes(type)) tags.route ||= type;
    if (klass === "natural" && ["wood", "scrub"].includes(type)) tags.natural ||= type;
    if (klass === "tourism" && type === "viewpoint") tags.tourism ||= type;
    if (type === "sports_centre" && klass === "leisure") tags.leisure ||= type;
    const mappedOutdoorTag = parks.includes(tags.leisure) || leisure.includes(tags.leisure) || highways.includes(tags.highway) || ["hiking", "bicycle"].includes(tags.route) || ["wood", "scrub"].includes(tags.natural) || tags.tourism === "viewpoint" || tags.amenity === "fitness_centre" || Boolean(tags.sport);
    if (!mappedOutdoorTag) return [];
    const classified = classify({ ...tags, name: text(row.name) || text(row.display_name?.split(",")[0]) || "Outdoor place" });
    const compatible = new Set(classified.activityTypes);
    if (activity === "cycling" && type === "cycleway") compatible.add("cycling");
    if (activity === "hiking" && ["trail", "path", "park", "wood"].includes(row.type)) compatible.add("hiking");
    if (activity === "running" && ["park", "track", "path"].includes(row.type)) compatible.add("running");
    if (!compatible.has(activity)) return [];
    const id = `nominatim:${row.place_id ?? `${lat},${lon}`}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, name: classified.name, latitude: lat, longitude: lon, distanceKm: Math.round(distanceKm * 100) / 100, categories: classified.categories, activityTypes: [...compatible], source: "OpenStreetMap Nominatim" as const, openingHours: text(tags.opening_hours), surface: text(tags.surface), description: classified.description }];
  });
}

function activityOverpassQuery(latitude: number, longitude: number, radiusM: number, activity: Activity) {
  const around = `nwr(around:${radiusM},${latitude},${longitude})`;
  const parks = `${around}[leisure~"^(park|garden|nature_reserve)$"]`;
  const walkingPaths = `${around}[highway~"^(path|footway|pedestrian)$"]`;
  const sportsGrounds = `${around}[leisure~"^(sports_centre|pitch|stadium)$"]`;
  const selectors = activity === "cycling"
    ? [`${around}[highway="cycleway"]`, `${around}[route="bicycle"]`, `${around}[sport="cycling"]`]
    : activity === "running"
      ? [`${around}[leisure~"^(park|track)$"]`, `${around}[highway~"^(path|footway|track)$"]`, sportsGrounds, `${around}[sport~"^(running|athletics)$"]`]
      : activity === "hiking"
        ? [`${around}[route="hiking"]`, `${around}[highway~"^(path|footway|track)$"]`, `${around}[natural~"^(wood|scrub)$"]`]
        : [parks, walkingPaths];
  return `[out:json][timeout:10];(${selectors.join(";")};);out geom tags 30;`;
}

export async function getNearbyPlaces(latitude: number, longitude: number, radiusKm: number, activity: Activity = "walking"): Promise<OutdoorPlace[]> {
  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${radiusKm}:${activity}`;
  const cached = nearbyCache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.results;
  const recentFailure = nearbyFailureCache.get(cacheKey);
  if (recentFailure && recentFailure.until > Date.now()) throw new ProviderError(recentFailure.message, "OpenStreetMap", undefined, recentFailure.kind);
  nearbyFailureCache.delete(cacheKey);
  const radiusM = Math.round(radiusKm * 1000);
  const query = activityOverpassQuery(latitude, longitude, radiusM, activity);
  const endpoints = ["https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  const init = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: `data=${encodeURIComponent(query)}` };
  let lastError: unknown;
  let overpassResponded = false;
  let nominatimResponded = false;
  for (const endpoint of endpoints) {
    try {
      const data = await requestJson(endpoint, init, Math.min(10000, Math.max(TIMEOUT_MS, 6000)));
      overpassResponded = true;
      const places = overpassPlaces(data, latitude, longitude, radiusKm);
      if (places.length) {
        const ranked = places.slice(0, 100);
        nearbyCache.set(cacheKey, { until: Date.now() + NEARBY_TTL_MS, results: ranked });
        nearbyFailureCache.delete(cacheKey);
        return ranked;
      }
      lastError = new ProviderError("Overpass returned no matching outdoor features.", new URL(endpoint).hostname);
    } catch (error) {
      lastError = error;
    }
  }
  try {
    await waitForNominatimSlot();
    const latSpan = radiusKm / 111.195;
    const lonSpan = radiusKm / Math.max(111.195 * Math.abs(Math.cos(latitude * Math.PI / 180)), 5);
    const viewbox = [longitude - lonSpan, latitude + latSpan, longitude + lonSpan, latitude - latSpan].join(",");
    const term = activity === "cycling" ? "cycleway" : activity === "hiking" ? "trail" : "park";
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=20&q=${encodeURIComponent(term)}&viewbox=${encodeURIComponent(viewbox)}&bounded=1`;
    const nominatimData = await requestJson(url, { headers: { "Accept-Language": "en" } });
    nominatimResponded = true;
    const fallback = nominatimNearbyPlaces(nominatimData, latitude, longitude, radiusKm, activity).slice(0, 100);
    if (fallback.length) {
      nearbyCache.set(cacheKey, { until: Date.now() + NEARBY_TTL_MS, results: fallback });
      nearbyFailureCache.delete(cacheKey);
      return fallback;
    }
    const kind = overpassResponded || nominatimResponded ? "no-match" as const : "unavailable" as const;
    const message = kind === "no-match"
      ? "Nearby map data returned no verified outdoor places in this radius."
      : `Nearby map services did not respond; the bounded fallback returned no verified places (${lastError instanceof Error ? lastError.message : "provider timeout"}).`;
    nearbyFailureCache.set(cacheKey, { until: Date.now() + NEARBY_FAILURE_TTL_MS, message, kind });
    throw new ProviderError(message, "OpenStreetMap", undefined, kind);
  } catch (error) {
    if (error instanceof ProviderError && error.provider === "OpenStreetMap") throw error;
    const reason = lastError instanceof Error ? lastError.message : error instanceof Error ? error.message : "provider timeout";
    const message = `Nearby map providers are temporarily unavailable (${reason}).`;
    nearbyFailureCache.set(cacheKey, { until: Date.now() + NEARBY_FAILURE_TTL_MS, message, kind: "unavailable" });
    throw new ProviderError(message, "OpenStreetMap", undefined, "unavailable");
  }
}

function parseWeatherReading(data: any, section: "current" | "hourly", index?: number): WeatherReading | null {
  const field = (key: string) => section === "current" ? finite(data?.current?.[key]) : finite(data?.hourly?.[key]?.[index ?? 0]);
  const time = section === "current" ? text(data?.current?.time) : text(data?.hourly?.time?.[index ?? 0]);
  if (!time && field("temperature_2m") === null) return null;
  const isDay = section === "current" ? finite(data?.current?.is_day) : finite(data?.hourly?.is_day?.[index ?? 0]);
  return { temperatureC: field("temperature_2m"), feelsLikeC: field("apparent_temperature"), precipitationMm: field("precipitation"), precipitationProbabilityPct: field("precipitation_probability"), windKph: field("wind_speed_10m"), humidityPct: field("relative_humidity_2m"), weatherCode: field("weather_code"), daylight: isDay === null ? null : isDay === 1, time: time || null };
}

export async function getWeather(latitude: number, longitude: number, plannedTime?: string): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day", hourly: "temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,relative_humidity_2m,weather_code,is_day", forecast_days: "7", timezone: "auto" });
  const retrievedAt = new Date().toISOString();
  try {
    const data = await requestJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    let planned: WeatherReading | null = null;
    if (plannedTime && Array.isArray(data.hourly?.time)) {
      const desired = Date.parse(plannedTime);
      const localOffsetMs = Number(data.utc_offset_seconds || 0) * 1000;
      let closest = -1, distance = Infinity;
      data.hourly.time.forEach((time: string, i: number) => { const providerLocalEpoch = Date.parse(`${time}Z`) - localOffsetMs; const diff = Math.abs(providerLocalEpoch - desired); if (Number.isFinite(diff) && diff < distance) { closest = i; distance = diff; } });
      if (closest >= 0 && distance <= 90 * 60 * 1000) planned = parseWeatherReading(data, "hourly", closest);
    }
    return { status: "available", source: "Open-Meteo", attribution: "Weather forecast data by Open-Meteo (open-meteo.com)", units: { temperature: "°C", precipitation: "mm", wind: "km/h" }, timezone: text(data.timezone), current: parseWeatherReading(data, "current"), planned, retrievedAt };
  } catch (error) {
    return { status: "unavailable", source: "Open-Meteo", attribution: "Weather source: Open-Meteo", units: { temperature: "°C", precipitation: "mm", wind: "km/h" }, current: null, planned: null, retrievedAt, note: error instanceof Error ? error.message : "Weather data is unavailable." };
  }
}

function aqiCategory(index: number, value: number): string {
  if (index === 1) return value <= 20 ? "Good" : value <= 40 ? "Fair" : value <= 60 ? "Moderate" : value <= 80 ? "Poor" : value <= 100 ? "Very poor" : "Extremely poor";
  return value <= 50 ? "Good" : value <= 100 ? "Moderate" : value <= 150 ? "Unhealthy for sensitive groups" : value <= 200 ? "Unhealthy" : value <= 300 ? "Very unhealthy" : "Hazardous";
}

export async function getAirQuality(latitude: number, longitude: number): Promise<AirQualitySnapshot> {
  const retrievedAt = new Date().toISOString();
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: "us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide", timezone: "auto" });
  try {
    const data = await requestJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
    const current = data.current || {};
    const us = finite(current.us_aqi), eu = finite(current.european_aqi);
    const index = us !== null ? { name: "US AQI" as const, value: us, category: aqiCategory(0, us) } : eu !== null ? { name: "European AQI" as const, value: eu, category: aqiCategory(1, eu) } : null;
    const pollutants = { pm2_5: finite(current.pm2_5), pm10: finite(current.pm10), ozone: finite(current.ozone), nitrogenDioxide: finite(current.nitrogen_dioxide) };
    if (!index && Object.values(pollutants).every(value => value === null)) throw new ProviderError("The air-quality service returned no current index or pollutant values.", "Open-Meteo Air Quality");
    return { status: "available", source: "Open-Meteo Air Quality", attribution: "Air-quality model data by Open-Meteo/CAMS; model estimates, not local sensor measurements", index, pollutants, units: { index: "AQI", concentration: "μg/m³" }, time: text(current.time) || null, retrievedAt };
  } catch (error) {
    return { status: "unavailable", source: "Open-Meteo Air Quality", attribution: "Air-quality source: Open-Meteo/CAMS", index: null, pollutants: { pm2_5: null, pm10: null, ozone: null, nitrogenDioxide: null }, units: { index: "AQI", concentration: "μg/m³" }, time: null, retrievedAt, note: error instanceof Error ? error.message : "Air-quality data is unavailable." };
  }
}

export function clearProviderCachesForTests() { geocodeCache.clear(); nearbyCache.clear(); nearbyFailureCache.clear(); }
