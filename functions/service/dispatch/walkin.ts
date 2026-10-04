import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import {enqueueDispatchPush} from "../taskQueueService";
import {NS} from "./constants";
import {
  DECLINE_REASON,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";

export const declineDispatch = async ({
  userId,
  ticketId,
  shopId,
  reason,
  note,
}: {
  userId: string;
  ticketId: string;
  shopId: string;
  reason: string;
  note?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "WALK_IN") {
    throw new ValidationError("Only walk-in tickets are declined");
  }
  if (!(Object.values(DECLINE_REASON) as string[]).includes(reason)) {
    throw new ValidationError("Unknown decline reason");
  }
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = shop.operatorUid as string | null;
  if (operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator declines for this provider");
  }
  if (ticket.providerId !== shopId) {
    throw new ForbiddenError("Ticket is addressed to another provider");
  }
  const claimed = await dispatchRepository.claimForAssignment(ticketId, {
    status: STATUS_DISPATCH.DECLINED,
    declineReason: reason,
    declineNote: note ?? null,
  });
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.DECLINED}`);
  return {declined: true};
};


export const resolveShopOperator = async (
  userId: string,
  shopId: string,
): Promise<void> => {
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (shop.operatorUid !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator views this shop");
  }
};


export const sweepStaleWalkIns = async (): Promise<{cancelled: number}> => {
  const nowIso = new Date().toISOString();
  const stale = await dispatchRepository.findStaleWalkIns(nowIso);
  for (const ticket of stale) {
    await dispatchRepository.updateStatus(
      ticket.id,
      STATUS_DISPATCH.CANCELLED,
    );
    await enqueueDispatchPush(
      ticket.id,
      `-status-${STATUS_DISPATCH.CANCELLED}`,
    );
  }
  if (stale.length > 0) cacheManager.del(NS);
  return {cancelled: stale.length};
};


export const shopRequests = async ({
  userId,
  shopId,
}: {
  userId: string;
  shopId: string;
}) => {
  await resolveShopOperator(userId, shopId);
  return dispatchRepository.findPendingForShop(shopId);
};


export const shopRecords = async ({
  userId,
  shopId,
  limit = 20,
}: {
  userId: string;
  shopId: string;
  limit?: number;
}) => {
  await resolveShopOperator(userId, shopId);
  return dispatchRepository.findRecentForShop(shopId, limit);
};


export const feedTickets = async ({
  userId,
  limit = 50,
}: {
  userId: string;
  limit?: number;
}) => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const out = await dispatchRepository.findByUserId(userId, limit);
  const inbound: Array<Record<string, unknown>> = [];
  const operated = await providerRepository.findByOperator(userId);
  for (const provider of operated) {
    if ((provider.status as string) === PROVIDER_STATUS.DENIED) continue;
    const [pending, recent] = await Promise.all([
      dispatchRepository.findPendingForShop(provider.id),
      dispatchRepository.findRecentForShop(provider.id, limit),
    ]);
    for (const ticket of [...pending, ...recent]) {
      if (ticket.userId !== userId) {
        inbound.push({...ticket, direction: "in"});
      }
    }
  }
  const assisted = await dispatchRepository.findByAssignee(userId, limit);
  for (const ticket of assisted) {
    if (ticket.userId !== userId) {
      inbound.push({...ticket, direction: "in"});
    }
  }
  const seen = new Set(out.map((t) => t.id));
  const merged: Array<Record<string, unknown>> = [
    ...out.map((t) => ({...t, direction: "out"})),
  ];
  for (const ticket of inbound) {
    const id = ticket.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(ticket);
  }
  merged.sort((a, b) =>
    String(b.createdAt ?? "") < String(a.createdAt ?? "") ? -1 : 1,
  );
  return merged.slice(0, limit);
};


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
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      break;
    }
  }
  if (!isOperator && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates the work order");
  }
  if (ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED &&
    ticket.status !== STATUS_DISPATCH.IN_PROGRESS) {
    throw new ValidationError("Work order is no longer editable");
  }
  await dispatchRepository.update(ticketId, {
    ...(workType !== undefined ? {workType} : {}),
    ...(quotedAmount !== undefined ? {shopQuotedAmount: quotedAmount} : {}),
    ...(finalAmount !== undefined ? {finalAmount} : {}),
    ...(invoiceRef !== undefined ? {invoiceRef} : {}),
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
  });
  cacheManager.del(NS);
  return {updated: 1};
};
