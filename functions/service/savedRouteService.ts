import * as savedRouteRepository from
  "../repository/savedRouteRepository";
import * as userRepository from "../repository/userRepository";

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
  via?: {lat: number; lng: number} | null;
  hazards?: unknown[] | null;
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

const saveRoute = async (input: SaveRouteInput) => {
  const user = await userRepository.findById(input.userId);
  if (!user) throw new NotFoundError("User not found");
  const fallback = input.name && input.name.trim().length > 0 ?
    input.name.trim() :
    FALLBACK_NAME;
  const record = await savedRouteRepository.create({...input, name: fallback});
  return {...record, geometry: parseGeometry(record.geometry)};
};

const listRoutes = async (userId: string): Promise<SavedRouteSummary[]> => {
  const records = await savedRouteRepository.listByUserId(userId);
  return records.map(toSummary);
};

const getRoute = async ({
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
};
