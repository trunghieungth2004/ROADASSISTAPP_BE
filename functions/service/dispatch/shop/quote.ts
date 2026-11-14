import {resolveTicketOperator} from "./helpers";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";

import {
  enqueueDispatchPush,
} from "../../taskQueueService";
import {resolveQuoteAmount} from "./items";
import {isWarrantyRework} from "../../warrantyRework";

import {NS} from "../constants";
import {QUOTE_TTL_MS} from "../../../constants/dispatch";

import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {PAYMENT_ACTIVE_STATUSES} from "../../../constants/payments";
import {ROLE_ADMIN} from "../../../constants/roles";

import {chatService} from "../../chatService";
import * as paymentService from "../../paymentService";
import * as refundService from "../../refundService";

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";
import {approveShopQuoteWork} from "../quote/paid";
import {expireMobileFixQuote} from "./mobile";

type QuoteCatalog = Array<{
  code: string;
  name: string;
  displayPrice: number;
  quoteRequired: boolean;
  category?: string;
  warrantyDays?: number;
  warrantyParts?: string;
}>;

const resolveQuoteCatalog = async ({
  shopIds,
  userId,
  isAdmin,
}: {
  shopIds: string[];
  userId: string;
  isAdmin: boolean;
}): Promise<QuoteCatalog> => {
  let kind: unknown = null;
  let services: unknown[] = [];
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      kind = shop.kind;
      services = Array.isArray(shop.services) ? shop.services : [];
      break;
    }
  }
  if (!isAdmin && kind !== PROVIDER_KIND.SHOP) {
    throw new ForbiddenError("Only shops send quotes");
  }
  if (services.length === 0 && shopIds.length > 0) {
    const fallback = await providerRepository.findById(shopIds[0]);
    services = Array.isArray(fallback?.services) ? fallback.services : [];
  }
  return services as QuoteCatalog;
};

export const sendQuote = async ({
  userId,
  ticketId,
  quotedAmount,
  finalAmount,
  workType,
  faultPhotos,
  items,
}: {
  userId: string;
  ticketId: string;
  quotedAmount?: number;
  finalAmount?: number;
  workType?: string;
  faultPhotos?: string[];
  items?: unknown;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  await resolveTicketOperator(ticket, userId);
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length === 0) {
    throw new ValidationError("Quotes need a shop ticket");
  }
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const shopCatalog = await resolveQuoteCatalog({
    shopIds,
    userId,
    isAdmin: caller.role === ROLE_ADMIN,
  });
  if (ticket.ticketType === "TOW") {
    throw new ValidationError("Quotes belong to the shop ticket");
  }
  if (finalAmount !== undefined) {
    throw new ValidationError("Walk-in quotes are binding");
  }
  const {amount, workItems} = resolveQuoteAmount({
    quotedAmount,
    items,
    services: shopCatalog,
    free: isWarrantyRework(ticket as never),
    ...(typeof ticket.vehicleClass === "string" ?
      {vehicleClass: ticket.vehicleClass} : {}),
  });
  const amendment = typeof ticket.shopQuotedAmount === "number";
  const quoteStates: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.ESTIMATED,
    STATUS_DISPATCH.EST_APPROVED,
  ]);
  if (amendment) {
    if (ticket.status !== STATUS_DISPATCH.QUOTED) {
      throw new ValidationError("Approved quotes cannot be amended");
    }
  } else if (!quoteStates.has(ticket.status)) {
    throw new ValidationError("Quotes go out on active tickets");
  }
  const version = typeof ticket.quoteVersion === "number" ?
    ticket.quoteVersion :
    0;
  const history = Array.isArray(ticket.quoteHistory) ?
    [...ticket.quoteHistory] :
    [];
  if (amendment) {
    history.push({
      version,
      amount: ticket.shopQuotedAmount as number,
      items: Array.isArray(ticket.quoteItems) ? ticket.quoteItems : [],
      at: typeof ticket.quotedAt === "string" ?
        ticket.quotedAt :
        new Date().toISOString(),
      by: typeof ticket.quotedBy === "string" ? ticket.quotedBy : userId,
    });
  }
  await dispatchRepository.update(ticketId, {
    shopQuotedAmount: amount,
    quoteItems: workItems,
    quoteVersion: version + 1,
    quoteHistory: history,
    ...(workType !== undefined ? {workType} : {}),
    ...(faultPhotos !== undefined ? {faultPhotos} : {}),
    ...(amendment ? {} : {preQuoteStatus: ticket.status}),
    quoteDeclinedAt: null,
    quoteDeclineReason: null,
    quoteExpiredAt: null,
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
    quoteExpiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
  });
  if (!amendment) {
    await dispatchRepository.updateStatus(
      ticketId,
      STATUS_DISPATCH.QUOTED,
      userId,
    );
  }
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    amendment ?
      `Quote updated: ${amount} VND.` :
      `Quote sent: ${amount} VND.`,
    amendment ? "QUOTE_UPDATED" : "QUOTE_SENT",
    {amount, version: version + 1},
  );
  if (!amendment) {
    await enqueueDispatchPush(
      ticketId,
      `-status-${STATUS_DISPATCH.QUOTED}-${version + 1}`,
    );
  }
  return {quoted: true, version: version + 1};
};

export const approveQuote = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider approves the quote");
  }
  if (typeof ticket.quoteApprovedAt === "string" &&
    (ticket.status === STATUS_DISPATCH.IN_PROGRESS ||
      ticket.status === STATUS_DISPATCH.READY)) {
    return {approved: true};
  }
  if (ticket.depositStatus === "REQUESTED") {
    throw new ValidationError("Settle or waive the deposit first");
  }
  if (typeof ticket.quoteExpiresAt === "string" &&
    Date.parse(ticket.quoteExpiresAt) < Date.now()) {
    await expireQuoteNow(ticket);
    throw new ValidationError("Quote expired — request a new quote");
  }
  const quoted = typeof ticket.shopQuotedAmount === "number";
  const pending = ticket.status === STATUS_DISPATCH.QUOTED;
  const legacy = (ticket.status === STATUS_DISPATCH.MATCHED ||
    ticket.status === STATUS_DISPATCH.ARRIVED) && quoted;
  const finalPending = ticket.status === STATUS_DISPATCH.FINAL_QUOTED &&
    typeof ticket.finalAmount === "number";
  const finalLegacy = (ticket.status === STATUS_DISPATCH.IN_SHOP ||
    ticket.status === STATUS_DISPATCH.EST_APPROVED ||
    ticket.status === STATUS_DISPATCH.QUOTED) &&
    typeof ticket.finalAmount === "number";
  if (!pending && !legacy && !finalPending && !finalLegacy) {
    throw new ValidationError("No quote awaiting approval");
  }
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length === 0) {
    throw new ValidationError("Quotes need a shop ticket");
  }
  if (isWarrantyRework(ticket as never)) {
    await dispatchRepository.update(ticketId, {
      paymentArmed: true,
      quoteApprovedAt: new Date().toISOString(),
    });
    await dispatchRepository.updateStatus(
      ticketId,
      STATUS_DISPATCH.IN_PROGRESS,
      userId,
    );
    cacheManager.del(NS);
    await chatService.addSystemEvent(
      ticketId,
      "The rider approved the warranty rework.",
      "QUOTE_APPROVED",
    );
    await enqueueDispatchPush(
      ticketId,
      `-quote-approved-${Date.now()}`,
      {
        audience: "operator",
        urgent: "true",
        title: "Warranty rework approved",
        body: "The rider approved the free warranty rework",
      },
    );
    return {approved: true};
  }
  const payments = await paymentRepository.findByTicket(ticketId);
  let funded = payments.some((p) =>
    (p.method === "CASH" && (p.status === "PENDING" ||
      p.status === "CONFIRMED")) ||
    (p.method === "SEPAY" && (p.status === "HELD" ||
      p.status === "CONFIRMED")));
  const active = payments.some((p) =>
    PAYMENT_ACTIVE_STATUSES.includes(p.status));
  if (!funded && !active) {
    await paymentService.createPaymentForTicket({
      userId,
      ticketId,
      method: "CASH",
    });
    funded = true;
  }
  if (!funded) {
    throw new ValidationError("Payment required before starting work");
  }
  const approved = await approveShopQuoteWork(ticketId, userId);
  if (!approved) {
    throw new ValidationError("No quote awaiting approval");
  }
  return {approved: true};
};

export const declineQuote = async ({
  userId,
  ticketId,
  reason,
}: {
  userId: string;
  ticketId: string;
  reason?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider declines the quote");
  }
  if (ticket.status !== STATUS_DISPATCH.QUOTED) {
    throw new ValidationError("No quote awaiting approval");
  }
  if (ticket.disputeHold === true) {
    throw new ValidationError("Dispute under review");
  }
  if (ticket.ticketType !== "WALK_IN" &&
    ticket.ticketType !== "MECHANIC") {
    throw new ValidationError("Quote decline is shop-ticket-only");
  }
  const quoteStates: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.ESTIMATED,
    STATUS_DISPATCH.EST_APPROVED,
  ]);
  const recorded = typeof ticket.preQuoteStatus === "string" ?
    ticket.preQuoteStatus :
    "";
  const backTo = quoteStates.has(recorded) ?
    recorded :
    ticket.ticketType === "WALK_IN" ?
      STATUS_DISPATCH.MATCHED :
      STATUS_DISPATCH.ARRIVED;
  await dispatchRepository.update(ticketId, {
    shopQuotedAmount: null,
    quoteItems: null,
    invoiceItems: null,
    invoiceAmount: null,
    invoiceApproval: null,
    invoiceApprovedAt: null,
    preQuoteStatus: null,
    quoteDeclinedAt: new Date().toISOString(),
    quoteDeclineReason: typeof reason === "string" &&
      reason.trim() !== "" ? reason.trim() : null,
  });
  try {
    await paymentService.cancelPendingPayments(ticketId);
    const payments = await paymentRepository.findByTicketId(ticketId);
    for (const payment of payments) {
      if (payment.status === "HELD" ||
        payment.status === "CONFIRMED" ||
        payment.status === "PARTIAL") {
        await refundService.requestRefund({
          paymentId: payment.id,
          requestedBy: userId,
          automatic: true,
          reason: "Quote declined",
        });
      }
    }
  } catch {
    void 0;
  }
  await dispatchRepository.updateStatus(
    ticketId,
    backTo,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "Quote declined by the rider.",
    "QUOTE_DECLINED",
    {},
  );
  const now = Date.now();
  await enqueueDispatchPush(
    ticketId,
    `-quote-declined-operator-${now}`,
    {
      audience: "operator",
      urgent: "true",
      title: "Quote declined",
      body: "The rider declined your quote — send a revised quote.",
    },
  );
  return {declined: true, status: backTo};
};

const expireQuoteNow = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<void> => {
  const quoteStates: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.ESTIMATED,
    STATUS_DISPATCH.EST_APPROVED,
  ]);
  const recorded = typeof ticket.preQuoteStatus === "string" ?
    ticket.preQuoteStatus :
    "";
  const backTo = quoteStates.has(recorded) ?
    recorded :
    ticket.ticketType === "WALK_IN" ?
      STATUS_DISPATCH.MATCHED :
      STATUS_DISPATCH.ARRIVED;
  await dispatchRepository.update(ticket.id, {
    shopQuotedAmount: null,
    quoteItems: null,
    invoiceItems: null,
    invoiceAmount: null,
    invoiceApproval: null,
    invoiceApprovedAt: null,
    preQuoteStatus: null,
    quoteExpiresAt: null,
    quoteExpiredAt: new Date().toISOString(),
  });
  await paymentService.cancelPendingPayments(ticket.id)
    .catch(() => undefined);
  try {
    const payments = await paymentRepository.findByTicketId(ticket.id);
    for (const payment of payments) {
      if (payment.status === "HELD" ||
        payment.status === "CONFIRMED" ||
        payment.status === "PARTIAL") {
        await refundService.requestRefund({
          paymentId: payment.id,
          requestedBy: ticket.userId,
          automatic: true,
          reason: "Quote expired",
        });
      }
    }
  } catch {
    void 0;
  }
  await dispatchRepository.updateStatus(ticket.id, backTo, "sweep");
  await chatService.addSystemEvent(
    ticket.id,
    "The quote expired without a rider decision.",
    "QUOTE_EXPIRED",
    {},
  );
  const stamp = Date.now();
  await enqueueDispatchPush(
    ticket.id,
    `-quote-expired-${stamp}`,
    {
      audience: "operator",
      urgent: "true",
      title: "Quote expired",
      body: "The rider did not respond — the ticket is back in your queue.",
    },
  ).catch(() => undefined);
  cacheManager.del(NS);
};

export const sweepExpiredQuotes = async (): Promise<number> => {
  const quoted = await dispatchRepository.findByStatus(
    STATUS_DISPATCH.QUOTED,
    200,
  );
  const now = Date.now();
  let expired = 0;
  for (const ticket of quoted) {
    if (ticket.ticketType !== "WALK_IN" &&
      ticket.ticketType !== "MECHANIC" &&
      ticket.ticketType !== "SOS") continue;
    if (ticket.disputeHold === true) continue;
    const raw = ticket.quoteExpiresAt;
    const expiresAt = typeof raw === "string" ? Date.parse(raw) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt > now) continue;
    if (ticket.ticketType === "SOS") {
      const result = await expireMobileFixQuote(ticket.id);
      if (result.expired) expired += 1;
      continue;
    }
    await expireQuoteNow(ticket);
    expired += 1;
  }
  return expired;
};
