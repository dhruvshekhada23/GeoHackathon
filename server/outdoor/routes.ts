import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { geocodePlaces, getAirQuality, getNearbyPlaces, getWeather, ProviderError } from "./providers";
import { addModelExplanations, haversineDistanceKm, scorePlaces } from "./recommend";
import type { Activity, AirQualitySnapshot, LocationResult, RecommendationRequest, RecommendationResponse, WeatherSnapshot } from "./types";

const activities: Activity[] = ["walking", "running", "cycling", "hiking"];
const EMPTY_WEATHER: WeatherSnapshot = { status: "unavailable", source: "Open-Meteo", attribution: "Weather data by Open-Meteo", units: { temperature: "°C", precipitation: "mm", wind: "km/h" }, current: null, planned: null, retrievedAt: new Date().toISOString(), note: "Weather provider did not return data." };
const EMPTY_AIR: AirQualitySnapshot = { status: "unavailable", source: "Open-Meteo Air Quality", attribution: "Air-quality model data by Open-Meteo/CAMS", index: null, pollutants: { pm2_5: null, pm10: null, ozone: null, nitrogenDioxide: null }, units: { index: "AQI", concentration: "μg/m³" }, time: null, retrievedAt: new Date().toISOString(), note: "Air-quality provider did not return data." };

type Dependencies = {
  geocode: typeof geocodePlaces;
  nearby: typeof getNearbyPlaces;
  weather: typeof getWeather;
  air: typeof getAirQuality;
  model: typeof addModelExplanations;
};
const defaults: Dependencies = { geocode: geocodePlaces, nearby: getNearbyPlaces, weather: getWeather, air: getAirQuality, model: addModelExplanations };
const errorResponse = (res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) } });
const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { void handler(req, res).catch(next); };

export function outdoorApiErrorHandler(error: any, req: Request, res: Response, next: NextFunction) {
  if (!/^\/(?:api\/|recommend(?:\/|$)|health$|docs$|openapi\.json$)/.test(req.path)) return next(error);
  if (res.headersSent) return next(error);
  const status = Number(error?.status);
  const code = status === 400 ? "INVALID_JSON" : status === 413 ? "REQUEST_TOO_LARGE" : "INTERNAL_ERROR";
  const responseStatus = status === 400 || status === 413 ? status : 500;
  console.error("[OutdoorIQ API] Request failed:", error);
  const message = status === 400 ? "Request body must be valid JSON." : status === 413 ? "Request body is too large." : "The request could not be completed.";
  return errorResponse(res, responseStatus, code, message, process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined);
}

function validateRequest(body: any): { value?: RecommendationRequest; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Request body must be a JSON object." };
  const activity = body.activity;
  if (!activities.includes(activity)) return { error: `activity must be one of: ${activities.join(", ")}.` };
  const radiusKm = Number(body.radiusKm ?? 5);
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 20) return { error: "radiusKm must be between 1 and 20 kilometres." };
  let location: RecommendationRequest["location"];
  if (typeof body.location === "string") {
    const query = body.location.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (query.length < 2 || query.length > 120) return { error: "location must contain 2 to 120 characters." };
    location = query;
  } else if (body.location && typeof body.location === "object") {
    const { name, latitude, longitude, country, region } = body.location;
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 200) return { error: "location.name must contain 2 to 200 characters." };
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { error: "location latitude/longitude must be valid geographic coordinates." };
    location = { name: name.trim(), latitude, longitude, ...(typeof country === "string" ? { country: country.slice(0, 100) } : {}), ...(typeof region === "string" ? { region: region.slice(0, 120) } : {}) };
  } else return { error: "location is required as a place name or a selected geocoding result." };
  let plannedTime: string | undefined;
  if (body.plannedTime !== undefined && body.plannedTime !== null && body.plannedTime !== "") {
    if (typeof body.plannedTime !== "string" || !Number.isFinite(Date.parse(body.plannedTime))) return { error: "plannedTime must be a valid ISO date/time." };
    plannedTime = body.plannedTime;
  }
  return { value: { location, activity, radiusKm, ...(plannedTime ? { plannedTime } : {}) } };
}

function resolvedLocation(location: RecommendationRequest["location"], found?: LocationResult): LocationResult {
  if (typeof location === "string") return found!;
  return { id: `selected:${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`, name: location.name, displayName: [location.name, location.region, location.country].filter(Boolean).join(", "), latitude: location.latitude, longitude: location.longitude, country: location.country, region: location.region, source: "Selected geocoding result" };
}

export function createOutdoorRouter(overrides: Partial<Dependencies> = {}) {
  const router = Router();
  const deps = { ...defaults, ...overrides };

  router.get("/health", (_req, res) => res.json({ status: "ok", service: "OutdoorIQ API", timestamp: new Date().toISOString() }));
  router.get("/api/health", (_req, res) => res.json({ status: "ok", service: "OutdoorIQ API", timestamp: new Date().toISOString() }));

  router.get("/api/geocode", asyncRoute(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (query.trim().length < 2 || query.length > 120) return errorResponse(res, 400, "INVALID_LOCATION_QUERY", "Enter a place search between 2 and 120 characters.");
    try {
      const results = await deps.geocode(query);
      return res.json({ results, source: results[0]?.source || "Open-Meteo Geocoding / OpenStreetMap Nominatim", resolved: results.length > 0 });
    } catch (error) {
      const provider = error instanceof ProviderError;
      return errorResponse(res, provider ? 503 : 500, provider ? "GEOCODING_UNAVAILABLE" : "GEOCODING_ERROR", error instanceof Error ? error.message : "Location search failed.");
    }
  }));

  router.post("/recommend", asyncRoute(async (req, res) => {
    const parsed = validateRequest(req.body);
    if (!parsed.value) return errorResponse(res, 400, "INVALID_REQUEST", parsed.error || "Invalid recommendation request.");
    const request = parsed.value;
    let placeFromQuery: LocationResult | undefined;
    if (typeof request.location === "string") {
      try { placeFromQuery = (await deps.geocode(request.location))[0]; }
      catch (error) { return errorResponse(res, 503, "GEOCODING_UNAVAILABLE", error instanceof Error ? error.message : "Location search is temporarily unavailable."); }
      if (!placeFromQuery) return errorResponse(res, 404, "LOCATION_NOT_FOUND", `No matching place was found for “${request.location}”. Try a nearby city, landmark, or park name.`);
    }
    const location = resolvedLocation(request.location, placeFromQuery);
    const [nearbyResult, weather, airQuality] = await Promise.allSettled([
      deps.nearby(location.latitude, location.longitude, request.radiusKm, request.activity),
      deps.weather(location.latitude, location.longitude, request.plannedTime),
      deps.air(location.latitude, location.longitude),
    ]);
    const warnings: string[] = [];
    const places = nearbyResult.status === "fulfilled" ? nearbyResult.value : [];
    if (nearbyResult.status === "rejected") {
      const nearbyError = nearbyResult.reason;
      if (nearbyError instanceof ProviderError && nearbyError.kind === "no-match") warnings.push(`No verified mapped ${request.activity} places were found within ${request.radiusKm} km.`);
      else warnings.push(`Nearby place data is currently unavailable (${nearbyError instanceof Error ? nearbyError.message : "provider error"}); no places have been invented.`);
    }
    const weatherData = weather.status === "fulfilled" ? weather.value : { ...EMPTY_WEATHER, note: weather.reason instanceof Error ? weather.reason.message : EMPTY_WEATHER.note };
    const airData = airQuality.status === "fulfilled" ? airQuality.value : { ...EMPTY_AIR, note: airQuality.reason instanceof Error ? airQuality.reason.message : EMPTY_AIR.note };
    if (weatherData.status === "unavailable") warnings.push("Weather data is unavailable; weather was excluded from suitability scoring.");
    if (request.plannedTime && !weatherData.planned) warnings.push("No hourly forecast was available close to the requested time; current conditions are shown separately and are not used as a substitute for that time.");
    if (airData.status === "unavailable") warnings.push("Air-quality data is unavailable; air quality was excluded from suitability scoring.");
    const candidates = places.map(place => ({ ...place, distanceKm: Math.round(haversineDistanceKm(location.latitude, location.longitude, place.latitude, place.longitude) * 100) / 100 })).filter(place => place.distanceKm <= request.radiusKm && place.activityTypes.includes(request.activity));
    const weatherForScoring = request.plannedTime && !weatherData.planned ? { ...weatherData, status: "unavailable" as const, current: null } : weatherData;
    const ranked = scorePlaces(candidates, request.activity, request.radiusKm, weatherForScoring, airData, request.plannedTime);
    const modelResult = await deps.model(ranked, location, request.activity);
    if (!modelResult.used && process.env.SLM_BASE_URL && ranked.length) warnings.push("Optional SLM explanations were unavailable; deterministic explanations are shown.");
    const response: RecommendationResponse = {
      location, activity: request.activity, radiusKm: request.radiusKm, recommendations: modelResult.recommendations,
      weather: weatherData, airQuality: airData, recommendationMode: modelResult.used ? "slm-assisted" : "deterministic",
      generatedAt: new Date().toISOString(), dataSources: [...new Set([location.source, ...places.map(place => place.source), ...(weatherData.status === "available" ? [weatherData.source] : []), ...(airData.status === "available" ? [airData.source] : [])])],
      warnings, safetyNote: "Suitability scores are estimates from mapped place tags and provider data; they are not a safety guarantee. Verify local access, current conditions, and route suitability before setting out.",
    };
    return res.json(response);
  }));

  const openApi = {
    openapi: "3.0.3", info: { title: "OutdoorIQ API", version: "1.0.0", description: "Location-aware outdoor recommendations. Provider data can be unavailable; missing values are reported rather than fabricated." },
    paths: {
      "/health": { get: { summary: "Health check", responses: { "200": { description: "Service ready" } } } },
      "/api/geocode": { get: { summary: "Search for places", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", minLength: 2, maxLength: 120 } }], responses: { "200": { description: "Resolved place suggestions" }, "400": { description: "Invalid search" }, "503": { description: "Geocoding services unavailable" } } } },
      "/recommend": { post: { summary: "Rank outdoor places for an activity", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["location", "activity"], properties: { location: { oneOf: [{ type: "string" }, { type: "object", required: ["name", "latitude", "longitude"], properties: { name: { type: "string" }, latitude: { type: "number" }, longitude: { type: "number" }, country: { type: "string" }, region: { type: "string" } } }] }, activity: { type: "string", enum: activities }, radiusKm: { type: "number", minimum: 1, maximum: 20, default: 5 }, plannedTime: { type: "string", format: "date-time" } } } } } }, responses: { "200": { description: "Ranked recommendation data with provider provenance" }, "400": { description: "Invalid request" }, "404": { description: "Place not found" }, "503": { description: "Geocoding unavailable" } } } },
    },
  };
  router.get("/openapi.json", (_req, res) => res.json(openApi));
  router.get("/docs", (_req, res) => res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OutdoorIQ API Docs</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:900px;margin:48px auto;padding:0 22px;color:#21382d;background:#f6f5ed}h1{font-family:Georgia,serif;font-size:42px}code,pre{background:#e7eadf;padding:3px 6px;border-radius:5px}section{border:1px solid #d6ddcf;border-radius:14px;padding:22px;margin:18px 0;background:white}.verb{display:inline-block;background:#dcebdc;color:#28543a;border-radius:5px;padding:3px 8px;font-weight:700}</style><h1>OutdoorIQ API</h1><p>Live place search, weather-aware outdoor recommendations, and health.</p><section><h2><span class="verb">GET</span> /health</h2><p>Unauthenticated service health check.</p></section><section><h2><span class="verb">GET</span> /api/geocode?q=...</h2><p>Returns place suggestions with coordinates and provider provenance. Unknown places return an empty result list; unavailable providers return a useful 503 error.</p></section><section><h2><span class="verb">POST</span> /recommend</h2><p>JSON: <code>{"location":"Pune, India","activity":"walking","radiusKm":5,"plannedTime":"2026-10-25T08:00:00+05:30"}</code>. Activity: walking, running, cycling, hiking. Radius: 1–20 km; plannedTime is optional.</p><pre>curl -X POST http://localhost:3000/recommend -H 'Content-Type: application/json' -d '{"location":"Pune, India","activity":"walking","radiusKm":5}'</pre><p>Responses distinguish weather/AQ measurements or model estimates, calculated scores, explanation mode, warnings, and sources.</p></section><section><h2>OpenAPI schema</h2><p><a href="/openapi.json">GET /openapi.json</a></p></section></html>`));
  router.use(outdoorApiErrorHandler);
  return router;
}
