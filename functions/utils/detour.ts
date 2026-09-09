import {lineString as turfLineString, point as turfPoint} from
  "@turf/helpers";
import turfBearing from "@turf/bearing";
import turfDestination from "@turf/destination";
import turfNearestPointOnLine from "@turf/nearest-point-on-line";
import {extractLineCoords, haversineMeters} from "./geo";

export const DETOUR_MARGINS_METERS = [20, 60, 120];

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
  const segIndex = Math.min(
    nearest.properties.index ?? 0,
    coords.length - 2,
  );
  const segBearing = turfBearing(
    turfPoint(coords[segIndex]),
    turfPoint(coords[segIndex + 1]),
  );
  if (!Number.isFinite(segBearing)) return null;
  const [nearLng, nearLat] = nearest.geometry.coordinates;
  for (const side of [90, -90]) {
    let via;
    try {
      via = turfDestination(
        turfPoint([nearLng, nearLat]),
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

export {buildBypassPoint};
