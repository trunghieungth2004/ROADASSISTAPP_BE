import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import {chatService} from "../../chatService";
import {enqueueDispatchPush} from "../../taskQueueService";
import {NS} from "../constants";
import {STATUS_DISPATCH} from "../../../constants/status";
import * as cacheManager from "../../../utils/cacheManager";
import {appendMobileQuoteHistory} from "./history";

const nowIso = (): string => new Date().toISOString();

const approveMobileFixWork = async (
  ticketId: string,
  actor: string,
): Promise<boolean> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket || ticket.ticketType !== "SOS") return false;
  if (ticket.status !== STATUS_DISPATCH.QUOTED) return false;
  if (ticket.disputeHold === true) return false;
  if (typeof ticket.finalAmount !== "number") return false;
  if (typeof ticket.mobileFixApprovedAt === "string") return false;
  await dispatchRepository.update(ticketId, {
    paymentArmed: true,
    mobileFixApprovedAt: nowIso(),
    fulfilledByShopId: ticket.assignedShopId ?? null,
    mobileFixExpiredAt: null,
    quoteHistory: appendMobileQuoteHistory(ticket, {
      status: "APPROVED",
      by: actor,
    }),
    quoteExpiresAt: null,
    quoteExpiredAt: null,
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.IN_PROGRESS,
    actor,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "The rider approved the fix quote.",
    "MOBILE_FIX_APPROVED",
  );
  await enqueueDispatchPush(
    ticketId,
    `-mobile-fix-approved-operator-${Date.now()}`,
    {
      audience: "operator",
      urgent: "true",
      title: "Fix quote approved",
      body: "The rider approved your fix quote — start work",
    },
  );
  return true;
};

const approveShopQuoteWork = async (
  ticketId: string,
  actor: string,
): Promise<boolean> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket || ticket.ticketType === "TOW") return false;
  if (ticket.disputeHold === true) return false;
  if (ticket.status !== STATUS_DISPATCH.QUOTED &&
    ticket.status !== STATUS_DISPATCH.FINAL_QUOTED &&
    ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED) {
    return false;
  }
  if (typeof ticket.quoteApprovedAt === "string") return false;
  if (typeof ticket.shopQuotedAmount !== "number" &&
    typeof ticket.finalAmount !== "number") {
    return false;
  }
  await dispatchRepository.update(ticketId, {
    paymentArmed: true,
    quoteApprovedAt: nowIso(),
    quoteExpiresAt: null,
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.IN_PROGRESS,
    actor,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "The rider approved the quote.",
    "QUOTE_APPROVED",
  );
  const items = Array.isArray(ticket.quoteItems) ? ticket.quoteItems : [];
  const codes = items
    .map((item) => (item as {serviceCode?: unknown}).serviceCode)
    .filter((code): code is string =>
      typeof code === "string" && code !== "");
  const providerId = typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" ?
    ticket.assignedShopId :
    typeof ticket.providerId === "string" ? ticket.providerId : "";
  if (providerId !== "") {
    try {
      await providerRepository.incrementServiceUsage(providerId, codes);
    } catch {
      void 0;
    }
  }
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
  return true;
};

const approvePaidQuote = async (
  ticketId: string,
  actor: string,
): Promise<boolean> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return false;
  if (ticket.ticketType === "SOS") {
    return approveMobileFixWork(ticketId, actor);
  }
  return approveShopQuoteWork(ticketId, actor);
};

export {approveMobileFixWork, approveShopQuoteWork, approvePaidQuote};
