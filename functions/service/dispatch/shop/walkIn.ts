import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {enqueueDispatchPush} from "../../taskQueueService";


import {NS} from "../constants";


import {
  DECLINE_REASON,
  HELPER_KIND,
  STATUS_DISPATCH,
} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";


import {chatService} from "../../chatService";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";
import {deleteObjects} from "../../../utils/media";


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
    assignedShopId: shopId,
    assignedKind: HELPER_KIND.SHOP,
    status: STATUS_DISPATCH.DECLINED,
    declineReason: reason,
    declineNote: note ?? null,
  }, userId);
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    `The shop declined the request (${reason}).`,
    "DECLINED",
    {reason},
  );
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.DECLINED}`);
  return {declined: true};
};


export const sweepStaleWalkIns = async (): Promise<{cancelled: number}> => {
  const nowIso = new Date().toISOString();
  const stale = await dispatchRepository.findStaleWalkIns(nowIso);
  for (const ticket of stale) {
    await dispatchRepository.updateStatus(
      ticket.id,
      STATUS_DISPATCH.CANCELLED,
      "sweep",
    );
    await deleteObjects(ticket.photoUrls ?? []);
    await enqueueDispatchPush(
      ticket.id,
      `-status-${STATUS_DISPATCH.CANCELLED}`,
    );
    if (typeof ticket.providerId === "string" && ticket.providerId !== "") {
      await enqueueDispatchPush(ticket.id, "-expired-shop", {
        audience: "destination-shop",
        shopId: ticket.providerId as string,
        title: "Walk-in expired",
        body: "The rider's visit request expired",
      });
    }
  }
  if (stale.length > 0) cacheManager.del(NS);
  return {cancelled: stale.length};
};
