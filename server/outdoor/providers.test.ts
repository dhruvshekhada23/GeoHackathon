import { afterEach, describe, expect, it, vi } from "vitest";
import { clearProviderCachesForTests, getNearbyPlaces, getWeather } from "./providers";

describe("nearby map provider degradation", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearProviderCachesForTests(); });

  it("returns strictly tagged places from the first working global Overpass mirror", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("overpass.openstreetmap.fr")) {
        return new Response(JSON.stringify({ elements: [
          { type: "way", id: 42, center: { lat: 18.521, lon: 73.856 }, tags: { leisure: "park" } },
          { type: "way", id: 43, center: { lat: 18.522, lon: 73.857 }, tags: { highway: "residential", name: "Not an outdoor path" } },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected mirror call: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await getNearbyPlaces(18.5204, 73.8567, 5, "walking");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Unnamed park");
    expect(results[0].source).toBe("OpenStreetMap");
    expect(results[0].distanceKm).toBeLessThan(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a mapped athletics sports centre for running", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { type: "way", id: 77, center: { lat: 18.521, lon: 73.856 }, tags: { leisure: "sports_centre", sport: "athletics", name: "Riverside Athletics Centre" } },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const results = await getNearbyPlaces(18.5204, 73.8567, 5, "running");
    expect(results).toHaveLength(1);
    expect(results[0].categories).toContain("athletics facility");
    expect(results[0].activityTypes).toContain("running");
  });

  it("measures a mapped park's geometry instead of incorrectly filtering by its distant center", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes("overpass.openstreetmap.fr")) throw new Error(`Unexpected mirror call: ${String(input)}`);
      return new Response(JSON.stringify({ elements: [
        { type: "way", id: 88, center: { lat: 18.59, lon: 73.90 }, geometry: [{ lat: 18.5205, lon: 73.8568 }, { lat: 18.53, lon: 73.86 }], tags: { leisure: "park", name: "Edge Park" } },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await getNearbyPlaces(18.5204, 73.8567, 5, "walking");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Edge Park");
    expect(results[0].distanceKm).toBeLessThan(0.1);
    expect(results[0].latitude).toBeCloseTo(18.5205, 3);
  });

  it("uses a bounded Nominatim result when all Overpass mirrors fail", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("overpass.openstreetmap.fr") || url.includes("overpass-api.de") || url.includes("overpass.private.coffee")) throw new Error("simulated timeout");
      if (url.includes("nominatim.openstreetmap.org/search") && url.includes("viewbox=")) {
        return new Response(JSON.stringify([{ place_id: 123, type: "park", class: "leisure", name: "Mapped Community Park", lat: "18.5250", lon: "73.8600", extratags: { opening_hours: "06:00-20:00" } }, { place_id: 456, type: "suburb", class: "place", name: "Not a park: Peth neighborhood", lat: "18.5260", lon: "73.8610", extratags: {} }, { place_id: 789, type: "park", class: "place", name: "Not a park: neighborhood mislabeled by type", lat: "18.5270", lon: "73.8620", extratags: {} }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await getNearbyPlaces(18.5204, 73.8567, 5, "walking");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Mapped Community Park");
    expect(results[0].source).toBe("OpenStreetMap Nominatim");
    expect(results[0].distanceKm).toBeGreaterThan(0);
    expect(results[0].distanceKm).toBeLessThan(5);
    expect(results[0].openingHours).toBe("06:00-20:00");
    expect(results.some(result => result.name.includes("Not a park"))).toBe(false);
    expect(results.some(result => result.name.includes("mislabeled by type"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("filters bounded-search results that fall outside the requested radius", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("overpass")) throw new Error("simulated timeout");
      return new Response(JSON.stringify([{ place_id: 321, type: "park", class: "leisure", name: "Too Far Park", lat: "18.9", lon: "73.9", extratags: {} }]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getNearbyPlaces(18.5204, 73.8567, 3, "walking")).rejects.toThrow("Nearby map data returned no verified outdoor places in this radius");
  });

  it("labels empty successful map responses as no-match rather than provider outage", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes("overpass") ? { elements: [] } : []), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getNearbyPlaces(18.5404, 73.8767, 3, "walking")).rejects.toMatchObject({ kind: "no-match" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("briefly caches identical provider outages to avoid repeated public-service load", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("simulated provider outage"); });
    vi.stubGlobal("fetch", fetchMock);
    const query = getNearbyPlaces(18.5304, 73.8667, 4, "walking");
    await expect(query).rejects.toThrow("Nearby map providers are temporarily unavailable");
    const firstCallCount = fetchMock.mock.calls.length;
    await expect(getNearbyPlaces(18.5304, 73.8667, 4, "walking")).rejects.toThrow("Nearby map providers are temporarily unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(firstCallCount);
  });
});

describe("location-local forecast time selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches a UTC planned instant to the provider's location-local forecast hour", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      timezone: "Asia/Kolkata", utc_offset_seconds: 19800,
      current: { time: "2026-10-24T09:00", temperature_2m: 25, weather_code: 1, wind_speed_10m: 5 },
      hourly: { time: ["2026-10-24T09:00", "2026-10-24T10:00"], temperature_2m: [28, 29], apparent_temperature: [28, 29], precipitation: [0, 0], precipitation_probability: [0, 0], wind_speed_10m: [6, 7], relative_humidity_2m: [40, 40], weather_code: [1, 1] },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await getWeather(18.52, 73.86, "2026-10-24T03:30:00Z");
    expect(result.planned?.temperatureC).toBe(28);
    expect(result.planned?.time).toBe("2026-10-24T09:00");
    expect(result.timezone).toBe("Asia/Kolkata");
  });
});
