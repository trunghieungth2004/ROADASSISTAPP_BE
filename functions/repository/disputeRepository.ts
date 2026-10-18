import {db} from "../config/firebase";
import {
  DISPUTE_COLLECTION,
  DISPUTE_LIST_LIMIT,
  DISPUTE_STATUS,
} from "../constants/payments";

interface Dispute {
  id: string;
  ticketId: string;
  filedBy: string;
  accusedId: string | null;
  accusedKind: string;
  type: string;
  reasonCode: string;
  note: string | null;
  photoUrls: string[];
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  refundAdjust: number | null;
  payoutAdjust: number | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const byCreatedDesc = (a: Dispute, b: Dispute): number => {
  const av = String(a.createdAt ?? "");
  const bv = String(b.createdAt ?? "");
  return av < bv ? 1 : av > bv ? -1 : 0;
};

const create = async (data: {
  ticketId: string;
  filedBy: string;
  accusedKind: string;
  accusedId?: string | null;
  type: string;
  reasonCode: string;
  note?: string | null;
  photoUrls?: string[];
  status?: string;
}): Promise<Dispute> => {
  const ref = db.collection(DISPUTE_COLLECTION).doc();
  const now = new Date().toISOString();
  const doc: Dispute = {
    id: ref.id,
    ticketId: data.ticketId,
    filedBy: data.filedBy,
    accusedId: data.accusedId ?? null,
    accusedKind: data.accusedKind,
    type: data.type,
    reasonCode: data.reasonCode,
    note: data.note ?? null,
    photoUrls: data.photoUrls ?? [],
    status: data.status ?? DISPUTE_STATUS.OPEN,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    refundAdjust: null,
    payoutAdjust: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<Dispute | null> => {
  const doc = await db.collection(DISPUTE_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Dispute;
};

const findByTicketId = async (
  ticketId: string,
  status?: string,
): Promise<Dispute[]> => {
  const base = db
    .collection(DISPUTE_COLLECTION)
    .where("ticketId", "==", ticketId);
  const query = typeof status === "string" && status !== "" ?
    base.where("status", "==", status) :
    base;
  const snap = await query.get();
  const results: Dispute[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Dispute),
  );
  results.sort(byCreatedDesc);
  return results;
};

const findByStatus = async (
  status: string,
  limit: number = DISPUTE_LIST_LIMIT,
): Promise<Dispute[]> => {
  const snap = await db
    .collection(DISPUTE_COLLECTION)
    .where("status", "==", status)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results: Dispute[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Dispute),
  );
  return results;
};

const update = async (
  id: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection(DISPUTE_COLLECTION).doc(id).update({
    ...fields,
    updatedAt: new Date().toISOString(),
  });
};

const findAll = async (
  limit: number = DISPUTE_LIST_LIMIT,
): Promise<Dispute[]> => {
  const snap = await db.collection(DISPUTE_COLLECTION).get();
  const results: Dispute[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Dispute),
  );
  results.sort(byCreatedDesc);
  return results.slice(0, limit);
};

export {
  Dispute,
  create,
  findById,
  findByTicketId,
  findByStatus,
  update,
  findAll,
};
