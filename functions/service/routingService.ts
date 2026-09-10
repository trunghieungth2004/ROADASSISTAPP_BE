import * as routingCacheRepository from
  "../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../repository/activeRouteRepository";
import * as closureService from "../service/closureService";
import * as userRepository from "../repository/userRepository";
import {buildBypassPoint, DETOUR_MARGINS_METERS} from "../utils/detour";

class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}
class ServiceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}
class RouteBlockedError extends Error {
  statusCode: number;
  errors: unknown;
  constructor(zones: unknown) {
    super("Route is blocked by active road hazards");
    this.statusCode = 409;
    this.errors = zones;
  }
}

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";
const OSRM_TIMEOUT_MS = 15000;

interface RouteResult {
  cached: boolean;
  distanceMeters?: number;
  durationSeconds?: number;
  geometry?: unknown;
  source: string;
  via?: {lat: number; lng: number};
  hazards?: unknown;
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: unknown;
}

const fetchOsrm = async (url: string): Promise<Response> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, {signal: AbortSignal.timeout(OSRM_TIMEOUT_MS)});
    } catch {
      if (attempt === 1) {
        throw new ServiceError("Routing service unreachable");
      }
    }
  }
  throw new ServiceError("Routing service unreachable");
};

const solveOsrm = async (
  coordinates: string,
  widthBucket: string,
): Promise<OsrmRoute> => {
  const url =
    `${OSRM_URL}/route/v1/motorbike/${coordinates}` +
    `?overview=full&geometries=geojson&width_bucket=${widthBucket}`;
  const response = await fetchOsrm(url);
  if (!response.ok) {
    throw new ServiceError(`Routing service returned ${response.status}`);
  }
  const body = (await response.json()) as {
    code?: string;
    routes?: OsrmRoute[];
  };
  if (body.code !== "Ok" || !body.routes || body.routes.length === 0) {
    throw new ServiceError("No route found", 404);
  }
  return body.routes[0];
};

const tryDetour = async ({
  originLat,
  originLng,
  destLat,
  destLng,
  widthBucket,
  geometry,
  zones,
}: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  widthBucket: string;
  geometry: unknown;
  zones: closureService.BlockingZone[];
}): Promise<{
  via: {lat: number; lng: number};
  geometry: unknown;
  distanceMeters?: number;
  durationSeconds?: number;
} | null> => {
  const zone = zones[0];
  if (!zone) return null;
  for (const margin of DETOUR_MARGINS_METERS) {
    const via = buildBypassPoint(
      geometry,
      zone,
      margin,
      {lat: originLat, lng: originLng},
      {lat: destLat, lng: destLng},
    );
    if (!via) break;
    const coordinates =
      `${originLng},${originLat};${via.lng},${via.lat};` +
      `${destLng},${destLat}`;
    const solved = await solveOsrm(coordinates, widthBucket);
    const remaining = await closureService.findBlocking(
      solved.geometry ?? null,
    );
    if (remaining.length === 0) {
      return {
        via,
        geometry: solved.geometry ?? null,
        distanceMeters: solved.distance,
        durationSeconds: solved.duration,
      };
    }
  }
  return null;
};

const widthToBucket = (width?: number): string => {
  if (width === undefined) return "MEDIUM";
  if (width < 0.8) return "NARROW";
  if (width <= 1.0) return "MEDIUM";
  return "WIDE";
};

const buildKey = (
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  widthBucket: string,
): string => {
  const origin = `${originLat.toFixed(5)},${originLng.toFixed(5)}`;
  const dest = `${destLat.toFixed(5)},${destLng.toFixed(5)}`;
  return `${origin}:${dest}:${widthBucket}`;
};

const parseGeometry = (stored: unknown): unknown => {
  if (typeof stored !== "string") return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
};

const recordActiveRoute = async (
  routeKey: string,
  userId: string,
  geometry: unknown,
): Promise<void> => {
  try {
    await activeRouteRepository.touch(routeKey, userId, geometry);
  } catch {
    // Active-route tracking must never fail a route request.
  }
};

const getRoute = async ({
  userId,
  originLat,
  originLng,
  destLat,
  destLng,
  width,
}: {
  userId: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  width?: number;
}): Promise<RouteResult> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  const widthBucket = widthToBucket(width);
  const key = buildKey(originLat, originLng, destLat, destLng, widthBucket);

  const existing = await routingCacheRepository.findExisting(key);
  let geometry: unknown;
  let distanceMeters: number | undefined;
  let durationSeconds: number | undefined;
  let cached: boolean;
  let source: string;
  if (existing) {
    geometry = parseGeometry(existing.geometry);
    distanceMeters = existing.distanceMeters;
    durationSeconds = existing.durationSeconds;
    cached = true;
    source = "cache";
  } else {
    const coordinates = `${originLng},${originLat};${destLng},${destLat}`;
    const route = await solveOsrm(coordinates, widthBucket);
    geometry = route.geometry ?? null;
    distanceMeters = route.distance;
    durationSeconds = route.duration;
    await routingCacheRepository.save(key, {
      originLat,
      originLng,
      destLat,
      destLng,
      widthBucket,
      geometry: route.geometry ?? null,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    });
    cached = false;
    source = "osrm";
  }

  const zones = await closureService.findBlocking(geometry);
  if (zones.length === 0) {
    await recordActiveRoute(key, userId, geometry);
    return {
      cached,
      distanceMeters,
      durationSeconds,
      geometry,
      source,
    };
  }
  const detoured = await tryDetour({
    originLat,
    originLng,
    destLat,
    destLng,
    widthBucket,
    geometry,
    zones,
  });
  if (detoured) {
    await recordActiveRoute(key, userId, detoured.geometry);
    return {
      cached: false,
      distanceMeters: detoured.distanceMeters,
      durationSeconds: detoured.durationSeconds,
      geometry: detoured.geometry,
      source: "detour",
      via: detoured.via,
      hazards: zones,
    };
  }
  throw new RouteBlockedError(zones);
};

export {
  getRoute,
  widthToBucket,
  NotFoundError,
  ServiceError,
  RouteBlockedError,
};
