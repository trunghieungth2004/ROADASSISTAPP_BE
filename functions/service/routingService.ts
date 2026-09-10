import * as routingCacheRepository from
  "../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../repository/activeRouteRepository";
import * as closureService from "../service/closureService";
import * as userRepository from "../repository/userRepository";
import * as alleySegmentRepository from
  "../repository/alleySegmentRepository";
import {computePassability} from "../service/alleySegmentService";
import {cellsForBounds, extractLineCoords, pointToSegmentMeters} from
  "../utils/geo";
import {buildBypassPoint, DETOUR_MARGINS_METERS, nearestSegmentIndex,
  legOrdinalForZone} from "../utils/detour";
import type {LatLng} from "../utils/detour";

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
class WidthBlockedError extends Error {
  statusCode: number;
  errors: unknown;
  constructor(segments: unknown) {
    super("Route is impassable for this vehicle width");
    this.statusCode = 409;
    this.errors = segments;
  }
}

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";
const OSRM_TIMEOUT_MS = 15000;
const WIDTH_GATE_RADIUS_METERS = 20;

const EXCLUDE_BY_BUCKET: Record<string, string | null> = {
  NARROW: null,
  MEDIUM: "narrowonly",
  WIDE: "narrowonly,mediumonly",
};

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
  const exclude = EXCLUDE_BY_BUCKET[widthBucket] ?? null;
  const url =
    `${OSRM_URL}/route/v1/motorbike/${coordinates}` +
    "?overview=full&geometries=geojson" +
    (exclude === null ? "" : `&exclude=${exclude}`);
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
  stops,
  widthBucket,
  geometry,
  zones,
}: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops: LatLng[];
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
    const ordered = orderedControls(
      originLat,
      originLng,
      destLat,
      destLng,
      stops,
      geometry,
      zone,
      via,
    );
    if (!ordered) return null;
    const coordinates = ordered
      .map((p) => `${p.lng},${p.lat}`)
      .join(";");
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

const orderedControls = (
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  stops: LatLng[],
  geometry: unknown,
  zone: closureService.BlockingZone,
  via: LatLng,
): LatLng[] | null => {
  const controls: LatLng[] = [
    {lat: originLat, lng: originLng},
    ...stops,
    {lat: destLat, lng: destLng},
  ];
  if (stops.length === 0) {
    return [controls[0], via, controls[1]];
  }
  const segIndex = nearestSegmentIndex(geometry, zone);
  const ordinal =
    segIndex === null ? null : legOrdinalForZone(geometry, stops, segIndex);
  if (ordinal === null) return null;
  return [
    ...controls.slice(0, ordinal + 1),
    via,
    ...controls.slice(ordinal + 1),
  ];
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

const recordActiveRoute = async (
  routeKey: string,
  userId: string,
  geometry: unknown,
): Promise<void> => {
  await activeRouteRepository
    .touch(routeKey, userId, geometry)
    .catch(() => undefined);
};

interface WidthBlock {
  segmentId: string;
  baseWidth: number;
  distanceMeters: number;
}

const findWidthBlocks = async (
  geometry: unknown,
  width: number,
): Promise<WidthBlock[]> => {
  const coords = extractLineCoords(geometry);
  if (coords.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const segments = await alleySegmentRepository.findByGeohashPrefixes(
    cellsForBounds({minLat, maxLat, minLng, maxLng}, 4),
  );
  const blocks: WidthBlock[] = [];
  for (const segment of segments) {
    const lat = (segment as {lat?: unknown}).lat;
    const lng = (segment as {lng?: unknown}).lng;
    const baseWidth = segment.baseWidth;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      typeof baseWidth !== "number"
    ) {
      continue;
    }
    if (computePassability(segment, width).compatible) continue;
    let nearest = Infinity;
    for (let i = 0; i + 1 < coords.length; i++) {
      nearest = Math.min(
        nearest,
        pointToSegmentMeters(
          lat,
          lng,
          coords[i][1],
          coords[i][0],
          coords[i + 1][1],
          coords[i + 1][0],
        ),
      );
    }
    if (Number.isFinite(nearest) && nearest <= WIDTH_GATE_RADIUS_METERS) {
      blocks.push({
        segmentId: segment.id,
        baseWidth,
        distanceMeters: Math.round(nearest * 10) / 10,
      });
    }
  }
  return blocks;
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
}): Promise<RouteResult> => {
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
    const controls = [
      `${originLng},${originLat}`,
      ...stopList.map((s) => `${s.lng},${s.lat}`),
      `${destLng},${destLat}`,
    ];
    const route = await solveOsrm(controls.join(";"), widthBucket);
    geometry = route.geometry ?? null;
    distanceMeters = route.distance;
    durationSeconds = route.duration;
    await routingCacheRepository.save(key, {
      originLat,
      originLng,
      destLat,
      destLng,
      stops: stopList,
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
    if (width !== undefined) {
      const blocks = await findWidthBlocks(geometry, width);
      if (blocks.length > 0) throw new WidthBlockedError(blocks);
    }
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
    stops: stopList,
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
  WidthBlockedError,
};
