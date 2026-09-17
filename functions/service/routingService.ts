import * as routingCacheRepository from
  "../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../repository/activeRouteRepository";
import * as userRepository from "../repository/userRepository";
import * as closureService from "./closureService";
import {postRoutes, dedupeRoutes, costingForVehicle} from
  "../utils/valhalla";
import type {LatLng} from "../utils/valhalla";
import {
  NotFoundError,
  RouteBlockedError,
  WidthBlockedError,
  isConflictError,
} from "./routing/errors";
import type {BaseRoute, RouteList, RouteOption} from "./routing/types";
import {
  routeSafely,
  recordActiveRoute,
  MAX_EXTRA_DISTANCE_METERS,
} from "./routing/detour";
import {probeWidth, toWidthZone, withTightZones} from "./routing/widthGate";
import {logWarn} from "../utils/logger";

const MAX_ROUTE_OPTIONS = 5;

const logBlocked = (reason: string, fields: Record<string, unknown>): void => {
  logWarn("routing", reason, fields);
};

const withWidthFallback = async (
  geometry: unknown,
  width: number | undefined,
  warnings: unknown,
): Promise<unknown> => {
  if (width === undefined) return warnings;
  const probe = await probeWidth(geometry, width);
  const merged = withTightZones(width, probe.tight, warnings);
  if (probe.blocks.length === 0) return merged;
  const list = Array.isArray(merged) ? merged : [];
  return [...list, ...probe.blocks.map(toWidthZone)];
};

const widthToBucket = (width?: number): string => {
  if (width === undefined) return "MEDIUM";
  if (width < 0.8) return "NARROW";
  if (width <= 1.0) return "MEDIUM";
  return "WIDE";
};

const pointKey = (lat: number, lng: number): string =>
  `${lat.toFixed(5)},${lng.toFixed(5)}`;

const buildKey = (
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  stops: LatLng[],
  widthBucket: string,
  costing: string,
): string => {
  if (stops.length === 0) {
    const origin = pointKey(originLat, originLng);
    const dest = pointKey(destLat, destLng);
    return `${origin}:${dest}:${widthBucket}:${costing}`;
  }
  const legs = [
    pointKey(originLat, originLng),
    ...stops.map((s) => pointKey(s.lat, s.lng)),
    pointKey(destLat, destLng),
  ];
  return `${legs.join(";")}:${widthBucket}:${costing}`;
};

const parseGeometry = (stored: unknown): unknown => {
  if (typeof stored !== "string") return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
};

const readCachedRoutes = (entry: {
  routes?: unknown;
  geometry?: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
}): BaseRoute[] => {
  const stored = parseGeometry(entry.routes) as
    | Array<{
        geometry?: unknown;
        distanceMeters?: number;
        durationSeconds?: number;
      }>
    | null;
  if (Array.isArray(stored)) {
    return stored.map((r) => ({
      geometry: parseGeometry(r.geometry),
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
    }));
  }
  return [];
};

const legacyCachedRoute = (entry: {
  geometry?: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
}): BaseRoute | null => {
  if (entry.geometry === undefined) return null;
  return {
    geometry: parseGeometry(entry.geometry),
    distanceMeters: entry.distanceMeters,
    durationSeconds: entry.durationSeconds,
  };
};

const buildPrimary = async ({
  base,
  originLat,
  originLng,
  destLat,
  destLng,
  stops,
  width,
  costing,
  key,
  userId,
  source,
}: {
  base: BaseRoute;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops: LatLng[];
  width: number | undefined;
  costing: string;
  key: string;
  userId: string;
  source: string;
}): Promise<RouteOption> => {
  const {blocking: zones, warnings} = await closureService.analyzeRoute(
    base.geometry,
    userId,
  );
  if (zones.length === 0 && width === undefined) {
    return {
      distanceMeters: base.distanceMeters,
      durationSeconds: base.durationSeconds,
      geometry: base.geometry,
      source,
      warnings,
    };
  }
  return await routeSafely({
    originLat,
    originLng,
    destLat,
    destLng,
    stops,
    width,
    costing,
    key,
    userId,
    baseGeometry: base.geometry,
    baseDistance: base.distanceMeters,
    baseDuration: base.durationSeconds,
    baseSource: source,
    blocking: zones,
    warnings,
  });
};

const buildAlternative = async ({
  base,
  originLat,
  originLng,
  destLat,
  destLng,
  stops,
  width,
  costing,
  key,
  userId,
  source,
}: {
  base: BaseRoute;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops: LatLng[];
  width: number | undefined;
  costing: string;
  key: string;
  userId: string;
  source: string;
}): Promise<RouteOption | null> => {
  const {blocking: zones, warnings} = await closureService.analyzeRoute(
    base.geometry,
    userId,
  );
  if (zones.length === 0) {
    if (width === undefined) {
      return {
        distanceMeters: base.distanceMeters,
        durationSeconds: base.durationSeconds,
        geometry: base.geometry,
        source,
        warnings,
      };
    }
    const probe = await probeWidth(base.geometry, width);
    if (probe.blocks.length > 0) {
      logBlocked("alt-width-drop", {
        key,
        userId,
        segments: probe.blocks.map((b) => b.segmentId),
      });
      return null;
    }
    return {
      distanceMeters: base.distanceMeters,
      durationSeconds: base.durationSeconds,
      geometry: base.geometry,
      source,
      warnings: withTightZones(width, probe.tight, warnings),
    };
  }
  try {
    return await routeSafely({
      originLat,
      originLng,
      destLat,
      destLng,
      stops,
      width,
      costing,
      key,
      userId,
      baseGeometry: base.geometry,
      baseDistance: base.distanceMeters,
      baseDuration: base.durationSeconds,
      baseSource: source,
      blocking: zones,
      warnings,
    });
  } catch (err) {
    if (err instanceof RouteBlockedError) {
      logBlocked("alt-detour-failed", {key, userId, zones: err.errors});
      return {
        distanceMeters: base.distanceMeters,
        durationSeconds: base.durationSeconds,
        geometry: base.geometry,
        source,
        hazards: zones,
        warnings: await withWidthFallback(base.geometry, width, warnings),
      };
    }
    throw err;
  }
};

const getRoute = async ({
  userId,
  originLat,
  originLng,
  destLat,
  destLng,
  stops,
  width,
  vehicleType,
}: {
  userId: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops?: LatLng[];
  width?: number;
  vehicleType?: string;
}): Promise<RouteList> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  const stopList = stops ?? [];
  const widthBucket = widthToBucket(width);
  const costing = costingForVehicle(vehicleType);
  const key = buildKey(
    originLat,
    originLng,
    destLat,
    destLng,
    stopList,
    widthBucket,
    costing,
  );

  const existing = await routingCacheRepository.findExisting(key);
  let bases: BaseRoute[] = [];
  let cached = false;
  let source = "valhalla";
  if (existing) {
    bases = readCachedRoutes(existing);
    if (bases.length === 0) {
      const legacy = legacyCachedRoute(existing);
      if (legacy) bases = [legacy];
    }
    if (bases.length > 0) {
      cached = true;
      source = "cache";
    }
  }
  if (!cached) {
    const controls: LatLng[] = [
      {lat: originLat, lng: originLng},
      ...stopList,
      {lat: destLat, lng: destLng},
    ];
    const raw =
      stopList.length === 0 ?
        await postRoutes(controls, [], MAX_ROUTE_OPTIONS, costing) :
        await postRoutes(controls, [], 1, costing);
    bases = raw.map((r) => ({
      geometry: r.geometry,
      distanceMeters: r.distanceMeters,
      durationSeconds: r.durationSeconds,
    }));
    await routingCacheRepository.save(key, {
      originLat,
      originLng,
      destLat,
      destLng,
      stops: stopList,
      widthBucket,
      costing,
      routes: bases,
    });
  }
  bases = dedupeRoutes(bases);

  const options: RouteOption[] = [];
  let firstError: unknown = null;
  const primary = await buildPrimary({
    base: bases[0],
    originLat,
    originLng,
    destLat,
    destLng,
    stops: stopList,
    width,
    costing,
    key,
    userId,
    source,
  }).catch((err: unknown) => {
    if (!isConflictError(err)) throw err;

    let kind = "endpoint";
    if (err instanceof RouteBlockedError) kind = "hazard";
    else if (err instanceof WidthBlockedError) kind = "width";
    logBlocked("primary-blocked", {key, userId, kind});
    firstError = err;
    return null;
  });
  if (primary) options.push(primary);
  for (const base of bases.slice(1)) {
    const option = await buildAlternative({
      base,
      originLat,
      originLng,
      destLat,
      destLng,
      stops: stopList,
      width,
      costing,
      key,
      userId,
      source,
    });
    if (option) options.push(option);
  }
  if (options.length === 0) {
    if (firstError instanceof RouteBlockedError && bases.length > 0) {
      logBlocked("primary-fallback", {
        key,
        userId,
        routes: bases.length,
      });
      const raw = bases[0];
      const analysis = await closureService.analyzeRoute(raw.geometry, userId);
      options.push({
        distanceMeters: raw.distanceMeters,
        durationSeconds: raw.durationSeconds,
        geometry: raw.geometry,
        source,
        hazards: analysis.blocking,
        warnings: await withWidthFallback(
          raw.geometry,
          width,
          analysis.warnings,
        ),
      });
    } else {
      if (firstError) throw firstError;
      throw new RouteBlockedError([]);
    }
  }
  await recordActiveRoute(key, userId, options[0].geometry);
  return {cached, routes: dedupeRoutes<RouteOption>(options)};
};

const sweepActiveRoutes = async (): Promise<number> => {
  return activeRouteRepository.deleteExpired();
};

export {
  getRoute,
  sweepActiveRoutes,
  widthToBucket,
  MAX_EXTRA_DISTANCE_METERS,
  MAX_ROUTE_OPTIONS,
  NotFoundError,
  RouteBlockedError,
  WidthBlockedError,
  RouteList,
  RouteOption,
  BaseRoute,
};
