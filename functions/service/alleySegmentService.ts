import * as alleySegmentRepository from "../repository/alleySegmentRepository";
import * as userRepository from "../repository/userRepository";
import {encodeGeohash, boundsForRadiusMeters} from "../utils/geo";
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

const NS = "alleySegment";

interface Segment {
  id: string;
  baseWidth?: number | null;
  wireHeight?: number | null;
  inclinePct?: number | null;
  tier: string;
  verifiedCount?: number;
  [key: string]: unknown;
}

const computePassability = (
  segment: Segment,
  vehicleWidth: number,
): {
  compatible: boolean;
  score: number;
  reason: string;
} => {
  const capacity = segment.baseWidth ?? 0;
  if (capacity <= 0) {
    return {compatible: true, score: 50, reason: "UNKNOWN_WIDTH"};
  }
  if (vehicleWidth > capacity) {
    return {compatible: false, score: 10, reason: "NARROWER_THAN_VEHICLE"};
  }
  const margin = capacity - vehicleWidth;
  if (margin >= 0.3) {
    return {compatible: true, score: 90, reason: "WIDE"};
  } else if (margin >= 0.1) {
    return {compatible: true, score: 70, reason: "TIGHT"};
  } else {
    return {compatible: true, score: 50, reason: "VERY_TIGHT"};
  }
};

const getSegment = cacheManager.wrap(
  async (segmentId: string) => {
    const segment = await alleySegmentRepository.findById(segmentId);
    if (!segment) throw new NotFoundError("Alley segment not found");
    return segment;
  },
  {namespace: NS, keyFn: (segmentId: string) => segmentId},
) as unknown as (segmentId: string) => Promise<Record<string, unknown>>;

const searchNear = cacheManager.wrap(
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
    const center = encodeGeohash(lat, lng, 4);
    const prefixes = Array.from({length: 9}, (_, i) => {
      const r = (i % 3) - 1;
      const c = Math.floor(i / 3) - 1;
      const dLat = (bounds.maxLat - bounds.minLat) / 3;
      const dLng = (bounds.maxLng - bounds.minLng) / 3;
      return encodeGeohash(
        bounds.minLat + (r + 0.5) * dLat,
        bounds.minLng + (c + 0.5) * dLng,
        4,
      ).slice(0, 4);
    });
    const unique = Array.from(new Set([center.slice(0, 4), ...prefixes]));
    return alleySegmentRepository.findByGeohashPrefixes(unique);
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
}) => Promise<Record<string, unknown>[]>;

const createSegment = async (data: {
  userId: string;
  lat: number;
  lng: number;
  baseWidth?: number;
  wireHeight?: number;
  inclinePct?: number;
  tier: string;
}) => {
  const user = await userRepository.findById(data.userId);
  if (!user) throw new NotFoundError("User not found");
  const segment = await alleySegmentRepository.create({...data});
  cacheManager.del(NS);
  return segment;
};

const setPassability = async ({
  userId,
  segmentId,
  baseWidth,
  wireHeight,
  inclinePct,
  tier,
}: {
  userId: string;
  segmentId: string;
  baseWidth?: number;
  wireHeight?: number;
  inclinePct?: number;
  tier: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const segment = await alleySegmentRepository.findById(segmentId);
  if (!segment) throw new NotFoundError("Alley segment not found");
  await alleySegmentRepository.update(segmentId, {
    baseWidth,
    wireHeight,
    inclinePct,
    tier,
  });
  cacheManager.del(NS, segmentId);
  return {updated: 1};
};

const moderateSegment = async ({
  segmentId,
  baseWidth,
  wireHeight,
  inclinePct,
  tier,
  verifiedCount,
}: {
  segmentId: string;
  baseWidth?: number;
  wireHeight?: number;
  inclinePct?: number;
  tier?: string;
  verifiedCount?: number;
}) => {
  const segment = await alleySegmentRepository.findById(segmentId);
  if (!segment) throw new NotFoundError("Alley segment not found");
  const patch: Record<string, unknown> = {};
  if (baseWidth !== undefined) patch.baseWidth = baseWidth;
  if (wireHeight !== undefined) patch.wireHeight = wireHeight;
  if (inclinePct !== undefined) patch.inclinePct = inclinePct;
  if (tier !== undefined) patch.tier = tier;
  if (verifiedCount !== undefined) patch.verifiedCount = verifiedCount;
  if (Object.keys(patch).length > 0) {
    await alleySegmentRepository.update(segmentId, patch);
  }
  cacheManager.del(NS, segmentId);
  return {updated: 1};
};

export {
  getSegment,
  searchNear,
  createSegment,
  setPassability,
  moderateSegment,
  computePassability,
  ValidationError,
  NotFoundError,
};
