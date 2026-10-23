import type { Activity, AirQualitySnapshot, LocationResult, OutdoorPlace, RankedRecommendation, WeatherSnapshot } from "./types";

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreWeather(weather: WeatherSnapshot, activity: Activity) {
  const reading = weather.planned || weather.current;
  let score = 82;
  const cautions: string[] = [], reasons: string[] = [];
  if (weather.status !== "available" || !reading) return { score: 65, cautions: ["Live weather data is unavailable; conditions were not included in the score."], reasons: ["Weather could not be included in this ranking."], reading: null };
  if (reading.precipitationProbabilityPct !== null) {
    if (reading.precipitationProbabilityPct >= 70) { score -= 24; cautions.push("High forecast chance of precipitation."); }
    else if (reading.precipitationProbabilityPct >= 40) { score -= 12; cautions.push("Some chance of precipitation."); }
    else reasons.push("Low forecast precipitation chance.");
  } else if ((reading.precipitationMm ?? 0) > 0.5) { score -= 14; cautions.push("Precipitation is present in the available forecast."); }
  const feels = reading.feelsLikeC ?? reading.temperatureC;
  if (feels !== null && feels >= 36) { score -= activity === "running" || activity === "hiking" ? 24 : 19; cautions.push("High apparent temperature; consider reducing effort or postponing."); }
  else if (feels !== null && feels >= 31) { score -= 10; cautions.push("Warm conditions may make sustained outdoor activity harder."); }
  else if (feels !== null && feels >= 10 && feels <= 26) reasons.push("Temperature is within a comfortable range for many people.");
  if (reading.windKph !== null && reading.windKph >= 40) { score -= 17; cautions.push("Strong wind is forecast."); }
  else if (reading.windKph !== null && reading.windKph >= 28) { score -= 8; cautions.push("Breezy conditions may affect exposed routes."); }
  else if (reading.windKph !== null) reasons.push("Wind is not especially strong in the available forecast.");
  return { score: Math.max(0, Math.min(100, score)), cautions, reasons, reading };
}

function scoreAir(air: AirQualitySnapshot) {
  const value = air.index?.value;
  if (air.status !== "available" || value === null || value === undefined) return { score: 65, caution: "Air-quality index is unavailable; it was not included in the score." };
  if (air.index?.name === "US AQI") {
    if (value > 200) return { score: 5, caution: "Very unhealthy or hazardous modeled AQI; consider avoiding strenuous activity." };
    if (value > 150) return { score: 22, caution: "Unhealthy modeled AQI; sensitive groups should consider avoiding strenuous activity." };
    if (value > 100) return { score: 48, caution: "Elevated modeled AQI; sensitive groups may want to reduce exertion." };
    if (value > 50) return { score: 72, caution: undefined as string | undefined };
    return { score: 94, caution: undefined as string | undefined };
  }
  if (value > 80) return { score: 15, caution: "Very poor modeled European AQI; consider avoiding strenuous activity." };
  if (value > 60) return { score: 38, caution: "Poor modeled European AQI; sensitive groups should take care." };
  if (value > 40) return { score: 62, caution: undefined as string | undefined };
  return { score: 90, caution: undefined as string | undefined };
}

function scoreWeights() {
  const read = (key: string, fallback: number) => {
    const value = Number(process.env[`OUTDOORIQ_SCORE_WEIGHT_${key}`]);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
  };
  return { placeFit: read("PLACE_FIT", 38), distance: read("DISTANCE", 18), conditions: read("CONDITIONS", 22), airQuality: read("AIR_QUALITY", 17), timing: read("TIMING", 5) };
}

function activityRelevance(place: OutdoorPlace, activity: Activity) {
  const direct = place.activityTypes.includes(activity);
  const kinds = place.categories.join(" ").toLowerCase();
  if (activity === "cycling" && (kinds.includes("cycle") || kinds.includes("bike"))) return direct ? 98 : 85;
  if (activity === "hiking" && (kinds.includes("trail") || kinds.includes("green") || kinds.includes("path"))) return direct ? 95 : 82;
  if (activity === "running" && (kinds.includes("track") || kinds.includes("park") || kinds.includes("path"))) return direct ? 95 : 84;
  if (activity === "walking" && (kinds.includes("park") || kinds.includes("path") || kinds.includes("garden"))) return 92;
  return direct ? 76 : 42;
}

function deterministicExplanation(place: OutdoorPlace, activity: Activity, score: number, reasons: string[], cautions: string[]) {
  const main = `${place.name} is a ${place.categories.slice(0, 2).join(" and ").toLowerCase() || "mapped outdoor place"} ${place.distanceKm.toFixed(1)} km away, ranked for ${activity}.`;
  const why = reasons.slice(0, 2).join(" ");
  const caveat = cautions[0] ? ` ${cautions[0]}` : "";
  return `${main}${why ? ` ${why}` : ""}${caveat} Suitability score: ${score}/100; this is a data-based guide, not a safety guarantee.`;
}

export function scorePlaces(places: OutdoorPlace[], activity: Activity, radiusKm: number, weather: WeatherSnapshot, air: AirQualitySnapshot, plannedTime?: string): RankedRecommendation[] {
  const weatherScore = scoreWeather(weather, activity);
  const airScore = scoreAir(air);
  const daylightScore = weatherScore.reading?.daylight === false ? 45 : weatherScore.reading?.daylight === true ? 85 : null;
  const weights = scoreWeights();
  return places.map(place => {
    const placeFit = activityRelevance(place, activity);
    const distanceScore = Math.max(0, Math.round(100 * (1 - place.distanceKm / Math.max(radiusKm, 0.1))));
    const conditions = weatherScore.reading ? weatherScore.score : null;
    const airQuality = air.status === "available" && air.index?.value !== null && air.index?.value !== undefined ? airScore.score : null;
    const dimensions = [
      { value: placeFit, weight: weights.placeFit },
      { value: distanceScore, weight: weights.distance },
      { value: conditions, weight: weights.conditions },
      { value: airQuality, weight: weights.airQuality },
      { value: daylightScore, weight: weights.timing },
    ].filter((item): item is { value: number; weight: number } => item.value !== null && item.weight > 0);
    const activeWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
    const score = activeWeight > 0 ? Math.round(dimensions.reduce((sum, item) => sum + item.value * item.weight, 0) / activeWeight) : Math.round((placeFit + distanceScore) / 2);
    const reasons = [`Mapped as ${place.categories.slice(0, 2).join(" and ").toLowerCase() || "an outdoor place"}, which can suit ${activity}.`, `Approximately ${place.distanceKm.toFixed(1)} km from the selected location.`];
    if (weatherScore.reasons.length) reasons.push(...weatherScore.reasons.slice(0, 1));
    if (plannedTime && weather.planned) reasons.push(`Weather estimate aligned to ${weather.planned.time || plannedTime}.`);
    const cautions = [...weatherScore.cautions];
    if (airScore.caution) cautions.push(airScore.caution);
    if (!weatherScore.reading?.daylight && weatherScore.reading?.daylight !== null && weatherScore.reading) cautions.push("The available conditions indicate darkness at the selected time.");
    if (place.openingHours) reasons.push(`Map data lists hours: ${place.openingHours}; confirm with the venue before setting out.`);
    const scoreBreakdown = { placeFit, distance: distanceScore, conditions, airQuality, timing: daylightScore };
    return { place, score, scoreBreakdown, explanation: deterministicExplanation(place, activity, score, reasons, cautions), reasons, cautions };
  }).sort((a, b) => b.score - a.score || a.place.distanceKm - b.place.distanceKm).slice(0, 12);
}

function extractJson(content: unknown): any {
  if (typeof content !== "string") throw new Error("SLM response did not contain text.");
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.explanations)) throw new Error("SLM response did not match the expected explanations schema.");
  return parsed;
}

export async function addModelExplanations(recommendations: RankedRecommendation[], location: LocationResult, activity: Activity): Promise<{ recommendations: RankedRecommendation[]; used: boolean }> {
  const baseUrl = process.env.SLM_BASE_URL?.trim();
  const model = process.env.SLM_MODEL?.trim();
  if (!baseUrl || !model || recommendations.length === 0) return { recommendations, used: false };
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const evidence = recommendations.map(item => ({ name: item.place.name, score: item.score, distanceKm: item.place.distanceKm, categories: item.place.categories, reasons: item.reasons, cautions: item.cautions }));
  const timeout = Math.min(30000, Math.max(1000, Number(process.env.SLM_TIMEOUT_MS) || 8000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", ...(process.env.SLM_API_KEY ? { Authorization: `Bearer ${process.env.SLM_API_KEY}` } : {}) }, body: JSON.stringify({ model, temperature: 0.2, max_tokens: 450, messages: [{ role: "system", content: "Write brief, factual outdoor recommendation explanations only from supplied evidence. Do not invent safety, access, opening, route, or weather facts. Return only JSON with this shape: {\"explanations\":[{\"name\":\"exact supplied place name\",\"text\":\"one or two sentences\"}]}" }, { role: "user", content: JSON.stringify({ location: location.displayName, activity, recommendations: evidence }) }] }) });
    if (!response.ok) throw new Error(`SLM returned HTTP ${response.status}`);
    const body: any = await response.json();
    const parsed = extractJson(body?.choices?.[0]?.message?.content);
    const approved = new Map<string, string>();
    for (const entry of parsed.explanations) {
      if (typeof entry?.name === "string" && typeof entry?.text === "string" && recommendations.some(item => item.place.name === entry.name) && entry.text.length > 20 && entry.text.length <= 500) approved.set(entry.name, entry.text);
    }
    if (!approved.size) throw new Error("SLM returned no valid place explanations.");
    return { recommendations: recommendations.map(item => approved.has(item.place.name) ? { ...item, explanation: approved.get(item.place.name)! } : item), used: true };
  } catch (error) {
    console.warn("[OutdoorIQ] Optional SLM explanation unavailable; deterministic explanations retained:", error instanceof Error ? error.message : "unknown error");
    return { recommendations, used: false };
  } finally { clearTimeout(timer); }
}
