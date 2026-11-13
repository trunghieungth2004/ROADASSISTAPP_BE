import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as bookingRepository from "../../../repository/bookingRepository";

import {NS} from "../constants";

import {STATUS_DISPATCH} from "../../../constants/status";
import {PAYMENT_METHOD, PAYMENT_STATUS} from "../../../constants/payments";

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
    (ticket.status !== STATUS_DISPATCH.READY &&
      ticket.status !== STATUS_DISPATCH.UNFIXABLE)) {
    throw new ValidationError("The walk-in is not ready for a return tow");
  }
  const existing = ticket.returnTowOffer;
  if (existing && existing.status !== "PENDING") {
    throw new ValidationError("No return tow awaiting an answer");
  }
  const offer = existing ?? {
    status: "PENDING",
    shopId: typeof ticket.assignedShopId === "string" &&
      ticket.assignedShopId !== "" ?
      ticket.assignedShopId :
      typeof ticket.providerId === "string" ? ticket.providerId : "",
    by: userId,
    at: new Date().toISOString(),
  };
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
  const payments = await paymentRepository.findByTicketId(ticketId);
  const unconfirmedCash = payments.some((payment) =>
    payment.method === PAYMENT_METHOD.CASH &&
    (payment.status === PAYMENT_STATUS.PENDING ||
      payment.status === PAYMENT_STATUS.PARTIAL));
  if (unconfirmedCash) {
    throw new ValidationError(
      "Confirm the repair cash payment before requesting a return tow",
    );
  }
  const created = await createDispatch({
    userId,
    ticketType: "TOW",
    lat: ticket.lat,
    lng: ticket.lng,
    destinationPoint,
    towKind: "RETURN",
    sourceTicketId: ticketId,
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
    ...(typeof ticket.bookingId === "string" && ticket.bookingId !== "" ?
      {bookingId: ticket.bookingId} :
      {}),
  });
  if (typeof ticket.bookingId === "string" && ticket.bookingId !== "") {
    const booking = await bookingRepository.findById(ticket.bookingId);
    if (booking) {
      const bookingLinks = Array.isArray(booking.linkedTicketIds) ?
        booking.linkedTicketIds as string[] :
        [];
      await bookingRepository.update(booking.id, {
        linkedTicketIds: [...new Set([...bookingLinks, created.id])],
      });
    }
  }
  cacheManager.del(NS);
  return {accepted: true, ticketId: created.id};
};
