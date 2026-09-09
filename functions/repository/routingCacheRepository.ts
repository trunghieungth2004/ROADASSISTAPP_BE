import {db} from "../config/firebase";

interface RouteCacheEntry {
  id: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  widthBucket: string;
  geometry: unknown;
  cachedAt: string;
  [key: string]: unknown;
}

const findExisting = async (key: string): Promise<RouteCacheEntry | null> => {
  const doc = await db.collection("routing_cache").doc(key).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as RouteCacheEntry;
};

const save = async (
  key: string,
  entry: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    widthBucket: string;
    geometry: unknown;
  },
): Promise<void> => {
  await db
    .collection("routing_cache")
    .doc(key)
    .set({
      ...entry,
      geometry: JSON.stringify(entry.geometry ?? null),
      cachedAt: new Date().toISOString(),
    });
};

export {findExisting, save};
