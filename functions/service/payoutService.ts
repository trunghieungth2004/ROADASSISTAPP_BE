import * as payoutRepository from "../repository/payoutRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as userRepository from "../repository/userRepository";
import * as paymentPush from "./paymentPush";
import {
  PAYMENT_PAYOUT_PREFIX,
  PAYMENT_RECEIVED_STATUSES,
  PAYMENT_SETTLE_SCAN,
  PAYOUT_LIST_LIMIT,
  PAYOUT_LIST_MAX,
} from "../constants/payments";
import {NotFoundError, ValidationError} from "../utils/errors";

type Payment = paymentRepository.Payment;
type Batch = payoutRepository.Payout;

type CandidateSummary = {
  gross: number;
  commission: number;
  refunded: number;
  net: number;
  itemCount: number;
  paymentIds: string[];
  ticketIds: string[];
};

type PayeeGroup = {
  payeeId: string;
  payeeName: string | null;
} & CandidateSummary;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const byCreatedDesc = (a: Payment, b: Payment): number => {
  const av = String(a.createdAt ?? "");
  const bv = String(b.createdAt ?? "");
  return av < bv ? 1 : av > bv ? -1 : 0;
};

const isSettleable = (payment: Payment): boolean =>
  PAYMENT_RECEIVED_STATUSES.includes(payment.status) &&
  !nonEmpty(payment.payoutAt) &&
  !nonEmpty(payment.payoutBatchId);

const netFor = (payment: Payment): number => {
  const commission = typeof payment.commissionAmount === "number" ?
    payment.commissionAmount :
    0;
  const base = typeof payment.payoutAmount === "number" ?
    payment.payoutAmount :
    payment.amount - commission;
  const refunded = typeof payment.refundAmount === "number" ?
    payment.refundAmount :
    0;
  return Math.max(0, base - refunded);
};

const summaryFor = (payments: Payment[]): CandidateSummary => {
  let gross = 0;
  let commission = 0;
  let refunded = 0;
  let net = 0;
  const ticketIds: string[] = [];
  for (const payment of payments) {
    gross += payment.amount;
    commission += typeof payment.commissionAmount === "number" ?
      payment.commissionAmount :
      0;
    refunded += typeof payment.refundAmount === "number" ?
      payment.refundAmount :
      0;
    net += netFor(payment);
    if (!ticketIds.includes(payment.ticketId)) {
      ticketIds.push(payment.ticketId);
    }
  }
  return {
    gross,
    commission,
    refunded,
    net,
    itemCount: payments.length,
    paymentIds: payments.map((payment) => payment.id),
    ticketIds,
  };
};

const settleableFor = async (payeeId: string): Promise<Payment[]> =>
  (await paymentRepository.findByPayeeAll(payeeId))
    .filter(isSettleable)
    .sort(byCreatedDesc);

const nameOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const groupFor = async (
  payeeId: string,
  payments: Payment[],
): Promise<PayeeGroup> => {
  const names = await userRepository.findByIds([payeeId]);
  return {
    payeeId,
    payeeName: nameOf(names.get(payeeId)?.displayName),
    ...summaryFor(payments),
  };
};

const pendingSettlements = async ({
  payeeId,
  limit,
}: {
  payeeId?: string;
  limit?: number;
}): Promise<PayeeGroup[]> => {
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYOUT_LIST_MAX) :
    PAYOUT_LIST_MAX;
  if (nonEmpty(payeeId)) {
    const payments = await settleableFor(payeeId);
    return payments.length > 0 ? [await groupFor(payeeId, payments)] : [];
  }
  const received = await paymentRepository.findByReceived(PAYMENT_SETTLE_SCAN);
  const settleable = received.filter(isSettleable).sort(byCreatedDesc);
  const byPayee = new Map<string, Payment[]>();
  for (const payment of settleable) {
    const bucket = byPayee.get(payment.payeeId) ?? [];
    bucket.push(payment);
    byPayee.set(payment.payeeId, bucket);
  }
  const groups = [...byPayee.entries()]
    .map(([payee, payments]) => ({payeeId: payee, ...summaryFor(payments)}))
    .sort((a, b) =>
      (b.net ?? 0) - (a.net ?? 0) || a.payeeId.localeCompare(b.payeeId));
  const picked = groups.slice(0, capped);
  if (picked.length === 0) return [];
  const names = await userRepository.findByIds(
    picked.map((group) => group.payeeId),
  );
  return picked.map((group) => ({
    ...group,
    payeeName: nameOf(names.get(group.payeeId)?.displayName),
  }));
};

const settleBatch = async ({
  adminUid,
  payeeId,
  paymentIds,
  payoutRef,
  note,
}: {
  adminUid: string;
  payeeId: string;
  paymentIds?: string[];
  payoutRef?: string;
  note?: string;
}): Promise<{batch: Batch; settled: number}> => {
  const payee = await userRepository.findById(payeeId);
  if (!payee) throw new NotFoundError("Payee not found");
  let payments: Payment[];
  if (Array.isArray(paymentIds) && paymentIds.length > 0) {
    payments = [];
    for (const id of paymentIds) {
      const payment = await paymentRepository.findById(id);
      if (!payment) throw new NotFoundError("Payment not found");
      if (payment.payeeId !== payeeId) {
        throw new ValidationError("Payment belongs to another payee");
      }
      if (!isSettleable(payment)) {
        throw new ValidationError("Payment is not settleable");
      }
      payments.push(payment);
    }
  } else {
    payments = await settleableFor(payeeId);
  }
  if (payments.length === 0) {
    throw new ValidationError("No payments to settle for this payee");
  }
  const ref = nonEmpty(payoutRef) ? payoutRef :
    `${PAYMENT_PAYOUT_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();
  const batch = await payoutRepository.create({
    payeeId,
    payeeName: nameOf(payee.displayName),
    ...summaryFor(payments),
    payoutRef: ref,
    note: nonEmpty(note) ? note : null,
    batchedUid: adminUid,
  });
  for (const payment of payments) {
    await paymentRepository.update(payment.id, {
      payoutRef: ref,
      payoutAt: now,
      payoutBy: adminUid,
      payoutBatchId: batch.id,
    });
  }
  await paymentPush.deliverPayout(batch).catch(() => undefined);
  return {batch, settled: payments.length};
};

const listBatches = async ({
  payeeId,
  limit,
}: {
  payeeId?: string;
  limit?: number;
}): Promise<Batch[]> => {
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYOUT_LIST_MAX) :
    PAYOUT_LIST_LIMIT;
  if (nonEmpty(payeeId)) {
    return payoutRepository.findByPayee(payeeId, capped);
  }
  return payoutRepository.findAll(capped);
};

const myPayouts = async ({
  userId,
  limit,
}: {
  userId: string;
  limit?: number;
}): Promise<{
  batches: Batch[];
  pending: CandidateSummary;
  settled: {gross: number; commission: number; net: number; itemCount: number};
}> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYOUT_LIST_MAX) :
    PAYOUT_LIST_LIMIT;
  const batches = await payoutRepository.findByPayee(userId, capped);
  const settleable = await settleableFor(userId);
  const settled = batches.reduce(
    (sum, batch) => ({
      gross: sum.gross + (batch.gross ?? 0),
      commission: sum.commission + (batch.commission ?? 0),
      net: sum.net + (batch.net ?? 0),
      itemCount: sum.itemCount + (batch.itemCount ?? 0),
    }),
    {gross: 0, commission: 0, net: 0, itemCount: 0},
  );
  return {batches, pending: summaryFor(settleable), settled};
};

export {listBatches, myPayouts, pendingSettlements, settleBatch, summaryFor};
