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
4. On a hit, **one** re-solve carries every blocking circle as
   `exclude_polygons`, so the detour grows natively around the closure;
   a still-blocked result gets one retry with 1.5× radii, then `409`.

The old flow probed up to ~19 OSRM calls per incident (nearest-road
snapping + per-via re-solves) and stitched the winner in as a `via`
waypoint, which produced the backtrack-loop artifacts. The new flow makes
at most 3 engine calls and has no waypoints to stitch.

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
| Endpoint inside a closure | `409` after the probe loop burned calls | immediate `409`, same shape |
| Stops | up to 10, one call | up to 10, one call (`locations` in order) |

## Limits

| Limit | Value | Notes |
|---|---|---|
| Stops per request | 10 (app validation) | engine allows 50 locations; app stays the binding constraint |
| Route distance | 500 km (engine `max_distance`, `motor_scooter`) | **new**: OSRM had no cap — intercity routes (e.g. HCMC → Hanoi) are refused by the engine and surface as `500`, not `404`/`409` |
| Avoidance budget | 100 km total `exclude_polygons` circumference (raised from the 10 km default in our image) | ~79 simultaneous 200 m flood circles; past it the engine 400s and the API returns `500` |
| Detour attempts | 1 solve + 1 widened (1.5×) retry, then `409` | was up to 3 via-probing passes |
| Detour extra distance | +15 km over base, then `409` | unchanged |
| Engine timeout | 15 s + 1 retry | unchanged (cold-boot tolerance) |
| Width gate radius | 20 m around incompatible segments | unchanged |
| Hazard radii / types / statuses | `FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m; `"2"`/`"3"` (+ own `"1"`) | unchanged |
| Cache TTL | 30 d default, 90 d recommended prod | unchanged; detours stay uncached |

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
