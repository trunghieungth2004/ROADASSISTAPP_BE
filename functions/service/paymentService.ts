import * as dispatchRepository from "../repository/dispatchRepository";
import {resolvePayeeId, generateQrRef} from "./payment/helpers";
import {depositCreditFor} from "./payment/depositCredit";
import {markDepositConfirmed} from "./paymentDepositService";
import * as paymentRepository from "../repository/paymentRepository";
import * as commissionRepository from "../repository/commissionRepository";
import * as paymentPush from "./push/payment";
import * as providerRepository from "../repository/providerRepository";
import {isWarrantyRework} from "./warrantyRework";
import * as userRepository from "../repository/userRepository";
import {listPayments} from "./payment/adminPayments";
import * as platformConfigService from "./platformConfigService";
import * as sepayService from "./sepayService";
import {approvePaidQuote} from "./dispatch/quote/paid";
import {logError} from "../utils/logger";
import * as subscriptionService from "./subscriptionService";
import {
  cancelActiveForSwitch,
  cancelPendingPayment,
} from "./paymentMethodSwitch";
import {ROLE_ADMIN} from "../constants/roles";
import {
  MOBILE_SHOP_CALL_OUT_FEE,
  STATUS_DISPATCH,
} from "../constants/status";
import {
  COMMISSION_RATE_PERCENT,
  PAYMENT_ACTIVE_STATUSES,
  PAYMENT_CASH_CONFIRMABLE_STATUSES,
  DEPOSIT_PURPOSE,
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  REFUND_POLICY,
} from "../constants/payments";
import {
  SEPAY_AMOUNT_KEYS,
  SEPAY_IPN_FIELD,
  SEPAY_IPN_NOTIFICATION_PAID,
  SEPAY_IPN_REF_KEYS,
  SEPAY_QR_REF_KEYS,
} from "../constants/sepay";
import {SUBSCRIPTION_PURPOSE} from "../constants/subscriptions";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
export type TicketLike = {
  id: string;
  userId: string;
  ticketType: string;
  status: string;
  assignedShopId?: string | null;
  destinationShopId?: string | null;
  providerId?: string | null;
  assignedUid?: string | null;
  shopQuotedAmount?: number | null;
  invoiceAmount?: number | null;
  invoiceApproval?: string | null;
  finalAmount?: number | null;
  mobileCallOutFee?: number | null;
  mobileTravelFee?: number | null;
  mobileFeeHistory?: Array<{
    callOutFee?: number | null;
    travelFee?: number | null;
  }>;
  cancelledBy?: string | null;
  towFeeHistory?: Array<{amount?: number | null}>;
  towFare?: {
    final?: number | null;
    estimate?: number | null;
    waitingFee?: number | null;
    partial?: boolean | null;
  } | null;
  depositAmount?: number | null; depositStatus?: string | null;
  warrantyOfTicketId?: string | null; warrantyClaimId?: string | null;
};
type PaymentWithCheckout = paymentRepository.Payment & {
  checkout?: sepayService.SepayCheckoutFields;
  reused?: boolean;
};
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";
const towHistoryAmountFor = (ticket: TicketLike): number =>
  Array.isArray(ticket.towFeeHistory) ?
    ticket.towFeeHistory.reduce((sum, entry) =>
      sum + (typeof entry.amount === "number" && entry.amount > 0 ?
        entry.amount :
        0), 0) :
    0;
const notify = async (task: Promise<unknown>): Promise<void> => {
  try {
    await task;
  } catch {
    return;
  }
};
const billableAmountFor = (ticket: TicketLike):
  {amount: number; waitingFee: number} | null => {
  if (isWarrantyRework(ticket)) return null;
  if (ticket.ticketType === "TOW") {
    const fare = ticket.towFare;
    const historyAmount = towHistoryAmountFor(ticket);
    const riderCancelled = ticket.status === STATUS_DISPATCH.CANCELLED &&
      ticket.cancelledBy === ticket.userId;
    const priorTowCharge = ticket.status === STATUS_DISPATCH.CANCELLED &&
      historyAmount > 0;
    if (ticket.status !== STATUS_DISPATCH.RESOLVED &&
      !(ticket.status === STATUS_DISPATCH.CANCELLED &&
        (riderCancelled || priorTowCharge))) {
      return null;
    }
    const reMatched = (riderCancelled && !nonEmpty(ticket.assignedShopId)) ||
      (priorTowCharge && !riderCancelled &&
        fare?.partial !== true);
    const base = reMatched ?
      null :
      fare && typeof fare === "object" ?
        (typeof fare.final === "number" ? fare.final :
          typeof fare.estimate === "number" ? fare.estimate : null) :
        (typeof ticket.finalAmount === "number" ? ticket.finalAmount : null);
    if (base === null && historyAmount === 0) return null;
    const waitingFee = fare && typeof fare.waitingFee === "number" ?
      fare.waitingFee :
      0;
    return {amount: (base ?? 0) + historyAmount + waitingFee, waitingFee};
  }
  if (ticket.ticketType === "SOS") {
    const history = Array.isArray(ticket.mobileFeeHistory) ?
      ticket.mobileFeeHistory.reduce((sum, entry) => {
        const callOut = typeof entry.callOutFee === "number" ?
          entry.callOutFee :
          0;
        const travel = typeof entry.travelFee === "number" ?
          entry.travelFee :
          0;
        return sum + callOut + travel;
      }, 0) :
      0;
    const assigned = nonEmpty(ticket.assignedShopId);
    const callOut = typeof ticket.mobileCallOutFee === "number" ?
      ticket.mobileCallOutFee :
      MOBILE_SHOP_CALL_OUT_FEE;
    const travel = typeof ticket.mobileTravelFee === "number" ?
      ticket.mobileTravelFee :
      0;
    if (!assigned && history === 0) return null;
    const fix = typeof ticket.finalAmount === "number" ?
      ticket.finalAmount :
      0;
    if (assigned &&
      (ticket.status === STATUS_DISPATCH.RESOLVED ||
        ticket.status === STATUS_DISPATCH.READY ||
        ticket.status === STATUS_DISPATCH.IN_PROGRESS ||
        ticket.status === STATUS_DISPATCH.QUOTED) &&
      typeof ticket.finalAmount === "number") {
      return {amount: history + callOut + travel + fix, waitingFee: 0};
    }
    if (ticket.status === STATUS_DISPATCH.UNFIXABLE ||
      ticket.status === STATUS_DISPATCH.RESOLVED_UNFIXABLE) {
      return {amount: history + (assigned ? callOut : 0), waitingFee: 0};
    }
    if (ticket.status === STATUS_DISPATCH.CANCELLED &&
      ticket.cancelledBy === ticket.userId) {
      return {
        amount: history + (assigned ? callOut + travel : 0),
        waitingFee: 0,
      };
    }
    return null;
  }
  if (ticket.invoiceApproval === "APPROVED" &&
    typeof ticket.invoiceAmount === "number") {
    return {amount: ticket.invoiceAmount, waitingFee: 0};
  }
  if (typeof ticket.shopQuotedAmount === "number") {
    return {amount: ticket.shopQuotedAmount, waitingFee: 0};
  }
  if (typeof ticket.finalAmount === "number") {
    return {amount: ticket.finalAmount, waitingFee: 0};
  }
  return null;
};
export const assertCashConfirmedForResolve = async ({
  ticketId,
  ticketType,
  isAdmin,
}: {
  ticketId: string;
  ticketType: string;
  isAdmin: boolean;
}): Promise<void> => {
  if (isAdmin || (ticketType !== "WALK_IN" &&
    ticketType !== "MECHANIC" && ticketType !== "SOS")) {
    return;
  }
  const payments = await paymentRepository.findByTicketId(ticketId);
  const cash = payments.find((p) => p.method === "CASH");
  if (cash && cash.status !== PAYMENT_STATUS.CONFIRMED) {
    throw new ValidationError("Confirm cash received before resolving");
  }
};

const expectedAmountFor = (ticket: TicketLike): number => {
  const billable = billableAmountFor(ticket);
  if (!billable || billable.amount <= 0) {
    throw new ValidationError("Ticket has no payable amount yet");
  }
  return Math.max(0, billable.amount - depositCreditFor(ticket));
};

const isOperatorOfTicket = async (
  ticket: TicketLike,
  userId: string,
): Promise<boolean> => {
  if (nonEmpty(ticket.assignedUid) && ticket.assignedUid === userId) {
    return true;
  }
  const shopIds = [ticket.assignedShopId, ticket.destinationShopId].filter(
    nonEmpty,
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) return true;
  }
  return false;
};

const isParticipant = async (
  ticket: TicketLike,
  userId: string,
): Promise<boolean> => {
  if (ticket.userId === userId) return true;
  return isOperatorOfTicket(ticket, userId);
};

const stampTicketPayment = async (
  ticketId: string,
  payment: paymentRepository.Payment,
  checkout?: sepayService.SepayCheckoutFields,
): Promise<void> => {
  if (payment.purpose === DEPOSIT_PURPOSE) return;
  const patch: Record<string, unknown> = {
    paymentId: payment.id,
    paymentMethod: payment.method,
    paymentStatus: payment.status,
  };
  if (checkout !== undefined) patch.checkoutUrl = checkout.qrUrl;
  try {
    await dispatchRepository.update(ticketId, patch);
  } catch {
    return;
  }
};

const strField = (
  body: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
};

const numField = (
  body: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, unknown> :
    {};

const asReused = async (
  payment: paymentRepository.Payment,
  method: string,
): Promise<PaymentWithCheckout> => {
  if (payment.method !== method) {
    throw new ConflictError("Ticket already has an active payment");
  }
  if (method === PAYMENT_METHOD.SEPAY) {
    const checkout = sepayService.buildCheckoutFields(payment);
    await stampTicketPayment(payment.ticketId, payment, checkout);
    return {...payment, checkout, reused: true};
  }
  return {...payment, reused: true};
};

export const adjustPendingCashAmount = async ({
  ticketId,
  amount,
  ticketType,
}: {
  ticketId: string;
  amount: number;
  ticketType: string;
}): Promise<string | null> => {
  const payments = await paymentRepository.findByTicketId(ticketId);
  const cash = payments.find((p) =>
    p.method === PAYMENT_METHOD.CASH &&
    p.status === PAYMENT_STATUS.PENDING);
  if (!cash) return null;
  const rate = await platformConfigService.getCommissionRate(ticketType);
  const commissionAmount = Math.round(amount * rate / 100);
  const payoutAmount = amount - commissionAmount;
  await paymentRepository.update(cash.id, {
    amount,
    commissionRate: rate,
    commissionAmount,
    payoutAmount,
  });
  await stampTicketPayment(ticketId, {
    ...cash,
    amount,
    commissionRate: rate,
    commissionAmount,
    payoutAmount,
  });
  return cash.id;
};

const createPaymentForTicket = async ({
  userId,
  ticketId,
  planId,
  method,
}: {
  userId: string;
  ticketId?: string;
  planId?: string;
  method: string;
}): Promise<PaymentWithCheckout> => {
  if (planId) {
    return subscriptionService.createSubscriptionPayment({
      userId,
      planId,
      method,
    });
  }
  if (!ticketId) {
    throw new ValidationError("Ticket or subscription plan required");
  }
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider pays for a ticket");
  }
  if (ticket.disputeHold === true) {
    throw new ValidationError("Dispute under review");
  }
  const blocked: Set<string> = new Set([
    STATUS_DISPATCH.CANCELLED,
    STATUS_DISPATCH.DECLINED,
    STATUS_DISPATCH.RESOLVED_UNFIXABLE,
    STATUS_DISPATCH.UNFIXABLE,
  ]);
  const unfixableSos = ticket.ticketType === "SOS" &&
    (ticket.status === STATUS_DISPATCH.UNFIXABLE ||
      ticket.status === STATUS_DISPATCH.RESOLVED_UNFIXABLE);
  const riderCancelled = ticket.status === STATUS_DISPATCH.CANCELLED &&
    ticket.cancelledBy === ticket.userId &&
    (ticket.ticketType === "TOW" || ticket.ticketType === "SOS");
  const priorTowCharge = ticket.ticketType === "TOW" &&
    ticket.status === STATUS_DISPATCH.CANCELLED &&
    Array.isArray(ticket.towFeeHistory) &&
    ticket.towFeeHistory.some((entry) =>
      typeof entry.amount === "number" && entry.amount > 0);
  if (blocked.has(ticket.status) && !unfixableSos && !riderCancelled &&
    !priorTowCharge) {
    throw new ValidationError("Ticket is not payable");
  }
  if (
    ticket.ticketType === "TOW" &&
    ticket.status !== STATUS_DISPATCH.RESOLVED &&
    !riderCancelled &&
    !priorTowCharge
  ) {
    throw new ValidationError(
      "Tow payment is available after the tow is resolved",
    );
  }
  if (method !== PAYMENT_METHOD.CASH && method !== PAYMENT_METHOD.SEPAY) {
    throw new ValidationError("Unknown payment method");
  }
  const config = await platformConfigService.getConfig();
  if (!config.paymentMethodsEnabled.includes(method)) {
    throw new ValidationError("Payment method is disabled");
  }
  const amount = expectedAmountFor(ticket);
  const existing = await paymentRepository.findByTicketId(ticketId);
  if (amount <= 0) {
    const deposit = existing.find((payment) =>
      payment.purpose === DEPOSIT_PURPOSE &&
      (payment.status === PAYMENT_STATUS.HELD ||
        payment.status === PAYMENT_STATUS.CONFIRMED));
    if (deposit) return {...deposit, reused: true};
    const collected = existing.find((payment) =>
      payment.purpose !== DEPOSIT_PURPOSE);
    if (collected) return {...collected, reused: true};
  }
  const pendingDeposit = existing.find((payment) =>
    payment.purpose === DEPOSIT_PURPOSE &&
    payment.status === PAYMENT_STATUS.PENDING);
  if (pendingDeposit) {
    if (pendingDeposit.method !== method) {
      throw new ValidationError("Settle the deposit first");
    }
    return asReused(pendingDeposit, method);
  }
  const active = existing.find(
    (payment) => payment.purpose !== DEPOSIT_PURPOSE &&
      PAYMENT_ACTIVE_STATUSES.includes(payment.status),
  );
  if (active) {
    if (active.method === method) return asReused(active, method);
    await cancelActiveForSwitch({active, ticketId});
  }
  const payeeId = await resolvePayeeId(ticket);
  const rate = await platformConfigService.getCommissionRate(
    ticket.ticketType,
  );
  const commissionAmount = Math.round(amount * rate / COMMISSION_RATE_PERCENT);
  const payoutAmount = amount - commissionAmount;
  const qrRef = method === "SEPAY" ? generateQrRef(ticketId) : null;
  const created = await paymentRepository.createGuarded({
    ticketId,
    riderUid: userId,
    payeeId,
    amount,
    method,
    qrRef,
    status: PAYMENT_STATUS.PENDING,
    commissionRate: rate,
    commissionAmount,
    payoutAmount,
  });
  const payment = created.payment;
  if (created.reused) return asReused(payment, method);
  if (method === PAYMENT_METHOD.SEPAY) {
    const checkout = sepayService.buildCheckoutFields(payment);
    await stampTicketPayment(ticketId, payment, checkout);
    await notify(paymentPush.deliverOpened(payment));
    return {...payment, checkout};
  }
  await stampTicketPayment(ticketId, payment);
  await notify(paymentPush.deliverOpened(payment));
  return payment;
};

const confirmCash = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}): Promise<paymentRepository.Payment | null> => {
  const payments = await paymentRepository.findByTicketId(ticketId);
  const payment = payments.find((p) =>
    p.method === PAYMENT_METHOD.CASH &&
    PAYMENT_CASH_CONFIRMABLE_STATUSES.includes(p.status));
  if (!payment) throw new NotFoundError("Pending cash payment not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN && payment.payeeId !== userId) {
    throw new ForbiddenError("Only the payee confirms cash");
  }
  const confirmed = await paymentRepository.updateStatusWhen(
    payment.id,
    PAYMENT_STATUS.PENDING,
    PAYMENT_STATUS.CONFIRMED,
    {
      confirmedBy: userId,
      confirmedAt: new Date().toISOString(),
    },
  );
  if (!confirmed) {
    throw new NotFoundError("Pending cash payment not found");
  }
  if (typeof confirmed.commissionAmount === "number" &&
    confirmed.commissionAmount > 0) {
    await commissionRepository.create({
      payeeId: confirmed.payeeId, ticketId: confirmed.ticketId,
      paymentId: confirmed.id, amount: confirmed.commissionAmount,
    }).catch(() => undefined);
  }
  await stampTicketPayment(ticketId, confirmed);
  await notify(paymentPush.deliverConfirmed(confirmed));
  return confirmed;
};

const buildSepayOrder = async ({
  paymentId,
}: {
  paymentId: string;
}): Promise<sepayService.SepayCheckoutFields> => {
  const payment = await paymentRepository.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  return sepayService.buildCheckoutFields(payment);
};

const handleSepayIpn = async (
  body: Record<string, unknown>,
  headers?: Record<string, unknown>,
): Promise<paymentRepository.Payment | null> => {
  if (headers !== undefined && !sepayService.verifyIpnAuth(headers)) {
    throw new ForbiddenError("Invalid SePay authorization");
  }
  const order = asRecord(body.order);
  const transaction = asRecord(body.transaction);
  const notificationType = typeof body.notification_type === "string" ?
    body.notification_type :
    "";
  if (notificationType !== "" &&
    notificationType !== SEPAY_IPN_NOTIFICATION_PAID) {
    return null;
  }
  const qrRef = strField(order, [SEPAY_IPN_FIELD.ORDER_INVOICE_NUMBER]) ??
    strField(body, SEPAY_QR_REF_KEYS);
  if (!qrRef) throw new ValidationError("IPN has no order reference");
  const payment = await paymentRepository.findByQrRef(qrRef);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status === PAYMENT_STATUS.HELD ||
    payment.status === PAYMENT_STATUS.CONFIRMED) {
    await subscriptionService.activateFromPayment(payment);
    if (payment.purpose !== SUBSCRIPTION_PURPOSE &&
      payment.purpose !== DEPOSIT_PURPOSE) {
      await approvePaidQuote(payment.ticketId, payment.riderUid)
        .catch((err) => logError("payments", "auto-approve-quote-failed", {
          ticketId: payment.ticketId,
          paymentId: payment.id,
        }, err));
    }
    return payment;
  }
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    throw new ValidationError("Payment cannot be held");
  }
  const notified = numField(transaction, [
    SEPAY_IPN_FIELD.TRANSACTION_AMOUNT,
  ]) ??
    numField(order, [SEPAY_IPN_FIELD.ORDER_AMOUNT]) ??
    numField(body, SEPAY_AMOUNT_KEYS);
  if (typeof notified !== "number") {
    throw new ValidationError("IPN amount missing");
  }
  if (Math.round(notified) !== payment.amount) {
    throw new ValidationError("IPN amount mismatch");
  }
  const ipnRef = strField(transaction, [
    SEPAY_IPN_FIELD.TRANSACTION_ID,
    SEPAY_IPN_FIELD.ID,
  ]) ?? strField(body, SEPAY_IPN_REF_KEYS) ?? qrRef;
  const held = await paymentRepository.updateStatus(
    payment.id,
    PAYMENT_STATUS.HELD,
    {
      ipnRef,
    },
  );
  if (held) {
    if (held.purpose === SUBSCRIPTION_PURPOSE) {
      await subscriptionService.activateFromPayment(held);
    } else if (held.purpose === DEPOSIT_PURPOSE) {
      await markDepositConfirmed(held, new Date().toISOString());
      await notify(paymentPush.deliverReceived(held));
    } else {
      await stampTicketPayment(payment.ticketId, held);
      await approvePaidQuote(held.ticketId, held.riderUid)
        .catch((err) => logError("payments", "auto-approve-quote-failed", {
          ticketId: held.ticketId,
          paymentId: held.id,
        }, err));
      await notify(paymentPush.deliverReceived(held));
    }
  }
  return held;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildSepayCheckoutPage = async ({
  paymentId,
  token,
}: {
  paymentId: string;
  token: string;
}): Promise<string> => {
  if (!sepayService.verifyCheckoutToken(paymentId, token)) {
    throw new ForbiddenError("Invalid checkout token");
  }
  const payment = await paymentRepository.findById(paymentId);
  if (!payment || payment.method !== PAYMENT_METHOD.SEPAY) {
    throw new NotFoundError("Payment not found");
  }
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    throw new ValidationError("Payment is no longer payable");
  }
  const checkout = sepayService.buildCheckoutFields(payment);
  const inputs = Object.entries(checkout.fields)
    .map(([key, value]) =>
      `<input type="hidden" name="${escapeHtml(key)}" ` +
      `value="${escapeHtml(value)}" />`)
    .join("");
  const form = "<form id=\"sepay-checkout\" method=\"post\" " +
    `action="${escapeHtml(checkout.action)}">${inputs}</form>`;
  const submit = "<script>" +
    "document.getElementById(\"sepay-checkout\").submit();</script>";
  return "<!doctype html><html><head><meta charset=\"utf-8\" />" +
    "<meta name=\"viewport\" content=\"width=device-width," +
    "initial-scale=1\" /><title>RoadAssist payment</title></head><body>" +
    form + submit + "</body></html>";
};

const refund = async ({
  paymentId,
  amount,
  full,
  by,
}: {
  paymentId: string;
  amount?: number;
  full?: boolean;
  by?: string;
}): Promise<paymentRepository.Payment | null> => {
  const payment = await paymentRepository.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  const config = await platformConfigService.getConfig();
  const policy = String(config.refundPolicy ?? REFUND_POLICY.FULL);
  if (policy === REFUND_POLICY.NONE) {
    throw new ValidationError("Refunds are disabled");
  }
  const refundable = payment.status === PAYMENT_STATUS.HELD ||
    payment.status === PAYMENT_STATUS.CONFIRMED ||
    payment.status === PAYMENT_STATUS.PARTIAL;
  if (!refundable) throw new ValidationError("Payment cannot be refunded");
  const already = typeof payment.refundAmount === "number" ?
    payment.refundAmount :
    0;
  const remaining = payment.amount - already;
  if (remaining <= 0) throw new ValidationError("Payment already refunded");
  let refundAmount: number;
  if (full === true || amount === undefined) {
    refundAmount = remaining;
  } else {
    if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
      throw new ValidationError("Invalid refund amount");
    }
    refundAmount = amount;
  }
  const totalRefunded = already + refundAmount;
  const status = totalRefunded >= payment.amount ?
    PAYMENT_STATUS.REFUNDED :
    PAYMENT_STATUS.PARTIAL;
  if (policy === REFUND_POLICY.PARTIAL && status === PAYMENT_STATUS.REFUNDED) {
    throw new ValidationError("Full refunds are disabled");
  }
  const updated = await paymentRepository.updateStatus(payment.id, status, {
    refundAmount: totalRefunded,
    refundedAt: new Date().toISOString(),
    refundedBy: by ?? null,
  });
  if (updated) {
    await stampTicketPayment(payment.ticketId, updated);
    if (status === PAYMENT_STATUS.REFUNDED) {
      await paymentRepository.clearGuard(payment.ticketId, payment.id);
    }
    await notify(paymentPush.deliverRefunded(updated));
  }
  return updated;
};

const refundPayment = async (input: {
  paymentId: string;
  adminUid?: string;
  amount?: number;
  reason?: string;
}): Promise<paymentRepository.Payment | null> =>
  refund({
    paymentId: input.paymentId,
    ...(typeof input.amount === "number" ? {amount: input.amount} : {}),
    full: typeof input.amount !== "number",
    ...(typeof input.adminUid === "string" ? {by: input.adminUid} : {}),
  });

const getPaymentForTicket = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}): Promise<paymentRepository.Payment[]> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    const allowed = await isParticipant(ticket, userId);
    if (!allowed) {
      throw new ForbiddenError("Not allowed to view this payment");
    }
  }
  return paymentRepository.findByTicketId(ticketId);
};

const cancelPendingPayments = async (ticketId: string): Promise<void> => {
  const payments = await paymentRepository.findByTicket(ticketId);
  const pending = payments.filter((p) => p.status === PAYMENT_STATUS.PENDING);
  for (const payment of pending) {
    try {
      const updated = await paymentRepository.updateStatus(
        payment.id,
        PAYMENT_STATUS.CANCELLED,
      );
      if (updated) {
        await stampTicketPayment(ticketId, updated);
        await paymentRepository.clearGuard(ticketId, payment.id);
      }
    } catch {
      continue;
    }
  }
  if (pending.length > 0) {
    try {
      await dispatchRepository.update(ticketId, {
        checkoutUrl: null,
        qrUrl: null,
      });
    } catch {
      return;
    }
  }
};

const auditLedger = async ({
  limit,
}: {
  limit?: number;
}): Promise<{
  scanned: number;
  tickets: number;
  missingTickets: number;
  drift: Array<{
    ticketId: string;
    paymentId: string;
    expected: string;
    actual: string | null;
  }>;
}> => {
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYMENT_LIST_MAX) :
    PAYMENT_LIST_MAX;
  const payments = (await paymentRepository.findAll(capped))
    .filter((payment) => payment.purpose !== SUBSCRIPTION_PURPOSE);
  const latest = new Map<string, paymentRepository.Payment>();
  for (const payment of payments) {
    if (!latest.has(payment.ticketId)) latest.set(payment.ticketId, payment);
  }
  const drift: Array<{
    ticketId: string;
    paymentId: string;
    expected: string;
    actual: string | null;
  }> = [];
  let missingTickets = 0;
  for (const [ticketId, payment] of latest.entries()) {
    const ticket = await dispatchRepository.findById(ticketId);
    if (!ticket) {
      missingTickets += 1;
      continue;
    }
    const raw = (ticket as {paymentStatus?: unknown}).paymentStatus;
    const actual = typeof raw === "string" ? raw : null;
    if (actual !== payment.status) {
      drift.push({
        ticketId,
        paymentId: payment.id,
        expected: String(payment.status),
        actual,
      });
    }
  }
  return {
    scanned: payments.length,
    tickets: latest.size,
    missingTickets,
    drift,
  };
};

export {createDepositPayment, depositCheckout} from "./paymentDepositService";

export {
  PaymentWithCheckout,
  billableAmountFor,
  depositCreditFor,
  cancelPendingPayments,
  cancelPendingPayment,
  createPaymentForTicket,
  confirmCash,
  buildSepayOrder,
  handleSepayIpn,
  buildSepayCheckoutPage,
  isParticipant,
  isOperatorOfTicket,
  refund,
  refundPayment,
  getPaymentForTicket,
  listPayments,
  auditLedger,
  resolvePayeeId,
};
