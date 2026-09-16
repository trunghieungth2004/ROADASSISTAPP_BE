import * as activeRouteRepository from
  "../../repository/activeRouteRepository";
import * as closureService from "../closureService";
import {haversineMeters} from "../../utils/geo";
import {logWarn} from "../../utils/logger";
import {COSTING_AUTO, circleToRing, postRoutes} from "../../utils/valhalla";
import type {LatLng} from "../../utils/valhalla";
import {EndpointBlockedError, RouteBlockedError, WidthBlockedError} from
  "./errors";
import {
  steerThroughCorridor,
  STEER_MIN_FRESH_ZONES,
} from "./corridor";
import type {RouteOption} from "./types";
import {
  probeWidth,
  toWidthZone,
  withTightZones,
  type WidthBlock,
} from "./widthGate";

const MAX_EXTRA_DISTANCE_METERS = 15000;
const DETOUR_ATTEMPTS = 4;
const DETOUR_MAX_ZONES = 8;

const maxExtraDistanceFor = (costing: string): number => {
  if (costing === COSTING_AUTO) {
    return Number(process.env.DETOUR_BUDGET_AUTO_METERS ?? 15000);
  }
  return Number(process.env.DETOUR_BUDGET_SCOOTER_METERS ?? 8000);
};

const hasCoords = (zone: closureService.BlockingZone): boolean =>
  Number.isFinite(zone.lat) &&
  Number.isFinite(zone.lng) &&
  Number.isFinite(zone.radiusMeters) &&
  zone.radiusMeters > 0;

const hasFlagId = (zone: closureService.BlockingZone): boolean =>
  typeof zone.flagId === "string" && zone.flagId !== "";

const isWidthZone = (zone: closureService.BlockingZone): boolean =>
  zone.flagId.startsWith("width:");

const controlLabel = (index: number, total: number): string => {
  if (index === 0) return "Origin";
  if (index === total - 1) return "Destination";
  return `Stop ${index}`;
};

const freshZones = (
  queue: closureService.BlockingZone[],
  hazards: closureService.BlockingZone[],
  widthBlocks: WidthBlock[],
): {zones: closureService.BlockingZone[]; unusable: boolean} => {
  const known = new Set(queue.map((z) => z.flagId));
  const zones: closureService.BlockingZone[] = [];
  for (const candidate of [...hazards, ...widthBlocks.map(toWidthZone)]) {
    if (!hasFlagId(candidate) || !hasCoords(candidate)) {
      return {zones, unusable: true};
    }
    if (known.has(candidate.flagId)) continue;
    known.add(candidate.flagId);
    zones.push(candidate);
  }
  return {zones, unusable: false};
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

const routeSafely = async ({
  originLat,
  originLng,
  destLat,
  destLng,
  stops,
  width,
  costing,
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
  costing: string;
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
  for (let i = 0; i < controls.length; i++) {
    const point = controls[i];
    for (const zone of queue) {
      if (
        haversineMeters(point.lat, point.lng, zone.lat, zone.lng) <=
        zone.radiusMeters
      ) {
        if (hasFlagId(zone) && !isWidthZone(zone)) {
          throw new EndpointBlockedError(
            controlLabel(i, controls.length),
            zone,
          );
        }
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
    const solved = (
      await postRoutes(
        controls,
        queue.map((zone) =>
          circleToRing(zone.lat, zone.lng, zone.radiusMeters),
        ),
        1,
        costing,
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
    const fresh = freshZones(queue, recheck.hazards, recheck.widthBlocks);
    const overfull = queue.length + fresh.zones.length > DETOUR_MAX_ZONES;
    if (fresh.unusable || overfull) {
      throw queueError(recheck.hazards, recheck.widthBlocks);
    }
    if (fresh.zones.length > 0) {
      if (
        attempt === 0 &&
        stops.length === 0 &&
        fresh.zones.length >= STEER_MIN_FRESH_ZONES
      ) {
        const steered = await steerThroughCorridor({
          origin: {lat: originLat, lng: originLng},
          destination: {lat: destLat, lng: destLng},
          costing,
          rings: queue.map((zone) =>
            circleToRing(zone.lat, zone.lng, zone.radiusMeters),
          ),
          cluster: [...blocking, ...fresh.zones],
          check: (geometry) => queueFor(geometry, null),
        });
        if (steered !== null) {
          logWarn("routing", "corridor-steered", {
            key,
            distanceMeters: steered.distanceMeters,
          });
          geometry = steered.geometry;
          distanceMeters = steered.distanceMeters;
          durationSeconds = steered.durationSeconds;
          lastWidthBlocks = steered.widthBlocks;
          lastTight = steered.widthTight;
          break;
        }
      }
      logWarn("routing", "detour-chained", {
        key,
        attempt,
        zones: fresh.zones.map((z) => z.flagId),
      });
      queue.push(...fresh.zones);
    }
  }
  if (
    baseDistance !== undefined &&
    distanceMeters !== undefined &&
    distanceMeters - baseDistance > maxExtraDistanceFor(costing)
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
  maxExtraDistanceFor,
  MAX_EXTRA_DISTANCE_METERS,
  DETOUR_ATTEMPTS,
  DETOUR_MAX_ZONES,
};
