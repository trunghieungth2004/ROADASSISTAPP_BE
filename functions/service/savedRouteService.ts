import * as savedRouteRepository from
  "../repository/savedRouteRepository";
import * as userRepository from "../repository/userRepository";
import * as cacheManager from "../utils/cacheManager";

import {ForbiddenError, NotFoundError, ValidationError} from "../utils/errors";

interface SaveRouteInput {
  userId: string;
  name?: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops?: Array<{lat: number; lng: number}>;
  width?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  source?: string;
  geometry: unknown;
}

interface SavedRouteSummary {
  id: string;
  userId: string;
  name: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  stops: Array<{lat: number; lng: number}>;
  width?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

const FALLBACK_NAME = "Saved route";
const NS = "savedRoute";

const parseGeometry = (stored: unknown): unknown => {
  if (typeof stored !== "string") return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
};

const toSummary = (
  record: savedRouteRepository.SavedRouteRecord,
): SavedRouteSummary => ({
  id: record.id,
  userId: record.userId,
  name: record.name,
  originLat: record.originLat,
  originLng: record.originLng,
  destLat: record.destLat,
  destLng: record.destLng,
  stops: record.stops,
  width: record.width,
  distanceMeters: record.distanceMeters,
  durationSeconds: record.durationSeconds,
  source: record.source,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const sameStops = (
  a: Array<{lat: number; lng: number}> | undefined,
  b: Array<{lat: number; lng: number}>,
): boolean => {
  const left = a ?? [];
  if (left.length !== b.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i].lat !== b[i].lat || left[i].lng !== b[i].lng) return false;
  }
  return true;
};

const saveRoute = async (input: SaveRouteInput) => {
  const user = await userRepository.findById(input.userId);
  if (!user) throw new NotFoundError("User not found");
  const geometryJson = JSON.stringify(input.geometry ?? null);
  if (geometryJson.length > 500000) {
    throw new ValidationError("Route geometry is too large");
  }
  const existing = await savedRouteRepository.listByUserId(input.userId);
  const dupe = existing.find((r) =>
    r.originLat === input.originLat &&
    r.originLng === input.originLng &&
    r.destLat === input.destLat &&
    r.destLng === input.destLng &&
    sameStops(input.stops, r.stops ?? []));
  if (dupe) {
    return {...dupe, geometry: parseGeometry(dupe.geometry)};
  }
  const fallback = input.name && input.name.trim().length > 0 ?
    input.name.trim() :
    FALLBACK_NAME;
  const record = await savedRouteRepository.create({...input, name: fallback});
  cacheManager.del(NS, input.userId);
  return {...record, geometry: parseGeometry(record.geometry)};
};

const listRoutesInner = async (
  userId: string,
): Promise<SavedRouteSummary[]> => {
  const records = await savedRouteRepository.listByUserId(userId);
  return records.map(toSummary);
};

const listRoutesCached = cacheManager.wrap(listRoutesInner, {
  namespace: NS,
  keyFn: (userId: string) => userId,
});

const listRoutes = async (userId: string): Promise<SavedRouteSummary[]> =>
  listRoutesCached(userId);

const getRouteInner = async ({
  routeId,
  userId,
}: {
  routeId: string;
  userId: string;
}) => {
  const record = await savedRouteRepository.findById(routeId);
  if (!record) return null;
  if (record.userId !== userId) {
    throw new ForbiddenError("You can only open your own saved routes");
  }
  return {...record, geometry: parseGeometry(record.geometry)};
};

const getRouteCached = cacheManager.wrap(getRouteInner, {
  namespace: NS,
  keyFn: ({routeId, userId}: {routeId: string; userId: string}) =>
    `${userId}:${routeId}`,
});

const getRoute = async ({
  routeId,
  userId,
}: {
  routeId: string;
  userId: string;
}) => getRouteCached({routeId, userId});

const renameRoute = async ({
  routeId,
  userId,
  name,
}: {
  routeId: string;
  userId: string;
  name: string;
}) => {
  const record = await savedRouteRepository.findById(routeId);
  if (!record) return null;
  if (record.userId !== userId) {
    throw new ForbiddenError("You can only rename your own saved routes");
  }
  await savedRouteRepository.updateName(routeId, name.trim());
  cacheManager.del(NS, userId);
  cacheManager.del(NS, `${userId}:${routeId}`);
  return {renamed: 1};
};

const deleteRoute = async ({
  routeId,
  userId,
}: {
  routeId: string;
  userId: string;
}) => {
  const record = await savedRouteRepository.findById(routeId);
  if (!record) return null;
  if (record.userId !== userId) {
    throw new ForbiddenError("You can only delete your own saved routes");
  }
  await savedRouteRepository.deleteById(routeId);
  cacheManager.del(NS, userId);
  cacheManager.del(NS, `${userId}:${routeId}`);
  return {deleted: 1};
};

export {
  saveRoute,
  listRoutes,
  getRoute,
  renameRoute,
  deleteRoute,
  NotFoundError,
  ForbiddenError,
  ValidationError,
};
