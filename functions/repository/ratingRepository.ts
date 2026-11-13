import {db} from "../config/firebase";
import {RATING_WINDOW} from "../constants/ratings";

interface Rating {
  id: string;
  targetId: string;
  targetKind: string;
  byUserId: string;
  ticketId: string;
  score: number;
  text?: string;
  excluded?: boolean;
  excludedAt?: string | null;
  excludedBy?: string | null;
  exclusionReason?: string | null;
  exclusionSource?: string | null;
  exclusionRef?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const findExisting = async (
  targetId: string,
  targetKind: string,
  byUserId: string,
  ticketId: string,
): Promise<Rating | null> => {
  const snap = await db
    .collection("ratings")
    .where("targetId", "==", targetId)
    .where("targetKind", "==", targetKind)
    .where("byUserId", "==", byUserId)
    .where("ticketId", "==", ticketId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return {id: doc.id, ...doc.data()} as Rating;
};

const create = async (data: {
  targetId: string;
  targetKind: string;
  byUserId: string;
  ticketId: string;
  score: number;
  text?: string;
}): Promise<Rating> => {
  const ref = db.collection("ratings").doc();
  const now = new Date().toISOString();
  const doc = {
    id: ref.id,
    ...data,
    excluded: false,
    excludedAt: null,
    excludedBy: null,
    exclusionReason: null,
    exclusionSource: null,
    exclusionRef: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const updateScore = async (
  id: string,
  score: number,
  text?: string,
): Promise<void> => {
  await db.collection("ratings").doc(id).update({
    score,
    ...(text !== undefined ? {text} : {}),
    updatedAt: new Date().toISOString(),
  });
};

const findById = async (id: string): Promise<Rating | null> => {
  const doc = await db.collection("ratings").doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Rating;
};

const updateReply = async (
  id: string,
  reply: string,
  repliedBy: string,
): Promise<void> => {
  await db.collection("ratings").doc(id).update({
    reply,
    repliedBy,
    repliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

const listByTarget = async (
  targetId: string,
  targetKind: string,
): Promise<Rating[]> => {
  const snap = await db
    .collection("ratings")
    .where("targetId", "==", targetId)
    .where("targetKind", "==", targetKind)
    .get();
  const results: Rating[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Rating),
  );
  return results;
};

const listRecentByTarget = async (
  targetId: string,
  targetKind: string,
  limit = RATING_WINDOW * 3,
): Promise<Rating[]> => {
  const snap = await db
    .collection("ratings")
    .where("targetId", "==", targetId)
    .where("targetKind", "==", targetKind)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const rows: Rating[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as Rating),
  );
  return rows
    .filter((row) => row.excluded !== true)
    .slice(0, RATING_WINDOW);
};

const listByTicket = async (ticketId: string): Promise<Rating[]> => {
  const snap = await db
    .collection("ratings")
    .where("ticketId", "==", ticketId)
    .get();
  const results: Rating[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Rating),
  );
  return results;
};

const listAll = async (): Promise<Rating[]> => {
  const snap = await db.collection("ratings").get();
  const results: Rating[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Rating),
  );
  return results;
};

const aggregate = async (
  targetId: string,
  targetKind: string,
): Promise<{avg: number; count: number}> => {
  const rows = await listRecentByTarget(targetId, targetKind);
  if (rows.length === 0) return {avg: 0, count: 0};
  const sum = rows.reduce((acc, r) => acc + (r.score as number), 0);
  return {avg: sum / rows.length, count: rows.length};
};

const exclude = async (
  id: string,
  data: {
    excludedBy: string;
    exclusionReason: string;
    exclusionSource: string;
    exclusionRef: string | null;
  },
): Promise<void> => {
  await db.collection("ratings").doc(id).update({
    excluded: true,
    excludedAt: new Date().toISOString(),
    excludedBy: data.excludedBy,
    exclusionReason: data.exclusionReason,
    exclusionSource: data.exclusionSource,
    exclusionRef: data.exclusionRef,
    updatedAt: new Date().toISOString(),
  });
};

export {
  Rating,
  findExisting,
  create,
  updateScore,
  findById,
  updateReply,
  listByTarget,
  listRecentByTarget,
  listByTicket,
  listAll,
  aggregate,
  exclude,
};
