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
    geoHash: encodeGeohash(data.lat, data.lng, 8),
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
      .where("geoHash", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as Shop),
    );
  }
  return results;
};

export {create, findByGeohashPrefixes};
