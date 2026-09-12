import * as activeRouteRepository from
  "../../repository/activeRouteRepository";
import * as closureService from "../closureService";
import {haversineMeters} from "../../utils/geo";
import {circleToRing, postRoutes} from "../../utils/valhalla";
import type {LatLng} from "../../utils/valhalla";
import {RouteBlockedError, WidthBlockedError} from "./errors";
import type {RouteOption} from "./types";
import {
  probeWidth,
  toWidthZone,
  withTightZones,
  type WidthBlock,
} from "./widthGate";

const MAX_EXTRA_DISTANCE_METERS = 15000;
const DETOUR_ATTEMPTS = 2;
const DETOUR_RADIUS_GROWTH = 1.5;

const recordActiveRoute = async (
  routeKey: string,
  userId: string,
  geometry: unknown,
): Promise<void> => {
  await activeRouteRepository
    .touch(routeKey, userId, geometry)
    .catch(() => undefined);
};

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
  blocking: closureService.BlockingZone[];
  warnings: unknown;
}): Promise<RouteOption> => {
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
    widthTight: WidthBlock[];
  }> => {
    const hazards =
      provided ?? (await closureService.findBlocking(geometry, userId)) ?? [];
    const probe =
      width !== undefined ?
        await probeWidth(geometry, width) :
        {blocks: [], tight: []};
    return {hazards, widthBlocks: probe.blocks, widthTight: probe.tight};
  };
  const controls: LatLng[] = [
    {lat: originLat, lng: originLng},
    ...stops,
    {lat: destLat, lng: destLng},
  ];
  const {widthBlocks: baseWidthBlocks, widthTight: baseTight} = await queueFor(
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
      distanceMeters: baseDistance,
      durationSeconds: baseDuration,
      geometry: baseGeometry,
      source: baseSource,
      warnings: withTightZones(width, baseTight, warnings),
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
  let lastTight = baseTight;
  for (let attempt = 0; attempt < DETOUR_ATTEMPTS; attempt++) {
    const scale = attempt === 0 ? 1 : DETOUR_RADIUS_GROWTH;
    const solved = (
      await postRoutes(
        controls,
        queue.map((zone) =>
          circleToRing(zone.lat, zone.lng, zone.radiusMeters * scale),
        ),
        1,
      )
    )[0];
    const recheck = await queueFor(solved.geometry, null);
    lastWidthBlocks = recheck.widthBlocks;
    lastTight = recheck.widthTight;
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
    distanceMeters,
    durationSeconds,
    geometry,
    source: "detour",
    hazards: blocking,
    warnings: withTightZones(width, lastTight, outWarnings),
  };
};

export {
  routeSafely,
  recordActiveRoute,
  MAX_EXTRA_DISTANCE_METERS,
  DETOUR_ATTEMPTS,
  DETOUR_RADIUS_GROWTH,
};
