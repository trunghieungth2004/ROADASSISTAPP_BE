import {db} from "../config/firebase";

interface SavedRouteRecord {
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
  geometry: unknown;
  via?: {lat: number; lng: number} | null;
  hazards?: unknown[] | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const create = async (data: {
  userId: string;
  name: string;
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
}): Promise<SavedRouteRecord> => {
  const ref = db.collection("saved_routes").doc();
  const now = new Date().toISOString();
  const doc = {
    id: ref.id,
    userId: data.userId,
    name: data.name,
    originLat: data.originLat,
    originLng: data.originLng,
    destLat: data.destLat,
    destLng: data.destLng,
    stops: data.stops ?? [],
    width: data.width ?? null,
    distanceMeters: data.distanceMeters ?? null,
    durationSeconds: data.durationSeconds ?? null,
    source: data.source ?? null,
    geometry: JSON.stringify(data.geometry ?? null),
    via: data.via ?? null,
    hazards: data.hazards ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc as SavedRouteRecord;
};

const findById = async (
  routeId: string,
): Promise<SavedRouteRecord | null> => {
  const doc = await db.collection("saved_routes").doc(routeId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as SavedRouteRecord;
};

const listByUserId = async (
  userId: string,
): Promise<SavedRouteRecord[]> => {
  const snapshot = await db
    .collection("saved_routes")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();
  const results: SavedRouteRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as SavedRouteRecord),
  );
  return results;
};

const updateName = async (
  routeId: string,
  name: string,
): Promise<void> => {
  await db.collection("saved_routes").doc(routeId).update({
    name,
    updatedAt: new Date().toISOString(),
  });
};

const deleteById = async (routeId: string): Promise<void> => {
  await db.collection("saved_routes").doc(routeId).delete();
};

export {
  create,
  findById,
  listByUserId,
  updateName,
  deleteById,
  SavedRouteRecord,
};
