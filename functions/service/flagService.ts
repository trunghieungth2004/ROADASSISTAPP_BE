import * as flagRepository from "../repository/flagRepository";
import * as userRepository from "../repository/userRepository";
import * as savedRouteRepository from "../repository/savedRouteRepository";
import * as savedPlaceRepository from "../repository/savedPlaceRepository";
import {STATUS_FLAGS} from "../constants/status";
import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  haversineMeters,
} from "../utils/geo";
import * as cacheManager from "../utils/cacheManager";
import {effectiveRadiusMeters} from "./closureService";
import {enqueueHazardPush} from "./taskQueueService";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class ConflictError extends Error {
  statusCode: number;
  errors: unknown;
  constructor(message: string, errors?: unknown) {
    super(message);
    this.statusCode = 409;
    this.errors = errors;
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
  votes?: Record<string, number>;
  alreadyVoted?: boolean;
  voteDirection?: "up" | "down" | null;
  [key: string]: unknown;
}

const NS = "flag";

const TTL_MS: Record<string, number> = {
  ACCIDENT: 60 * 60 * 1000,
  FLOOD: 6 * 60 * 60 * 1000,
  OBSTRUCTION: 3 * 60 * 60 * 1000,
};

const CONSENSUS_THRESHOLD = 3;

const assertNoCoveredDestination = async ({
  userId,
  type,
  lat,
  lng,
  radiusMeters,
}: {
  userId: string;
  type: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
}): Promise<void> => {
  const radius = effectiveRadiusMeters(type, radiusMeters);
  const [routes, places] = await Promise.all([
    savedRouteRepository.listByUserId(userId),
    savedPlaceRepository.listByUserId(userId),
  ]);
  const points: Array<{
    kind: string;
    label: string;
    lat: number;
    lng: number;
  }> = [];
  for (const route of routes) {
    const label =
      typeof route.name === "string" && route.name !== "" ?
        route.name :
        route.id;
    for (const end of [
      {kind: "destination", lat: route.destLat, lng: route.destLng},
      {kind: "origin", lat: route.originLat, lng: route.originLng},
    ]) {
      if (typeof end.lat === "number" && typeof end.lng === "number") {
        points.push({
          kind: `route ${end.kind}`,
          label,
          lat: end.lat,
          lng: end.lng,
        });
      }
    }
  }
  for (const place of places) {
    if (typeof place.lat === "number" && typeof place.lng === "number") {
      points.push({
        kind: "saved place",
        label: place.label,
        lat: place.lat,
        lng: place.lng,
      });
    }
  }
  for (const point of points) {
    if (haversineMeters(lat, lng, point.lat, point.lng) <= radius) {
      throw new ConflictError(
        `Flag covers your ${point.kind} "${point.label}"`,
        {kind: point.kind, label: point.label},
      );
    }
  }
};

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
  await assertNoCoveredDestination({userId, type, lat, lng, radiusMeters});
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

const voteWeightFor = (flag: FlagRecord): number =>
  1 + ((flag.reporterTrust as number) >= 50 ? 0.5 : 0);

const voteDirectionOf = (
  flag: FlagRecord,
  userId: string,
  weight: number,
): "up" | "down" | null => {
  const stored = flag.votes ?? {};
  const voters = Array.isArray(flag.voters) ? flag.voters : [];
  const current =
    userId in stored ? stored[userId] : voters.includes(userId) ? weight : 0;
  if (current > 0) return "up";
  if (current < 0) return "down";
  return null;
};

const castSignedFlagVote = async (
  flagId: string,
  userId: string,
  sign: 1 | -1,
): Promise<FlagRecord | null> => {
  const flag = await flagRepository.findById(flagId);
  if (!flag) return null;
  if ((flag.reporterUid as string) === userId) {
    throw new ForbiddenError("You cannot vote on your own report");
  }
  if (flag.status === STATUS_FLAGS.LOCKED) {
    return {
      ...flag,
      alreadyVoted: false,
      voteDirection: voteDirectionOf(flag, userId, voteWeightFor(flag)),
    };
  }
  const signedWeight = voteWeightFor(flag) * sign;
  const cast = await flagRepository.castSignedVote(
    flagId,
    userId,
    signedWeight,
  );
  if (!cast) return null;
  if (cast.duplicate) {
    return {...cast.flag, alreadyVoted: true, voteDirection: cast.direction};
  }
  const newCount = cast.flag.voteCount as number;
  if (
    sign > 0 &&
    newCount >= CONSENSUS_THRESHOLD &&
    cast.flag.status !== STATUS_FLAGS.CONFIRMED
  ) {
    await flagRepository.updateStatus(flagId, STATUS_FLAGS.CONFIRMED);
    cacheManager.del(NS, flagId);
    await enqueueHazardPush(flagId, flag.type, STATUS_FLAGS.CONFIRMED);
    return {
      ...cast.flag,
      voteCount: newCount,
      status: STATUS_FLAGS.CONFIRMED,
      alreadyVoted: false,
      voteDirection: cast.direction,
    };
  }
  if (sign < 0 && newCount <= -CONSENSUS_THRESHOLD) {
    if (cast.flag.status === STATUS_FLAGS.SUGGESTED) {
      await flagRepository.updateStatus(flagId, STATUS_FLAGS.REJECTED);
      cacheManager.del(NS, flagId);
      return {
        ...cast.flag,
        voteCount: newCount,
        status: STATUS_FLAGS.REJECTED,
        alreadyVoted: false,
        voteDirection: cast.direction,
      };
    }
    if (cast.flag.status === STATUS_FLAGS.CONFIRMED) {
      await flagRepository.updateStatus(flagId, STATUS_FLAGS.SUGGESTED);
      cacheManager.del(NS, flagId);
      return {
        ...cast.flag,
        voteCount: newCount,
        status: STATUS_FLAGS.SUGGESTED,
        alreadyVoted: false,
        voteDirection: cast.direction,
      };
    }
  }
  cacheManager.del(NS, flagId);
  return {
    ...cast.flag,
    voteCount: newCount,
    alreadyVoted: false,
    voteDirection: cast.direction,
  };
};

const confirmFlag = async (
  flagId: string,
  userId: string,
): Promise<FlagRecord | null> => castSignedFlagVote(flagId, userId, 1);

const denyFlag = async (
  flagId: string,
  userId: string,
): Promise<FlagRecord | null> => castSignedFlagVote(flagId, userId, -1);

const stripVoters = (flag: FlagRecord): FlagRecord => {
  const rest = {...flag};
  delete rest.voters;
  delete rest.votes;
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
  denyFlag,
  getNear,
  getMine,
  moderateFlag,
  unflagFlag,
  expireFlags,
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
};
