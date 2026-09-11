import * as flagRepository from "../repository/flagRepository";
import * as userRepository from "../repository/userRepository";
import {STATUS_FLAGS} from "../constants/status";
import {boundsForRadiusMeters, cellsCoveringBounds} from "../utils/geo";
import * as cacheManager from "../utils/cacheManager";
import {enqueueHazardPush} from "./taskQueueService";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}
class ForbiddenError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface FlagRecord {
  id: string;
  type: string;
  status: string;
  voteCount?: number;
  reporterTrust?: number;
  voters?: string[];
  alreadyVoted?: boolean;
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
  radiusMeters,
}: {
  userId: string;
  type: string;
  lat: number;
  lng: number;
  note?: string;
  radiusMeters?: number;
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
    radiusMeters,
    note,
  });
  cacheManager.del(NS);
  return flag;
};

const confirmFlag = async (
  flagId: string,
  userId: string,
): Promise<FlagRecord | null> => {
  const flag = await flagRepository.findById(flagId);
  if (!flag) return null;
  if ((flag.reporterUid as string) === userId) {
    throw new ForbiddenError("You cannot confirm your own report");
  }
  if (flag.status === STATUS_FLAGS.LOCKED) {
    return {...flag, alreadyVoted: false};
  }
  const voteWeight = 1 + ((flag.reporterTrust as number) >= 50 ? 0.5 : 0);
  const cast = await flagRepository.castVote(flagId, userId, voteWeight);
  if (!cast) return null;
  if (cast.duplicate) return {...cast.flag, alreadyVoted: true};
  const newCount = cast.flag.voteCount as number;
  if (
    newCount >= CONSENSUS_THRESHOLD &&
    cast.flag.status !== STATUS_FLAGS.CONFIRMED
  ) {
    await flagRepository.updateStatus(flagId, STATUS_FLAGS.CONFIRMED);
    cacheManager.del(NS, flagId);
    await enqueueHazardPush(
      flagId,
      flag.type,
      STATUS_FLAGS.CONFIRMED,
    );
    return {
      ...cast.flag,
      voteCount: newCount,
      status: STATUS_FLAGS.CONFIRMED,
      alreadyVoted: false,
    };
  }
  cacheManager.del(NS, flagId);
  return {...cast.flag, voteCount: newCount, alreadyVoted: false};
};

const stripVoters = (flag: FlagRecord): FlagRecord => {
  const rest = {...flag};
  delete rest.voters;
  return rest;
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
    const unique = cellsCoveringBounds(bounds);
    const active = await flagRepository.findByGeohashPrefixes(unique);
    return active
      .filter(
        (f) =>
          f.status !== STATUS_FLAGS.EXPIRED &&
          f.status !== STATUS_FLAGS.REJECTED,
      )
      .map(stripVoters);
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

const getMine = async (userId: string): Promise<FlagRecord[]> => {
  const flags = await flagRepository.findByReporterUid(userId);
  return flags
    .filter(
      (f) =>
        f.status !== STATUS_FLAGS.EXPIRED &&
        f.status !== STATUS_FLAGS.REJECTED,
    )
    .map(stripVoters);
};

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
  if (status === STATUS_FLAGS.CONFIRMED || status === STATUS_FLAGS.LOCKED) {
    await enqueueHazardPush(flagId, flag.type, status);
  }
  return {updated: 1};
};

const unflagFlag = async ({
  flagId,
  userId,
}: {
  flagId: string;
  userId: string;
}) => {
  const flag = await flagRepository.findById(flagId);
  if (!flag) return null;
  if (
    flag.status === STATUS_FLAGS.EXPIRED ||
    flag.status === STATUS_FLAGS.REJECTED
  ) {
    return null;
  }
  if (flag.status === STATUS_FLAGS.LOCKED) {
    throw new ValidationError(
      "Locked flags can only be removed by an administrator",
    );
  }
  if ((flag.reporterUid as string) !== userId) {
    throw new ForbiddenError("Only the reporter can unflag this report");
  }
  await flagRepository.deleteById(flagId);
  cacheManager.del(NS, flagId);
  cacheManager.del(NS);
  return {unflagged: 1};
};

const expireFlags = async (): Promise<number> => {
  const expired = await flagRepository.findExpired();
  for (const flag of expired) {
    await flagRepository.updateStatus(flag.id, STATUS_FLAGS.EXPIRED);
    cacheManager.del(NS, flag.id);
  }
  return expired.length;
};

export {
  createFlag,
  confirmFlag,
  getNear,
  getMine,
  moderateFlag,
  unflagFlag,
  expireFlags,
  ValidationError,
  ForbiddenError,
  NotFoundError,
};
