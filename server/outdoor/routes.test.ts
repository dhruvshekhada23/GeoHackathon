import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOutdoorRouter, outdoorApiErrorHandler } from "./routes";
import { haversineDistanceKm, scorePlaces } from "./recommend";
import type { AirQualitySnapshot, LocationResult, OutdoorPlace, WeatherSnapshot } from "./types";

const location: LocationResult = { id: "om:1", name: "Pune", displayName: "Pune, Maharashtra, India", latitude: 18.5204, longitude: 73.8567, country: "India", region: "Maharashtra", source: "Open-Meteo Geocoding" };
const park: OutdoorPlace = { id: "osm:way:10", name: "City Park", latitude: 18.525, longitude: 73.86, distanceKm: 0.7, categories: ["Park", "Walking path"], activityTypes: ["walking", "running", "hiking"], source: "OpenStreetMap", openingHours: undefined };
const weather: WeatherSnapshot = { status: "available", source: "Open-Meteo", attribution: "Open-Meteo", units: { temperature: "°C", precipitation: "mm", wind: "km/h" }, current: { temperatureC: 23, feelsLikeC: 23, precipitationMm: 0, precipitationProbabilityPct: 5, windKph: 8, humidityPct: 50, weatherCode: 1, daylight: true, time: "2026-10-24T09:00" }, planned: null, retrievedAt: "2026-10-24T09:00:00Z" };
const air: AirQualitySnapshot = { status: "available", source: "Open-Meteo Air Quality", attribution: "CAMS model estimate", index: { name: "US AQI", value: 42, category: "Good" }, pollutants: { pm2_5: 8, pm10: 12, ozone: 25, nitrogenDioxide: 5 }, units: { index: "AQI", concentration: "μg/m³" }, time: "2026-10-24T09:00", retrievedAt: "2026-10-24T09:00:00Z" };

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let nearbyOverride: (...args: any[]) => any = vi.fn(async () => [park]);
let geocodeOverride: (...args: any[]) => any = vi.fn(async () => [location]);
let weatherOverride: (...args: any[]) => any = vi.fn(async () => weather);
let airOverride: (...args: any[]) => any = vi.fn(async () => air);
let modelOverride: (...args: any[]) => any = vi.fn(async (recommendations: any[]) => ({ recommendations, used: false }));

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(outdoorApiErrorHandler);
  app.use(createOutdoorRouter({ geocode: (...args: any[]) => geocodeOverride(...args), nearby: (...args: any[]) => nearbyOverride(...args), weather: (...args: any[]) => weatherOverride(...args), air: (...args: any[]) => airOverride(...args), model: (...args: any[]) => modelOverride(...args) } as any));
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start local HTTP test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe("OutdoorIQ HTTP API", () => {
  it("serves health and API documentation over real HTTP", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("ok");
    const docs = await fetch(`${baseUrl}/docs`);
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain("OutdoorIQ API");
    const openapi = await fetch(`${baseUrl}/openapi.json`);
    expect((await openapi.json()).openapi).toBe("3.0.3");
  });

  it("returns a useful validation error for invalid activity and location", async () => {
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "Pune", activity: "surfing" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("walking");
  });

  it("returns consistent JSON for malformed request bodies", async () => {
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{ invalid" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });

  it("logs unexpected handler errors and returns a structured internal error", async () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    modelOverride = vi.fn(async () => { throw new Error("expected test failure"); });
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: { name: location.name, latitude: location.latitude, longitude: location.longitude }, activity: "walking" }) });
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
    expect(failure).toHaveBeenCalled();
    failure.mockRestore();
    modelOverride = vi.fn(async (recommendations: any[]) => ({ recommendations, used: false }));
  });

  it("resolves a recognized place and returns structured deterministic recommendations", async () => {
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "Pune", activity: "walking", radiusKm: 5 }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.location.latitude).toBeCloseTo(18.5204);
    expect(data.recommendationMode).toBe("deterministic");
    expect(data.recommendations[0].place.name).toBe("City Park");
    expect(data.recommendations[0].score).toBeGreaterThan(0);
    expect(data.weather.source).toBe("Open-Meteo");
    expect(data.safetyNote).toContain("not a safety guarantee");
  });

  it("does not substitute current conditions for a requested time without a matching forecast", async () => {
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: { name: location.name, latitude: location.latitude, longitude: location.longitude }, activity: "walking", plannedTime: "2026-10-25T08:00:00Z" }) });
    const data = await response.json();
    expect(data.warnings.some((warning: string) => warning.includes("not used as a substitute"))).toBe(true);
    expect(data.recommendations[0].scoreBreakdown.conditions).toBeNull();
  });

  it("does not substitute a location when a search has no match", async () => {
    geocodeOverride = vi.fn(async () => []);
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "Unknown Place QXZ", activity: "walking" }) });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("LOCATION_NOT_FOUND");
    geocodeOverride = vi.fn(async () => [location]);
  });

  it("degrades honestly if nearby data fails and continues with available conditions", async () => {
    nearbyOverride = vi.fn(async () => { throw new Error("Overpass timed out"); });
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: { name: location.name, latitude: location.latitude, longitude: location.longitude }, activity: "walking" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.recommendations).toEqual([]);
    expect(data.weather.status).toBe("available");
    expect(data.warnings[0]).toContain("no places have been invented");
    nearbyOverride = vi.fn(async () => [park]);
  });

  it("reports geocoding-provider failure rather than returning unrelated results", async () => {
    geocodeOverride = vi.fn(async () => { throw new Error("provider down"); });
    const response = await fetch(`${baseUrl}/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "Pune", activity: "walking" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("GEOCODING_UNAVAILABLE");
    geocodeOverride = vi.fn(async () => [location]);
  });

  it("computes geographic distance and ranks by explicit conditions", () => {
    expect(haversineDistanceKm(0, 0, 0, 1)).toBeGreaterThan(111);
    const ranked = scorePlaces([park], "walking", 5, weather, air);
    expect(ranked[0].scoreBreakdown.placeFit).toBeGreaterThan(70);
    expect(ranked[0].scoreBreakdown.airQuality).toBeGreaterThan(80);
    expect(ranked[0].explanation).toContain("City Park");
  });

  it("excludes unavailable weather, daylight, and AQI from normalized scoring", () => {
    const noWeather: WeatherSnapshot = { ...weather, status: "unavailable", current: null, planned: null };
    const noAir: AirQualitySnapshot = { ...air, status: "unavailable", index: null };
    const [ranked] = scorePlaces([park], "walking", 5, noWeather, noAir);
    expect(ranked.scoreBreakdown.conditions).toBeNull();
    expect(ranked.scoreBreakdown.airQuality).toBeNull();
    expect(ranked.scoreBreakdown.timing).toBeNull();
    expect(ranked.score).toBe(Math.round((ranked.scoreBreakdown.placeFit * 38 + ranked.scoreBreakdown.distance * 18) / 56));
  });
});
