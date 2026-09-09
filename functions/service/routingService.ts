import * as routingCacheRepository from
  "../repository/routingCacheRepository";
import * as userRepository from "../repository/userRepository";

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

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";

interface RouteResult {
  cached: boolean;
  distanceMeters?: number;
  durationSeconds?: number;
  geometry?: unknown;
  source: string;
}

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
  if (existing) {
    return {
      cached: true,
      geometry: parseGeometry(existing.geometry),
      source: "cache",
    };
  }

  const coordinates = `${originLng},${originLat};${destLng},${destLat}`;
  const url =
    `${OSRM_URL}/route/v1/motorbike/${coordinates}` +
    `?overview=full&geometries=geojson&width_bucket=${widthBucket}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new ServiceError(`Routing service returned ${response.status}`);
  }
  const body = (await response.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: unknown;
    }>;
  };
  if (body.code !== "Ok" || !body.routes || body.routes.length === 0) {
    throw new ServiceError("No route found", 404);
  }
  const route = body.routes[0];
  await routingCacheRepository.save(key, {
    originLat,
    originLng,
    destLat,
    destLng,
    widthBucket,
    geometry: route.geometry ?? null,
  });
  return {
    cached: false,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry: route.geometry,
    source: "osrm",
  };
};

export {getRoute, widthToBucket, NotFoundError, ServiceError};
