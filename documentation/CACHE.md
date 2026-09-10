# Caching

The backend uses two caching layers: **per-namespace in-process LRU caches** (`utils/cacheManager`, disabled during tests) for hot reads, and a **persistent Firestore route cache** (`routing_cache` collection) for OSRM results. Both are keyed deterministically; all caches start empty on cold start, and the LRU layer is not shared across function instances.

## Mechanics

Everything in-process is backed by `utils/cacheManager` + `utils/cache.ts` (lru-cache). Each namespace is a lazily created LRU bounded **both** ways:

| Bound | Default | Purpose |
|-------|---------|---------|
| `maxSize` (bytes) | per namespace, see table below | real memory ceiling |
| `max` (entries) | 5000 shared safety net | prevents unbounded counts of tiny entries |

- Entry size is measured with `sizeOf`: strings/objects via `JSON.stringify` byte length, arrays/maps/sets recursively.
- Eviction is LRU; `updateAgeOnGet` keeps hot entries alive within their TTL window; `allowStale: false`.
- `cacheManager.wrap(fn, {namespace, keyFn})` wraps a read function: on a miss it calls `fn` and stores the result **only if it is not `undefined`**. Thrown errors (including 400/404) are never cached. Most readers pass a custom `keyFn`; the default is `JSON.stringify(args)`.
- Wrapped functions expose `.invalidate(key)` / `.invalidateAll()`.
- When `CACHE_ENABLED=false` (both planned test suites will set this), `get`/`set` become no-ops, so `wrap` behaves as a plain passthrough — tests stay deterministic without special handling.

TTLs and byte caps are env-overridable per namespace:

```
CACHE_ENABLED=false
CACHE_TTL_<NAMESPACE>_MS        e.g. CACHE_TTL_FLAG_MS=5000
CACHE_MAX_SIZE_<NAMESPACE>_MB   e.g. CACHE_MAX_SIZE_FLAG_MB=8
```

## Namespaces

| Namespace | Cached data | Lives in | TTL | Cap | Invalidation |
|-----------|-------------|----------|-----|-----|--------------|
| `user` | user doc per `userId` for auth checks (`requireAuth`), `getOneUser`, `getAllUser` (`__all__`) | `middleware/auth.ts`, `service/userService.ts` | 30 s | 3 MB | key-level: register clears `__all__`; role/status updates clear the target key + `__all__`; trust updates clear the target key |
| `vehicleProfile` | profile list per `userId` | `service/vehicleProfileService.ts` | 30 s | 3 MB | key-level (`userId`) on profile create and ride-config add |
| `alleySegment` | single segment per `segmentId`; near-search per `lat,lng,radius` | `service/alleySegmentService.ts` | 120 s | 4 MB | key-level (`segmentId`) on passability/moderation writes; wholesale on segment create |
| `landmark` | near-search per `lat,lng,radius` (with computed `distance`) | `service/landmarkService.ts` | 120 s | 2 MB | wholesale on landmark create (`matchNearby` reuses the near-search cache) |
| `flag` | near-search per `lat,lng,radius` | `service/flagService.ts` | 10 s | 4 MB | key-level (`flagId`) on confirm/moderate/expire; wholesale on flag create |

The `routing` (10 s / 8 MB) and `shop` (120 s / 2 MB) defaults exist in `cacheManager` but are currently reserved — routing persistence lives in Firestore (below) and shop reads are uncached. Only reads whose arguments fully determine the result are wrapped.

## Invalidation model

The rule is blunt by design: **a write clears either its exact cache key or its whole namespace** (a namespace clear is cheap at these sizes).

Notable behaviors:

- **Near-search staleness**: `alleySegment`, `landmark`, and `flag` near-searches are keyed by exact `lat,lng,radiusMeters`. A create clears the whole namespace, but key-level writes (e.g. a flag confirm for one `flagId`) do not proactively refresh other coordinate keys — they expire via the short TTLs (10 s flags, 120 s segments/landmarks).
- **Flag votes**: `confirmFlag` deletes only that flag's near-key; the updated vote count is returned directly in the response, so voters never read stale counts.
- **Auth cache**: `requireAuth` reads through the `user` namespace, so role/status changes propagate within 30 s at most — and all three user mutations eagerly delete the affected keys, making propagation immediate in practice.

## Persistent route cache (Firestore)

`POST /routes` does not use the in-process LRU. It uses the `routing_cache` collection as a durable cache (`repository/routingCacheRepository.ts`, consumed by `service/routingService.ts`):

- Key: origin/dest rounded to 5 decimals plus width bucket, e.g. `10.76262,106.66017:10.77584,106.70194:MEDIUM`.
- Hit returns the full payload `{cached: true, distanceMeters, durationSeconds, geometry, source: "cache"}` without touching OSRM.
- Miss calls OSRM, persists `{originLat/Lng, destLat/Lng, widthBucket, geometry, distanceMeters, durationSeconds, cachedAt, expiresAt}`, and returns `{cached: false, ..., source: "osrm"}`. The fetch also carries an inverted `exclude=` for the bucket (`narrowonly` / `narrowonly,mediumonly` / none), so each cached bucket is a genuinely different route.
- Geometry is stored JSON-stringified: GeoJSON coordinates are nested arrays, which Firestore flattens — the service reparses on read.
- TTL: `expiresAt = cachedAt + ROUTING_CACHE_TTL_SECONDS` (default 30 days, env-overridable). `findExisting` treats expired entries as misses; the miss path overwrites the same doc, so growth is bounded by the key space with no sweeper. Docs written before `expiresAt` existed (legacy) are treated as valid; corrupt `expiresAt` values are treated as expired so they self-heal on next read.

### Hazard feedback loop

`POST /routes` never serves a route that crosses an active road hazard, on cache hit *or* miss: after resolving the geometry, `service/closureService.findBlocking` checks it against `FLOOD`, `OBSTRUCTION`, and `ACCIDENT` flags in `"2"` (Confirmed) / `"3"` (Locked) status near the route's bounding box (same 9-cell `geoCell` near-search as flags; polyline-vs-circle hit test in `utils/geo`). A hit returns `409` with the blocking zones instead of the route.

Because the check runs live on every request, **no cache invalidation is needed**: confirming a hazard blocks the next request, and removing it — `POST /flags/unflag` by the reporter, admin moderation, or the per-type TTL sweep (ACCIDENT 1h, FLOOD 6h, OBSTRUCTION 3h) — unblocks the next request automatically. Impact radius defaults per type (`FLOOD` 200 m, `OBSTRUCTION`/`ACCIDENT` 100 m; overridable per flag via `radiusMeters` at creation).

### Engine economics: cost-per-request posture

The routing engine (self-hosted OSRM) runs **scale-to-zero** — no `min-instances`, billed per request (~$0.5–1.5/mo at trial scale, Artifact Registry storage included). The cache is what makes this viable: the engine is only touched on `routing_cache` misses, and OD pairs saturate quickly at low user counts, so cold boots are rare. Two knobs support the posture: `ROUTING_CACHE_TTL_SECONDS` (default 30 d; prod recommendation 90 d to stretch warmth) and the single retry on OSRM fetch (15 s timeout), which absorbs the cold-boot race so a waking engine reads as one slow request instead of a 500. Detour re-solves also hit the engine but stay uncached by design — negligible at this volume. Revisit always-on (or a native-avoidance engine) only when traffic justifies it; see the engine-economics decision record in [ARCHITECTURE.md](./ARCHITECTURE.md).

### Decision record: why Firestore, not Redis (option A)

Evaluated 2026-09: move the route cache to Redis (Memorystore) vs. keep Firestore and fix the two gaps (no expiry, dropped ETA on hits).

- Memorystore (`asia-southeast1`): Basic 1 GiB ≈ $36/mo, Standard (HA) ≈ $47/mo, **plus** a Serverless VPC Access connector (~$18–45/mo) required for gen2 functions — **≈ $55–90/mo fixed, at zero traffic**. Basic tier is also ephemeral: a node restart wipes the cache.
- Firestore at current scale: route lookups fit the free tier (50k reads / 20k writes per day) → **≈ $0/mo**. Even 10M lookups/mo ≈ $3–6. Break-even with Memorystore needs ~100M+ ops/mo.
- Cheaper Redis variants (Upstash free tier, Redis Enterprise from $5/mo) exist but add an external dependency for no gain at this scale.

Decision: keep Firestore (option A) with TTL + full-response caching in place. Revisit Redis only if p99 route latency at volume becomes the constraint — never for cost.

## Memory budget

Worst case if every in-process namespace maxes out simultaneously: 3 + 3 + 4 + 2 + 8 + 4 + 2 = **~26 MiB** against a 512 MiB function allocation. Realistic steady state is far lower (short TTLs, small payloads).

## Testing behavior

The planned suites run with `CACHE_ENABLED=false` (`test/setup/unit.ts`, `test/setup/integration.ts`): `wrap` passes through, `get`/`set` are inert, and `del` still clears whatever exists — so cache assertions never leak between tests.
