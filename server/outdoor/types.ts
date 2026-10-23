export type Activity = "walking" | "running" | "cycling" | "hiking";

export interface LocationResult {
  id: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  country?: string;
  region?: string;
  kind?: string;
  source: string;
}

export interface OutdoorPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  categories: string[];
  activityTypes: Activity[];
  source: "OpenStreetMap" | "OpenStreetMap Nominatim";
  openingHours?: string;
  surface?: string;
  description?: string;
}

export interface WeatherReading {
  temperatureC: number | null;
  feelsLikeC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  windKph: number | null;
  humidityPct: number | null;
  weatherCode: number | null;
  daylight: boolean | null;
  time: string | null;
}

export interface WeatherSnapshot {
  status: "available" | "unavailable";
  source: "Open-Meteo";
  attribution: string;
  units: { temperature: "°C"; precipitation: "mm"; wind: "km/h" };
  timezone?: string;
  current: WeatherReading | null;
  planned: WeatherReading | null;
  retrievedAt: string;
  note?: string;
}

export interface AirQualitySnapshot {
  status: "available" | "unavailable";
  source: "Open-Meteo Air Quality";
  attribution: string;
  index: { name: "US AQI" | "European AQI"; value: number; category: string } | null;
  pollutants: { pm2_5: number | null; pm10: number | null; ozone: number | null; nitrogenDioxide: number | null };
  units: { index: "AQI"; concentration: "μg/m³" };
  time: string | null;
  retrievedAt: string;
  note?: string;
}

export interface RecommendationRequest {
  location: string | { name: string; latitude: number; longitude: number; country?: string; region?: string };
  activity: Activity;
  radiusKm: number;
  plannedTime?: string;
}

export interface RankedRecommendation {
  place: OutdoorPlace;
  score: number;
  scoreBreakdown: { placeFit: number; distance: number; conditions: number | null; airQuality: number | null; timing: number | null };
  explanation: string;
  reasons: string[];
  cautions: string[];
}

export interface RecommendationResponse {
  location: LocationResult;
  activity: Activity;
  radiusKm: number;
  recommendations: RankedRecommendation[];
  weather: WeatherSnapshot;
  airQuality: AirQualitySnapshot;
  recommendationMode: "deterministic" | "slm-assisted";
  generatedAt: string;
  dataSources: string[];
  warnings: string[];
  safetyNote: string;
}
