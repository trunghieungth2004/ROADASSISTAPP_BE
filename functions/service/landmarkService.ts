import * as landmarkRepository from "../repository/landmarkRepository";
import * as userRepository from "../repository/userRepository";
import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  haversineMeters,
} from "../utils/geo";
import * as cacheManager from "../utils/cacheManager";

import {NotFoundError, ValidationError} from "../utils/errors";

const NS = "landmark";

const nearLandmarks = cacheManager.wrap(
  async ({
    lat,
    lng,
    radiusMeters = 500,
  }: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  }) => {
    const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
    const unique = cellsCoveringBounds(bounds, 6);
    const found = await landmarkRepository.findByGeohashPrefixes(unique);
    return found
      .filter(
        (l) =>
          haversineMeters(lat, lng, l.lat as number, l.lng as number) <=
          radiusMeters,
      )
      .map((l) => ({
        ...l,
        distance: haversineMeters(lat, lng, l.lat as number, l.lng as number),
      }));
  },
  {
    namespace: NS,
    keyFn: ({
      lat,
      lng,
      radiusMeters,
    }: {
      lat: number;
      lng: number;
      radiusMeters?: number;
    }) => `${lat},${lng},${radiusMeters ?? 500}`,
  },
) as unknown as (arg: {
  lat: number;
  lng: number;
  radiusMeters?: number;
}) => Promise<Record<string, unknown>[]>;

const createLandmark = async ({
  userId,
  lat,
  lng,
  displayLabel,
  embedding,
}: {
  userId: string;
  lat: number;
  lng: number;
  displayLabel: string;
  embedding?: number[];
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const landmark = await landmarkRepository.create({
    lat,
    lng,
    displayLabel,
    embedding,
  });
  cacheManager.del(NS);
  return landmark;
};

export {
  nearLandmarks,
  createLandmark,
  ValidationError,
  NotFoundError,
};
