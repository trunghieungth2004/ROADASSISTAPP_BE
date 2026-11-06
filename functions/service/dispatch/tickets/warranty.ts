import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as warrantyRepository from "../../../repository/warrantyRepository";
import {logError} from "../../../utils/logger";

const DAY_MS = 24 * 60 * 60 * 1000;

export const stampLineWarranties = async (
  ticketId: string,
  ticket: dispatchRepository.DispatchTicket,
): Promise<void> => {
  const hasInvoice = Array.isArray(ticket.invoiceItems) &&
    ticket.invoiceItems.length > 0;
  const hasQuote = Array.isArray(ticket.quoteItems) &&
    ticket.quoteItems.length > 0;
  const now = Date.now();
  let maxUntil = typeof ticket.warrantyUntil === "string" ?
    ticket.warrantyUntil :
    "";
  if (typeof ticket.warrantyDays === "number" && ticket.warrantyDays > 0) {
    const until = new Date(now + ticket.warrantyDays * DAY_MS).toISOString();
    if (maxUntil === "" || until > maxUntil) maxUntil = until;
  }
  if (!hasInvoice && !hasQuote) {
    if (maxUntil !== "" && maxUntil !== ticket.warrantyUntil) {
      await dispatchRepository.update(ticketId, {warrantyUntil: maxUntil});
    }
    await completeWarrantyForTicket(ticketId).catch(() => undefined);
    return;
  }
  const source = hasInvoice ? ticket.invoiceItems : ticket.quoteItems;
  let changed = false;
  const stamped = (source as Array<Record<string, unknown>>).map((item) => {
    if (typeof item !== "object" || item === null) return item;
    if (item.kind !== "SERVICE") return item;
    const days = item.warrantyDays;
    if (typeof days !== "number" || !Number.isInteger(days) || days <= 0) {
      return item;
    }
    const until = new Date(now + days * DAY_MS).toISOString();
    changed = true;
    if (maxUntil === "" || until > maxUntil) maxUntil = until;
    return {...item, warrantyUntil: until};
  });
  if (changed) {
    await dispatchRepository.update(ticketId, {
      ...(hasInvoice ? {invoiceItems: stamped} : {quoteItems: stamped}),
      ...(maxUntil !== "" ? {warrantyUntil: maxUntil} : {}),
    });
  }
  await completeWarrantyForTicket(ticketId).catch(() => undefined);
};

export const stampWarranty = async (
  ticketId: string,
  ticket: dispatchRepository.DispatchTicket,
): Promise<void> => {
  await stampLineWarranties(ticketId, ticket).catch((err) => {
    logError("dispatch", "warranty-stamp-failed", {ticketId}, err);
  });
};

export const completeWarrantyForTicket = async (
  ticketId: string,
): Promise<void> => {
  const claim = await warrantyRepository.findByLinkedTicket(ticketId)
    .catch(() => null);
  if (claim?.status !== "REBOOKED") return;
  await warrantyRepository.update(claim.id, {
    status: "COMPLETED",
    resolvedAt: new Date().toISOString(),
  }).catch(() => undefined);
};
