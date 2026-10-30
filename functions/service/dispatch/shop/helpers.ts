
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";

import * as paymentService from "../../paymentService";


import {PROVIDER_KIND} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";


import {ForbiddenError, NotFoundError} from "../../../utils/errors";


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


type TicketActors = {
  assignedShopId?: unknown;
  providerId?: unknown;
  assignedUid?: unknown;
  destinationShopId?: unknown;
  ticketType?: unknown;
};

export const resolveTicketOperator = async (
  ticket: TicketActors,
  userId: string,
): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  if (ticket.assignedUid === userId) return;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) return;
  }
  throw new ForbiddenError("Only the helper sends quotes");
};

export const requireDestinationShopOperator = async (
  ticket: TicketActors,
  userId: string,
): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  const destShopId = typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" ?
    ticket.destinationShopId :
    "";
  if (destShopId === "") {
    throw new ForbiddenError(
      "Only the destination shop estimates for this tow",
    );
  }
  const shop = await providerRepository.findById(destShopId);
  if (!shop || shop.operatorUid !== userId ||
    shop.kind !== PROVIDER_KIND.SHOP) {
    throw new ForbiddenError(
      "Only the destination shop estimates for this tow",
    );
  }
};


export const tryRefundPayment = async (
  ticketId: string,
  byUserId: string,
): Promise<void> => {
  try {
    const payments = await paymentRepository.findByTicket(ticketId);
    const refundable = payments.filter((p) =>
      p.method === "SEPAY" && p.status === "HELD");
    for (const payment of refundable) {
      try {
        await paymentService.refundPayment({
          paymentId: payment.id,
          adminUid: byUserId,
          amount: payment.amount,
        });
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
};

export const tryVoidPendingPayments = async (
  ticketId: string,
): Promise<void> => {
  try {
    await paymentService.cancelPendingPayments(ticketId);
  } catch {
    return;
  }
};
