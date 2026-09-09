const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

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

export const lineStringHitsCircles = <T extends CircleZone>(
  geometry: unknown,
  zones: T[],
): Array<T & {distanceMeters: number}> => {
  const raw = (geometry as {coordinates?: unknown} | null)?.coordinates;
  if (!Array.isArray(raw) || raw.length === 0 || zones.length === 0) {
    return [];
  }
  const hits: Array<T & {distanceMeters: number}> = [];
  for (const zone of zones) {
    let min = Infinity;
    for (let i = 0; i < raw.length; i++) {
      const pt = raw[i] as [number, number] | null;
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const [lng, lat] = pt;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (i === 0) {
        min = Math.min(min, haversineMeters(zone.lat, zone.lng, lat, lng));
        continue;
      }
      const prev = raw[i - 1] as [number, number] | null;
      if (!Array.isArray(prev) || prev.length < 2) continue;
      const [prevLng, prevLat] = prev;
      if (typeof prevLat !== "number" || typeof prevLng !== "number") {
        continue;
      }
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
    if (min <= zone.radiusMeters) {
      hits.push({...zone, distanceMeters: min});
    }
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
