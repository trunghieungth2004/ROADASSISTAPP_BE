import * as routingCacheRepository from
  "../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../repository/activeRouteRepository";
import * as closureService from "../service/closureService";
import * as userRepository from "../repository/userRepository";
import * as alleySegmentRepository from
  "../repository/alleySegmentRepository";
import {computePassability} from "../service/alleySegmentService";
import {
  cellsForBounds,
  extractLineCoords,
  haversineMeters,
  pointToSegmentMeters,
} from "../utils/geo";
import {circleToRing, postRoute} from "../utils/valhalla";
import type {LatLng} from "../utils/valhalla";

class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
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

const WIDTH_GATE_RADIUS_METERS = 20;

interface RouteResult {
  cached: boolean;
  distanceMeters?: number;
  durationSeconds?: number;
  geometry?: unknown;
  source: string;
  via?: {lat: number; lng: number};
  hazards?: unknown;
  warnings?: unknown;
}

const MAX_EXTRA_DISTANCE_METERS = 15000;
const WIDTH_PSEUDO_RADIUS_METERS = 20;
const DETOUR_ATTEMPTS = 2;
const DETOUR_RADIUS_GROWTH = 1.5;

const toWidthZone = (block: WidthBlock): closureService.BlockingZone => ({
  flagId: `width:${block.segmentId}`,
  type: "WIDTH",
  lat: block.lat,
  lng: block.lng,
  radiusMeters: WIDTH_PSEUDO_RADIUS_METERS,
  note: null,
  distanceMeters: 0,
  raw: block,
});

const routeSafely = async ({
  originLat,
  originLng,
  destLat,
  destLng,
  stops,
  width,
  key,
  userId,
  baseGeometry,
  baseDistance,
  baseDuration,
  baseSource,
  baseCached,
  blocking,
  warnings,
}: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops: LatLng[];
  width: number | undefined;
  key: string;
  userId: string;
  baseGeometry: unknown;
  baseDistance: number | undefined;
  baseDuration: number | undefined;
  baseSource: string;
  baseCached: boolean;
  blocking: closureService.BlockingZone[];
  warnings: unknown;
}): Promise<RouteResult> => {
  const queueError = (
    hazards: closureService.BlockingZone[],
    widthBlocks: WidthBlock[],
  ): RouteBlockedError | WidthBlockedError =>
    hazards.length > 0 ?
      new RouteBlockedError(hazards) :
      new WidthBlockedError(widthBlocks);
  const queueFor = async (
    geometry: unknown,
    provided: closureService.BlockingZone[] | null,
  ): Promise<{
    hazards: closureService.BlockingZone[];
    widthBlocks: WidthBlock[];
  }> => {
    const hazards =
      provided ?? (await closureService.findBlocking(geometry, userId)) ?? [];
    const widthBlocks =
      width !== undefined ? await findWidthBlocks(geometry, width) : [];
    return {hazards, widthBlocks};
  };
  const controls: LatLng[] = [
    {lat: originLat, lng: originLng},
    ...stops,
    {lat: destLat, lng: destLng},
  ];
  const {widthBlocks: baseWidthBlocks} = await queueFor(
    baseGeometry,
    blocking,
  );
  const queue: closureService.BlockingZone[] = [
    ...blocking,
    ...baseWidthBlocks.map(toWidthZone),
  ];
  const hasCoords = (zone: closureService.BlockingZone): boolean =>
    Number.isFinite(zone.lat) &&
    Number.isFinite(zone.lng) &&
    Number.isFinite(zone.radiusMeters) &&
    zone.radiusMeters > 0;
  if (queue.length === 0) {
    await recordActiveRoute(key, userId, baseGeometry);
    return {
      cached: baseCached,
      distanceMeters: baseDistance,
      durationSeconds: baseDuration,
      geometry: baseGeometry,
      source: baseSource,
      warnings,
    };
  }
  if (!queue.every(hasCoords)) {
    throw queueError(blocking, baseWidthBlocks);
  }
  for (const point of controls) {
    for (const zone of queue) {
      if (
        haversineMeters(point.lat, point.lng, zone.lat, zone.lng) <=
        zone.radiusMeters
      ) {
        throw queueError(blocking, baseWidthBlocks);
      }
    }
  }
  let geometry = baseGeometry;
  let distanceMeters = baseDistance;
  let durationSeconds = baseDuration;
  let lastWidthBlocks = baseWidthBlocks;
  for (let attempt = 0; attempt < DETOUR_ATTEMPTS; attempt++) {
    const scale = attempt === 0 ? 1 : DETOUR_RADIUS_GROWTH;
    const solved = await postRoute(
      controls,
      queue.map((zone) =>
        circleToRing(zone.lat, zone.lng, zone.radiusMeters * scale),
      ),
    );
    const recheck = await queueFor(solved.geometry, null);
    lastWidthBlocks = recheck.widthBlocks;
    if (recheck.hazards.length + recheck.widthBlocks.length === 0) {
      geometry = solved.geometry;
      distanceMeters = solved.distanceMeters;
      durationSeconds = solved.durationSeconds;
      break;
    }
    if (attempt === DETOUR_ATTEMPTS - 1) {
      throw queueError(recheck.hazards, recheck.widthBlocks);
    }
  }
  if (
    baseDistance !== undefined &&
    distanceMeters !== undefined &&
    distanceMeters - baseDistance > MAX_EXTRA_DISTANCE_METERS
  ) {
    if (blocking.length > 0) throw new RouteBlockedError(blocking);
    throw new WidthBlockedError(lastWidthBlocks);
  }
  const outWarnings = await closureService.findWarnings(geometry, userId);
  await recordActiveRoute(key, userId, geometry);
  return {
    cached: baseCached,
    distanceMeters,
    durationSeconds,
    geometry,
    source: "detour",
    hazards: blocking,
    warnings: outWarnings,
  };
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
  lat: number;
  lng: number;
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
        lat,
        lng,
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
    const route = await postRoute(
      [
        {lat: originLat, lng: originLng},
        ...stopList,
        {lat: destLat, lng: destLng},
      ],
      [],
    );
    geometry = route.geometry;
    distanceMeters = route.distanceMeters;
    durationSeconds = route.durationSeconds;
    await routingCacheRepository.save(key, {
      originLat,
      originLng,
      destLat,
      destLng,
      stops: stopList,
      widthBucket,
      geometry: route.geometry,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
    });
    cached = false;
    source = "valhalla";
  }

  const {blocking: zones, warnings} = await closureService.analyzeRoute(
    geometry,
    userId,
  );
  if (zones.length === 0 && width === undefined) {
    await recordActiveRoute(key, userId, geometry);
    return {
      cached,
      distanceMeters,
      durationSeconds,
      geometry,
      source,
      warnings,
    };
  }
  return await routeSafely({
    originLat,
    originLng,
    destLat,
    destLng,
    stops: stopList,
    width,
    key,
    userId,
    baseGeometry: geometry,
    baseDistance: distanceMeters,
    baseDuration: durationSeconds,
    baseSource: source,
    baseCached: cached,
    blocking: zones,
    warnings,
  });
};

export {
  getRoute,
  widthToBucket,
  MAX_EXTRA_DISTANCE_METERS,
  NotFoundError,
  RouteBlockedError,
  WidthBlockedError,
};
