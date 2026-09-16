import {db} from "../config/firebase";

interface Rating {
  id: string;
  targetId: string;
  targetKind: string;
  byUserId: string;
  ticketId: string;
  score: number;
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
}): Promise<Rating> => {
  const ref = db.collection("ratings").doc();
  const now = new Date().toISOString();
  const doc = {
    id: ref.id,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const updateScore = async (
  id: string,
  score: number,
): Promise<void> => {
  await db.collection("ratings").doc(id).update({
    score,
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

const aggregate = async (
  targetId: string,
  targetKind: string,
): Promise<{avg: number; count: number}> => {
  const rows = await listByTarget(targetId, targetKind);
  if (rows.length === 0) return {avg: 0, count: 0};
  const sum = rows.reduce((acc, r) => acc + (r.score as number), 0);
  return {avg: sum / rows.length, count: rows.length};
};

export {findExisting, create, updateScore, listByTarget, aggregate};
