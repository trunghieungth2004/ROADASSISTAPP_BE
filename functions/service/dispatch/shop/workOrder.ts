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
import * as refundService from "../../refundService";
import * as paymentService from "../../paymentService";
import {
  freePricedItems,
  normalizeWorkItems,
  workItemsTotal,
} from "./items";
import {isWarrantyRework} from "../../warrantyRework";


const resolveWorkShop = async (
  shopIds: string[],
  userId: string,
): Promise<{isOperator: boolean; kind: unknown; services: unknown[]}> => {
  let isOperator = false;
  let kind: unknown = null;
  let services: unknown[] = [];
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      kind = shop.kind;
      services = Array.isArray(shop.services) ? shop.services : [];
      break;
    }
  }
  if (services.length === 0 && shopIds.length > 0) {
    const fallback = await providerRepository.findById(shopIds[0]);
    services = Array.isArray(fallback?.services) ? fallback.services : [];
  }
  return {isOperator, kind, services};
};

export const updateWorkOrder = async ({
  userId,
  ticketId,
  workType,
  quotedAmount,
  finalAmount,
  invoiceRef,
  warrantyDays,
  items,
}: {
  userId: string;
  ticketId: string;
  workType?: string;
  quotedAmount?: number;
  finalAmount?: number;
  invoiceRef?: string;
  warrantyDays?: number;
  items?: unknown;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  const shop = await resolveWorkShop(shopIds, userId);
  const isOperator = shop.isOperator;
  const operatedKind = shop.kind;
  const shopCatalog = shop.services;
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
  const normalizedItems = items === undefined ?
    null :
    normalizeWorkItems(items, {
      services: shopCatalog as never,
      allowExtras: true,
      free: isWarrantyRework(ticket as never),
      ...(typeof ticket.vehicleClass === "string" ?
        {vehicleClass: ticket.vehicleClass} : {}),
    });
  const invoiceItems = isWarrantyRework(ticket as never) ?
    freePricedItems(normalizedItems) :
    normalizedItems;
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
      const depositCredit = paymentService.depositCreditFor(
        ticket as never,
      );
      await paymentService.adjustPendingCashAmount({
        ticketId,
        amount: Math.max(0, total - depositCredit),
        ticketType: ticket.ticketType,
      });
      if (depositCredit > total) {
        const payments = await paymentRepository.findByTicketId(ticketId);
        const deposit = payments.find((payment) =>
          payment.purpose === "DEPOSIT" &&
          (payment.status === "HELD" || payment.status === "CONFIRMED"));
        if (deposit) {
          await refundService.requestRefund({
            paymentId: deposit.id,
            requestedBy: ticket.userId,
            amount: depositCredit - total,
            reason: "Deposit exceeds the final invoice",
            automatic: true,
          }).catch(() => undefined);
        }
      }
      invoiceApproval = "PENDING";
    }
  }
  await dispatchRepository.update(ticketId, {
    ...(workType !== undefined ? {workType} : {}),
    ...(invoiceRef !== undefined ? {invoiceRef} : {}),
    ...(warrantyDays !== undefined ? {warrantyDays} : {}),
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
