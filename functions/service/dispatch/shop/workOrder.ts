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


export const updateWorkOrder = async ({
  userId,
  ticketId,
  workType,
  quotedAmount,
  finalAmount,
  invoiceRef,
}: {
  userId: string;
  ticketId: string;
  workType?: string;
  quotedAmount?: number;
  finalAmount?: number;
  invoiceRef?: string;
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
  await dispatchRepository.update(ticketId, {
    ...(workType !== undefined ? {workType} : {}),
    ...(invoiceRef !== undefined ? {invoiceRef} : {}),
  });
  cacheManager.del(NS);
  return {updated: 1};
};
