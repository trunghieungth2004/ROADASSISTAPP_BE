import * as landmarkRepository from "../repository/landmarkRepository";
import * as userRepository from "../repository/userRepository";
import {
  boundsForRadiusMeters,
  encodeGeohash,
  haversineMeters,
} from "../utils/geo";
import * as cacheManager from "../utils/cacheManager";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}

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
    const unique = Array.from(new Set(prefixes));
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

const matchNearby = async ({
  lat,
  lng,
  embedding,
  radiusMeters = 300,
}: {
  lat: number;
  lng: number;
  embedding: number[];
  radiusMeters?: number;
}) => {
  const candidates = await nearLandmarks({lat, lng, radiusMeters});
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const candEmbedding = candidate.embedding as number[] | null | undefined;
    if (!candEmbedding || candEmbedding.length === 0) continue;
    const score = cosineSimilarity(embedding, candEmbedding);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore >= 0.7 ?
    {landmark: best, confidence: bestScore} :
    {landmark: null, confidence: bestScore};
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
};

export {
  nearLandmarks,
  createLandmark,
  matchNearby,
  ValidationError,
  NotFoundError,
};
