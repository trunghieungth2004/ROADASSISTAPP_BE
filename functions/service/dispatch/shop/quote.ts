import {resolveTicketOperator} from "./helpers";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {enqueueDispatchPush} from "../../taskQueueService";
import {resolveQuoteAmount} from "./items";


import {NS} from "../constants";


import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {PAYMENT_ACTIVE_STATUSES} from "../../../constants/payments";
import {ROLE_ADMIN} from "../../../constants/roles";


import {chatService} from "../../chatService";
import * as paymentService from "../../paymentService";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";


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
  if (caller.role !== ROLE_ADMIN) {
    let shopKind: unknown = null;
    for (const shopId of shopIds) {
      const shop = await providerRepository.findById(shopId);
      if (shop && shop.operatorUid === userId) {
        shopKind = shop.kind;
        break;
      }
    }
    if (shopKind !== PROVIDER_KIND.SHOP) {
      throw new ForbiddenError("Only shops send quotes");
    }
  }
  if (ticket.ticketType === "TOW") {
    throw new ValidationError("Quotes belong to the shop ticket");
  }
  if (finalAmount !== undefined) {
    throw new ValidationError("Walk-in quotes are binding");
  }
  const {amount, workItems} = resolveQuoteAmount({quotedAmount, items});
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
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
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
    "The rider approved the quote.",
    "QUOTE_APPROVED",
  );
  await enqueueDispatchPush(
    ticketId,
    `-quote-approved-${Date.now()}`,
    {
      audience: "operator",
      urgent: "true",
      title: "Quote approved",
      body: "The rider approved your quote — tap to view",
    },
  );
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
        await paymentService.refundPayment({
          paymentId: payment.id,
          adminUid: userId,
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
  return {declined: true};
};
