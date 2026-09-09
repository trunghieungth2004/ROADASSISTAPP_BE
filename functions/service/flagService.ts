import * as flagRepository from "../repository/flagRepository";
import * as userRepository from "../repository/userRepository";
import {boundsForRadiusMeters, encodeGeohash} from "../utils/geo";
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

interface FlagRecord {
  id: string;
  type: string;
  status: string;
  voteCount?: number;
  reporterTrust?: number;
  [key: string]: unknown;
}

const NS = "flag";

const TTL_MS: Record<string, number> = {
  ACCIDENT: 60 * 60 * 1000,
  FLOOD: 6 * 60 * 60 * 1000,
  OBSTRUCTION: 3 * 60 * 60 * 1000,
};

const CONSENSUS_THRESHOLD = 3;

const createFlag = async ({
  userId,
  type,
  lat,
  lng,
  note,
}: {
  userId: string;
  type: string;
  lat: number;
  lng: number;
  note?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const ttlMs = TTL_MS[type] ?? 3 * 60 * 60 * 1000;
  const trustScore = (user.trustScore as number) ?? 0;
  const flag = await flagRepository.create({
    type,
    lat,
    lng,
    reporterUid: userId,
    ttlMs,
    trustScore,
    note,
  });
  cacheManager.del(NS);
  return flag;
};

const confirmFlag = async (flagId: string): Promise<FlagRecord | null> => {
  const flag = await flagRepository.findById(flagId);
  if (!flag) return null;
  if (flag.status === "LOCKED") return flag;
  const voteWeight = 1 + ((flag.reporterTrust as number) >= 50 ? 0.5 : 0);
  const newCount = (flag.voteCount as number) + voteWeight;
  await flagRepository.incrementVote(flagId);
  if (newCount >= CONSENSUS_THRESHOLD) {
    await flagRepository.updateStatus(flagId, "CONFIRMED");
  }
  cacheManager.del(NS, flagId);
  return {...flag, voteCount: newCount};
};

const getNear = cacheManager.wrap(
  async ({
    lat,
    lng,
    radiusMeters = 2000,
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
        5,
      ).slice(0, 5);
    });
    const unique = Array.from(new Set([...prefixes]));
    const active = await flagRepository.findByGeohashPrefixes(unique);
    return active.filter(
      (f) => f.status !== "EXPIRED" && f.status !== "REJECTED",
    );
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
    }) => `${lat},${lng},${radiusMeters ?? 2000}`,
  },
) as unknown as (arg: {
  lat: number;
  lng: number;
  radiusMeters?: number;
}) => Promise<FlagRecord[]>;

const moderateFlag = async ({
  flagId,
  status,
}: {
  flagId: string;
  status: string;
}) => {
  const flag = await flagRepository.findById(flagId);
  if (!flag) throw new NotFoundError("Flag not found");
  await flagRepository.updateStatus(flagId, status);
  cacheManager.del(NS, flagId);
  return {updated: 1};
};

const expireFlags = async (): Promise<number> => {
  const expired = await flagRepository.findExpired();
  for (const flag of expired) {
    await flagRepository.updateStatus(flag.id, "EXPIRED");
    cacheManager.del(NS, flag.id);
  }
  return expired.length;
};

export {
  createFlag,
  confirmFlag,
  getNear,
  moderateFlag,
  expireFlags,
  ValidationError,
  NotFoundError,
};
