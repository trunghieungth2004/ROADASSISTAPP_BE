import {db, FieldValue, Timestamp} from "../config/firebase";
import {encodeGeohash} from "../utils/geo";

interface FlagRecord {
  id: string;
  type: string;
  status: string;
  geoHash: string;
  lat: number;
  lng: number;
  voteCount: number;
  ttlExpiresAt: Date;
  reporterUid: string;
  [key: string]: unknown;
}

const RULE_OF_THREE = 3;

const findById = async (flagId: string): Promise<FlagRecord | null> => {
  const doc = await db.collection("flags").doc(flagId).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as FlagRecord;
};

const findByGeohashPrefixes = async (
  prefixes: string[],
): Promise<FlagRecord[]> => {
  const IN_CHUNK_SIZE = 30;
  const results: FlagRecord[] = [];
  for (let i = 0; i < prefixes.length; i += IN_CHUNK_SIZE) {
    const chunk = prefixes.slice(i, i + IN_CHUNK_SIZE);
    const snapshot = await db
      .collection("flags")
      .where("geoCell", "in", chunk)
      .get();
    snapshot.forEach((doc) =>
      results.push({id: doc.id, ...doc.data()} as FlagRecord),
    );
  }
  return results;
};

const create = async (data: {
  type: string;
  lat: number;
  lng: number;
  reporterUid: string;
  ttlMs: number;
  trustScore: number;
  note?: string;
}): Promise<FlagRecord> => {
  const ref = db.collection("flags").doc();
  const geoHash = encodeGeohash(data.lat, data.lng, 7);
  const ttlExpiresAt = new Date(Date.now() + data.ttlMs);
  const doc = {
    id: ref.id,
    type: data.type,
    status: "SUGGESTED",
    geoHash,
    geoCell: encodeGeohash(data.lat, data.lng, 5),
    lat: data.lat,
    lng: data.lng,
    voteCount: 0,
    reporterUid: data.reporterUid,
    note: data.note ?? null,
    createdAt: new Date().toISOString(),
    ttlExpiresAt: Timestamp.fromDate(ttlExpiresAt),
    reporterTrust: data.trustScore,
  };
  await ref.set(doc);
  return doc as unknown as FlagRecord;
};

const incrementVote = async (flagId: string): Promise<void> => {
  await db
    .collection("flags")
    .doc(flagId)
    .update({voteCount: FieldValue.increment(1)});
};

const updateStatus = async (flagId: string, status: string): Promise<void> => {
  await db.collection("flags").doc(flagId).update({status});
};

const findExpired = async (): Promise<FlagRecord[]> => {
  const snapshot = await db
    .collection("flags")
    .where("status", "in", ["SUGGESTED", "CONFIRMED", "LOCKED"])
    .where("ttlExpiresAt", "<=", Timestamp.fromDate(new Date()))
    .get();
  const results: FlagRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as FlagRecord),
  );
  return results;
};

export {
  findById,
  findByGeohashPrefixes,
  create,
  incrementVote,
  updateStatus,
  findExpired,
  RULE_OF_THREE,
};
