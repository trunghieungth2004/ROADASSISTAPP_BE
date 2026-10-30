import * as dispatchRepository from "../../../repository/dispatchRepository";


import {enqueueDispatchPush} from "../../taskQueueService";


import {stopWaiting} from "../waiting";
import {NS} from "../constants";


import {resolveDestination} from "../helpers";

import {stampTowFare} from "../fare";

import {stampTowEta} from "../accept";

import {STATUS_DISPATCH} from "../../../constants/status";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";

import * as cacheManager from "../../../utils/cacheManager";


export const updateDispatchDestination = async ({userId,
  ticketId,
  destinationShopId,
  destinationPoint,
}: {
  userId: string;
  ticketId: string;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider edits the destination");
  }
  if (
    ticket.status !== STATUS_DISPATCH.PENDING &&
    ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED
  ) {
    throw new ValidationError("Ticket is no longer editable");
  }
  if (!destinationShopId && !destinationPoint) {
    throw new ValidationError("A destination needs a shop or a point");
  }
  if (ticket.ticketType === "WALK_IN") {
    throw new ValidationError("Walk-in tickets have no editable destination");
  }
  if (typeof destinationShopId === "string" && destinationShopId !== "") {
    const legs = Array.isArray(ticket.towLegs) ? ticket.towLegs : [];
    const refused = legs.some((leg) =>
      typeof leg === "object" && leg !== null &&
      (leg as {toShopId?: unknown}).toShopId === destinationShopId);
    if (refused) {
      throw new ValidationError("Shop already declined this ticket");
    }
    if (Array.isArray(ticket.declinedShopIds) &&
      (ticket.declinedShopIds as string[]).includes(destinationShopId)) {
      throw new ValidationError("Shop already declined this ticket");
    }
  }
  const prevShopId = typeof ticket.destinationShopId === "string" ?
    ticket.destinationShopId :
    "";
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticket.ticketType as string,
    ticket.vehicleType ?? undefined,
    prevShopId !== "" && prevShopId === destinationShopId,
  );
  await dispatchRepository.update(ticketId, {
    destinationShopId: destinationShopId ?? null,
    destinationPoint: destinationPoint ?? null,
    destinationSnapshot: destinationSnapshot ?? null,
    destinationDecline: null,
    needsNewDestination: false,
    estimateAmount: null,
    estimateNote: null,
    estimateExpiresAt: null,
    estimateApprovedAt: null,
  });
  try {
    await stopWaiting(ticketId);
  } catch {
    return dispatchRepository.findById(ticketId);
  }
  cacheManager.del(NS);
  if ((ticket.status === STATUS_DISPATCH.MATCHED ||
    ticket.status === STATUS_DISPATCH.ARRIVED) &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    await stampTowEta(ticketId, {
      lat: ticket.lat,
      lng: ticket.lng,
      vehicleType: ticket.vehicleType,
      destinationShopId: destinationShopId ?? null,
      destinationPoint: destinationPoint ?? null,
    }, ticket.assignedShopId as string);
    await stampTowFare(ticketId, {
      lat: ticket.lat,
      lng: ticket.lng,
      vehicleType: ticket.vehicleType,
      destinationShopId: destinationShopId ?? null,
      destinationPoint: destinationPoint ?? null,
      towFare: ticket.towFare ?? null,
    }, ticket.assignedShopId as string);
  }
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    const dest = destinationSnapshot as {name?: unknown} | null;
    const name = dest !== null && typeof dest.name === "string" ?
      dest.name :
      null;
    await enqueueDispatchPush(ticketId, "-destination-updated", {
      audience: "operator",
      title: "Drop-off updated",
      body: name !== null ?
        `The rider changed the drop-off to ${name}` :
        "The rider changed the drop-off — tap to view",
    });
  }
  if (typeof destinationShopId === "string" && destinationShopId !== "") {
    await enqueueDispatchPush(
      ticketId,
      `-destination-shop-${destinationShopId}`,
      {
        audience: "destination-shop",
        shopId: destinationShopId,
        title: "Incoming tow",
        body: "A rider picked your shop as drop-off — tap to view",
      },
    );
  }
  if (prevShopId !== "" && prevShopId !== (destinationShopId ?? "")) {
    await enqueueDispatchPush(ticketId, `-dropped-${prevShopId}`, {
      audience: "destination-shop",
      shopId: prevShopId,
      urgent: "true",
      title: "Drop-off changed",
      body: "Your shop is no longer the drop-off for this tow",
    });
  }
  return dispatchRepository.findById(ticketId);
};

