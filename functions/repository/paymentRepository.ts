import {db} from "../config/firebase";
import {
  PAYMENT_COLLECTION,
  PAYMENT_CURRENCY,
  PAYMENT_LIST_LIMIT,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../constants/payments";

type PaymentMethod = typeof PAYMENT_METHOD[keyof typeof PAYMENT_METHOD];
type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

interface Payment {
  id: string;
  ticketId: string;
  riderUid: string;
  payeeId: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  qrRef: string | null;
  ipnRef: string | null;
  commissionRate: number | null;
  commissionAmount: number | null;
  payoutAmount: number | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  receiptUrl: string | null;
  refundAmount: number | null;
  refundedAt: string | null;
  refundedBy: string | null;
  payoutRef: string | null;
  payoutAt: string | null;
  payoutBy: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const byCreatedDesc = (a: Payment, b: Payment): number => {
  const av = String(a.createdAt ?? "");
  const bv = String(b.createdAt ?? "");
  return av < bv ? 1 : av > bv ? -1 : 0;
};

const create = async (data: {
  ticketId: string;
  riderUid: string;
  payeeId: string;
  amount: number;
  method: PaymentMethod | string;
  status: PaymentStatus | string;
  currency?: string;
  qrRef?: string | null;
  ipnRef?: string | null;
  commissionRate?: number | null;
  commissionAmount?: number | null;
  payoutAmount?: number | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  receiptUrl?: string | null;
}): Promise<Payment> => {
  const ref = db.collection(PAYMENT_COLLECTION).doc();
  const now = new Date().toISOString();
  const doc: Payment = {
    id: ref.id,
    ticketId: data.ticketId,
    riderUid: data.riderUid,
    payeeId: data.payeeId,
    amount: data.amount,
    currency: data.currency ?? PAYMENT_CURRENCY,
    method: data.method,
    status: data.status,
    qrRef: data.qrRef ?? null,
    ipnRef: data.ipnRef ?? null,
    commissionRate: data.commissionRate ?? null,
    commissionAmount: data.commissionAmount ?? null,
    payoutAmount: data.payoutAmount ?? null,
    confirmedBy: data.confirmedBy ?? null,
    confirmedAt: data.confirmedAt ?? null,
    receiptUrl: data.receiptUrl ?? null,
    refundAmount: null,
    refundedAt: null,
    refundedBy: null,
    payoutRef: null,
    payoutAt: null,
    payoutBy: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  return doc;
};

const findById = async (id: string): Promise<Payment | null> => {
  const doc = await db.collection(PAYMENT_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return {id: doc.id, ...doc.data()} as Payment;
};

const findByTicketId = async (ticketId: string): Promise<Payment[]> => {
  const snap = await db
    .collection(PAYMENT_COLLECTION)
    .where("ticketId", "==", ticketId)
    .get();
  const results: Payment[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Payment),
  );
  results.sort(byCreatedDesc);
  return results;
};

const findByTicket = findByTicketId;

const findByQrRef = async (qrRef: string): Promise<Payment | null> => {
  const snap = await db
    .collection(PAYMENT_COLLECTION)
    .where("qrRef", "==", qrRef)
    .limit(1)
    .get();
  let found: Payment | null = null;
  snap.forEach((doc) => {
    if (!found) found = {id: doc.id, ...doc.data()} as Payment;
  });
  return found;
};

const update = async (
  id: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db.collection(PAYMENT_COLLECTION).doc(id).update({
    ...fields,
    updatedAt: new Date().toISOString(),
  });
};

const updateStatus = async (
  id: string,
  status: PaymentStatus | string,
  fields: Record<string, unknown> = {},
): Promise<Payment | null> => {
  await update(id, {...fields, status});
  return findById(id);
};

const findByStatus = async (
  status: PaymentStatus | string,
  limit: number = PAYMENT_LIST_LIMIT,
): Promise<Payment[]> => {
  const snap = await db
    .collection(PAYMENT_COLLECTION)
    .where("status", "==", status)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results: Payment[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Payment),
  );
  return results;
};

const findByPayee = async (
  payeeId: string,
  status?: string,
  limit: number = PAYMENT_LIST_LIMIT,
): Promise<Payment[]> => {
  const base = db
    .collection(PAYMENT_COLLECTION)
    .where("payeeId", "==", payeeId);
  const query = typeof status === "string" && status !== "" ?
    base.where("status", "==", status) :
    base;
  const snap = await query.get();
  const results: Payment[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Payment),
  );
  results.sort(byCreatedDesc);
  return results.slice(0, limit);
};

const findAll = async (
  limit: number = PAYMENT_LIST_LIMIT,
): Promise<Payment[]> => {
  const snap = await db.collection(PAYMENT_COLLECTION).get();
  const results: Payment[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Payment),
  );
  results.sort(byCreatedDesc);
  return results.slice(0, limit);
};

export {
  Payment,
  PaymentMethod,
  PaymentStatus,
  create,
  findById,
  findByTicketId,
  findByTicket,
  findByQrRef,
  update,
  updateStatus,
  findByStatus,
  findByPayee,
  findAll,
};
