import * as routingCacheRepository from
  "../repository/routingCacheRepository";
import * as userRepository from "../repository/userRepository";
import * as closureService from "./closureService";
import {postRoutes} from "../utils/valhalla";
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
import {probeWidth, withTightZones} from "./routing/widthGate";

const MAX_ROUTE_OPTIONS = 3;

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
): string => {
  if (stops.length === 0) {
    const origin = pointKey(originLat, originLng);
    const dest = pointKey(destLat, destLng);
    return `${origin}:${dest}:${widthBucket}`;
  }
  const legs = [
    pointKey(originLat, originLng),
    ...stops.map((s) => pointKey(s.lat, s.lng)),
    pointKey(destLat, destLng),
  ];
  return `${legs.join(";")}:${widthBucket}`;
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
  width,
  userId,
  source,
}: {
  base: BaseRoute;
  width: number | undefined;
  userId: string;
  source: string;
}): Promise<RouteOption | null> => {
  const {blocking: zones, warnings} = await closureService.analyzeRoute(
    base.geometry,
    userId,
  );
  if (zones.length > 0) return null;
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
  if (probe.blocks.length > 0) return null;
  return {
    distanceMeters: base.distanceMeters,
    durationSeconds: base.durationSeconds,
    geometry: base.geometry,
    source,
    warnings: withTightZones(width, probe.tight, warnings),
  };
};

const getRoute = async ({
  userId,
  originLat,
  originLng,
  destLat,
  destLng,
  stops,
  width,
}: {
  userId: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops?: LatLng[];
  width?: number;
}): Promise<RouteList> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  const stopList = stops ?? [];
  const widthBucket = widthToBucket(width);
  const key = buildKey(
    originLat,
    originLng,
    destLat,
    destLng,
    stopList,
    widthBucket,
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
        await postRoutes(controls, [], MAX_ROUTE_OPTIONS) :
        await postRoutes(controls, [], 1);
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
      routes: bases,
    });
  }

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
    key,
    userId,
    source,
  }).catch((err: unknown) => {
    if (!isConflictError(err)) throw err;
    firstError = err;
    return null;
  });
  if (primary) options.push(primary);
  for (const base of bases.slice(1)) {
    const option = await buildAlternative({base, width, userId, source});
    if (option) options.push(option);
  }
  if (options.length === 0) {
    if (firstError) throw firstError;
    throw new RouteBlockedError([]);
  }
  await recordActiveRoute(key, userId, options[0].geometry);
  return {cached, routes: options};
};

export {
  getRoute,
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
