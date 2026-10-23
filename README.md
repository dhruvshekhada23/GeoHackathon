# OutdoorIQ — Find your outside

OutdoorIQ is a location-aware outdoor activity field guide. Choose a resolved place, activity, search radius, and optional time to see mapped outdoor places ranked with real provider weather, modeled air-quality information, geographic distance, and explainable suitability scores.

> **Project provenance:** the supplied attachment contained the written brief only; it did not include an existing ZIP or source project. This is a fresh TypeScript implementation in the initialized React/Express workspace, not a repair of an unseen Python repository. No claim is made about the original `No module named app` error.

## Features

- Search cities, neighbourhoods, parks, landmarks and other recognizable places using Open-Meteo Geocoding, with OpenStreetMap Nominatim as a throttled fallback. Results show provider and resolved coordinates; an unknown place is never replaced with a default.
- Search nearby parks, walking paths, hiking trails, cycle routes and tagged sports grounds through compact activity-specific OpenStreetMap Overpass queries, tried against public mirrors sequentially, then a bounded Nominatim fallback that rejects unverified place-class results. Overpass geometry supplies the nearest mapped point for area/path radius checks, so a nearby feature is not discarded just because its center lies beyond the radius. Results are deduplicated and radius-filtered.
- Interactive Leaflet map using the no-key OpenStreetMap Germany tile endpoint, with a selected-location marker, recommendation markers, selection highlighting, and OpenStreetMap attribution. The endpoint was smoke-tested and selected because the CARTO response showed an API-key placeholder in the actual embedded Preview even though a direct test tile request responded successfully.
- Live Open-Meteo weather current conditions and forecast data, including an optional planned-time forecast where available, plus Open-Meteo/CAMS modeled air-quality index and pollutant values. Missing data is explicitly marked unavailable; the app does not claim local sensor measurements.
- Deterministic, activity-specific ranking considers mapped place fit, distance, forecast rain, apparent heat, wind, daylight and modeled air quality. Configurable weights default to 38/18/22/17/5; missing dimensions are excluded (not imputed as neutral) and remaining weights are renormalized. Result explanations, nullable score components, warnings, timestamps and provenance are returned separately. Scores are estimates, not safety guarantees. Additional available pollutants can be expanded from the air-quality card without hover.
- Optional OpenAI-compatible local or hosted chat-completions model for concise explanations. It is off by default, cannot change the deterministic ranking, does not download model weights at startup, and is labeled SLM-assisted only when validated model explanations were used.
- Express REST health, geocoding, recommendation, `/docs`, and `/openapi.json` endpoints. The existing starter's tRPC/OAuth/system routes remain available.
- Responsive desktop/mobile field-atlas UI with validation, autocomplete, loading and empty/error states, condition cards, ranking and synchronized map.

## Architecture and data flow

The frontend is React/TypeScript served by Vite and the existing Express server. The integrated developer command starts one Express listener; Vite middleware serves the frontend in development, and the production server serves the built frontend. The implementation keeps the starter's tRPC/OAuth helpers but the outdoor workflow uses same-origin REST requests. The recommendation feature requires no database.

`server/outdoor/providers.ts` owns place lookup, Nominatim throttling, activity-specific sequential Overpass retrieval using OSM geometry, the bounded Nominatim fallback, Open-Meteo weather/air-quality calls, request timeouts, and short in-memory success/failure caches. `server/outdoor/recommend.ts` owns coordinate distance, independent deterministic scoring, safety caveats, and an optional validated explanation-only model call. `server/outdoor/routes.ts` validates and orchestrates those services and distinguishes a verified zero-match from a provider outage. `client/src/pages/Home.tsx` owns search state/results and the inline retry state; `client/src/components/OutdoorMap.tsx` displays the selected location and results on an interactive map.

Typical flow: location text → debounced provider-backed suggestions → user-selected coordinates → parallel nearby/weather/air lookups → coordinate distance and activity filtering → deterministic scoring/ranking → optional SLM explanation of validated evidence → structured response and synchronized map/cards.

## Requirements

- Node.js 22 LTS (or a compatible Node.js 20 release supported by Vite 7).
- pnpm 10.18.0 via Corepack (the package manager version is pinned in `package.json`).
- Network access to Open-Meteo and public OpenStreetMap services for live data. There are no required API keys for the default provider path.

## Windows PowerShell setup

Install Node.js 22, open PowerShell in the project directory, then run:

```powershell
corepack enable
corepack prepare pnpm@10.18.0 --activate
Copy-Item .env.example .env
pnpm install
pnpm dev
```

Open `http://localhost:3000`. `pnpm dev` runs the integrated app: Express API and Vite-served frontend on the same port. This is the simplest local and Preview workflow.

To run backend and frontend as separate processes instead, use two PowerShell terminals:

```powershell
# Terminal 1 — backend (default http://localhost:3001)
pnpm dev:backend

# Terminal 2 — Vite frontend (default http://localhost:5173; proxies API routes to :3001)
pnpm dev:frontend
```

Then open `http://localhost:5173`. For another frontend origin, set `FRONTEND_ORIGINS` on the backend to the exact allowed origin(s), comma-separated. `VITE_OUTDOORIQ_API_BASE_URL` can be set to a browser-reachable API origin when a Vite proxy is not used; leave it empty for the integrated app or the default proxy setup.

## Linux and macOS setup

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
cp .env.example .env
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The separate processes option is identical to PowerShell: run `pnpm dev:backend` and `pnpm dev:frontend` in separate terminals.

## Optional SLM setup

The default app works without an SLM. To use an optional local or hosted OpenAI-compatible chat-completions endpoint, configure these values in the server's `.env`:

```dotenv
SLM_BASE_URL=http://localhost:8000/v1
SLM_MODEL=your-instruct-model
SLM_API_KEY=
SLM_TIMEOUT_MS=8000
```

`SLM_BASE_URL` should be the base through `/v1`; OutdoorIQ appends `/chat/completions`. Use `SLM_API_KEY` only when your provider requires it. Keep the key server-side; do not put it in any `VITE_*` variable. Start the model service separately and download its model weights manually as required by that service. OutdoorIQ neither selects a particular model nor downloads weights on startup. The model receives ranked provider evidence and can supply short explanations only. Invalid output, timeout, missing config, or provider failure leaves deterministic explanations intact and the response remains labeled `deterministic`.

## Configuration

Copy `.env.example` to `.env`. `PORT` controls the integrated server (default 3000); `OUTDOORIQ_API_PORT` controls standalone backend mode (default 3001); `FRONTEND_ORIGINS` contains exact allowed browser origins for direct cross-origin calls; `OUTDOORIQ_HTTP_TIMEOUT_MS` controls provider timeouts (bounded by the application); `OUTDOORIQ_USER_AGENT` identifies Nominatim requests and should include a contact you control. Weather/geocoding/Overpass require no API key. Air-quality results are Open-Meteo/CAMS model estimates, not local sensor readings.

Only use `VITE_OUTDOORIQ_API_BASE_URL` for a public browser-reachable API origin. Values prefixed `VITE_` are delivered to the browser and must never contain secrets. `OUTDOORIQ_SCORE_WEIGHT_PLACE_FIT`, `OUTDOORIQ_SCORE_WEIGHT_DISTANCE`, `OUTDOORIQ_SCORE_WEIGHT_CONDITIONS`, `OUTDOORIQ_SCORE_WEIGHT_AIR_QUALITY`, and `OUTDOORIQ_SCORE_WEIGHT_TIMING` are relative weights from 0–100 (defaults 38, 18, 22, 17, 5). They are server-only. Missing provider dimensions are left out and active weights are renormalized.

## API

- `GET /health` (also `GET /api/health`) returns service status.
- `GET /api/geocode?q=Pune` returns geocoding suggestions with display names, coordinates, metadata, and provider source. Invalid queries return 400; a valid unknown query returns an empty `results` array; unavailable geocoding providers return 503.
- `POST /recommend` accepts either a place-name string or a selected location object:

```json
{"location":"Pune, India","activity":"walking","radiusKm":5}
```

```json
{"location":{"name":"Lodhi Garden","latitude":28.5933,"longitude":77.2197,"country":"India","region":"Delhi"},"activity":"running","radiusKm":8,"plannedTime":"2026-10-25T08:00:00+05:30"}
```

Activities: `walking`, `running`, `cycling`, `hiking`. `radiusKm` defaults to 5 and must be between 1 and 20. `plannedTime` is optional ISO date/time; an hourly forecast is selected when available near that time. Responses include resolved location, ranked place details and score breakdowns, explanations, weather, air quality, data sources, generated time, recommendation mode, warnings, and a safety caveat. Invalid input returns a structured `error` object; unknown resolved names return 404; unavailable place/condition providers are represented honestly.
- `GET /docs` is a readable API guide; `GET /openapi.json` returns the OpenAPI 3.0.3 schema.

## Checks

Commands:

```bash
pnpm check
pnpm test
pnpm build
```

The route tests use mocked external providers but make real HTTP requests to a local Express listener; they cover health/docs, request and malformed-JSON errors, a recognized mock location, unknown place handling, provider degradation, planned-time fallback, structured deterministic output, and score normalization. Mocked checks do not prove external providers are live. Exact checks from this project revision are recorded below; live provider availability still depends on network and public-service limits.

### Verification status

- Project provenance: only the written brief was supplied; no source ZIP/project archive was present.
- Automated: `pnpm check` passed; `pnpm test` passed (4 files, 26 tests); `pnpm build` passed. The build retains the initialized platform runtime-config script as provided by the starter.
- Local HTTP: `/health`, `/docs`, `/openapi.json`, and `/manus-routes.json` returned 200. Live `GET /api/geocode?q=Pune` returned seven selectable results; the India result resolved to `18.51957, 73.85535` via Open-Meteo. A live unknown `/recommend` request returned 404 `LOCATION_NOT_FOUND`; malformed JSON returned structured 400 `INVALID_JSON` in the HTTP test suite.
- Live providers: Open-Meteo geocoding, current weather, and modeled air quality returned data. One live 10 km Pune walking request returned 12 verified nearby OpenStreetMap places; a separate 5 km request and a later 10 km retry returned no mapped matches. Public OSM responses/coverage can vary by mirror and time, so the app preserves no-match results rather than filling them with guesses.
- Browser: selected Pune from real autocomplete and submitted a walking request. One 10 km Preview run rendered 12 ranked place cards with matching markers; a later post-reload 10 km run returned an honest no-match. The selected coordinate, current weather/AQ with timestamps and pollutant disclosure, and loaded OSM Germany map tiles rendered in the Preview, including the final empty state. Mobile viewport layout and optional SLM-provider execution were not separately verified.
- The current run uses deterministic mode; no SLM server/key was configured. Do not interpret mocked tests or unconfigured optional-model code as proof of an SLM provider deployment.

## Limitations and manual configuration

- OpenStreetMap coverage and tagging vary by region; mapped places/routes may be incomplete or stale. Overpass is a shared public service and may rate-limit or be unavailable; if it fails, one bounded Nominatim query may find nearby parks/paths, subject to the same public-service limits.
- Nominatim is used as a throttled geocoding/nearby fallback, not as an unrestricted high-volume search API. The app keeps short in-memory geocoding and nearby-result caches; cache entries do not persist across restarts.
- Open-Meteo weather is forecast/model data. Air quality is a CAMS model estimate; it is not a roadside sensor. Provider omissions remain unavailable in the UI.
- Only planned times near an available hourly forecast are forecast-scored; a time outside the forecast window is not silently represented as a forecast.
- OutdoorIQ cannot verify route surface/closure/access comprehensively, actual opening status, lighting, hazards, local laws, or a person's health. Confirm conditions and access independently; no score is a safety guarantee.
- Optional SLM use requires a manually configured compatible model server and (for hosted providers) a private API key. The default deterministic engine works without them.
- The original Python import issue and source-project preservation cannot be assessed because the referenced ZIP was not attached. The deliverable is TypeScript/React/Express, not a Python FastAPI port of an unseen codebase.

## Troubleshooting

- **`pnpm` missing or wrong version:** run `corepack enable` and `corepack prepare pnpm@10.18.0 --activate`; then run `pnpm --version`.
- **Port already in use:** set `PORT` (integrated app) or `OUTDOORIQ_API_PORT` (standalone backend) to a free port, and update the Vite proxy target if you change the API port. Restart both dev processes.
- **Place search returns no result:** try a fuller name with city/country; search results are provider matches, not arbitrary aliases. An empty result is not replaced by a default coordinate.
- **Provider timeout/403/429/503:** check outbound internet and the configured Nominatim User-Agent/contact, wait before retrying, reduce query radius, or try again later. Shared geocoding/map services may apply their own limits; do not run high-volume automated lookups.
- **Weather or AQ unavailable:** this is surfaced rather than fabricated. Check Open-Meteo service/network availability; the recommendation can still complete with those dimensions excluded.
- **Optional model unavailable or malformed:** confirm `SLM_BASE_URL`, `SLM_MODEL`, service reachability, and (if required) `SLM_API_KEY`; deterministic output remains the fallback.
- **TypeScript/build issues after dependency changes:** run `pnpm install`, `pnpm check`, then `pnpm build`; keep the lockfile committed with `package.json`.
- **Standalone cross-origin calls blocked:** use the provided Vite proxy, or include the exact frontend origin in `FRONTEND_ORIGINS`; avoid wildcard CORS for private deployments.

## Short hackathon demo script

1. Introduce OutdoorIQ as an explainable field guide, not a route-safety oracle.
2. Search for a recognizable place (for example, a park and city) and select the resolved suggestion; point out the coordinates and geocoding source.
3. Choose a walking/running/cycling/hiking activity, set radius and optional planned time, then run Find my outside.
4. Show the interactive map and ranked places; explain distance, activity-fit, weather and AQ contributions and any cautions.
5. Call out provider attribution, freshness, unavailable/degraded data handling, and the safety caveat.
6. Show `/docs` and the OpenAPI endpoint. If an optional model is configured, show its SLM-assisted label; otherwise show deterministic mode and explain that the fallback is intentional.

## Map-data provider notes

Overpass is a shared public service, not an availability guarantee. Its official [instance directory](https://wiki.openstreetmap.org/wiki/Overpass_API) notes that the main global service may be overloaded and recommends caching/rate limiting; the [operator usage guide](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) explains load shedding and 429/504 responses. OutdoorIQ sends a compact activity-specific query to one mirror at a time, caches successful nearby results for three minutes, and briefly caches repeated failures to avoid a retry storm. The app also has a bounded Nominatim fallback and never fills a failed search with guessed places. Queries request OSM geometry (`out geom`) so the requested-radius check can use actual mapped features rather than only area centers.

The public [Photon API documentation](https://github.com/komoot/photon/blob/master/docs/api-v1.md) was reviewed as a potential fallback; the bounded Pune check returned no safely verified outdoor POI to replace the current Overpass/Nominatim flow, so it is not presented as a live source. Public geocoding, map tile and nearby-data availability varies over time and by region. If the nearby API reports a service outage, retry shortly; a verified empty search instead reports that no tagged matches were found.

## License

MIT (starter project license).
