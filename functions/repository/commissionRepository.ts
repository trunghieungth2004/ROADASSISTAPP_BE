import {db} from "../config/firebase";
import type {QueryDocumentSnapshot} from "firebase-admin/firestore";

const COMMISSION_COLLECTION = "commission_ledger";

const COMMISSION_STATUS = {
  OWED: "OWED",
  SETTLED: "SETTLED",
} as const;

interface CommissionEntry {
  id: string;
  payeeId: string;
  ticketId: string;
  paymentId: string;
  amount: number;
  settledAmount: number;
  reversedAmount: number;
  status: string;
  createdAt: string;
  settledAt?: string | null;
  settledBy?: string | null;
  payoutBatchId?: string | null;
  [key: string]: unknown;
}

const create = async (data: {
  payeeId: string;
  ticketId: string;
  paymentId: string;
  amount: number;
}): Promise<CommissionEntry> => {
  const existing = await findByPaymentId(data.paymentId);
  if (existing) return existing;
  const ref = db.collection(COMMISSION_COLLECTION).doc();
  const doc: CommissionEntry = {
    id: ref.id,
    payeeId: data.payeeId,
    ticketId: data.ticketId,
    paymentId: data.paymentId,
    amount: data.amount,
    settledAmount: 0,
    reversedAmount: 0,
    status: COMMISSION_STATUS.OWED,
    createdAt: new Date().toISOString(),
    settledAt: null,
    settledBy: null,
    payoutBatchId: null,
  };
  await ref.set(doc);
  return doc;
};

const findByPaymentId = async (
  paymentId: string,
): Promise<CommissionEntry | null> => {
  const snap = await db
    .collection(COMMISSION_COLLECTION)
    .where("paymentId", "==", paymentId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return {id: doc.id, ...doc.data()} as CommissionEntry;
};

const findOwedByPayee = async (
  payeeId: string,
): Promise<CommissionEntry[]> => {
  const snap = await db
    .collection(COMMISSION_COLLECTION)
    .where("payeeId", "==", payeeId)
    .get();
  const rows: CommissionEntry[] = [];
  snap.forEach((doc) => {
    const entry = {id: doc.id, ...doc.data()} as CommissionEntry;
    if (entry.status === COMMISSION_STATUS.OWED) rows.push(entry);
  });
  rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return rows;
};

const openAmountOf = (entry: CommissionEntry): number =>
  Math.max(
    0,
    entry.amount -
    (entry.settledAmount ?? 0) -
    (entry.reversedAmount ?? 0),
  );

const owedTotalByPayee = async (payeeId: string): Promise<number> => {
  const rows = await findOwedByPayee(payeeId);
  return rows.reduce((sum, entry) => sum + openAmountOf(entry), 0);
};

const settleAgainst = async (
  payeeId: string,
  amount: number,
  meta: {batchId: string; settledBy: string},
): Promise<number> => {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const rows = await findOwedByPayee(payeeId);
  let remaining = amount;
  let settled = 0;
  const now = new Date().toISOString();
  for (const entry of rows) {
    if (remaining <= 0) break;
    const open = openAmountOf(entry);
    if (open <= 0) continue;
    const applied = Math.min(open, remaining);
    const nextSettled = (entry.settledAmount ?? 0) + applied;
    const closed = nextSettled + (entry.reversedAmount ?? 0) >= entry.amount;
    await db.collection(COMMISSION_COLLECTION).doc(entry.id).update({
      settledAmount: nextSettled,
      status: closed ? COMMISSION_STATUS.SETTLED : COMMISSION_STATUS.OWED,
      settledAt: closed ? now : null,
      settledBy: meta.settledBy,
      payoutBatchId: meta.batchId,
    });
    remaining -= applied;
    settled += applied;
  }
  return settled;
};

type SettlementUpdate = {
  id: string;
  fields: Record<string, unknown>;
};

const planSettlement = async (
  payeeId: string,
  amount: number,
  meta: {batchId: string; settledBy: string},
): Promise<{updates: SettlementUpdate[]; settled: number}> => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return {updates: [], settled: 0};
  }
  const rows = await findOwedByPayee(payeeId);
  let remaining = amount;
  let settled = 0;
  const now = new Date().toISOString();
  const updates: SettlementUpdate[] = [];
  for (const entry of rows) {
    if (remaining <= 0) break;
    const open = openAmountOf(entry);
    if (open <= 0) continue;
    const applied = Math.min(open, remaining);
    const nextSettled = (entry.settledAmount ?? 0) + applied;
    const closed = nextSettled + (entry.reversedAmount ?? 0) >= entry.amount;
    updates.push({
      id: entry.id,
      fields: {
        settledAmount: nextSettled,
        status: closed ? COMMISSION_STATUS.SETTLED : COMMISSION_STATUS.OWED,
        settledAt: closed ? now : null,
        settledBy: meta.settledBy,
        payoutBatchId: meta.batchId,
      },
    });
    remaining -= applied;
    settled += applied;
  }
  return {updates, settled};
};

const settleDirect = async (
  payeeId: string,
  settledBy: string,
): Promise<number> => {
  const rows = await findOwedByPayee(payeeId);
  const now = new Date().toISOString();
  let settled = 0;
  for (const entry of rows) {
    const open = openAmountOf(entry);
    if (open <= 0) continue;
    await db.collection(COMMISSION_COLLECTION).doc(entry.id).update({
      settledAmount: (entry.settledAmount ?? 0) + open,
      status: COMMISSION_STATUS.SETTLED,
      settledAt: now,
      settledBy,
    });
    settled += open;
  }
  return settled;
};

const reverseForRefund = async ({
  paymentId,
  refundAmount,
  paymentAmount,
}: {
  paymentId: string;
  refundAmount: number;
  paymentAmount: number;
}): Promise<number> => {
  const entry = await findByPaymentId(paymentId);
  if (!entry) return 0;
  const open = openAmountOf(entry);
  if (open <= 0 || paymentAmount <= 0 || refundAmount <= 0) return 0;
  const share = Math.min(
    open,
    Math.round((entry.amount * refundAmount) / paymentAmount),
  );
  if (share <= 0) return 0;
  await db.collection(COMMISSION_COLLECTION).doc(entry.id).update({
    reversedAmount: (entry.reversedAmount ?? 0) + share,
  });
  return share;
};

const findAllOwed = async (): Promise<CommissionEntry[]> => {
  const rows: CommissionEntry[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection(COMMISSION_COLLECTION)
      .where("status", "==", COMMISSION_STATUS.OWED)
      .orderBy("createdAt", "asc")
      .limit(500);
    if (cursor !== null) query = query.startAfter(cursor);
    const snap = await query.get();
    snap.forEach((doc) =>
      rows.push({id: doc.id, ...doc.data()} as CommissionEntry));
    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return rows;
};

export {
  COMMISSION_STATUS,
  CommissionEntry,
  create,
  findByPaymentId,
  findOwedByPayee,
  owedTotalByPayee,
  settleAgainst,
  planSettlement,
  settleDirect,
  reverseForRefund,
  findAllOwed,
};
