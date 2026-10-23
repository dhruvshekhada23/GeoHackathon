import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGeocodeCacheForTests, getNearbyPlaces, getWeather } from "./providers";

describe("nearby map provider degradation", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearGeocodeCacheForTests(); });

  it("uses a bounded Nominatim result when both Overpass requests fail", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("overpass-api.de") || url.includes("overpass.kumi.systems")) throw new Error("simulated timeout");
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("filters bounded-search results that fall outside the requested radius", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("overpass")) throw new Error("simulated timeout");
      return new Response(JSON.stringify([{ place_id: 321, type: "park", class: "leisure", name: "Too Far Park", lat: "18.9", lon: "73.9", extratags: {} }]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getNearbyPlaces(18.5204, 73.8567, 3, "walking")).rejects.toThrow("bounded Nominatim nearby search returned no matching places");
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
