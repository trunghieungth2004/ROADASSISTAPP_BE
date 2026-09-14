# Routing engine: OSRM → Valhalla

The backend used to route on a self-hosted OSRM instance with a custom
`motorbike.lua` profile; it now routes on self-hosted Valhalla
(`motor_scooter` costing). The migration decision is recorded in
[ARCHITECTURE.md](./ARCHITECTURE.md); provisioning in
[INFRASTRUCTURE.md](./INFRASTRUCTURE.md) / [DEPLOY.md](./DEPLOY.md).
This page is the usage-facing delta: what behaves differently in the app,
and what the new limits are.

## How a route is solved now

1. Cache lookup by `origin:stops:dest:widthBucket` (unchanged).
2. One `POST /route` to Valhalla (`motor_scooter`, no width params).
3. The geometry is checked against blocking hazard flags and measured
   alley widths (unchanged hit-testing).
4. On a hit, re-solves carry every blocking circle as `exclude_polygons`,
   so the detour grows natively around the closure. The detour is
   **closure-aware**: each failed attempt merges the zones the re-solve
       newly crossed into the exclusion set and re-solves — up to
    `DETOUR_ATTEMPTS` = 4 attempts (`DETOUR_MAX_ZONES` = 8 zones),
    every attempt reusing the true reported radii (no growth). Anything still blocked returns soft-blocked
    (raw geometry + `hazards`) instead of `409` — except an
    origin/stop/destination sitting inside a flag's circle, which is
    refused with a named `409` (`EndpointBlockedError`: which control
    point + the flag), since no avoidance exists.

The old flow probed up to ~19 OSRM calls per incident (nearest-road
snapping + per-via re-solves) and stitched the winner in as a `via`
waypoint, which produced the backtrack-loop artifacts. The new flow
issues one engine call per option plus at most 4 detour attempts; when
an attempt-0 re-solve threads a gap and discovers 2+ new zones
(cascade), `steerThroughCorridor` (`service/routing/corridor.ts`)
evaluates up to 3 anchored multi-point solves around the blocked
cluster (8 bearings, shortest-duration clean one wins, otherwise the
chained solve stands) — the anchor stays server-side, and the response
has no waypoints to stitch.

## Route alternatives

Stop-less requests send `alternates: 4` (want = `MAX_ROUTE_OPTIONS` = 5)
in the single Valhalla call; Valhalla returns extras at top-level
`alternates[].trip`, parsed by `utils/valhalla.postRoutes` (entries without
a usable shape are skipped; entries with geometry identical to an
already-seen route are dropped by `dedupeRoutes`, so the engine can
never return two copies of the same route). Requests with `stops` omit
`alternates` and return one route. Cache entries store the routes array;
pre-alternatives single-route entries are still readable (legacy read),
and cached arrays are de-duplicated on read as well. The image pins
`max_alternates: 6` (server default is 2 — `alternates: 4` is refused
without it); see `infra/valhalla/Dockerfile`.

Per option, in order: the primary goes through the full hazard +
width-gate pipeline (detour on block). Each alternative gets the same
detour treatment via `buildAlternative` — a blocked alternative is
re-solved with `exclude_polygons`, not dropped on first contact. When an
alternative's detour still fails, it is kept as a soft-blocked option
(raw geometry + `hazards`) instead of disappearing. When several
options' detours converge on the same geometry, the copies are dropped
(`dedupeRoutes` on the final options, first kept) — the engine can
never return two copies of the same route. Width-only blocks
still drop the alternative (physical impossibility). A blocked primary
falls back to the first safe alternative; when nothing is safe, the
primary is returned soft-blocked (raw geometry + `hazards`) rather than
`409`. `active_routes` records the returned primary geometry. Block
decisions are logged as `[routing] primary-blocked / alt-width-drop /
alt-detour-failed / primary-fallback / detour-chained / corridor-steered`
with the route key
(`detour-chained` carries the newly discovered zone ids merged into the
exclusion set; `corridor-steered` carries the adopted steered distance).

Cost: still a bounded number of engine HTTP calls (`alternates: 4`
ride in the one base call; detours add at most 4 per blocked option,
plus up to 3 corridor-steering solves on cascade paths that discover
2+ new zones);
measured live at ~34–48 ms for 3 routes vs ~24–39 ms for 1 (≈10–15 ms
delta — the engine is self-hosted, so no per-call cost change). `409`
now only fires for width-only blocks, an origin/stop/destination inside
a flag zone (`EndpointBlockedError`), unreachable engine, or no engine
path.

## What changed in app usage

| Behavior | Before (OSRM) | Now (Valhalla) |
|---|---|---|
| Fresh-route `source` | `"osrm"` | `"valhalla"` (`"cache"` / `"detour"` unchanged) |
| Detour `via` | `{lat, lng}` waypoint clients could display | always absent (`null`) — there is no waypoint; FE already guards on it |
| Detour `hazards` | blocking zones of the base route | same |
| `distanceMeters` / `durationSeconds` | OSRM MLD + Lua scooter speeds | Valhalla `motor_scooter` costing — expect small differences for the same OD |
| Width shaping | engine-side: OSM `width`/`maxwidth` classes excluded per bucket (`exclude=narrowonly[,mediumonly]`) | engine is width-agnostic; **only** app-measured `alley_segments` gate, as 20 m avoidance polygons |
| Untagged narrow OSM ways | avoided for MEDIUM/WIDE buckets | routable unless an alley segment blocks them |
| No-route mapping | `code: NoRoute` → `404` | `error 442` → `404` (same app behavior) |
| Endpoint inside a closure | `409` after the probe loop burned calls | `409` naming the control point + flag (`EndpointBlockedError`), no detour attempted |
| Stops | up to 10, one call | up to 10, one call (`locations` in order) |

## Limits

| Limit | Value | Notes |
|---|---|---|
| Stops per request | 10 (app validation) | engine allows 50 locations; app stays the binding constraint |
| Route options | up to 5 (`MAX_ROUTE_OPTIONS`), stop-less requests only | `alternates: 4` in the one Valhalla call (needs image `max_alternates: 6`); identical engine alternates are dropped (`dedupeRoutes`, also applied to cached arrays); blocked options return soft-blocked with `hazards` instead of `409` |
| Route distance | 500 km (engine `max_distance`, `motor_scooter`) | **new**: OSRM had no cap — intercity routes (e.g. HCMC → Hanoi) are refused by the engine and surface as `500`, not `404`/`409` |
| Avoidance budget | 100 km total `exclude_polygons` circumference (raised from the 10 km default in our image) | ~79 simultaneous 200 m flood circles; past it the engine 400s and the API returns `500` |
| Detour attempts | up to 4 chained attempts (`DETOUR_ATTEMPTS`), each re-solving with every zone discovered so far at true reported radii (no growth), then soft-blocked return; on a cascade (2+ new zones at attempt 0, two-point requests only) up to 3 anchored corridor solves are tried first and the shortest clean one wins | was up to 3 via-probing passes + `409`. Observed live: a concave wall of exclusion circles leaves near-tied engine corridors, and the unpinned solve can descend a side street and loop back (U-turn-shaped double-pass) while staying time-optimal — steering picks the cleaner-looking thread at equal cost, never a genuinely shorter one; outsized detours in dev almost always trace to the caller's own `"1"` flags (data, not code) |
| Detour extra distance | +15 km over base, then soft-blocked return (width-only blocks → `409`) | unchanged |
| Engine timeout | 15 s + 1 retry | unchanged (cold-boot tolerance) |
| Width gate radius | 20 m around incompatible segments | unchanged |
| Hazard radii / types / statuses | `FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m; `"2"`/`"3"` (+ own `"1"`) | unchanged |
| Cache TTL | 30 d default, 90 d recommended prod | unchanged; detours stay uncached |

## Engine settings

What the engine is, how it is configured, and what the app assumes.
Sources: `infra/valhalla/Dockerfile`, `infra/valhalla/setup.sh`,
`functions/utils/valhalla.ts`, `functions/service/routingService.ts`,
`functions/service/routing/detour.ts`.

### Image (`infra/valhalla/Dockerfile`)

- Base `ghcr.io/valhalla/valhalla:latest`; OSM extract baked at build
  time (default `asia/vietnam-latest.osm.pbf`, overridable via `OSM_URL`
  build arg). Tiles/admins/extract are built into the image
  (`valhalla_build_tiles` / `valhalla_build_admins` /
  `valhalla_build_extract`, served from `tiles.tar`).
- Engine config (`/data/valhalla.json`) is patched at build time:
  - `"max_alternates": 6` (server default is 2) — required for the
    app's `alternates: 4`. Requests above the server cap are refused.
  - `"max_exclude_polygons_length": 100000` (meters; raised from the
    10 km default) — the avoidance budget (~79 simultaneous 200 m
    flood circles; past it the engine 400s and the API returns `500`).
- Runtime: serves on `:8002` (`valhalla_service /data/valhalla.json`).

### Provisioning (`infra/valhalla/setup.sh`)

- Three modes via `VALHALLA_MODE`: `cloud` (Cloud Build image +
  Cloud Run engine, default), `local` (local docker build + push +
  Cloud Run engine), `dev` (local docker build + local `valhalla-local`
  container on `VALHALLA_PORT`, default `8002`).
- Local-dev note: editing `/data/valhalla.json` inside a running
  container only takes effect after `docker restart <container>`; the
  edit lives in the container's writable layer until the container is
  removed or rebuilt, so bake durable changes into the Dockerfile sed.

### App client (`functions/utils/valhalla.ts`)

- `VALHALLA_COSTING = "motor_scooter"` — built-in profile, no custom
  profile to maintain. Route distance is capped by the engine at
  ~500 km for this costing (intercity ODs surface as `500`).
- `POST {VALHALLA_URL}/route`, `VALHALLA_TIMEOUT_MS = 15000` with one
  fetch retry (cold-boot tolerance for a scale-to-zero engine).
- `alternates: want - 1` (capped at `MAX_ALTERNATES = 4`), stop-less
  requests only; extras arrive as top-level `alternates[].trip`
  (shape-less entries skipped, identical geometries dropped by
  `dedupeRoutes`: 32 sampled vertices rounded to 5 decimals).
- `exclude_polygons` is sent as **raw rings** — an array of
  `[lng, lat]` point lists (`circleToRing`, `RING_STEPS` = 32 plus the
  closing vertex). This engine rejects the wrapped
  `{polygon, attribute}` shape with a 400, so do not "fix" the wire
  format without re-verifying against the running engine.

### App caps

`MAX_ROUTE_OPTIONS = 5` (stop-less), `DETOUR_ATTEMPTS = 4`
(closed growing exclusion set per detour, true reported radii,
`DETOUR_MAX_ZONES = 8`),
`MAX_EXTRA_DISTANCE_METERS = 15000` over base, width pseudo-radius
20 m (`WIDTH_PSEUDO_RADIUS_METERS`), hazard radii `FLOOD` 200 m /
`OBSTRUCTION`+`ACCIDENT` 100 m with per-flag `radiusMeters` flooring up.

## Operational side-by-side

| | Before (OSRM) | Now (Valhalla) |
|---|---|---|
| Image | `osrm-motorbike`, 4.94 GB (graph baked at build) | `valhalla-vietnam`, 2.19 GB (tiles baked at build, served from `tiles.tar`) |
| Runtime RAM | ~2.8 GiB | ~1 GiB |
| Cloud Run shape | 8Gi / 2 vCPU, `:5000` | 4Gi / 2 vCPU, `:8002` |
| Profile | custom `motorbike.lua` (speeds + width classes) | built-in `motor_scooter`, no profile to maintain |
| Provisioning | `infra/osrm/setup.sh` (`OSRM_MODE`, `OSRM_URL`) | `infra/valhalla/setup.sh` (`VALHALLA_MODE`, `VALHALLA_URL`), same 3 modes |
| Posture | scale-to-zero, max 2 | unchanged |

Rollback: the `osrm-local` container is stopped (image retained locally and
in Artifact Registry); restarting it and pointing `VALHALLA_URL` back is
*not* sufficient — the request/response contract differs, so a rollback
also needs the pre-migration `routingService` + `detour*` code (still in
git history).
