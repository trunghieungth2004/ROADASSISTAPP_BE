import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as paymentService from "../../paymentService";
import * as refundService from "../../refundService";
import {vehicleClassOf} from "../../providerService";
import {PAYMENT_STATUS} from "../../../constants/payments";
import {STATUS_DISPATCH} from "../../../constants/status";
import {
  freezeTowLeg,
  trackedDeadheadKm,
  trackedLoadedKm,
} from "../helpers";
import {
  actualDeadheadKm,
  isNightFare,
  partialTowFare,
  type TowRates,
} from "../fare";

const settleCancellation = async ({
  ticket,
  userId,
  isRider,
  towRates,
  towFareRates,
}: {
  ticket: dispatchRepository.DispatchTicket;
  userId: string;
  isRider: boolean;
  towRates: TowRates;
  towFareRates: TowRates;
}): Promise<void> => {
  const towerId = ticket.ticketType === "TOW" &&
    typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (towerId !== "") {
    const destId = typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId !== "" ?
      ticket.destinationShopId as string :
      null;
    const prior = ticket.towFare as {
      estimate?: number;
      ceiling?: number;
      loadedKm?: number;
      perKmFee?: number;
      vehicleClass?: string;
    } | null | undefined;
    const tracked = trackedDeadheadKm(ticket, towerId) ?? 0;
    const trackedLoaded = trackedLoadedKm(ticket, towerId) ?? 0;
    await freezeTowLeg(ticket.id, {
      towLegs: ticket.towLegs,
      towDistanceMeters: ticket.towDistanceMeters,
      assignedShopId: ticket.assignedShopId,
      lat: ticket.lat,
      lng: ticket.lng,
    }, destId, tracked);
    const fresh = await dispatchRepository.findById(ticket.id);
    const partialKm = actualDeadheadKm(fresh?.towLegs);
    const partial = partialTowFare({
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleClass: vehicleClassOf(ticket.vehicleType)} :
        {}),
      night: isNightFare(new Date(), towRates.nightWindow),
      deadheadKm: partialKm + trackedLoaded,
      ...(typeof prior?.perKmFee === "number" ?
        {perKmFee: prior.perKmFee} :
        {}),
      rates: towFareRates,
    });
    await dispatchRepository.update(ticket.id, {
      towFare: {
        estimate: typeof prior?.estimate === "number" ? prior.estimate : 0,
        ceiling: typeof prior?.ceiling === "number" ? prior.ceiling : 0,
        final: partial,
        partial: true,
        deadheadKm: partialKm,
        loadedKm: typeof prior?.loadedKm === "number" ? prior.loadedKm : 0,
        night: isNightFare(new Date(), towRates.nightWindow),
        vehicleClass: typeof prior?.vehicleClass === "string" ?
          prior.vehicleClass :
          vehicleClassOf(ticket.vehicleType),
      },
      towActual: {
        quotedKm: typeof prior?.loadedKm === "number" ?
          prior.loadedKm :
          null,
        actualKm: partialKm,
        cappedKm: Math.round(partialKm * 10) / 10,
        loadedTraveledKm: trackedLoaded,
      },
    });
  }
  let payments: paymentRepository.Payment[] = [];
  try {
    payments = await paymentRepository.findByTicketId(ticket.id) ?? [];
  } catch {
    payments = [];
  }
  try {
    await paymentService.cancelPendingPayments(ticket.id);
  } catch {
    void 0;
  }
  try {
    for (const payment of payments ?? []) {
      if (payment.status === PAYMENT_STATUS.HELD ||
        payment.status === PAYMENT_STATUS.CONFIRMED ||
        payment.status === PAYMENT_STATUS.PARTIAL) {
        await refundService.requestRefund({
          paymentId: payment.id,
          requestedBy: userId,
          automatic: true,
          reason: "Ticket closed",
        });
      }
    }
  } catch {
    void 0;
  }
  const preserveTowerCancel = !isRider &&
    ticket.ticketType === "TOW" &&
    towerId === "" &&
    typeof ticket.cancelledBy === "string" &&
    ticket.cancelledBy !== "" &&
    ticket.cancelledBy !== userId;
  if (!preserveTowerCancel) {
    await dispatchRepository.update(ticket.id, {cancelledBy: userId});
  }
};

const createCancellationCharge = async (ticketId: string): Promise<void> => {
  try {
    const ticket = await dispatchRepository.findById(ticketId);
    if (!ticket || ticket.status !== STATUS_DISPATCH.CANCELLED) return;
    if (ticket.ticketType !== "TOW" && ticket.ticketType !== "SOS") return;
    if (ticket.cancelledBy !== ticket.userId) return;
    const billable = paymentService.billableAmountFor(ticket);
    if (!billable || billable.amount <= 0) return;
    const payments = await paymentRepository.findByTicketId(ticketId);
    const hasOpenPayment = (payments ?? []).some((payment) =>
      payment.purpose !== "DEPOSIT" &&
      payment.status !== PAYMENT_STATUS.CANCELLED &&
      payment.status !== PAYMENT_STATUS.REFUNDED);
    if (hasOpenPayment) return;
    await paymentService.createPaymentForTicket({
      userId: ticket.userId,
      ticketId,
      method: "CASH",
    });
  } catch {
    void 0;
  }
};

export {settleCancellation, createCancellationCharge};
