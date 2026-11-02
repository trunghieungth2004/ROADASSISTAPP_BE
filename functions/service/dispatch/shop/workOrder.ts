import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {NS} from "../constants";


import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as paymentService from "../../paymentService";
import {normalizeWorkItems, workItemsTotal} from "./items";


export const updateWorkOrder = async ({
  userId,
  ticketId,
  workType,
  quotedAmount,
  finalAmount,
  invoiceRef,
  items,
}: {
  userId: string;
  ticketId: string;
  workType?: string;
  quotedAmount?: number;
  finalAmount?: number;
  invoiceRef?: string;
  items?: unknown;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  let isOperator = false;
  let operatedKind: unknown = null;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      operatedKind = shop.kind;
      break;
    }
  }
  if (!isOperator && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates the work order");
  }
  if (operatedKind !== PROVIDER_KIND.SHOP && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only shops update work orders");
  }
  const editable: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_PROGRESS,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.QUOTED,
    STATUS_DISPATCH.FINAL_QUOTED,
    STATUS_DISPATCH.ESTIMATED,
    STATUS_DISPATCH.EST_APPROVED,
  ]);
  if (!editable.has(ticket.status)) {
    throw new ValidationError("Work order is no longer editable");
  }
  if (quotedAmount !== undefined || finalAmount !== undefined) {
    throw new ValidationError("Quote amounts are sent via the quote endpoint");
  }
  const invoiceItems = items === undefined ? null : normalizeWorkItems(items);
  let invoiceAmount = typeof ticket.shopQuotedAmount === "number" ?
    ticket.shopQuotedAmount :
    null;
  let invoiceApproval: string | null = null;
  if (invoiceItems !== null) {
    const total = workItemsTotal(invoiceItems);
    invoiceAmount = total;
    invoiceApproval = "APPROVED";
    if (typeof ticket.shopQuotedAmount === "number" &&
      total !== ticket.shopQuotedAmount) {
      const payments = await paymentRepository.findByTicketId(ticketId);
      const funded = payments.some((p) =>
        (p.method === "CASH" && p.status === "CONFIRMED") ||
        (p.method === "SEPAY" &&
          (p.status === "HELD" || p.status === "CONFIRMED")));
      if (funded) {
        throw new ValidationError(
          "Invoice is already funded — contact support to adjust",
        );
      }
      await paymentService.adjustPendingCashAmount({
        ticketId,
        amount: total,
        ticketType: ticket.ticketType,
      });
      invoiceApproval = "PENDING";
    }
  }
  await dispatchRepository.update(ticketId, {
    ...(workType !== undefined ? {workType} : {}),
    ...(invoiceRef !== undefined ? {invoiceRef} : {}),
    ...(invoiceItems !== null ? {
      invoiceItems,
      ...(invoiceAmount !== null ? {invoiceAmount} : {}),
      ...(invoiceApproval !== null ? {invoiceApproval} : {}),
      invoiceVersion: (typeof ticket.invoiceVersion === "number" ?
        ticket.invoiceVersion :
        0) + 1,
      invoiceApprovedAt: invoiceApproval === "APPROVED" ?
        new Date().toISOString() :
        null,
    } : {}),
  });
  cacheManager.del(NS);
  return {updated: 1};
};

export const approveInvoice = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider approves the invoice");
  }
  if (ticket.invoiceApproval !== "PENDING") {
    throw new ValidationError("No invoice awaiting approval");
  }
  await dispatchRepository.update(ticketId, {
    invoiceApproval: "APPROVED",
    invoiceApprovedAt: new Date().toISOString(),
  });
  cacheManager.del(NS);
  return {approved: true};
};
