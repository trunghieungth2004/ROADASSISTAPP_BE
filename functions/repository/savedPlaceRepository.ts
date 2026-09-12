import {db} from "../config/firebase";

interface SavedPlace {
  id: string;
  userId: string;
  label: string;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION = "saved_places";

const create = async (data: {
  userId: string;
  label: string;
  lat: number;
  lng: number;
}): Promise<SavedPlace> => {
  const ref = db.collection(COLLECTION).doc();
  const now = new Date().toISOString();
  const doc = {
    id: ref.id,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const findByCoords = async (
  userId: string,
  lat: number,
  lng: number,
): Promise<SavedPlace | null> => {
  const snapshot = await db
    .collection(COLLECTION)
    .where("userId", "==", userId)
    .where("lat", "==", lat)
    .where("lng", "==", lng)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return {id: doc.id, ...doc.data()} as SavedPlace;
};

const findById = async (placeId: string): Promise<SavedPlace | null> => {
  const doc = await db.collection(COLLECTION).doc(placeId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as SavedPlace;
};

const listByUserId = async (userId: string): Promise<SavedPlace[]> => {
  const snapshot = await db
    .collection(COLLECTION)
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();
  const results: SavedPlace[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as SavedPlace),
  );
  return results;
};

const countByUserId = async (userId: string): Promise<number> => {
  const agg = await db
    .collection(COLLECTION)
    .where("userId", "==", userId)
    .count()
    .get();
  return agg.data().count;
};

const updateLabel = async (
  placeId: string,
  label: string,
): Promise<void> => {
  await db
    .collection(COLLECTION)
    .doc(placeId)
    .update({label, updatedAt: new Date().toISOString()});
};

const deleteById = async (placeId: string): Promise<void> => {
  await db.collection(COLLECTION).doc(placeId).delete();
};

export {
  create,
  findByCoords,
  findById,
  listByUserId,
  countByUserId,
  updateLabel,
  deleteById,
  SavedPlace,
};
