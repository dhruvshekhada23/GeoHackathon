import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, AlertTriangle, ArrowUpRight, Bike, Check, ChevronDown, Clock3, CloudRain, Compass, Footprints, LocateFixed, MapPin, Mountain, RefreshCw, Search, Sparkles, Wind } from "lucide-react";
import type { Activity as ActivityType, AirQualitySnapshot, LocationResult, RecommendationResponse, WeatherSnapshot } from "../../../server/outdoor/types";

const OutdoorMap = lazy(() => import("@/components/OutdoorMap"));

type StatusError = { error?: { code?: string; message?: string } };
const activityOptions: { id: ActivityType; label: string; detail: string; icon: typeof Footprints }[] = [
  { id: "walking", label: "Walk", detail: "Easy-going paths", icon: Footprints },
  { id: "running", label: "Run", detail: "Parks & tracks", icon: Activity },
  { id: "cycling", label: "Cycle", detail: "Bike-friendly routes", icon: Bike },
  { id: "hiking", label: "Hike", detail: "Trails & green space", icon: Mountain },
];
const toLocalInput = (date: Date) => { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const emptyMessage = "Search a place to see what’s around you.";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const apiBase = String((import.meta as any).env?.VITE_OUTDOORIQ_API_BASE_URL || "").replace(/\/$/, "");
  const response = await fetch(`${apiBase}${url}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json() as T & StatusError;
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  return data;
}

function conditionDescription(code: number | null) {
  if (code === null) return "Current conditions";
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return code === 1 ? "Mostly clear" : "Clouds passing";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain nearby";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Current conditions";
}
function formatNum(value: number | null | undefined, suffix = "") { return value === null || value === undefined ? "—" : `${Math.round(value * 10) / 10}${suffix}`; }
function weatherToShow(weather: WeatherSnapshot) { return weather.planned || weather.current; }
function aqiTone(value?: number) { if (value === undefined) return "neutral"; return value <= 50 ? "good" : value <= 100 ? "fair" : value <= 150 ? "caution" : "poor"; }
function airIndexNumber(air: AirQualitySnapshot) { return air.index?.value; }

function WeatherStrip({ weather, air }: { weather: WeatherSnapshot | null; air: AirQualitySnapshot | null }) {
  const reading = weather ? weatherToShow(weather) : null;
  const weatherTime = reading?.time ? `${reading.time.replace("T", " ")}${weather?.timezone ? ` · ${weather.timezone.replaceAll("_", " ")}` : " · provider local time"}` : "Time unavailable";
  const pm25 = air?.pollutants.pm2_5, pm10 = air?.pollutants.pm10;
  const pollutantSummary = air?.status === "available" ? [pm25 === null ? null : `PM2.5 ${formatNum(pm25)}`, pm10 === null ? null : `PM10 ${formatNum(pm10)}`].filter(Boolean).join(" · ") || "Pollutants not reported" : "Pollutant data unavailable";
  const allPollutants = air?.status === "available" ? `PM2.5 ${formatNum(pm25)} · PM10 ${formatNum(pm10)} · O₃ ${formatNum(air.pollutants.ozone)} · NO₂ ${formatNum(air.pollutants.nitrogenDioxide)} ${air.units.concentration}` : "Air-quality pollutant values unavailable.";
  return <div className="conditions-strip" aria-label="Live conditions">
    <div className="condition-item condition-primary" title={weather?.attribution || "Weather data unavailable"}><span className="condition-icon"><CloudRain size={17} /></span><span className="condition-copy"><small>{weather?.status === "available" ? (weather.planned ? "PLANNED FORECAST" : "CURRENT · OPEN-METEO") : "WEATHER"}</small><strong>{weather?.status === "available" && reading ? `${formatNum(reading.temperatureC, "°C")}` : "Unavailable"}</strong><em>{weather?.status === "available" && reading ? `${conditionDescription(reading.weatherCode)} · ${reading.time?.slice(11, 16) || "time —"} ${weather.timezone || "local"}` : "No live reading"}</em></span></div>
    <div className="condition-item"><span className="condition-icon"><Wind size={17} /></span><span className="condition-copy"><small>WIND</small><strong>{weather?.status === "available" ? formatNum(reading?.windKph, " km/h") : "—"}</strong><em>{reading?.precipitationProbabilityPct === null || reading?.precipitationProbabilityPct === undefined ? "Precipitation —" : `Rain chance ${Math.round(reading.precipitationProbabilityPct)}%`}</em></span></div>
    <div className={`condition-item aqi-${aqiTone(airIndexNumber(air || ({ index: null } as AirQualitySnapshot)))}`} title={`${air?.attribution || "Air-quality source unavailable"}${air?.time ? ` · valid at ${air.time}` : ""} · ${allPollutants}`}><span className="condition-icon"><Activity size={17} /></span><div className="condition-copy"><small>{air?.index?.name || "AIR QUALITY"}{air?.time ? ` · ${air.time.slice(11, 16)} ${weather?.timezone || "local"}` : ""}</small><strong>{air?.status === "available" && air.index ? `${air.index.value} · ${air.index.category}` : "Unavailable"}</strong><em>{air?.status === "available" ? `${pollutantSummary} μg/m³ · modeled` : "Not included in score"}</em>{air?.status === "available" && <details className="pollutant-more"><summary>More pollutant data</summary><span>O₃ {formatNum(air.pollutants.ozone)} · NO₂ {formatNum(air.pollutants.nitrogenDioxide)} {air.units.concentration}</span></details>}</div></div>
  </div>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null);
  const [activity, setActivity] = useState<ActivityType>("walking");
  const [radius, setRadius] = useState(5);
  const [plannedTime, setPlannedTime] = useState("");
  const [suggestions, setSuggestions] = useState<LocationResult[]>([]);
  const [suggestionError, setSuggestionError] = useState("");
  const [response, setResponse] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [activeResult, setActiveResult] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeActivity = useMemo(() => activityOptions.find(option => option.id === activity)!, [activity]);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (selectedLocation || value.length < 2) { setSuggestions([]); setSuggestionError(""); setLoadingSuggestions(false); return; }
    const controller = new AbortController();
    controllerRef.current?.abort(); controllerRef.current = controller;
    const timer = setTimeout(async () => {
      setLoadingSuggestions(true); setSuggestionError("");
      try {
        const data = await apiJson<{ results: LocationResult[] }>(`/api/geocode?q=${encodeURIComponent(value)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSuggestions(data.results);
      } catch (reason) {
        if (!controller.signal.aborted) { setSuggestions([]); setSuggestionError(reason instanceof Error ? reason.message : "Could not search this place."); }
      } finally { if (!controller.signal.aborted) setLoadingSuggestions(false); }
    }, 320);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, selectedLocation]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".location-search")) setShowSuggestions(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const chooseLocation = (place: LocationResult) => {
    setSelectedLocation(place); setQuery(place.displayName); setSuggestions([]); setShowSuggestions(false); setSuggestionError(""); setError("");
  };
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) { setError("Enter a city, park, landmark, or neighbourhood to start."); inputRef.current?.focus(); return; }
    if (!selectedLocation) { setError("Choose a place from the location suggestions so the map and conditions use a resolved location."); setShowSuggestions(true); inputRef.current?.focus(); return; }
    setSearching(true); setError(""); setResponse(null); setActiveResult(null);
    try {
      const data = await apiJson<RecommendationResponse>("/recommend", { method: "POST", body: JSON.stringify({ location: { name: selectedLocation.name, latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, country: selectedLocation.country, region: selectedLocation.region }, activity, radiusKm: radius, ...(plannedTime ? { plannedTime: new Date(plannedTime).toISOString() } : {}) }) });
      setResponse(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "We couldn’t find recommendations right now. Please try again."); }
    finally { setSearching(false); }
  };
  const resetLocation = () => { setResponse(null); setSelectedLocation(null); setQuery(""); setSuggestions([]); setError(""); setTimeout(() => inputRef.current?.focus(), 0); };

  return <main className="app-shell">
    <header className="topbar">
      <a href="/" className="brand" aria-label="OutdoorIQ home"><span className="brand-mark"><svg viewBox="0 0 40 40" role="img" aria-hidden="true"><path d="M7 29 17 10l6 11 4-7 7 15H7Z"/><path d="M11 29c7-7 12-7 18 0"/><circle cx="28.5" cy="10.5" r="2.5"/></svg></span><span className="brand-name">outdoor<span>IQ</span></span></a>
      <nav className="topnav"><a className="nav-link active" href="#explore">Explore</a><a className="nav-link" href="/docs" target="_blank" rel="noreferrer">API docs <ArrowUpRight size={13}/></a></nav>
      <div className="topbar-right"><span className="live-pill"><i/> LIVE DATA</span><span className="avatar">O</span></div>
    </header>
    <div className="page-wrap" id="explore">
      <section className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line"/>YOUR NEXT GOOD OUTING</div><h1>Find a little more <em>outside.</em></h1><p className="hero-subtitle">A field guide for finding the right place to move — shaped by what’s around you and what’s in the air.</p></div><div className="edition-tag"><Compass size={15}/><span>FIELD GUIDE <b>01</b></span></div></section>
      <section className="search-panel" aria-label="Outdoor activity search">
        <div className="search-panel-top"><div className="panel-title"><span className="step-number">01</span><div><strong>Where do you want to go?</strong><small>Start with a city, a park, or a place you know.</small></div></div>{selectedLocation && <button type="button" className="edit-location" onClick={resetLocation}>Change place <RefreshCw size={13}/></button>}</div>
        <form onSubmit={submit} className="search-form">
          <div className="location-search"><label className="input-label" htmlFor="place-search">LOCATION</label><div className={`location-input-wrap ${error && !selectedLocation ? "has-error" : ""}`}><MapPin size={19} className="location-pin"/><input ref={inputRef} id="place-search" autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setSelectedLocation(null); setResponse(null); setError(""); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} onKeyDown={event => { if (event.key === "Escape") setShowSuggestions(false); if (event.key === "Enter" && suggestions[0]) { event.preventDefault(); chooseLocation(suggestions[0]); } }} placeholder="Try ‘Lodhi Garden, New Delhi’" aria-autocomplete="list" aria-expanded={showSuggestions && suggestions.length > 0}/>{loadingSuggestions && <span className="tiny-loader"/>}{selectedLocation && <Check size={17} className="selected-check"/>}</div>
            {showSuggestions && (suggestions.length > 0 || loadingSuggestions || suggestionError || (query.trim().length >= 2 && !selectedLocation)) && <div className="suggestions" role="listbox" aria-label="Place suggestions">{loadingSuggestions && <div className="suggestion-state">Looking for nearby places…</div>}{!loadingSuggestions && suggestionError && <div className="suggestion-state suggestion-error">{suggestionError}</div>}{!loadingSuggestions && !suggestionError && suggestions.length === 0 && <div className="suggestion-state">No exact place found. Try a city, landmark, or more specific name.</div>}{suggestions.map(place => <button type="button" key={place.id} role="option" className="suggestion-option" onMouseDown={event => event.preventDefault()} onClick={() => chooseLocation(place)}><span className="suggestion-icon"><MapPin size={15}/></span><span><strong>{place.name}</strong><small>{place.displayName}</small></span><span className="suggestion-provider">{place.source.includes("Nominatim") ? "OSM" : "MAP"}</span></button>)}</div>}
            <div className="input-hint">{selectedLocation ? <><LocateFixed size={12}/> {selectedLocation.latitude.toFixed(4)}, {selectedLocation.longitude.toFixed(4)} · {selectedLocation.source}</> : <><Search size={12}/> Suggestions include Indian and international places</>}</div>
          </div>
          <div className="activity-options"><span className="input-label">ACTIVITY</span><div className="activity-selector" role="radiogroup" aria-label="Outdoor activity">{activityOptions.map(option => { const Icon = option.icon; return <button type="button" role="radio" aria-checked={activity === option.id} key={option.id} className={`activity-option ${activity === option.id ? "selected" : ""}`} onClick={() => setActivity(option.id)}><Icon size={18}/><span><strong>{option.label}</strong><small>{option.detail}</small></span>{activity === option.id && <Check size={14} className="activity-check"/>}</button>; })}</div></div>
          <div className="filter-row"><label className="filter-control"><span className="input-label">RADIUS</span><span className="select-wrap"><select value={radius} onChange={event => setRadius(Number(event.target.value))}><option value={3}>3 km</option><option value={5}>5 km</option><option value={10}>10 km</option><option value={15}>15 km</option><option value={20}>20 km</option></select><ChevronDown size={15}/></span></label><label className="filter-control time-control"><span className="input-label">WHEN <i>OPTIONAL</i></span><span className="datetime-wrap"><Clock3 size={15}/><input type="datetime-local" value={plannedTime} min={toLocalInput(new Date())} onChange={event => setPlannedTime(event.target.value)}/></span></label><button type="submit" className="find-button" disabled={searching}>{searching ? <><span className="button-spinner"/> Finding places</> : <><Sparkles size={17}/> Find my outside <ArrowUpRight size={15}/></>}</button></div>
          {(error || (suggestionError && !showSuggestions)) && <div className="form-error" role="alert"><AlertTriangle size={15}/>{error || suggestionError}</div>}
        </form>
      </section>

      {response ? <>
        <div className="results-intro"><div><div className="eyebrow"><span className="eyebrow-line"/>YOUR FIELD NOTES</div><h2>Outside near <em>{response.location.name}</em></h2><p className="results-meta">{response.recommendations.length} place{response.recommendations.length === 1 ? "" : "s"} · {activity} · within {response.radiusKm} km <span className="dot-divider">·</span> {response.recommendationMode === "slm-assisted" ? <><Sparkles size={12}/> SLM-assisted explanations</> : <>Calculated ranking · no SLM configured</>}</p></div><button type="button" className="text-button" onClick={() => submit()} disabled={searching}><RefreshCw size={14}/> Refresh</button></div>
        <WeatherStrip weather={response.weather} air={response.airQuality}/>
        {response.warnings.length > 0 && <div className="warning-banner"><AlertTriangle size={15}/><div>{response.warnings.map((warning, index) => <span key={index}>{warning}{index < response.warnings.length - 1 ? " " : ""}</span>)}</div></div>}
        <div className="results-layout">
          <section className="recommendations-column"><div className="section-heading"><span>RANKED FOR YOU</span><span>{response.recommendations.length} RESULTS</span></div>
            {response.recommendations.length ? response.recommendations.map((item, index) => <article key={item.place.id} className={`place-card ${activeResult === item.place.id ? "focused" : ""}`} onMouseEnter={() => setActiveResult(item.place.id)} onMouseLeave={() => setActiveResult(null)}><div className="place-card-top"><span className="rank-label">0{index + 1} <i>·</i> {item.place.categories[0] || "OUTDOOR PLACE"}</span><span className={`score-badge ${item.score >= 75 ? "score-good" : item.score >= 50 ? "score-mid" : "score-low"}`}><strong>{item.score}</strong><small>FIT</small></span></div><h3>{item.place.name}</h3><div className="place-meta"><span><MapPin size={13}/>{item.place.distanceKm.toFixed(1)} km away</span>{item.place.openingHours && <span><Clock3 size={13}/>Hours in map data · verify locally</span>}</div><p className="place-explanation">{item.explanation}</p>{item.cautions.length > 0 && <div className="place-cautions"><AlertTriangle size={14}/><span>{item.cautions.join(" ")}</span></div>}<div className="place-card-footer"><span className="place-source">OSM MAP DATA</span><button type="button" onClick={() => setActiveResult(item.place.id)} className="map-focus">Show on map <ArrowUpRight size={13}/></button></div></article>) : <div className="empty-results"><div className="empty-icon"><Mountain size={20}/></div><strong>No mapped {activity} places found in this radius.</strong><p>Try a larger search radius or another activity. If nearby map data is unavailable, results are left empty rather than invented.</p></div>}
          </section>
          <aside className="map-column"><div className="map-heading"><div><span className="section-heading">FIELD MAP</span><span className="map-subheading">{response.location.displayName}</span></div><span className="map-live"><i/> OSM</span></div><Suspense fallback={<div className="interactive-map map-loading">Preparing the interactive map…</div>}><OutdoorMap location={response.location} places={response.recommendations.map(item => item.place)} activeId={activeResult} onSelect={setActiveResult}/></Suspense><div className="map-legend"><span><i className="legend-user"/> Starting point</span><span><i className="legend-place"/> Recommendation</span></div><div className="map-attribution">© OpenStreetMap contributors · OSM Germany tiles · Map data can be incomplete.</div><div className="safety-note"><AlertTriangle size={14}/><span>{response.safetyNote}</span></div></aside>
        </div>
        <div className="data-footnote"><span>DATA AS OF {new Date(response.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>{response.dataSources.join(" · ")}</span><span>Conditions are estimates, not a safety guarantee.</span></div>
      </> : <>
        <div className="first-look-row"><div><span className="eyebrow"><span className="eyebrow-line"/>THE OUTDOORIQ METHOD</span><h2>Less guesswork.<br/><em>Better outside.</em></h2></div><div className="method-steps"><div className="method-step"><span>01</span><strong>Know your place</strong><p>Real mapped green spaces, paths and trails near your chosen location.</p></div><div className="method-step"><span>02</span><strong>Read the conditions</strong><p>Weather forecasts and modeled air quality, with sources and freshness noted.</p></div><div className="method-step"><span>03</span><strong>Make a call</strong><p>Explainable activity fit and distance scores — never a promise of safety.</p></div></div></div>
        <div className="empty-map-preview"><div className="preview-grid"/><div className="preview-contour contour-a"/><div className="preview-contour contour-b"/><div className="preview-contour contour-c"/><span className="preview-coordinate">LOCATION NOT SET</span><div className="preview-center"><span className="preview-marker"><Compass size={22}/></span><strong>Your map starts here.</strong><p>Choose a real place above to see nearby outdoor options.</p></div><span className="preview-scale">OUTDOORIQ · FIELD NOTES 01</span></div>
        <div className="empty-footnote"><span>NO LOCATION SELECTED</span><span>Search to load live map, weather and air-quality data.</span></div>
      </>}
      <footer className="site-footer"><a className="footer-brand" href="/">outdoor<span>IQ</span></a><span>Maps, weather and modeled air-quality data help inform your plans. They do not guarantee route access or personal safety.</span><a href="/docs" target="_blank" rel="noreferrer">API documentation <ArrowUpRight size={12}/></a></footer>
    </div>
  </main>;
}
