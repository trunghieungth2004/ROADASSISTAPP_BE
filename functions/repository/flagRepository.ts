import {db, FieldValue, Timestamp} from "../config/firebase";
import {STATUS_FLAGS} from "../constants/status";
import {encodeGeohash} from "../utils/geo";

interface FlagRecord {
  id: string;
  type: string;
  status: string;
  geoHash: string;
  lat: number;
  lng: number;
  voteCount: number;
  voters?: string[];
  radiusMeters?: number;
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

const findByReporterUid = async (uid: string): Promise<FlagRecord[]> => {
  const snapshot = await db
    .collection("flags")
    .where("reporterUid", "==", uid)
    .orderBy("createdAt", "desc")
    .get();
  const results: FlagRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as FlagRecord),
  );
  return results;
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
  radiusMeters?: number;
  note?: string;
}): Promise<FlagRecord> => {
  const ref = db.collection("flags").doc();
  const geoHash = encodeGeohash(data.lat, data.lng, 7);
  const ttlExpiresAt = new Date(Date.now() + data.ttlMs);
  const doc = {
    id: ref.id,
    type: data.type,
    status: STATUS_FLAGS.SUGGESTED,
    geoHash,
    geoCell: encodeGeohash(data.lat, data.lng, 5),
    lat: data.lat,
    lng: data.lng,
    voteCount: 0,
    radiusMeters: data.radiusMeters ?? null,
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

const castVote = async (
  flagId: string,
  uid: string,
  weight: number,
): Promise<{flag: FlagRecord; duplicate: boolean} | null> => {
  const ref = db.collection("flags").doc(flagId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = {id: snap.id, ...(snap.data() ?? {})} as FlagRecord;
    const voters = Array.isArray(data.voters) ? data.voters : [];
    if (voters.includes(uid)) return {flag: data, duplicate: true};
    tx.update(ref, {
      voters: FieldValue.arrayUnion(uid),
      voteCount: FieldValue.increment(weight),
    });
    return {
      flag: {
        ...data,
        voters: [...voters, uid],
        voteCount: (data.voteCount ?? 0) + weight,
      },
      duplicate: false,
    };
  });
};

const updateStatus = async (flagId: string, status: string): Promise<void> => {
  await db.collection("flags").doc(flagId).update({status});
};

const deleteById = async (flagId: string): Promise<void> => {
  await db.collection("flags").doc(flagId).delete();
};

const ACTIVE_STATUSES = [
  STATUS_FLAGS.SUGGESTED,
  STATUS_FLAGS.CONFIRMED,
  STATUS_FLAGS.LOCKED,
];

const findExpired = async (): Promise<FlagRecord[]> => {
  const snapshot = await db
    .collection("flags")
    .where("status", "in", ACTIVE_STATUSES)
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
  findByReporterUid,
  findByGeohashPrefixes,
  create,
  incrementVote,
  castVote,
  updateStatus,
  deleteById,
  findExpired,
  RULE_OF_THREE,
};
