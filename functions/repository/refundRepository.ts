import {db} from "../config/firebase";
import {
  REFUND_COLLECTION,
  REFUND_LIST_LIMIT,
  REFUND_STATUS,
} from "../constants/payments";

interface RefundRequest {
  id: string;
  paymentId: string;
  ticketId: string;
  riderUid: string;
  payeeId: string;
  amount: number;
  originalAmount: number;
  status: string;
  reason: string | null;
  automatic: boolean;
  requestedBy: string;
  requestedAt: string;
  bankCode: string | null;
  bankName: string | null;
  accountNumber: string | null;
  holderName: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  sentAt: string | null;
  sentBy: string | null;
  transferRef: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  failureReason: string | null;
  [key: string]: unknown;
}

const OPEN_STATUSES: string[] = [
  REFUND_STATUS.REQUESTED,
  REFUND_STATUS.APPROVED,
  REFUND_STATUS.SENT,
];

const create = async (data: {
  paymentId: string;
  ticketId: string;
  riderUid: string;
  payeeId: string;
  amount: number;
  originalAmount: number;
  reason?: string | null;
  automatic: boolean;
  requestedBy: string;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  holderName?: string | null;
}): Promise<RefundRequest> => {
  const ref = db.collection(REFUND_COLLECTION).doc();
  const now = new Date().toISOString();
  const doc: RefundRequest = {
    id: ref.id,
    paymentId: data.paymentId,
    ticketId: data.ticketId,
    riderUid: data.riderUid,
    payeeId: data.payeeId,
    amount: data.amount,
    originalAmount: data.originalAmount,
    status: REFUND_STATUS.REQUESTED,
    reason: data.reason ?? null,
    automatic: data.automatic,
    requestedBy: data.requestedBy,
    requestedAt: now,
    bankCode: data.bankCode ?? null,
    bankName: data.bankName ?? null,
    accountNumber: data.accountNumber ?? null,
    holderName: data.holderName ?? null,
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    sentAt: null,
    sentBy: null,
    transferRef: null,
    confirmedAt: null,
    confirmedBy: null,
    failureReason: null,
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<RefundRequest | null> => {
  const doc = await db.collection(REFUND_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as RefundRequest;
};

const findByPaymentId = async (
  paymentId: string,
): Promise<RefundRequest[]> => {
  const snap = await db
    .collection(REFUND_COLLECTION)
    .where("paymentId", "==", paymentId)
    .get();
  const rows: RefundRequest[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as RefundRequest));
  rows.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return rows;
};

const findOpenByPaymentId = async (
  paymentId: string,
): Promise<RefundRequest | null> => {
  const rows = await findByPaymentId(paymentId);
  return rows.find((row) => OPEN_STATUSES.includes(row.status)) ?? null;
};

const findByStatus = async (
  status?: string,
  limit: number = REFUND_LIST_LIMIT,
): Promise<RefundRequest[]> => {
  const base = status === undefined || status === "" ?
    db.collection(REFUND_COLLECTION) :
    db.collection(REFUND_COLLECTION).where("status", "==", status);
  const snap = await base.get();
  const rows: RefundRequest[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as RefundRequest));
  const filtered = status === undefined || status === "" ?
    rows.filter((row) => OPEN_STATUSES.includes(row.status)) :
    rows;
  filtered.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return filtered.slice(0, limit);
};

const findByRider = async (
  riderUid: string,
  limit: number = REFUND_LIST_LIMIT,
): Promise<RefundRequest[]> => {
  const snap = await db
    .collection(REFUND_COLLECTION)
    .where("riderUid", "==", riderUid)
    .get();
  const rows: RefundRequest[] = [];
  snap.forEach((doc) =>
    rows.push({id: doc.id, ...doc.data()} as RefundRequest));
  rows.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return rows.slice(0, limit);
};

const update = async (
  id: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection(REFUND_COLLECTION).doc(id).update(fields);
};

export {
  RefundRequest,
  OPEN_STATUSES,
  create,
  findById,
  findByPaymentId,
  findOpenByPaymentId,
  findByStatus,
  findByRider,
  update,
};
