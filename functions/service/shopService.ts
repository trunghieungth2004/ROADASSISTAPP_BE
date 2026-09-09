import * as shopRepository from "../repository/shopRepository";
import * as userRepository from "../repository/userRepository";
import {
  boundsForRadiusMeters,
  encodeGeohash,
  haversineMeters,
} from "../utils/geo";

class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}

const createShop = async ({
  userId,
  name,
  lat,
  lng,
  type,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return shopRepository.create({name, lat, lng, type});
};

const nearShops = async ({
  lat,
  lng,
  type,
  radiusMeters = 2000,
}: {
  lat: number;
  lng: number;
  type?: string;
  radiusMeters?: number;
}) => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const prefixes = Array.from({length: 9}, (_, i) => {
    const r = (i % 3) - 1;
    const c = Math.floor(i / 3) - 1;
    const dLat = (bounds.maxLat - bounds.minLat) / 3;
    const dLng = (bounds.maxLng - bounds.minLng) / 3;
    return encodeGeohash(
      bounds.minLat + (r + 0.5) * dLat,
      bounds.minLng + (c + 0.5) * dLng,
      6,
    ).slice(0, 6);
  });
  const found = await shopRepository.findByGeohashPrefixes(
    Array.from(new Set(prefixes)),
  );
  let filtered = found.filter(
    (s) =>
      haversineMeters(lat, lng, s.lat as number, s.lng as number) <=
      radiusMeters,
  );
  if (type) filtered = filtered.filter((s) => s.type === type);
  return filtered.map((s) => ({
    ...s,
    distance: haversineMeters(lat, lng, s.lat as number, s.lng as number),
  }));
};

export {createShop, nearShops, NotFoundError};
