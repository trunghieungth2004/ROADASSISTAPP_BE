import {db} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface ProviderLocation {
  providerId: string;
  lat: number;
  lng: number;
  geoHash: string;
  geoCell: string;
  lastSeen: string;
  [key: string]: unknown;
}

const COLLECTION = "provider_locations";

const upsert = async (
  providerId: string,
  lat: number,
  lng: number,
): Promise<ProviderLocation> => {
  const record: ProviderLocation = {
    providerId,
    lat,
    lng,
    geoHash: encodeGeohash(lat, lng, 8),
    geoCell: encodeGeohash(lat, lng, 6),
    lastSeen: new Date().toISOString(),
  };
  await db.collection(COLLECTION).doc(providerId).set(record);
  return record;
};

const remove = async (providerId: string): Promise<void> => {
  await db.collection(COLLECTION).doc(providerId).delete();
};

const findByIds = async (
  providerIds: string[],
): Promise<Map<string, ProviderLocation>> => {
  const out = new Map<string, ProviderLocation>();
  for (const id of providerIds) {
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (doc.exists) {
      out.set(id, {providerId: id, ...doc.data()} as ProviderLocation);
    }
  }
  return out;
};

const findByGeohashPrefixes = async (
  prefixes: string[],
): Promise<ProviderLocation[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: ProviderLocation[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection(COLLECTION)
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({providerId: doc.id, ...doc.data()} as ProviderLocation),
    );
  }
  return results;
};

const deleteStale = async (cutoffIso: string): Promise<number> => {
  let deleted = 0;
  for (;;) {
    const snapshot = await db
      .collection(COLLECTION)
      .where("lastSeen", "<", cutoffIso)
      .limit(500)
      .get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 500) break;
  }
  return deleted;
};

export {ProviderLocation, upsert, remove, findByIds,
  findByGeohashPrefixes, deleteStale};
