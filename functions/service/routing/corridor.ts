import * as closureService from "../closureService";
import {haversineMeters} from "../../utils/geo";
import {postRoutes} from "../../utils/valhalla";
import type {LatLng, Ring, ValhallaRoute} from "../../utils/valhalla";
import type {WidthBlock} from "./widthGate";

const STEER_MAX_CANDIDATES = 3;
const STEER_MIN_FRESH_ZONES = 2;
const STEER_MARGIN_METERS = 50;
const STEER_MIN_ANCHOR_GAP_METERS = 150;
const STEER_PROGRESS_MIN = 0.15;
const STEER_PROGRESS_MAX = 0.85;
const STEER_BEARING_STEPS = 8;

interface SteerCheck {
  hazards: closureService.BlockingZone[];
  widthBlocks: WidthBlock[];
  widthTight: WidthBlock[];
}

interface SteerInput {
  origin: LatLng;
  destination: LatLng;
  rings: Ring[];
  cluster: closureService.BlockingZone[];
  check: (geometry: unknown) => Promise<SteerCheck>;
}

interface SteeredRoute {
  geometry: unknown;
  distanceMeters: number | undefined;
  durationSeconds: number | undefined;
  widthBlocks: WidthBlock[];
  widthTight: WidthBlock[];
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

const destinationPoint = (
  lat: number,
  lng: number,
  radiusMeters: number,
  bearing: number,
): LatLng => {
  const earth = 6371000;
  const delta = radiusMeters / earth;
  const latRad = toRadians(lat);
  const lngRad = toRadians(lng);
  const outLat = Math.asin(
    Math.sin(latRad) * Math.cos(delta) +
      Math.cos(latRad) * Math.sin(delta) * Math.cos(bearing),
  );
  const outLng =
    lngRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(delta) * Math.cos(latRad),
      Math.cos(delta) - Math.sin(latRad) * Math.sin(outLat),
    );
  return {lat: toDegrees(outLat), lng: toDegrees(outLng)};
};

const pathBearing = (origin: LatLng, destination: LatLng): number => {
  const cosLat = Math.cos(toRadians(origin.lat));
  const dx = (destination.lng - origin.lng) * cosLat;
  const dy = destination.lat - origin.lat;
  return Math.atan2(dx, dy);
};

const axisProgress = (
  origin: LatLng,
  destination: LatLng,
  point: LatLng,
): number => {
  const cosLat = Math.cos(toRadians(origin.lat));
  const vx = (destination.lng - origin.lng) * cosLat;
  const vy = destination.lat - origin.lat;
  const wx = (point.lng - origin.lng) * cosLat;
  const wy = point.lat - origin.lat;
  const denom = vx * vx + vy * vy;
  if (denom === 0) return 0;
  return (wx * vx + wy * vy) / denom;
};

const outsideEveryZone = (
  point: LatLng,
  cluster: closureService.BlockingZone[],
): boolean =>
  cluster.every(
    (zone) =>
      haversineMeters(point.lat, point.lng, zone.lat, zone.lng) >
      zone.radiusMeters,
  );

const clearOfControls = (
  point: LatLng,
  origin: LatLng,
  destination: LatLng,
): boolean =>
  haversineMeters(point.lat, point.lng, origin.lat, origin.lng) >
    STEER_MIN_ANCHOR_GAP_METERS &&
  haversineMeters(
    point.lat,
    point.lng,
    destination.lat,
    destination.lng,
  ) > STEER_MIN_ANCHOR_GAP_METERS;

const orderedBearings = (axis: number): number[] => {
  const half = Math.PI / 2;
  const quarter = Math.PI / 4;
  const offsets = [
    half,
    -half,
    quarter,
    -quarter,
    3 * quarter,
    -3 * quarter,
    0,
    Math.PI,
  ];
  return offsets.map((offset) => axis + offset);
};

const collectAnchors = (
  origin: LatLng,
  destination: LatLng,
  cluster: closureService.BlockingZone[],
  orbit: number,
  centerLat: number,
  centerLng: number,
): LatLng[] => {
  const anchors: LatLng[] = [];
  const axis = pathBearing(origin, destination);
  for (const bearing of orderedBearings(axis)) {
    if (anchors.length >= STEER_MAX_CANDIDATES) break;
    const anchor = destinationPoint(centerLat, centerLng, orbit, bearing);
    if (!outsideEveryZone(anchor, cluster)) continue;
    if (!clearOfControls(anchor, origin, destination)) continue;
    const progress = axisProgress(origin, destination, anchor);
    if (progress <= STEER_PROGRESS_MIN) continue;
    if (progress >= STEER_PROGRESS_MAX) continue;
    anchors.push(anchor);
  }
  return anchors;
};

const recheckClean = async (
  input: SteerInput,
  geometry: unknown,
): Promise<SteerCheck | null> => {
  const check = await input.check(geometry);
  if (check.hazards.length > 0) return null;
  if (check.widthBlocks.length > 0) return null;
  return check;
};

const steerScore = (route: ValhallaRoute): number =>
  (route.durationSeconds ?? Number.MAX_SAFE_INTEGER) * 1000000 +
  (route.distanceMeters ?? 0);

const steerThroughCorridor = async (
  input: SteerInput,
): Promise<SteeredRoute | null> => {
  if (input.cluster.length === 0) return null;
  let centerLat = 0;
  let centerLng = 0;
  for (const zone of input.cluster) {
    centerLat += zone.lat;
    centerLng += zone.lng;
  }
  centerLat /= input.cluster.length;
  centerLng /= input.cluster.length;
  let orbit = 0;
  for (const zone of input.cluster) {
    orbit = Math.max(
      orbit,
      haversineMeters(centerLat, centerLng, zone.lat, zone.lng) +
        zone.radiusMeters,
    );
  }
  orbit += STEER_MARGIN_METERS;
  const anchors = collectAnchors(
    input.origin,
    input.destination,
    input.cluster,
    orbit,
    centerLat,
    centerLng,
  );
  let best: SteeredRoute | null = null;
  let bestRoute: ValhallaRoute | null = null;
  for (const anchor of anchors) {
    let solved: ValhallaRoute;
    try {
      solved = (
        await postRoutes(
          [input.origin, anchor, input.destination],
          input.rings,
          1,
        )
      )[0];
    } catch {
      continue;
    }
    if (!solved) continue;
    const clean = await recheckClean(input, solved.geometry);
    if (clean === null) continue;
    if (bestRoute === null || steerScore(solved) < steerScore(bestRoute)) {
      bestRoute = solved;
      best = {
        geometry: solved.geometry,
        distanceMeters: solved.distanceMeters,
        durationSeconds: solved.durationSeconds,
        widthBlocks: clean.widthBlocks,
        widthTight: clean.widthTight,
      };
    }
  }
  return best;
};

export {
  steerThroughCorridor,
  STEER_MAX_CANDIDATES,
  STEER_MIN_FRESH_ZONES,
  STEER_MARGIN_METERS,
  STEER_MIN_ANCHOR_GAP_METERS,
  STEER_PROGRESS_MIN,
  STEER_PROGRESS_MAX,
  STEER_BEARING_STEPS,
  SteerInput,
  SteeredRoute,
};
