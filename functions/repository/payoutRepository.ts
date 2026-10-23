import {db} from "../config/firebase";
import {PAYOUT_COLLECTION, PAYOUT_LIST_LIMIT} from "../constants/payments";

interface Payout {
  id: string;
  payeeId: string;
  payeeName: string | null;
  gross: number;
  commission: number;
  refunded: number;
  net: number;
  itemCount: number;
  paymentIds: string[];
  ticketIds: string[];
  status: string;
  payoutRef: string;
  payoutMethod: string;
  note: string | null;
  batchedUid: string;
  batchedAt: string;
  createdAt: string;
  [key: string]: unknown;
}

const byCreatedDesc = (a: Payout, b: Payout): number => {
  const av = String(a.createdAt ?? "");
  const bv = String(b.createdAt ?? "");
  return av < bv ? 1 : av > bv ? -1 : 0;
};

const create = async (data: {
  payeeId: string;
  payeeName: string | null;
  gross: number;
  commission: number;
  refunded: number;
  net: number;
  itemCount: number;
  paymentIds: string[];
  ticketIds: string[];
  payoutRef: string;
  note: string | null;
  batchedUid: string;
}): Promise<Payout> => {
  const ref = db.collection(PAYOUT_COLLECTION).doc();
  const now = new Date().toISOString();
  const doc: Payout = {
    id: ref.id,
    payeeId: data.payeeId,
    payeeName: data.payeeName,
    gross: data.gross,
    commission: data.commission,
    refunded: data.refunded,
    net: data.net,
    itemCount: data.itemCount,
    paymentIds: data.paymentIds,
    ticketIds: data.ticketIds,
    status: "PAID",
    payoutRef: data.payoutRef,
    payoutMethod: "MANUAL",
    note: data.note,
    batchedUid: data.batchedUid,
    batchedAt: now,
    createdAt: now,
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<Payout | null> => {
  const doc = await db.collection(PAYOUT_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Payout;
};

const findByPayee = async (
  payeeId: string,
  limit: number = PAYOUT_LIST_LIMIT,
): Promise<Payout[]> => {
  const snap = await db
    .collection(PAYOUT_COLLECTION)
    .where("payeeId", "==", payeeId)
    .get();
  const results: Payout[] = [];
  snap.forEach((doc) => results.push({id: doc.id, ...doc.data()} as Payout));
  results.sort(byCreatedDesc);
  return results.slice(0, limit);
};

const findAll = async (
  limit: number = PAYOUT_LIST_LIMIT,
): Promise<Payout[]> => {
  const snap = await db.collection(PAYOUT_COLLECTION).get();
  const results: Payout[] = [];
  snap.forEach((doc) => results.push({id: doc.id, ...doc.data()} as Payout));
  results.sort(byCreatedDesc);
  return results.slice(0, limit);
};

const findBetween = async (
  from: string,
  to: string,
  limit: number = PAYOUT_LIST_LIMIT,
): Promise<Payout[]> => {
  const snap = await db
    .collection(PAYOUT_COLLECTION)
    .where("createdAt", ">=", from)
    .where("createdAt", "<=", to)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();
  const results: Payout[] = [];
  snap.forEach((doc) => results.push({id: doc.id, ...doc.data()} as Payout));
  return results;
};

export {Payout, create, findById, findByPayee, findAll, findBetween};
