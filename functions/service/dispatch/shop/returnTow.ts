import * as dispatchRepository from "../../../repository/dispatchRepository";


import {NS} from "../constants";


import {STATUS_DISPATCH} from "../../../constants/status";


import {createDispatch} from "../tickets";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";


export const respondReturnTow = async ({
  userId,
  ticketId,
  accept,
  destinationPoint,
}: {
  userId: string;
  ticketId: string;
  accept: boolean;
  destinationPoint?: {lat: number; lng: number; label?: string};
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider answers the return tow");
  }
  if (ticket.ticketType !== "WALK_IN" ||
    ticket.status !== STATUS_DISPATCH.READY) {
    throw new ValidationError("The walk-in is not ready for a return tow");
  }
  const offer = ticket.returnTowOffer;
  if (!offer || offer.status !== "PENDING") {
    throw new ValidationError("No return tow awaiting an answer");
  }
  if (!accept) {
    await dispatchRepository.update(ticketId, {
      returnTowOffer: {...offer, status: "DECLINED"},
    });
    cacheManager.del(NS);
    return {accepted: false};
  }
  if (!destinationPoint) {
    throw new ValidationError("Rider location is required for a return tow");
  }
  const created = await createDispatch({
    userId,
    ticketType: "TOW",
    lat: ticket.lat,
    lng: ticket.lng,
    destinationPoint,
    ...(typeof ticket.vehicleId === "string" ?
      {vehicleId: ticket.vehicleId} :
      {}),
    vehicleType: ticket.vehicleType ?? undefined,
    vehicleWidth: ticket.vehicleWidth ?? undefined,
    allowVehicleOverlap: true,
    allowMissingVehicle: true,
  });
  const links = Array.isArray(ticket.linkedTicketIds) ?
    ticket.linkedTicketIds as string[] :
    [];
  await dispatchRepository.update(ticketId, {
    returnTowOffer: {...offer, status: "ACCEPTED"},
    linkedTicketIds: [...links.filter((id) => id !== created.id), created.id],
  });
  await dispatchRepository.update(created.id, {
    linkedTicketIds: [ticketId],
  });
  cacheManager.del(NS);
  return {accepted: true, ticketId: created.id};
};

