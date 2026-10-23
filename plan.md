# OutdoorIQ implementation plan

## Project context

Only the written brief was attached; no ZIP or pre-existing OutdoorIQ source was present. This project is therefore a fresh implementation in the initialized OutdoorIQ workspace, not a repair of an existing repository. The workspace is a React 19 + TypeScript + Vite frontend with an Express/TypeScript server and a preinstalled pnpm toolchain. I will preserve that stack, use the existing Express server for the public API, and avoid adding a database because recommendations are computed per request and do not need persistent user data.

## Implementation approach

### User workflow and API

The home page will let a visitor search for a place, select walking, running, cycling, or hiking, set a search radius and optional planned time, then request recommendations. Place lookup will use Open-Meteo Geocoding first and Nominatim as a controlled fallback, returning a disambiguatable place name, coordinates, country/region, and type. Failed lookups will return a clear recoverable error rather than silently choosing a different place. A debounced location suggestion endpoint and the recommendation request will use same-origin JSON HTTP routes.

The Express server will expose `GET /health` and the existing-compatible `GET /api/health`, `GET /docs` plus an OpenAPI document, `GET /api/geocode?q=...`, and `POST /recommend`. Request/response data will be schema-validated and errors will have a consistent JSON envelope. Browser calls will be relative to the app origin; no external provider key will be placed in the frontend.

### Geo-data and recommendation pipeline

Small server modules will isolate geocoding, OpenStreetMap/Overpass retrieval, Open-Meteo weather and air-quality retrieval, distance calculations, scoring, and optional model explanations. Provider calls will have configurable timeouts, restrained retries, cache entries, and clear unavailable-data states. Nominatim will be identified with an application User-Agent and throttled in accordance with its public usage policy. Nearby searches use compact activity-specific Overpass tag queries for parks, walk paths, trails, cycle routes and tagged outdoor sports grounds, and try three public mirrors sequentially, returning the first verified in-radius result set; a bounded, strict-tag Nominatim fallback follows when the mirrors fail or return no matches. The Pune live checks illustrate shared-provider variability: a 10 km walking request returned 12 verified OSM places, while a 5 km request returned no verified matches. Public providers remain subject to their availability and fair-use rules; weather and air-quality failures remain visibly unavailable rather than being invented.

POIs will be deduplicated, categorized from OSM tags, and limited by requested radius. Point places use haversine distance; OSM ways/relations use returned geometry and nearest-segment distance converted to geographic distance, so an in-radius feature is not dropped only because its center lies outside the requested radius. Activity suitability combines place relevance, distance, weather (including rain, heat and wind), modeled air quality where available, daylight, and planned time. Scores are calculated and explainable; if a provider dimension is unavailable it is omitted and the remaining configured weights are renormalized, not imputed as a neutral observation. Measured provider data, derived scores, and generated text are distinct in API fields and result UI. Recommendations include freshness/source metadata and a non-guarantee safety notice. Opening status is shown only when supported by OSM opening-hours data.

An optional, disabled-by-default OpenAI-compatible SLM connector will read a configurable base URL, model name, API key, and timeout from server environment variables. It will only produce concise explanations from the validated, already-ranked evidence; its output will be parsed/validated. If credentials or a local model server are absent, or the request fails or returns invalid data, the deterministic scorer remains the recommendation engine and the API/UI explicitly reports `deterministic` mode. The app will not download model weights during startup.

### Frontend and visual direction

The responsive dashboard will combine a focused search/action rail, condition summaries, ranked recommendation cards, and a synchronized interactive Leaflet map with a marker for the searched coordinate and markers for results. The map uses no-key OpenStreetMap Germany raster tiles and OpenStreetMap attribution. The CARTO response rendered an API-key placeholder in embedded Preview, so a smoke-tested OSM Germany endpoint replaced it. Loading, no-location, no-results, provider-degradation, and retry states will be visible. The layout will collapse cleanly on mobile, with keyboard-operable search/suggestions and accessible labels.

Three uncommon visual directions considered: field-notes trail atlas (0.08), alpine editorial field guide (0.06), and topographic eco-instrument panel (0.04). I propose **field-notes trail atlas**: a warm paper-like canvas with deep forest ink, a sharp fern-green action color, fine contour/grid motifs, small technical labels, and generous editorial typography. The layout is map-led rather than a generic centered card grid. Interactions will feel measured and calm; location changes re-center the map, result focus highlights its marker, and motion stays brief and functional. Proposed typography is a compact, legible sans-serif for controls/body with a distinctive editorial serif for large headlines. The wordmark will pair “outdoorIQ” with a simple contour-pin mark. Brand essence: a clear-eyed field guide for choosing a good place to move outdoors; curious, grounded, candid. Example voice: “Find a little more outside.” / “Good conditions, nearby.”

No decorative hero image is planned: this is a map and data utility, so geographic visualization is the primary visual asset.

### Project structure

- `client/src/pages/Home.tsx` — main OutdoorIQ search, conditions, and result experience.
- `client/src/components/OutdoorMap.tsx` — Leaflet/OSM map, location/result markers, and selected-result state.
- `client/src/index.css` — responsive field-atlas design system and page styling.
- `client/public/manus-routes.json` — synchronized declaration for the root page.
- `server/outdoor/types.ts` — validated request/response and provider data types, including nullable unavailable-score dimensions.
- `server/outdoor/providers.ts` — search normalization, Open-Meteo/Nominatim geocoding, throttling/caches, activity-specific sequential Overpass mirror failover and bounded Nominatim nearby retrieval, and Open-Meteo weather/forecast/AQ calls.
- `server/outdoor/recommend.ts` — haversine distance, configurable and normalized deterministic scoring, safety caveats, ranking, and optional validated SLM explanation adapter.
- `server/outdoor/routes.ts` — REST route registration, health, OpenAPI/docs, validation, provider orchestration, CORS/error handling.
- `server/outdoor/providers.test.ts` and `routes.test.ts` — mocked-provider tests plus real HTTP calls to a local Express listener.
- `client/src/components/OutdoorMap.tsx` — Leaflet results map using no-key OpenStreetMap Germany raster tiles and OSM attribution.
- `.env.example`, `.gitignore`, `README.md`, and `app.config.ts` — configuration, portability, setup/run instructions, verification/limitations, troubleshooting, judge demo script, and durable project-logo metadata.

## Delivery and verification

I will add the minimum frontend dependencies needed for the map, keep the existing pinned pnpm setup, implement the API and UI, and add mocked tests for provider failures, unknown locations, scoring, input validation, and structured outputs. I will run type-checks, automated tests, a production build, live HTTP smoke checks for health/docs/geocoding/recommendations when network access permits, and an actual browser-to-backend UI check. Documentation will state which checks were automated/mocked, which were live, and any provider limitations. No existing code ZIP was supplied, so ZIP repair/preservation cannot be verified; I will keep the fresh implementation in the project workspace and make the requested website available in Preview.
