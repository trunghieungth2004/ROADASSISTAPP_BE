import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as paymentService from "../../paymentService";
import * as refundService from "../../refundService";
import {chatService} from "../../chatService";
import {enqueueDispatchPush} from "../../taskQueueService";
import {NS} from "../constants";
import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";
import {PAYMENT_STATUS} from "../../../constants/payments";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";

const RELEASABLE = new Set<string>([
  STATUS_DISPATCH.PENDING,
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.ARRIVED,
  STATUS_DISPATCH.QUOTED,
]);

const RECEIVED: string[] = [
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.CONFIRMED,
  PAYMENT_STATUS.PARTIAL,
];

export const releaseTicket = async ({
  userId,
  ticketId,
  reason,
}: {
  userId: string;
  ticketId: string;
  reason?: string;
}): Promise<{released: boolean}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "WALK_IN" &&
    ticket.ticketType !== "MECHANIC" &&
    ticket.ticketType !== "SOS") {
    throw new ValidationError("Only shop tickets can be released");
  }
  if (!RELEASABLE.has(String(ticket.status))) {
    throw new ValidationError("Work already started; use unfixable");
  }
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
  let shop = null;
  for (const shopId of shopIds) {
    const row = await providerRepository.findById(shopId);
    if (row && row.operatorUid === userId) {
      shop = row;
      break;
    }
  }
  if (!shop && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the assigned shop releases the job");
  }
  if (shop && shop.kind !== PROVIDER_KIND.SHOP &&
    shop.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ValidationError("Only shops can release a job");
  }
  await paymentService.cancelPendingPayments(ticketId)
    .catch(() => undefined);
  const payments = await paymentRepository.findByTicketId(ticketId);
  for (const payment of payments) {
    if (!RECEIVED.includes(payment.status)) continue;
    try {
      await refundService.requestRefund({
        paymentId: payment.id,
        requestedBy: userId,
        automatic: true,
        reason: "Shop released the job",
      });
    } catch {
      continue;
    }
  }
  await dispatchRepository.update(ticketId, {
    releaseReason: typeof reason === "string" && reason.trim() !== "" ?
      reason.trim() :
      null,
    releasedBy: userId,
    releasedAt: new Date().toISOString(),
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.CANCELLED,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "The shop released this job.",
    "SHOP_RELEASED",
    {reason: typeof reason === "string" ? reason : ""},
  );
  await enqueueDispatchPush(ticketId, "-shop-released", {
    audience: "rider",
    title: "Shop released the job",
    body: "Pick another shop or contact support.",
  }).catch(() => undefined);
  return {released: true};
};
