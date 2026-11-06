import * as payoutRepository from "../repository/payoutRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as userRepository from "../repository/userRepository";
import * as providerRepository from "../repository/providerRepository";
import * as commissionRepository from "../repository/commissionRepository";
import * as paymentPush from "./push/payment";
import * as auditService from "./auditService";
import {
  PAYMENT_PAYOUT_PREFIX,
  PAYMENT_RECEIVED_STATUSES,
  PAYMENT_SETTLE_SCAN,
  PAYOUT_LIST_LIMIT,
  PAYOUT_LIST_MAX,
} from "../constants/payments";
import {
  ACCOUNT_NUMBER_PATTERN,
  BANK_BY_CODE,
  HOLDER_NAME_PATTERN,
  VIETNAM_BANKS,
} from "../constants/banks";
import {SUBSCRIPTION_PURPOSE} from "../constants/subscriptions";
import {
  NotFoundError,
  ValidationError,
} from "../utils/errors";

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
  commissionOwed: number;
  available: number;
} & CandidateSummary;

type PayoutAccount = {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  updatedAt: string;
};

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const byCreatedDesc = (a: Payment, b: Payment): number => {
  const av = String(a.createdAt ?? "");
  const bv = String(b.createdAt ?? "");
  return av < bv ? 1 : av > bv ? -1 : 0;
};

const isSettleable = (payment: Payment): boolean =>
  payment.purpose !== SUBSCRIPTION_PURPOSE &&
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
  (await paymentRepository.findByPayeeStatuses(
    payeeId,
    PAYMENT_RECEIVED_STATUSES,
    PAYMENT_SETTLE_SCAN,
  ))
    .filter(isSettleable)
    .sort(byCreatedDesc);

const nameOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const accountOf = (user: unknown): PayoutAccount | null => {
  const raw = typeof user === "object" && user !== null ?
    (user as {payoutAccount?: unknown}).payoutAccount :
    undefined;
  if (typeof raw !== "object" || raw === null) return null;
  const account = raw as Record<string, unknown>;
  if (!nonEmpty(account.bankCode) || !nonEmpty(account.bankName) ||
    !nonEmpty(account.accountNumber) || !nonEmpty(account.holderName)) {
    return null;
  }
  return {
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    holderName: account.holderName,
    updatedAt: nonEmpty(account.updatedAt) ? account.updatedAt : "",
  };
};

const groupFor = async (
  payeeId: string,
  payments: Payment[],
  owed?: number,
): Promise<PayeeGroup> => {
  const names = await userRepository.findByIds([payeeId]);
  const summary = summaryFor(payments);
  const commissionOwed = owed ??
    await commissionRepository.owedTotalByPayee(payeeId);
  return {
    payeeId,
    payeeName: nameOf(names.get(payeeId)?.displayName),
    commissionOwed,
    available: Math.max(0, summary.net - commissionOwed),
    ...summary,
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
  const owedRows = await commissionRepository.findAllOwed();
  const owedByPayee = new Map<string, number>();
  for (const entry of owedRows) {
    const open = Math.max(
      0,
      entry.amount - (entry.settledAmount ?? 0) - (entry.reversedAmount ?? 0),
    );
    if (open <= 0) continue;
    owedByPayee.set(
      entry.payeeId,
      (owedByPayee.get(entry.payeeId) ?? 0) + open,
    );
  }
  const groups = [...byPayee.entries()]
    .map(([payee, payments]) => {
      const summary = summaryFor(payments);
      const owed = owedByPayee.get(payee) ?? 0;
      return {
        payeeId: payee,
        commissionOwed: owed,
        available: Math.max(0, summary.net - owed),
        ...summary,
      };
    })
    .sort((a, b) =>
      (b.available ?? 0) - (a.available ?? 0) ||
      a.payeeId.localeCompare(b.payeeId));
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
}): Promise<{batch: Batch; settled: number; commissionDeducted: number}> => {
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
  const summary = summaryFor(payments);
  const commissionOwed = await commissionRepository.owedTotalByPayee(payeeId);
  const commissionDeducted = Math.min(commissionOwed, summary.net);
  const ref = nonEmpty(payoutRef) ? payoutRef :
    `${PAYMENT_PAYOUT_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();
  const batchId = payoutRepository.newId();
  const plan = commissionDeducted > 0 ?
    await commissionRepository.planSettlement(payeeId, commissionDeducted, {
      batchId,
      settledBy: adminUid,
    }) :
    {updates: [], settled: 0};
  const batch = await payoutRepository.applySettlement({
    batchId,
    batch: {
      payeeId,
      payeeName: nameOf(payee.displayName),
      ...summary,
      commissionDeducted,
      payoutRef: ref,
      note: nonEmpty(note) ? note : null,
      batchedUid: adminUid,
    },
    paymentStamps: payments.map((payment) => ({
      id: payment.id,
      fields: {
        payoutRef: ref,
        payoutAt: now,
        payoutBy: adminUid,
        payoutBatchId: batchId,
      },
    })),
    ledgerStamps: plan.updates,
  });
  await paymentPush.deliverPayout(batch).catch(() => undefined);
  await auditService.record({
    adminUid,
    action: "PAYOUT_SETTLED",
    targetType: "payout",
    targetId: batch.id,
    meta: {
      payeeId,
      net: batch.net,
      commissionDeducted,
      paymentCount: payments.length,
    },
  });
  return {batch, settled: payments.length, commissionDeducted};
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
  pending: CandidateSummary & {commissionOwed: number; available: number};
  settled: {gross: number; commission: number; net: number; itemCount: number};
  account: PayoutAccount | null;
  requests: payoutRepository.PayoutRequest[];
  pendingRequestCount?: number;
}> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYOUT_LIST_MAX) :
    PAYOUT_LIST_LIMIT;
  const batches = await payoutRepository.findByPayee(userId, capped);
  const settleable = await settleableFor(userId);
  const summary = summaryFor(settleable);
  const commissionOwed = await commissionRepository.owedTotalByPayee(userId);
  const pendingRequests = await payoutRepository.countPendingRequests(userId);
  const requests = await payoutRepository.findRequestsByPayee(userId, 20);
  const settled = batches.reduce(
    (sum, batch) => ({
      gross: sum.gross + (batch.gross ?? 0),
      commission: sum.commission + (batch.commission ?? 0),
      net: sum.net + (batch.netPayout ?? batch.net ?? 0),
      itemCount: sum.itemCount + (batch.itemCount ?? 0),
    }),
    {gross: 0, commission: 0, net: 0, itemCount: 0},
  );
  return {
    batches,
    pending: {
      ...summary,
      commissionOwed,
      available: Math.max(0, summary.net - commissionOwed),
    },
    settled,
    account: accountOf(user),
    requests,
    ...(pendingRequests > 0 ? {pendingRequestCount: pendingRequests} : {}),
  };
};

const listBanks = (): ReadonlyArray<{
  code: string;
  name: string;
  bin: string;
}> =>
  VIETNAM_BANKS;

const getAccount = async (userId: string): Promise<PayoutAccount | null> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return accountOf(user);
};

const setAccount = async ({
  userId,
  bankCode,
  accountNumber,
  holderName,
}: {
  userId: string;
  bankCode: string;
  accountNumber: string;
  holderName: string;
}): Promise<PayoutAccount> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const bank = BANK_BY_CODE.get(bankCode.trim().toUpperCase());
  if (!bank) throw new ValidationError("Unknown bank");
  const number = accountNumber.trim();
  if (!ACCOUNT_NUMBER_PATTERN.test(number)) {
    throw new ValidationError("Account number must be 6-19 digits");
  }
  const holder = holderName.trim().replace(/\s+/g, " ").toUpperCase();
  if (!HOLDER_NAME_PATTERN.test(holder)) {
    throw new ValidationError("Account holder name is invalid");
  }
  const account = {
    bankCode: bank.code,
    bankName: bank.name,
    accountNumber: number,
    holderName: holder,
  };
  await userRepository.updatePayoutAccount(userId, account);
  return {...account, updatedAt: new Date().toISOString()};
};

const requestPayout = async ({
  userId,
  amount,
  note,
}: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<payoutRepository.PayoutRequest> => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError("Requested amount is invalid");
  }
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const account = accountOf(user);
  if (!account) {
    throw new ValidationError(
      "Add a payout account before requesting a payout",
    );
  }
  const pending = await payoutRepository.countPendingRequests(userId);
  if (pending > 0) {
    throw new ValidationError("A payout request is already pending");
  }
  const settleable = await settleableFor(userId);
  const summary = summaryFor(settleable);
  const owed = await commissionRepository.owedTotalByPayee(userId);
  const available = Math.max(0, summary.net - owed);
  if (amount > available) {
    throw new ValidationError("Requested amount exceeds the available balance");
  }
  return payoutRepository.createRequest({
    payeeId: userId,
    payeeName: nameOf(user.displayName),
    amount,
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    holderName: account.holderName,
    note: nonEmpty(note) ? note : null,
  });
};

const listRequests = async ({
  status,
  limit,
}: {
  status?: string;
  limit?: number;
}): Promise<payoutRepository.PayoutRequest[]> => {
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYOUT_LIST_MAX) :
    PAYOUT_LIST_LIMIT;
  return payoutRepository.findRequests(status, capped);
};

const decideRequest = async ({
  adminUid,
  requestId,
  approve,
  note,
  payoutRef,
}: {
  adminUid: string;
  requestId: string;
  approve: boolean;
  note?: string;
  payoutRef?: string;
}): Promise<{
  request: payoutRepository.PayoutRequest;
  batch: Batch | null;
  commissionDeducted: number;
}> => {
  const request = await payoutRepository.findRequestById(requestId);
  if (!request) throw new NotFoundError("Payout request not found");
  if (request.status !== payoutRepository.PAYOUT_REQUEST_STATUS.PENDING) {
    throw new ValidationError("Payout request is already decided");
  }
  if (!approve) {
    await payoutRepository.decideRequest(requestId, {
      status: payoutRepository.PAYOUT_REQUEST_STATUS.REJECTED,
      decidedBy: adminUid,
      decisionNote: nonEmpty(note) ? note : null,
    });
    const updated = await payoutRepository.findRequestById(requestId);
    return {request: updated ?? request, batch: null, commissionDeducted: 0};
  }
  const settled = await settleBatch({
    adminUid,
    payeeId: request.payeeId,
    payoutRef,
    note: nonEmpty(note) ? note : undefined,
  });
  await payoutRepository.decideRequest(requestId, {
    status: payoutRepository.PAYOUT_REQUEST_STATUS.PAID,
    decidedBy: adminUid,
    decisionNote: nonEmpty(note) ? note : null,
    payoutBatchId: settled.batch.id,
  });
  const updated = await payoutRepository.findRequestById(requestId);
  return {
    request: updated ?? request,
    batch: settled.batch,
    commissionDeducted: settled.commissionDeducted,
  };
};

const statement = async ({
  userId,
  from,
  to,
}: {
  userId: string;
  from?: string;
  to?: string;
}): Promise<{
  from: string;
  to: string;
  totals: {
    gross: number;
    commission: number;
    refunded: number;
    net: number;
    cashCollected: number;
    payoutsNet: number;
    commissionDeducted: number;
    batches: number;
  };
  taxCode: string | null;
  lines: Array<Record<string, unknown>>;
}> => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const now = new Date();
  const start = nonEmpty(from) ? from :
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = nonEmpty(to) ? to : now.toISOString();
  const inRange = (value: unknown): boolean =>
    typeof value === "string" && value >= start && value <= end;
  const payments = (await paymentRepository.findByPayeeAll(userId))
    .filter((payment) => inRange(payment.createdAt));
  const batches = (await payoutRepository.findByPayee(userId, 500))
    .filter((batch) => inRange(batch.createdAt));
  let gross = 0;
  let commission = 0;
  let refunded = 0;
  let net = 0;
  let cashCollected = 0;
  const lines: Array<Record<string, unknown>> = [];
  for (const payment of payments) {
    if (!PAYMENT_RECEIVED_STATUSES.includes(payment.status)) continue;
    const refund = typeof payment.refundAmount === "number" ?
      payment.refundAmount :
      0;
    const payout = typeof payment.payoutAmount === "number" ?
      payment.payoutAmount :
      payment.amount - (payment.commissionAmount ?? 0);
    gross += payment.amount;
    commission += payment.commissionAmount ?? 0;
    refunded += refund;
    net += Math.max(0, payout - refund);
    if (payment.method === "CASH") cashCollected += payment.amount;
    lines.push({
      paymentId: payment.id,
      ticketId: payment.ticketId,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      commissionAmount: payment.commissionAmount ?? 0,
      payoutAmount: payout,
      refundAmount: refund,
      createdAt: payment.createdAt,
      payoutRef: payment.payoutRef ?? null,
    });
  }
  const payoutsNet = batches.reduce(
    (sum, batch) => sum + (batch.netPayout ?? batch.net ?? 0),
    0,
  );
  const commissionDeducted = batches.reduce(
    (sum, batch) => sum + (batch.commissionDeducted ?? 0),
    0,
  );
  const providers = await providerRepository.findByOperator(userId);
  const primary = providers[0];
  return {
    from: start,
    to: end,
    taxCode: typeof primary?.taxCode === "string" ? primary.taxCode : null,
    totals: {
      gross,
      commission,
      refunded,
      net,
      cashCollected,
      payoutsNet,
      commissionDeducted,
      batches: batches.length,
    },
    lines,
  };
};

const settleCommission = async ({
  adminUid,
  payeeId,
}: {
  adminUid: string;
  payeeId: string;
}): Promise<{settled: number}> => {
  const user = await userRepository.findById(payeeId);
  if (!user) throw new NotFoundError("Payee not found");
  const settled = await commissionRepository.settleDirect(payeeId, adminUid);
  return {settled};
};

export {
  listBatches,
  listBanks,
  myPayouts,
  pendingSettlements,
  settleBatch,
  summaryFor,
  getAccount,
  setAccount,
  requestPayout,
  listRequests,
  decideRequest,
  settleCommission,
  statement,
};
