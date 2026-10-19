import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import * as platformConfigService from "./platformConfigService";
import * as sepayService from "./sepayService";
import {ROLE_ADMIN} from "../constants/roles";
import {STATUS_DISPATCH} from "../constants/status";
import {
  COMMISSION_RATE_PERCENT,
  PAYMENT_ACTIVE_STATUSES,
  PAYMENT_CASH_CONFIRMABLE_STATUSES,
  PAYMENT_LIST_LIMIT,
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYMENT_QR_PREFIX,
  PAYMENT_QR_TICKET_LENGTH,
  PAYMENT_STATUS,
} from "../constants/payments";
import {
  SEPAY_AMOUNT_KEYS,
  SEPAY_IPN_REF_KEYS,
  SEPAY_QR_REF_KEYS,
} from "../constants/sepay";
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
  finalAmount?: number | null;
  towFare?: {
    final?: number | null;
    estimate?: number | null;
    waitingFee?: number | null;
  } | null;
};

type PaymentWithCheckout = paymentRepository.Payment & {
  checkout?: sepayService.SepayCheckoutFields;
};

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const billableAmountFor = (
  ticket: TicketLike,
): {amount: number; waitingFee: number} | null => {
  if (ticket.ticketType === "TOW") {
    const fare = ticket.towFare;
    const base = fare && typeof fare === "object" ?
      (typeof fare.final === "number" ? fare.final :
        typeof fare.estimate === "number" ? fare.estimate : null) :
      (typeof ticket.finalAmount === "number" ? ticket.finalAmount : null);
    if (base === null) return null;
    const waitingFee = fare && typeof fare.waitingFee === "number" ?
      fare.waitingFee :
      0;
    return {amount: base + waitingFee, waitingFee};
  }
  if (ticket.ticketType === "SOS") return null;
  if (typeof ticket.shopQuotedAmount === "number") {
    return {amount: ticket.shopQuotedAmount, waitingFee: 0};
  }
  if (typeof ticket.finalAmount === "number") {
    return {amount: ticket.finalAmount, waitingFee: 0};
  }
  return null;
};

const expectedAmountFor = (ticket: TicketLike): number => {
  const billable = billableAmountFor(ticket);
  if (!billable) throw new ValidationError("Ticket has no payable amount yet");
  return billable.amount;
};

const resolvePayeeId = async (ticket: TicketLike): Promise<string> => {
  const shopIds = [
    ticket.assignedShopId,
    ticket.providerId,
    ticket.destinationShopId,
  ].filter(nonEmpty);
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && nonEmpty(shop.operatorUid)) {
      return shop.operatorUid;
    }
  }
  if (nonEmpty(ticket.assignedUid)) return ticket.assignedUid;
  throw new ValidationError("Ticket has no payee yet");
};

const generateQrRef = (ticketId: string): string => {
  const ticketPart = ticketId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, PAYMENT_QR_TICKET_LENGTH)
    .toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  return `${PAYMENT_QR_PREFIX}${ticketPart}${stamp}`;
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
    if (typeof value === "number") return value;
  }
  return undefined;
};

const createPaymentForTicket = async ({
  userId,
  ticketId,
  method,
}: {
  userId: string;
  ticketId: string;
  method: string;
}): Promise<PaymentWithCheckout> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider pays for a ticket");
  }
  const blocked: Set<string> = new Set([
    STATUS_DISPATCH.CANCELLED,
    STATUS_DISPATCH.DECLINED,
    STATUS_DISPATCH.RESOLVED_UNFIXABLE,
    STATUS_DISPATCH.UNFIXABLE,
  ]);
  if (blocked.has(ticket.status)) {
    throw new ValidationError("Ticket is not payable");
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
  if (existing.some((p) => PAYMENT_ACTIVE_STATUSES.includes(p.status))) {
    throw new ConflictError("Ticket already has an active payment");
  }
  const payeeId = await resolvePayeeId(ticket);
  const rate = await platformConfigService.getCommissionRate(
    ticket.ticketType,
  );
  const commissionAmount = Math.round(amount * rate / COMMISSION_RATE_PERCENT);
  const payoutAmount = amount - commissionAmount;
  const qrRef = method === PAYMENT_METHOD.SEPAY ?
    generateQrRef(ticketId) :
    null;
  const payment = await paymentRepository.create({
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
  if (method === PAYMENT_METHOD.SEPAY) {
    const checkout = sepayService.buildCheckoutFields(payment);
    await stampTicketPayment(ticketId, payment, checkout);
    return {...payment, checkout};
  }
  await stampTicketPayment(ticketId, payment);
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
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    const operator = await isOperatorOfTicket(ticket, userId);
    if (!operator) throw new ForbiddenError("Only the operator confirms cash");
  }
  const confirmed = await paymentRepository.updateStatus(
    payment.id,
    PAYMENT_STATUS.CONFIRMED,
    {
      confirmedBy: userId,
      confirmedAt: new Date().toISOString(),
    },
  );
  if (confirmed) await stampTicketPayment(ticketId, confirmed);
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
  const qrRef = strField(body, SEPAY_QR_REF_KEYS);
  if (!qrRef) throw new ValidationError("IPN has no order reference");
  const payment = await paymentRepository.findByQrRef(qrRef);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status === PAYMENT_STATUS.HELD ||
    payment.status === PAYMENT_STATUS.CONFIRMED) {
    return payment;
  }
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    throw new ValidationError("Payment cannot be held");
  }
  const notified = numField(body, SEPAY_AMOUNT_KEYS);
  if (typeof notified === "number" && notified !== payment.amount) {
    throw new ValidationError("IPN amount mismatch");
  }
  const ipnRef = strField(body, SEPAY_IPN_REF_KEYS) ?? qrRef;
  const held = await paymentRepository.updateStatus(
    payment.id,
    PAYMENT_STATUS.HELD,
    {
      ipnRef,
    },
  );
  if (held) await stampTicketPayment(payment.ticketId, held);
  return held;
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
  if (payment.status === PAYMENT_STATUS.REFUNDED) {
    throw new ValidationError("Payment already refunded");
  }
  const refundable = payment.status === PAYMENT_STATUS.HELD ||
    payment.status === PAYMENT_STATUS.CONFIRMED ||
    payment.status === PAYMENT_STATUS.PARTIAL;
  if (!refundable) throw new ValidationError("Payment cannot be refunded");
  let refundAmount: number;
  if (full === true || amount === undefined) {
    refundAmount = payment.amount;
  } else {
    if (!Number.isInteger(amount) || amount <= 0 || amount > payment.amount) {
      throw new ValidationError("Invalid refund amount");
    }
    refundAmount = amount;
  }
  const status = refundAmount >= payment.amount ?
    PAYMENT_STATUS.REFUNDED :
    PAYMENT_STATUS.PARTIAL;
  const updated = await paymentRepository.updateStatus(payment.id, status, {
    refundAmount,
    refundedAt: new Date().toISOString(),
    refundedBy: by ?? null,
  });
  if (updated) await stampTicketPayment(payment.ticketId, updated);
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
      if (updated) await stampTicketPayment(ticketId, updated);
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

const listPayments = async ({
  adminUid,
  status,
  limit,
}: {
  adminUid: string;
  status?: string;
  limit?: number;
}): Promise<paymentRepository.Payment[]> => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const capped = typeof limit === "number" ?
    Math.min(limit, PAYMENT_LIST_MAX) :
    PAYMENT_LIST_LIMIT;
  if (typeof status === "string" && status !== "") {
    return paymentRepository.findByStatus(status, capped);
  }
  return paymentRepository.findAll(capped);
};

export {
  PaymentWithCheckout,
  billableAmountFor,
  cancelPendingPayments,
  createPaymentForTicket,
  confirmCash,
  buildSepayOrder,
  handleSepayIpn,
  isParticipant,
  isOperatorOfTicket,
  refund,
  refundPayment,
  getPaymentForTicket,
  listPayments,
  resolvePayeeId,
};
