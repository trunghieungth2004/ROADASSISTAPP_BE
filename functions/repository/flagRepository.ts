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
  votes?: Record<string, number>;
  radiusMeters?: number;
  ttlExpiresAt: Date;
  reporterUid: string;
  [key: string]: unknown;
}

const RULE_OF_THREE = 3;

const findAll = async (limit = 100): Promise<FlagRecord[]> => {
  const snapshot = await db
    .collection("flags")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results: FlagRecord[] = [];
  snapshot.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as FlagRecord),
  );
  return results;
};

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
  const cast = await castSignedVote(flagId, uid, weight);
  if (!cast) return null;
  return {flag: cast.flag, duplicate: cast.duplicate};
};

const castSignedVote = async (
  flagId: string,
  uid: string,
  signedWeight: number,
): Promise<{
  flag: FlagRecord;
  duplicate: boolean;
  direction: "up" | "down";
} | null> => {
  const ref = db.collection("flags").doc(flagId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = {id: snap.id, ...(snap.data() ?? {})} as FlagRecord;
    const weight = Math.abs(signedWeight);
    const direction = signedWeight >= 0 ? "up" : "down";
    const stored =
      data.votes !== undefined && data.votes !== null ?
        (data.votes as Record<string, number>) :
        {};
    const legacyVoters = Array.isArray(data.voters) ?
      (data.voters as string[]) :
      [];
    const current =
      uid in stored ? stored[uid] : legacyVoters.includes(uid) ? weight : 0;
    const next = direction === "up" ? weight : -weight;
    if (current === next) return {flag: data, duplicate: true, direction};
    const votes = {...stored, [uid]: next};
    const voteCount = (data.voteCount ?? 0) + (next - current);
    tx.update(ref, {
      votes,
      voteCount,
      voters:
        direction === "up" ?
          FieldValue.arrayUnion(uid) :
          FieldValue.arrayRemove(uid),
    });
    return {
      flag: {
        ...data,
        votes,
        voters:
          direction === "up" ?
            Array.from(new Set([...legacyVoters, uid])) :
            legacyVoters.filter((voter) => voter !== uid),
        voteCount,
      },
      duplicate: false,
      direction,
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
  findAll,
  findById,
  findByReporterUid,
  findByGeohashPrefixes,
  create,
  incrementVote,
  castVote,
  castSignedVote,
  updateStatus,
  deleteById,
  findExpired,
  RULE_OF_THREE,
};
