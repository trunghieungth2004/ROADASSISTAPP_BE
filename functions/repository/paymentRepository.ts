import {db} from "../config/firebase";
import {
  PAYMENT_ACTIVE_STATUSES,
  PAYMENT_COLLECTION,
  PAYMENT_CURRENCY,
  PAYMENT_GUARD_COLLECTION,
  PAYMENT_LIST_LIMIT,
  PAYMENT_METHOD,
  PAYMENT_RECEIVED_STATUSES,
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
  payoutBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const byCreatedDesc = (a: Payment, b: Payment): number => {
  const av = String(a.createdAt ?? "");
  const bv = String(b.createdAt ?? "");
  return av < bv ? 1 : av > bv ? -1 : 0;
};

type CreatePaymentInput = {
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
};

const buildDoc = (id: string, data: CreatePaymentInput): Payment => {
  const now = new Date().toISOString();
  return {
    id,
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
    payoutBatchId: null,
    createdAt: now,
    updatedAt: now,
  };
};

const create = async (data: CreatePaymentInput): Promise<Payment> => {
  const ref = db.collection(PAYMENT_COLLECTION).doc();
  const doc = buildDoc(ref.id, data);
  await ref.set(doc);
  return doc;
};

const createGuarded = async (data: CreatePaymentInput): Promise<{
  payment: Payment;
  reused: boolean;
}> => {
  const guardRef = db.collection(PAYMENT_GUARD_COLLECTION).doc(data.ticketId);
  return db.runTransaction(async (tx) => {
    const guardDoc = await tx.get(guardRef);
    const guard = guardDoc.exists ? guardDoc.data() : null;
    const activeId = typeof guard?.paymentId === "string" ?
      guard.paymentId :
      "";
    if (activeId !== "") {
      const activeRef = db.collection(PAYMENT_COLLECTION).doc(activeId);
      const activeDoc = await tx.get(activeRef);
      if (activeDoc.exists) {
        const active = {id: activeDoc.id, ...activeDoc.data()} as Payment;
        if (PAYMENT_ACTIVE_STATUSES.includes(active.status)) {
          return {payment: active, reused: true};
        }
      }
    }
    const ref = db.collection(PAYMENT_COLLECTION).doc();
    const doc = buildDoc(ref.id, data);
    tx.set(ref, doc);
    tx.set(guardRef, {
      ticketId: data.ticketId,
      paymentId: ref.id,
      updatedAt: new Date().toISOString(),
    });
    return {payment: doc, reused: false};
  });
};

const clearGuard = async (
  ticketId: string,
  paymentId: string,
): Promise<void> => {
  const ref = db.collection(PAYMENT_GUARD_COLLECTION).doc(ticketId);
  const doc = await ref.get();
  if (!doc.exists) return;
  if (doc.data()?.paymentId !== paymentId) return;
  await ref.delete();
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

const findBetween = async (
  from: string,
  to: string,
  limit: number = PAYMENT_LIST_LIMIT,
): Promise<Payment[]> => {
  const snap = await db
    .collection(PAYMENT_COLLECTION)
    .where("createdAt", ">=", from)
    .where("createdAt", "<=", to)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .get();
  const results: Payment[] = [];
  snap.forEach((doc) =>
    results.push({id: doc.id, ...doc.data()} as Payment),
  );
  return results;
};

const findByPayeeAll = async (payeeId: string): Promise<Payment[]> => {
  const snap = await db
    .collection(PAYMENT_COLLECTION)
    .where("payeeId", "==", payeeId)
    .get();
  const results: Payment[] = [];
  snap.forEach((doc) => results.push({id: doc.id, ...doc.data()} as Payment));
  results.sort(byCreatedDesc);
  return results;
};

const findByReceived = async (
  limit: number = PAYMENT_LIST_LIMIT,
): Promise<Payment[]> => {
  if (limit <= 0) return [];
  const snap = await db
    .collection(PAYMENT_COLLECTION)
    .where("status", "in", [...PAYMENT_RECEIVED_STATUSES])
    .get();
  const results: Payment[] = [];
  snap.forEach((doc) => results.push({id: doc.id, ...doc.data()} as Payment));
  results.sort(byCreatedDesc);
  return results.slice(0, limit);
};

const updateStatusWhen = async (
  id: string,
  fromStatus: PaymentStatus | string,
  status: PaymentStatus | string,
  fields: Record<string, unknown> = {},
): Promise<Payment | null> => {
  const applied = await db.runTransaction(async (tx) => {
    const ref = db.collection(PAYMENT_COLLECTION).doc(id);
    const doc = await tx.get(ref);
    const current = doc.data()?.status;
    if (!doc.exists || current !== fromStatus) return false;
    tx.update(ref, {
      ...fields,
      status,
      updatedAt: new Date().toISOString(),
    });
    return true;
  });
  if (!applied) return null;
  return findById(id);
};

export {
  Payment,
  PaymentMethod,
  PaymentStatus,
  create,
  createGuarded,
  clearGuard,
  findById,
  findByTicketId,
  findByTicket,
  findByQrRef,
  update,
  updateStatus,
  findByStatus,
  findByPayee,
  findByPayeeAll,
  findByReceived,
  updateStatusWhen,
  findAll,
  findBetween,
};
