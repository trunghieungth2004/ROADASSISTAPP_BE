import {db} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface VolunteerLocation {
  uid: string;
  lat: number;
  lng: number;
  geoHash: string;
  geoCell: string;
  lastSeen: string;
  [key: string]: unknown;
}

const upsert = async (
  uid: string,
  lat: number,
  lng: number,
): Promise<VolunteerLocation> => {
  const record = {
    uid,
    lat,
    lng,
    geoHash: encodeGeohash(lat, lng, 8),
    geoCell: encodeGeohash(lat, lng, 6),
    lastSeen: new Date().toISOString(),
  };
  await db.collection("volunteer_locations").doc(uid).set(record);
  return record;
};

const remove = async (uid: string): Promise<void> => {
  await db.collection("volunteer_locations").doc(uid).delete();
};

const findByGeohashPrefixes = async (
  prefixes: string[],
): Promise<VolunteerLocation[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: VolunteerLocation[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("volunteer_locations")
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({uid: doc.id, ...doc.data()} as VolunteerLocation),
    );
  }
  return results;
};

export {upsert, remove, findByGeohashPrefixes};
