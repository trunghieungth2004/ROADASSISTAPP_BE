import {lineString as turfLineString, point as turfPoint} from
  "@turf/helpers";
import turfBooleanPointInPolygon from "@turf/boolean-point-in-polygon";
import turfCircle from "@turf/circle";
import turfLineIntersect from "@turf/line-intersect";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

const CIRCLE_STEPS = 64;

export const encodeGeohash = (
  lat: number,
  lng: number,
  precision = 9,
): string => {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let bit = 0;
  let ch = 0;
  let even = true;
  const geohash: string[] = [];
  while (geohash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        latMin = mid;
      } else {
        latMax = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit++;
    } else {
      geohash.push(BASE32[ch]);
      bit = 0;
      ch = 0;
    }
  }
  return geohash.join("");
};

export const decodeGeohash = (
  geohash: string,
): { latitude: number; longitude: number } => {
  const latBits: number[] = [];
  const lngBits: number[] = [];
  for (const char of geohash) {
    const i = BASE32.indexOf(char);
    if (i === -1) throw new Error(`Invalid geohash character: ${char}`);
    for (let bit = 4; bit >= 0; bit--) {
      const b = (i >> bit) & 1;
      if ((lngBits.length + latBits.length) % 2 === 0) lngBits.push(b);
      else latBits.push(b);
    }
  }
  const decodeBits = (bits: number[], min: number, max: number): number => {
    for (const b of bits) {
      const mid = (min + max) / 2;
      if (b === 1) min = mid;
      else max = mid;
    }
    return (min + max) / 2;
  };
  return {
    latitude: decodeBits(latBits, -90, 90),
    longitude: decodeBits(lngBits, -180, 180),
  };
};

export const haversineMeters = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const boundsForRadiusMeters = (
  lat: number,
  lng: number,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } => {
  const degPerMeterLat = 1 / 110574;
  const latDelta = radiusMeters * degPerMeterLat;
  const lngDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
};

export const isWithinRadiusMeters = (
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): boolean => haversineMeters(lat, lng, centerLat, centerLng) <= radiusMeters;

export const pointToSegmentMeters = (
  lat: number,
  lng: number,
  segLat1: number,
  segLng1: number,
  segLat2: number,
  segLng2: number,
): number => {
  const mPerDegLat = 110574;
  const mPerDegLng = 111320 * Math.cos((segLat1 * Math.PI) / 180);
  const px = (lng - segLng1) * mPerDegLng;
  const py = (lat - segLat1) * mPerDegLat;
  const dx = (segLng2 - segLng1) * mPerDegLng;
  const dy = (segLat2 - segLat1) * mPerDegLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
  return Math.hypot(px - t * dx, py - t * dy);
};

interface CircleZone {
  lat: number;
  lng: number;
  radiusMeters: number;
  [key: string]: unknown;
}

export const extractLineCoords = (
  geometry: unknown,
): Array<[number, number]> => {
  const raw = (geometry as {coordinates?: unknown} | null)?.coordinates;
  if (!Array.isArray(raw)) return [];
  const coords: Array<[number, number]> = [];
  for (const pt of raw) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const [lng, lat] = pt as [unknown, unknown];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    coords.push([lng, lat]);
  }
  return coords;
};

export const lineStringHitsCircles = <T extends CircleZone>(
  geometry: unknown,
  zones: T[],
): Array<T & {distanceMeters: number}> => {
  const coords = extractLineCoords(geometry);
  if (coords.length === 0 || zones.length === 0) {
    return [];
  }
  const hits: Array<T & {distanceMeters: number}> = [];
  for (const zone of zones) {
    if (
      typeof zone.lat !== "number" ||
      typeof zone.lng !== "number" ||
      typeof zone.radiusMeters !== "number"
    ) {
      continue;
    }
    let hit = false;
    try {
      const ring = turfCircle(
        [zone.lng, zone.lat],
        zone.radiusMeters / 1000,
        {steps: CIRCLE_STEPS, units: "kilometers"},
      );
      if (coords.length === 1) {
        hit = turfBooleanPointInPolygon(turfPoint(coords[0]), ring);
      } else {
        hit =
          turfLineIntersect(turfLineString(coords), ring).features.length >
            0 ||
          coords.some((c) => turfBooleanPointInPolygon(turfPoint(c), ring));
      }
    } catch {
      hit = false;
    }
    if (!hit) continue;
    let min = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      if (i === 0) {
        min = Math.min(min, haversineMeters(zone.lat, zone.lng, lat, lng));
        continue;
      }
      const [prevLng, prevLat] = coords[i - 1];
      min = Math.min(
        min,
        pointToSegmentMeters(
          zone.lat,
          zone.lng,
          prevLat,
          prevLng,
          lat,
          lng,
        ),
      );
    }
    hits.push({...zone, distanceMeters: min});
  }
  return hits.sort((a, b) => a.distanceMeters - b.distanceMeters);
};

interface LatLngBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const cellsForBounds = (
  bounds: LatLngBounds,
  precision = 5,
): string[] => {
  const prefixes: string[] = [];
  for (let i = 0; i < 9; i++) {
    const r = (i % 3) - 1;
    const c = Math.floor(i / 3) - 1;
    const dLat = (bounds.maxLat - bounds.minLat) / 3;
    const dLng = (bounds.maxLng - bounds.minLng) / 3;
    prefixes.push(
      encodeGeohash(
        bounds.minLat + (r + 0.5) * dLat,
        bounds.minLng + (c + 0.5) * dLng,
        precision,
      ).slice(0, precision),
    );
  }
  return Array.from(new Set(prefixes));
};

const geohashCellBounds = (
  hash: string,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } => {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;
  for (const char of hash) {
    const i = BASE32.indexOf(char);
    if (i === -1) throw new Error(`Invalid geohash character: ${char}`);
    for (let bit = 4; bit >= 0; bit--) {
      const b = (i >> bit) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (b === 1) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (b === 1) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return {minLat: latMin, maxLat: latMax, minLng: lngMin, maxLng: lngMax};
};

const CELLS_COVER_MAX = 520;

export const cellsCoveringBounds = (
  bounds: LatLngBounds,
  precision = 5,
  maxCells = CELLS_COVER_MAX,
): string[] => {
  let p = Math.max(1, Math.min(12, Math.floor(precision)));
  for (;;) {
    const sw = encodeGeohash(bounds.minLat, bounds.minLng, p);
    const cell = geohashCellBounds(sw);
    const latStep = cell.maxLat - cell.minLat;
    const lngStep = cell.maxLng - cell.minLng;
    if (latStep <= 0 || lngStep <= 0) return [sw.slice(0, p)];
    const startLat = (cell.minLat + cell.maxLat) / 2;
    const startLng = (cell.minLng + cell.maxLng) / 2;
    const rows = Math.max(
      1,
      Math.ceil((bounds.maxLat - cell.minLat) / latStep),
    );
    const cols = Math.max(
      1,
      Math.ceil((bounds.maxLng - cell.minLng) / lngStep),
    );
    if (rows * cols <= maxCells || p <= 2) {
      const cells = new Set<string>();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          cells.add(
            encodeGeohash(startLat + r * latStep, startLng + c * lngStep, p),
          );
        }
      }
      return Array.from(cells);
    }
    p -= 1;
  }
};
