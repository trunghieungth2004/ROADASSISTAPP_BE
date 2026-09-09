import {db, Timestamp, FieldValue} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface AlleySegment {
  id: string;
  baseWidth?: number | null;
  wireHeight?: number | null;
  inclinePct?: number | null;
  tier: string;
  verifiedCount?: number;
  geoHash: string;
  [key: string]: unknown;
}

const BATCH_SIZE = 400;

const findById = async (segmentId: string): Promise<AlleySegment | null> => {
  const doc = await db.collection("alley_segments").doc(segmentId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as AlleySegment;
};

const findByGeohashPrefixes = async (
  prefixes: string[],
): Promise<AlleySegment[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: AlleySegment[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("alley_segments")
      .where("geoHash", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as AlleySegment),
    );
  }
  return results;
};

const create = async (data: {
  lat: number;
  lng: number;
  baseWidth?: number;
  wireHeight?: number;
  inclinePct?: number;
  tier: string;
  verifiedCount?: number;
}): Promise<AlleySegment> => {
  const ref = db.collection("alley_segments").doc();
  const geoHash = encodeGeohash(data.lat, data.lng, 9);
  const doc = {
    id: ref.id,
    lat: data.lat,
    lng: data.lng,
    geoHash,
    baseWidth: data.baseWidth ?? null,
    wireHeight: data.wireHeight ?? null,
    inclinePct: data.inclinePct ?? null,
    tier: data.tier,
    verifiedCount: data.verifiedCount ?? 0,
    createdAt: new Date().toISOString(),
  };
  await ref.set(doc);
  return doc;
};

const update = async (
  segmentId: string,
  data: Partial<AlleySegment>,
): Promise<void> => {
  await db.collection("alley_segments").doc(segmentId).update(data);
};

const incrementVerified = async (segmentId: string): Promise<void> => {
  await db
    .collection("alley_segments")
    .doc(segmentId)
    .update({
      verifiedCount: FieldValue.increment(1),
    });
};

const deleteById = async (segmentId: string): Promise<void> => {
  await db.collection("alley_segments").doc(segmentId).delete();
};

export {
  findById,
  findByGeohashPrefixes,
  create,
  update,
  incrementVerified,
  deleteById,
  BATCH_SIZE,
  Timestamp,
};
