import {db} from "../config/firebase";
import {
  PAYMENT_RECEIVED_STATUSES,
  PAYOUT_COLLECTION,
  PAYOUT_LIST_LIMIT,
} from "../constants/payments";
import {COMMISSION_STATUS} from "./commissionRepository";

const PAYOUT_REQUEST_COLLECTION = "payout_requests";

const PAYOUT_REQUEST_STATUS = {
  PENDING: "PENDING",
  PAID: "PAID",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;

interface Payout {
  id: string;
  payeeId: string;
  payeeName: string | null;
  gross: number;
  commission: number;
  refunded: number;
  net: number;
  commissionDeducted: number;
  netPayout: number;
  itemCount: number;
  paymentIds: string[];
  ticketIds: string[];
  status: string;
  payoutRef: string;
  payoutMethod: string;
  note: string | null;
  proofUrl?: string | null;
  payeeAccount?: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    holderName: string;
    updatedAt: string;
  } | null;
  batchedUid: string;
  batchedAt: string;
  createdAt: string;
  [key: string]: unknown;
}

interface PayoutRequest {
  id: string;
  payeeId: string;
  payeeName: string | null;
  amount: number;
  status: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  payoutBatchId: string | null;
  proofUrl?: string | null;
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
  commissionDeducted?: number;
  itemCount: number;
  paymentIds: string[];
  ticketIds: string[];
  payoutRef: string;
  note: string | null;
  batchedUid: string;
}): Promise<Payout> => {
  const ref = db.collection(PAYOUT_COLLECTION).doc();
  const now = new Date().toISOString();
  const deducted = Math.max(0, data.commissionDeducted ?? 0);
  const doc: Payout = {
    id: ref.id,
    payeeId: data.payeeId,
    payeeName: data.payeeName,
    gross: data.gross,
    commission: data.commission,
    refunded: data.refunded,
    net: data.net,
    commissionDeducted: deducted,
    netPayout: Math.max(0, data.net - deducted),
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

const newId = (): string => db.collection(PAYOUT_COLLECTION).doc().id;

type PaymentStamp = {
  id: string;
  fields: Record<string, unknown>;
};

type LedgerStamp = {
  id: string;
  fields: Record<string, unknown>;
};

const applySettlement = async ({
  batchId,
  batch,
  paymentStamps,
  ledgerStamps,
}: {
  batchId: string;
  batch: Record<string, unknown>;
  paymentStamps: PaymentStamp[];
  ledgerStamps: LedgerStamp[];
}): Promise<Payout> => {
  const now = new Date().toISOString();
  const doc = {
    id: batchId,
    ...batch,
    status: "PAID",
    payoutMethod: "MANUAL",
    batchedAt: now,
    createdAt: now,
  } as Payout;
  await db.runTransaction(async (tx) => {
    const batchRef = db.collection(PAYOUT_COLLECTION).doc(batchId);
    const existing = await tx.get(batchRef);
    if (existing.exists) {
      throw new Error("Payout batch already exists");
    }
    for (const stamp of paymentStamps) {
      const ref = db.collection("payments").doc(stamp.id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Payment not found");
      const data = snap.data() ?? {};
      if (data.payoutAt || data.payoutBatchId) {
        throw new Error("Payment already settled");
      }
      if (!PAYMENT_RECEIVED_STATUSES.includes(String(data.status))) {
        throw new Error("Payment is not settleable");
      }
    }
    for (const stamp of ledgerStamps) {
      const ref = db.collection("commission_ledger").doc(stamp.id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Commission entry not found");
      if (snap.data()?.status !== COMMISSION_STATUS.OWED) {
        throw new Error("Commission entry is not open");
      }
    }
    tx.set(batchRef, doc);
    for (const stamp of paymentStamps) {
      tx.update(db.collection("payments").doc(stamp.id), stamp.fields);
    }
    for (const stamp of ledgerStamps) {
      tx.update(
        db.collection("commission_ledger").doc(stamp.id),
        stamp.fields,
      );
    }
  });
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

const createRequest = async (data: {
  payeeId: string;
  payeeName: string | null;
  amount: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  note: string | null;
}): Promise<PayoutRequest> => {
  const ref = db.collection(PAYOUT_REQUEST_COLLECTION).doc();
  const doc: PayoutRequest = {
    id: ref.id,
    payeeId: data.payeeId,
    payeeName: data.payeeName,
    amount: data.amount,
    status: PAYOUT_REQUEST_STATUS.PENDING,
    bankCode: data.bankCode,
    bankName: data.bankName,
    accountNumber: data.accountNumber,
    holderName: data.holderName,
    note: data.note,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    payoutBatchId: null,
  };
  await ref.set(doc);
  return doc;
};

const findRequestById = async (id: string): Promise<PayoutRequest | null> => {
  const doc = await db.collection(PAYOUT_REQUEST_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as PayoutRequest;
};

const findRequestsByPayee = async (
  payeeId: string,
  limit: number = PAYOUT_LIST_LIMIT,
): Promise<PayoutRequest[]> => {
  const snap = await db
    .collection(PAYOUT_REQUEST_COLLECTION)
    .where("payeeId", "==", payeeId)
    .get();
  const rows: PayoutRequest[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as PayoutRequest));
  rows.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return rows.slice(0, limit);
};

const findPendingRequests = async (
  limit: number = PAYOUT_LIST_LIMIT,
): Promise<PayoutRequest[]> => {
  const snap = await db
    .collection(PAYOUT_REQUEST_COLLECTION)
    .where("status", "==", PAYOUT_REQUEST_STATUS.PENDING)
    .get();
  const rows: PayoutRequest[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as PayoutRequest));
  rows.sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1));
  return rows.slice(0, limit);
};

const findRequests = async (
  status: string | undefined,
  limit: number = PAYOUT_LIST_LIMIT,
): Promise<PayoutRequest[]> => {
  if (status === PAYOUT_REQUEST_STATUS.PENDING) {
    return findPendingRequests(limit);
  }
  const snap = await db.collection(PAYOUT_REQUEST_COLLECTION).get();
  const rows: PayoutRequest[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as PayoutRequest));
  const filtered = status === undefined ?
    rows :
    rows.filter((row) => row.status === status);
  filtered.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return filtered.slice(0, limit);
};

const decideRequest = async (
  id: string,
  fields: {
    status: string;
    decidedBy: string;
    decisionNote?: string | null;
    payoutBatchId?: string | null;
    proofUrl?: string | null;
  },
): Promise<void> => {
  await db.collection(PAYOUT_REQUEST_COLLECTION).doc(id).update({
    status: fields.status,
    decidedBy: fields.decidedBy,
    decidedAt: new Date().toISOString(),
    decisionNote: fields.decisionNote ?? null,
    payoutBatchId: fields.payoutBatchId ?? null,
    proofUrl: fields.proofUrl ?? null,
  });
};

const countPendingRequests = async (payeeId: string): Promise<number> => {
  const snap = await db
    .collection(PAYOUT_REQUEST_COLLECTION)
    .where("payeeId", "==", payeeId)
    .where("status", "==", PAYOUT_REQUEST_STATUS.PENDING)
    .get();
  return snap.size;
};

export {
  Payout,
  PayoutRequest,
  PAYOUT_REQUEST_STATUS,
  create,
  newId,
  applySettlement,
  findById,
  findByPayee,
  findAll,
  findBetween,
  createRequest,
  findRequestById,
  findRequestsByPayee,
  findPendingRequests,
  findRequests,
  decideRequest,
  countPendingRequests,
};
