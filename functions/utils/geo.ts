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
