import {db} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface Landmark {
  id: string;
  lat: number;
  lng: number;
  displayLabel: string;
  geoHash: string;
  embedding?: number[] | null;
  [key: string]: unknown;
}

const IN_CHUNK_SIZE = 30;

const create = async (data: {
  lat: number;
  lng: number;
  displayLabel: string;
  embedding?: number[];
}): Promise<Landmark> => {
  const ref = db.collection("landmarks").doc();
  const doc = {
    id: ref.id,
    lat: data.lat,
    lng: data.lng,
    displayLabel: data.displayLabel,
    displayLabelLower: data.displayLabel.trim().toLowerCase(),
    embedding: data.embedding ?? null,
    geoHash: encodeGeohash(data.lat, data.lng, 8),
    geoCell: encodeGeohash(data.lat, data.lng, 6),
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findByGeohashPrefixes = async (
  prefixes: string[],
): Promise<Landmark[]> => {
  const results: Landmark[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("landmarks")
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as Landmark),
    );
  }
  return results;
};

const findById = async (landmarkId: string): Promise<Landmark | null> => {
  const doc = await db.collection("landmarks").doc(landmarkId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Landmark;
};

const findByLabelPrefix = async (
  prefix: string,
  limit = 5,
): Promise<Landmark[]> => {
  const q = prefix.trim().toLowerCase();
  if (!q) return [];
  const snapshot = await db
    .collection("landmarks")
    .where("displayLabelLower", ">=", q)
    .where("displayLabelLower", "<", `${q}\uf8ff`)
    .limit(limit)
    .get();
  const results: Landmark[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Landmark),
  );
  return results;
};

export {create, findByGeohashPrefixes, findById, findByLabelPrefix};
