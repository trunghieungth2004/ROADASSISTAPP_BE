import {resolveTicketOperator} from "./helpers";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {enqueueDispatchPush} from "../../taskQueueService";


import {NS} from "../constants";


import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";


import {chatService} from "../../chatService";


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
}: {
  userId: string;
  ticketId: string;
  quotedAmount?: number;
  finalAmount?: number;
  workType?: string;
  faultPhotos?: string[];
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
  if (quotedAmount === undefined) {
    throw new ValidationError("Quote needs an amount");
  }
  if (!Number.isInteger(quotedAmount) || quotedAmount < 0) {
    throw new ValidationError("Quote must be a non-negative integer");
  }
  const quoteStates: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.ESTIMATED,
    STATUS_DISPATCH.EST_APPROVED,
  ]);
  if (!quoteStates.has(ticket.status)) {
    throw new ValidationError("Quotes go out on active tickets");
  }
  if (typeof ticket.shopQuotedAmount === "number") {
    throw new ValidationError("Quote already sent");
  }
  await dispatchRepository.update(ticketId, {
    shopQuotedAmount: quotedAmount,
    ...(workType !== undefined ? {workType} : {}),
    ...(faultPhotos !== undefined ? {faultPhotos} : {}),
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.QUOTED,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    `Quote sent: ${quotedAmount} VND.`,
    "QUOTE_SENT",
    {amount: quotedAmount},
  );
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.QUOTED}`);
  return {quoted: true};
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
  const funded = payments.some((p) =>
    (p.method === "CASH" && (p.status === "PENDING" ||
      p.status === "CONFIRMED")) ||
    (p.method === "SEPAY" && (p.status === "HELD" ||
      p.status === "CONFIRMED")));
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
    `-status-${STATUS_DISPATCH.IN_PROGRESS}-operator`,
    {
      audience: "operator",
      title: "Quote approved",
      body: "The rider approved your quote — tap to view",
    },
  );
  return {approved: true};
};
