import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {db, FieldValue} from "../../../config/firebase";
import {enqueueDispatchPush} from "../../taskQueueService";
import {autoFile} from "../../disputeService";
import {startWaiting} from "../waiting";
import {NS, SHOP_DECLINE_REASON, TERMINAL_STATUSES} from "../constants";
import {ACCUSED_KIND, DISPUTE_TYPE} from "../../../constants/disputes";


import {ROLE_ADMIN} from "../../../constants/roles";
import {freezeTowLeg} from "../helpers";


import {chatService} from "../../chatService";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";


export const declineDestination = async ({
  userId,
  ticketId,
  reasonCode,
}: {
  userId: string;
  ticketId: string;
  reasonCode?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (typeof ticket.destinationShopId !== "string" ||
    ticket.destinationShopId === "") {
    throw new ValidationError("Ticket has no shop destination");
  }
  if (TERMINAL_STATUSES.has(ticket.status)) {
    throw new ValidationError("Destination is no longer declinable");
  }
  const shop = await providerRepository.findById(
    ticket.destinationShopId as string,
  );
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (shop.operatorUid !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the destination shop declines");
  }
  if (typeof reasonCode !== "string" ||
    !(Object.values(SHOP_DECLINE_REASON) as string[]).includes(reasonCode)) {
    throw new ValidationError("Unknown decline reason");
  }
  const destShopId = ticket.destinationShopId as string;
  const legKm = await freezeTowLeg(ticketId, {
    towLegs: ticket.towLegs,
    towDistanceMeters: ticket.towDistanceMeters,
    assignedShopId: ticket.assignedShopId,
    lat: ticket.lat,
    lng: ticket.lng,
  }, destShopId);
  const declinedPrior = Array.isArray(ticket.declinedShopIds) ?
    [...(ticket.declinedShopIds as string[])] :
    [];
  if (!declinedPrior.includes(destShopId)) declinedPrior.push(destShopId);
  await dispatchRepository.update(ticketId, {
    destinationShopId: null,
    destinationSnapshot: null,
    destinationPoint: null,
    destinationDecline: {
      shopId: destShopId,
      reasonCode,
      by: userId,
      at: new Date().toISOString(),
    },
    needsNewDestination: true,
    etaNotifiedAt: null,
    declinedShopIds: declinedPrior,
    estimateAmount: null,
    estimateNote: null,
    estimateExpiresAt: null,
    estimateApprovedAt: null,
  });
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    try {
      await startWaiting(ticketId);
    } catch {
      return {declined: true, legKm};
    }
  }
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, "-destination-declined", {
    audience: "rider",
    urgent: "true",
    title: "Destination declined",
    body: "The shop can't take your vehicle — pick another drop-off",
  });
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    await enqueueDispatchPush(ticketId, "-destination-declined-operator", {
      audience: "operator",
      title: "Drop-off declined",
      body: "The destination shop declined — await the rider's new drop-off",
    });
  }
  await chatService.addSystemEvent(
    ticketId,
    "The destination shop declined the drop-off. " +
      "The rider is choosing another shop.",
  );
  try {
    await autoFile({
      ticketId,
      reporterUid: ticket.userId,
      accusedKind: ACCUSED_KIND.SHOP,
      accusedId: destShopId,
      reasonCode,
      type: DISPUTE_TYPE.SHOP_DECLINE_DROPOFF,
    });
  } catch {
    return {declined: true, legKm};
  }
  try {
    await db.collection("providers").doc(destShopId).update({
      declineCount: FieldValue.increment(1),
    });
  } catch {
    try {
      await providerRepository.update(destShopId, {declineCount: 1});
    } catch {
      return {declined: true, legKm};
    }
  }
  return {declined: true, legKm};
};

