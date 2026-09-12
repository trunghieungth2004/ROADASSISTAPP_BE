import {db} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface Shop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  geoHash: string;
  [key: string]: unknown;
}

const create = async (data: {
  name: string;
  lat: number;
  lng: number;
  type: string;
}): Promise<Shop> => {
  const ref = db.collection("shops").doc();
  const doc = {
    id: ref.id,
    ...data,
    nameLower: data.name.trim().toLowerCase(),
    geoHash: encodeGeohash(data.lat, data.lng, 8),
    geoCell: encodeGeohash(data.lat, data.lng, 6),
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const findByGeohashPrefixes = async (prefixes: string[]): Promise<Shop[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: Shop[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("shops")
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as Shop),
    );
  }
  return results;
};

const findByNamePrefix = async (
  prefix: string,
  limit = 5,
): Promise<Shop[]> => {
  const q = prefix.trim().toLowerCase();
  if (!q) return [];
  const snapshot = await db
    .collection("shops")
    .where("nameLower", ">=", q)
    .where("nameLower", "<", `${q}\uf8ff`)
    .limit(limit)
    .get();
  const results: Shop[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Shop),
  );
  return results;
};

export {create, findByGeohashPrefixes, findByNamePrefix};
