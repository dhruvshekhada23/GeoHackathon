# OutdoorIQ delivery tracker

All criteria below come from the approved project brief. Statuses reflect implementation and verification evidence; limits are recorded below.

## 1. Location search and resolution — complete

- Users can search for a city, neighbourhood, landmark, park, or recognizable point of interest in India or internationally.
- Normalize search text, return geographically resolved place suggestions with display name, coordinates, country/region or other relevant metadata, and the source.
- Handle ambiguous place names by presenting selectable results rather than silently choosing an unrelated location.
- Give useful unknown-place suggestions/errors; never substitute a default location.
- Handle external-service timeouts, rate limits, network failures, provider outages, and empty responses; use suitable fallbacks and caching while respecting provider usage policies.

## 2. Nearby outdoor places and interactive map — complete

- Retrieve geographically relevant nearby parks, walking paths, running/cycle routes, hiking trails, sports facilities, and other suitable points of interest using OpenStreetMap/Overpass or a suitable alternative.
- Use timeouts, retries, provider fallbacks, activity relevance filtering, radius filtering, deduplication, and distances calculated from geographic coordinates.
- Return useful mapped results when one nearby-place provider fails and another source is available; if sources fail or return no matches, say so and do not invent locations.
- Display an interactive map synchronized to the selected search result and recommendation cards, including the selected location, recommendation markers, names, distances, and useful details; map tiles and data attribution must be visible.
- Show no hard-coded demo location or stale results unrelated to the selected coordinates.

## 3. Weather and air-quality conditions — complete

- Retrieve real current weather/forecast and air-quality data, including planned-time forecast when available; present temperature, precipitation, wind, available pollutants/AQI, correct units, provider/source attribution, and observation/forecast valid time.
- Distinguish modeled air-quality estimates from local sensor measurements.
- Represent unavailable/missing provider data honestly, exclude unavailable scoring dimensions, and never fabricate live values.

## 4. Explainable activity recommendations and optional SLM — complete

- Validate each recommendation request and resolve the selected location; retrieve nearby places, weather, air quality, and relevant provider metadata.
- Calculate activity-specific suitability for walking, running, cycling, and hiking; consider distance, requested radius, relevant mapped place types, current/planned weather, rain, heat, wind, air quality, and time of day; filter unsupported/out-of-radius candidates and rank the rest.
- Use a suitable geographic distance calculation and explain scores and conditions concisely; penalize unsuitable conditions and flag notable concerns without promising safety or claiming unsupported opening status.
- Return structured, schema-validated JSON distinguishing provider observations/model estimates, calculated scores, provenance/freshness, and any generated explanations.
- Keep scoring deterministic, testable, and independent from optional SLM output; make scoring weights configurable where practical.
- Reuse an existing functional SLM integration if one exists; otherwise support optional configurable local or hosted OpenAI-compatible SLM settings via environment variables. Do not claim a model exists without inspecting it and do not automatically download large model weights at startup.
- Validate structured model output; handle model timeout, provider unavailability, malformed responses, and resource limits. Use deterministic explanations whenever optional SLM use is unavailable, and label recommendation mode accurately so fallback is never claimed as SLM output.
- Document optional model/API-key setup separately; keep private keys server-side.

## 5. Backend/API and starter compatibility — complete

- Use a correct, maintainable TypeScript/Node package structure with compatible dependencies and canonical documented startup commands.
- Provide validated request/response schemas, defaults, useful consistent JSON errors, appropriate status codes, actual frontend CORS for configured origins, nonblocking asynchronous provider HTTP, configurable timeouts, and graceful external-provider failures.
- Provide unauthenticated `GET /health`, readable `/docs`, `POST /recommend`, and the location-search endpoint used by the UI; retain relevant initialized starter routes/helpers.
- Expose frontend API configuration by environment variable without putting private keys in browser bundles; do not commit secrets.
- Log unexpected request failures rather than hiding them in unexplained catch-all exceptions.

## 6. Responsive, functional frontend — complete

- Provide validated place search and selectable resolved suggestions; activity selection for walking, running, cycling, and hiking; optional radius and planned time; and a working recommendation action.
- Show loading/disabled states, helpful empty/error/retry states, ranked result cards with place, geographic distance, suitability score, relevant conditions, concise explanation, and source/freshness.
- Keep map markers and results synchronized; show weather and air-quality summaries, units, timestamps, pollutants where available, and attribution.
- Use polished consistent hackathon-ready visual styling that works at desktop and mobile widths.
- Use live provider data; do not add fake demo recommendations, hard-coded locations, private frontend keys, inert/broken actions, or browser console errors.

## 7. Setup, portability, and documentation — complete

- Provide `.env.example`; ignore local secrets, caches, virtual environments, and downloaded model files/weights; keep the deliverable portable and reasonably lightweight.
- Give exact Windows PowerShell and Linux/macOS installation/start commands from the correct project directory, with an unambiguous integrated start command and separately documented backend/frontend commands if supported.
- Document API/provider configuration, CORS, timeouts, optional SLM service/model/API-key setup, and troubleshooting for dependencies, imports, ports, network/provider failures, and model failures.
- Document project structure, architecture/data flow, API endpoints, technologies, implemented features and verification state, required manual configuration, remaining limitations, and a short hackathon-judge demonstration script.

## 8. Verification and provenance — complete

- Automated tests use mocked external providers and include real HTTP requests against a local server for health/docs, request validation, recognized/unknown places, representative structured recommendations, provider failures, deterministic fallback, and malformed requests.
- Perform real provider smoke tests when network and provider usage policies permit; clearly distinguish mocked tests, live checks, and untested functionality, and never claim an untested feature works.
- Run type checking/build and fix issues revealed before handoff. State exact commands for anything that cannot be verified.
- The attachment contains only the written brief; there is no supplied ZIP/source project to inspect or preserve. Keep relevant initialized starter functionality; do not claim ZIP inspection or modification.

## Evidence and remaining limits

- `pnpm check`, `pnpm test` (4 files, 20 tests), and `pnpm build` passed. Live `/health`, `/docs`, `/openapi.json`, `/manus-routes.json`, Pune geocoding, and unknown-place `LOCATION_NOT_FOUND` checks were exercised.
- Preview workflow selected real Pune geocoding results and rendered weather/AQ data, accessible pollutant details, an interactive map with successfully loaded OSM Germany tiles, and the correct provider-degraded empty state. Both Overpass endpoints timed out in this environment; the conservative Nominatim fallback found no verifiable nearby place on the final run. It intentionally returned no invented results.
- No optional SLM instance/API key was configured, and a mobile-sized browser viewport was not separately tested. The written brief was supplied without a project ZIP; this is a fresh implementation.
