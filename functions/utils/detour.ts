import {lineString as turfLineString, point as turfPoint} from
  "@turf/helpers";
import turfBearing from "@turf/bearing";
import turfDestination from "@turf/destination";
import turfNearestPointOnLine from "@turf/nearest-point-on-line";
import {extractLineCoords, haversineMeters} from "./geo";

export const DETOUR_MARGINS_METERS = [20, 60, 120];
export const STOP_MATCH_TOLERANCE_METERS = 150;

export interface HazardCircle {
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

const isLatLng = (p: LatLng): boolean =>
  typeof p.lat === "number" &&
  typeof p.lng === "number" &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng);

const isHazard = (zone: HazardCircle): boolean =>
  isLatLng(zone) &&
  typeof zone.radiusMeters === "number" &&
  Number.isFinite(zone.radiusMeters) &&
  zone.radiusMeters > 0;

const buildBypassPoint = (
  geometry: unknown,
  zone: HazardCircle,
  marginMeters: number,
  origin: LatLng,
  dest: LatLng,
): LatLng | null => {
  if (
    !isHazard(zone) ||
    typeof marginMeters !== "number" ||
    marginMeters < 0 ||
    !isLatLng(origin) ||
    !isLatLng(dest)
  ) {
    return null;
  }
  const clearance = zone.radiusMeters + marginMeters;
  if (
    haversineMeters(origin.lat, origin.lng, zone.lat, zone.lng) <= clearance ||
    haversineMeters(dest.lat, dest.lng, zone.lat, zone.lng) <= clearance
  ) {
    return null;
  }
  const hit = nearestOnRoute(geometry, zone);
  if (!hit) return null;
  const coords = extractLineCoords(geometry);
  const segBearing = turfBearing(
    turfPoint(coords[hit.index]),
    turfPoint(coords[hit.index + 1]),
  );
  if (!Number.isFinite(segBearing)) return null;
  for (const side of [90, -90]) {
    let via;
    try {
      via = turfDestination(
        turfPoint([hit.lng, hit.lat]),
        clearance / 1000,
        segBearing + side,
        {units: "kilometers"},
      );
    } catch {
      continue;
    }
    const [viaLng, viaLat] = via.geometry.coordinates;
    if (!Number.isFinite(viaLat) || !Number.isFinite(viaLng)) continue;
    if (
      haversineMeters(viaLat, viaLng, zone.lat, zone.lng) > zone.radiusMeters
    ) {
      return {lat: viaLat, lng: viaLng};
    }
  }
  return null;
};

const nearestOnRoute = (
  geometry: unknown,
  zone: HazardCircle,
): {index: number; lat: number; lng: number} | null => {
  if (!isHazard(zone)) return null;
  const coords = extractLineCoords(geometry);
  if (coords.length < 2) return null;
  let nearest;
  try {
    nearest = turfNearestPointOnLine(
      turfLineString(coords),
      turfPoint([zone.lng, zone.lat]),
    );
  } catch {
    return null;
  }
  const index = Math.min(
    nearest.properties.index ?? 0,
    coords.length - 2,
  );
  const [lng, lat] = nearest.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {index, lat, lng};
};

const nearestSegmentIndex = (
  geometry: unknown,
  zone: HazardCircle,
): number | null => {
  const hit = nearestOnRoute(geometry, zone);
  return hit === null ? null : hit.index;
};

const legOrdinalForZone = (
  geometry: unknown,
  stops: LatLng[],
  segIndex: number,
): number | null => {
  const coords = extractLineCoords(geometry);
  if (
    coords.length < 2 ||
    !Number.isInteger(segIndex) ||
    segIndex < 0 ||
    segIndex > coords.length - 2
  ) {
    return null;
  }
  let ordinal = 0;
  for (const stop of stops) {
    if (!isLatLng(stop)) return null;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const dist = haversineMeters(
        stop.lat,
        stop.lng,
        coords[i][1],
        coords[i][0],
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist > STOP_MATCH_TOLERANCE_METERS) return null;
    if (bestIdx <= segIndex) ordinal += 1;
  }
  return ordinal;
};

export {
  buildBypassPoint,
  nearestSegmentIndex,
  legOrdinalForZone,
};
