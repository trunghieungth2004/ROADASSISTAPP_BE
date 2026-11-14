import {spawnShopTicket} from "./tow";
import {assertTransition} from "./assertTransition";
export {assertTransition} from "./assertTransition";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import {enqueueDispatchPush} from "../../taskQueueService";
import {chatService} from "../../chatService";
import {stampWarranty} from "./warranty";
import {haversineMeters} from "../../../utils/geo";
import {startWaiting, stopWaiting} from "../waiting";
import {
  NS, TOWER_CANCEL_SOURCE, VALID_STATUSES, ARRIVAL_RADIUS_M,
} from "../constants";
import {loadedTrackDistance} from "../helpers";
import {schedulePaymentReminder} from "../../paymentReminderService";
import {assertNearTowDestination} from "./deliveryGuard";
import {
  DEFAULT_TOW_RATES, quoteTowFare, towRatesForProvider,
  type TowFareQuote,
} from "../fare";
import * as paymentService from "../../paymentService";
import {rematchTow} from "./towRematch";
import {
  createCancellationCharge,
  settleCancellation,
} from "./cancellation";
import {providerBlocked} from "../providerEligibility";
import * as platformConfigService from "../../platformConfigService";
import {
  PROVIDER_KIND, PROVIDER_STATUS, PROVIDER_FRESH_MS, STATUS_DISPATCH,
} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";
import {
  ForbiddenError, NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";
import {logError} from "../../../utils/logger";
export const updateDispatchStatus = async ({
  id,
  status,
  userId,
  lat,
  lng,
  reasonCode,
}: {
  id: string;
  status: string;
  userId: string;
  lat?: number;
  lng?: number;
  reasonCode?: string;
}) => {
  if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError("Invalid dispatch status");
  }
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const towRates = await platformConfigService.getTowRates()
    .catch(() => DEFAULT_TOW_RATES);
  const towShop = ticket.ticketType === "TOW" &&
    typeof ticket.assignedShopId === "string" ?
    await providerRepository.findById(ticket.assignedShopId) : null;
  const towFareRates = towShop?.kind === PROVIDER_KIND.TOW ?
    towRatesForProvider(towRates, towShop) : towRates;
  const isRider = ticket.userId === userId;
  if (isRider && status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "SOS" &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" && typeof ticket.finalAmount !== "number") {
    throw new ValidationError("The mobile shop must set the fix fee first");
  }
  const isAssignee = ticket.assignedUid === userId;
  let isOperator = false;
  let operatorShopId = "";
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      operatorShopId = shopId;
      break;
    }
  }
  const isAdmin = caller.role === ROLE_ADMIN;
  if (ticket.disputeHold === true && !isAdmin) {
    throw new ForbiddenError("Dispute under review");
  }
  if (status === STATUS_DISPATCH.IN_PROGRESS &&
    ticket.depositStatus === "REQUESTED" && !isAdmin) {
    throw new ValidationError(
      "Settle or waive the deposit before starting work",
    );
  }
  if (!isRider && !isAssignee && !isOperator && !isAdmin) {
    throw new ForbiddenError("Only the rider, helper, or operator updates");
  }
  const destinationId = typeof ticket.destinationShopId === "string" ?
    ticket.destinationShopId :
    "";
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" && destinationId !== "") {
    const destination = await providerRepository.findById(destinationId);
    if (!destination ||
      destination.status !== PROVIDER_STATUS.ACTIVE ||
      (destination as {suspended?: boolean}).suspended === true) {
      throw new ValidationError(
        "Destination shop is no longer available — choose another drop-off",
      );
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.invoiceApproval === "PENDING") {
    throw new ValidationError("Approve the updated invoice first");
  }
  if (status === STATUS_DISPATCH.RESOLVED) {
    await assertNearTowDestination(ticket as never);
    await paymentService.assertCashConfirmedForResolve({
      ticketId: id,
      ticketType: ticket.ticketType,
      isAdmin,
    });
  }
  assertTransition({
    ticket: {
      status: ticket.status,
      ticketType: ticket.ticketType,
      shopQuotedAmount: ticket.shopQuotedAmount,
    },
    status,
    isRider,
    isOperator,
    isAssignee,
    isAdmin,
  });
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    ticket.status === STATUS_DISPATCH.ARRIVED &&
    !isAdmin &&
    (typeof ticket.loadedAt !== "string" || ticket.loadedAt === "")) {
    throw new ValidationError("Mark loaded before delivering");
  }
  if (status === STATUS_DISPATCH.ARRIVED &&
    (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") &&
    (isRider ||
      (ticket.ticketType === "TOW" && (isOperator || isAssignee)))) {
    const providerId = typeof ticket.assignedShopId === "string" &&
      ticket.assignedShopId !== "" ?
      ticket.assignedShopId :
      typeof ticket.providerId === "string" ? ticket.providerId : "";
    if (providerId !== "") {
      const fixes = await providerLocationRepository.findByIds([providerId]);
      const fix = fixes.get(providerId);
      if (fix &&
        typeof fix.lat === "number" &&
        typeof fix.lng === "number" &&
        typeof fix.lastSeen === "string" &&
        Date.now() - Date.parse(fix.lastSeen) < PROVIDER_FRESH_MS) {
        const meters = Math.round(
          haversineMeters(ticket.lat, ticket.lng, fix.lat, fix.lng),
        );
        if (meters > ARRIVAL_RADIUS_M) {
          throw new ValidationError(
            "Too far from the pickup point to mark arrival",
          );
        }
      }
    }
  }
  if (status === STATUS_DISPATCH.READY && ticket.ticketType === "SOS" &&
    typeof ticket.finalAmount !== "number") {
    throw new ValidationError("The mobile shop must set the fix fee first");
  }
  const engagedTow = ticket.ticketType === "TOW" &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" &&
    (ticket.status === STATUS_DISPATCH.MATCHED ||
      ticket.status === STATUS_DISPATCH.ARRIVED);
  const towerCancel = (isOperator || isAssignee) && !isRider && engagedTow &&
    status === STATUS_DISPATCH.CANCELLED;
  if (towerCancel) {
    return rematchTow({
      ticket,
      userId,
      reasonCode: typeof reasonCode === "string" ? reasonCode : "",
      lat,
      lng,
      pickupReason: TOWER_CANCEL_SOURCE.STATUS,
    });
  }
  if (status === STATUS_DISPATCH.CANCELLED) {
    await settleCancellation({
      ticket,
      userId,
      isRider,
      towRates,
      towFareRates,
    });
  }
  await dispatchRepository.updateStatus(id, status, userId);
  if (status === STATUS_DISPATCH.CANCELLED) {
    await createCancellationCharge(id);
  }
  await schedulePaymentReminder(id, {...ticket, status} as never);
  if (status === STATUS_DISPATCH.RESOLVED) {
    await stampWarranty(id, ticket);
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    (isOperator || isAssignee)) {
    await dispatchRepository.update(id, {
      deliveredAt: new Date().toISOString(),
      deliveredBy: userId,
      receivedAt: null,
    });
  }
  await chatService.addSystemEvent(
    id,
    `Status changed: ${ticket.status} -> ${status}`,
    "STATUS_CHANGED",
    {from: String(ticket.status), to: status},
  );
  if (status === STATUS_DISPATCH.READY) {
    await dispatchRepository.update(id, {
      fulfilledByShopId: ticket.assignedShopId ?? null,
      ...(ticket.ticketType === "WALK_IN" ?
        {
          returnTowOffer: {
            status: "PENDING",
            shopId: typeof ticket.assignedShopId === "string" ?
              ticket.assignedShopId :
              "",
            by: userId,
            at: new Date().toISOString(),
          },
        } :
        {}),
    });
    if (ticket.ticketType === "WALK_IN") {
      await enqueueDispatchPush(id, "-return-tow-offer", {
        audience: "rider",
        title: "Vehicle ready",
        body: "Your vehicle is ready — tow it back to you?",
      });
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW") {
    const links = Array.isArray(ticket.linkedTicketIds) ?
      ticket.linkedTicketIds as string[] :
      [];
    for (const linkedId of links) {
      try {
        const linked = await dispatchRepository.findById(linkedId);
        if (linked && linked.ticketType === "WALK_IN" &&
          linked.status === STATUS_DISPATCH.READY &&
          linked.invoiceApproval !== "PENDING") {
          try {
            await paymentService.assertCashConfirmedForResolve({
              ticketId: linked.id,
              ticketType: linked.ticketType,
              isAdmin,
            });
            await dispatchRepository.updateStatus(
              linked.id,
              STATUS_DISPATCH.RESOLVED,
              userId,
            );
            await stampWarranty(linked.id, linked);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED ||
    status === STATUS_DISPATCH.CANCELLED) {
    await dispatchRepository.update(id, {
      etaPickupAt: null,
      etaDropoffAt: null,
      etaNotifiedAt: null,
    });
    try {
      await stopWaiting(id);
    } catch {
      return {updated: 1};
    }
  }
  if (status === STATUS_DISPATCH.IN_PROGRESS ||
    status === STATUS_DISPATCH.READY) {
    try {
      await stopWaiting(id);
    } catch {
      return {updated: 1};
    }
  }
  if (status === STATUS_DISPATCH.ARRIVED && ticket.ticketType === "TOW" &&
    ticket.towKind !== "RETURN" &&
    typeof ticket.assignedShopId === "string" && ticket.assignedShopId !== "") {
    try {
      await startWaiting(id);
    } catch {
      return {updated: 1};
    }
  }
  cacheManager.del(NS);
  const towerTowEvent = ticket.ticketType === "TOW" &&
    (isOperator || isAssignee) &&
    (status === STATUS_DISPATCH.ARRIVED ||
      status === STATUS_DISPATCH.RESOLVED);
  if (!towerTowEvent && (
    status === STATUS_DISPATCH.MATCHED ||
    status === STATUS_DISPATCH.ARRIVED ||
    status === STATUS_DISPATCH.RESOLVED ||
    status === STATUS_DISPATCH.IN_PROGRESS ||
    status === STATUS_DISPATCH.READY ||
    status === STATUS_DISPATCH.DECLINED
  )) {
    await enqueueDispatchPush(id, `-status-${status}`);
  }
  if (towerTowEvent) {
    const arrived = status === STATUS_DISPATCH.ARRIVED;
    const returnTow = ticket.towKind === "RETURN";
    await enqueueDispatchPush(
      id,
      arrived ? "-tow-arrived-rider" : "-tow-delivered-rider",
      {
        audience: "rider",
        urgent: "true",
        title: arrived ?
          (returnTow ? "Tow arrived at hangar" : "Tow arrived at pickup") :
          (returnTow ? "Delivered to rider" : "Tow delivered"),
        body: arrived ?
          (returnTow ?
            "The tower arrived at the hangar — tap to view" :
            "The tower arrived at the pickup — tap to view") :
          "The vehicle was delivered — confirm receipt",
      },
    );
  }
  if (!towerTowEvent && (
    status === STATUS_DISPATCH.ARRIVED ||
    status === STATUS_DISPATCH.RESOLVED)) {
    const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    if (shopIds.length > 0) {
      const arrived = status === STATUS_DISPATCH.ARRIVED;
      await enqueueDispatchPush(id, `-status-${status}-operator`, {
        audience: "operator",
        urgent: "true",
        title: arrived ? "Arrival confirmed" : "Ticket resolved",
        body: arrived ?
          "The rider confirmed arrival — tap to view" :
          "The rider closed this ticket — tap to view",
      });
    }
  }
  if (status === STATUS_DISPATCH.CANCELLED) {
    if (ticket.ticketType === "TOW" &&
      ticket.towKind === "RETURN" &&
      ticket.status !== STATUS_DISPATCH.ARRIVED) {
      const links = Array.isArray(ticket.linkedTicketIds) ?
        ticket.linkedTicketIds as string[] :
        [];
      for (const linkedId of links) {
        const linked = await dispatchRepository.findById(linkedId);
        if (!linked || linked.ticketType !== "WALK_IN" ||
          (linked.status !== STATUS_DISPATCH.READY &&
            linked.status !== STATUS_DISPATCH.UNFIXABLE)) {
          continue;
        }
        const offer = linked.returnTowOffer;
        if (!offer || offer.status !== "ACCEPTED") continue;
        await dispatchRepository.update(linked.id, {
          returnTowOffer: {
            ...offer,
            status: "PENDING",
            at: new Date().toISOString(),
          },
        });
        await enqueueDispatchPush(linked.id, "-return-tow-offer-again", {
          audience: "rider",
          title: "Return tow cancelled",
          body: "Tap to request a return tow again",
        });
      }
    }
    await enqueueDispatchPush(id, "-cancelled-rider", {
      title: "Request cancelled",
      body: isRider ?
        "Your request was cancelled" :
        isOperator && ticket.ticketType === "SOS" ?
          "The mobile shop cancelled your SOS — request help again" :
          "Your request was cancelled",
    });
    if (ticket.status === STATUS_DISPATCH.PENDING &&
      ticket.ticketType === "TOW") {
      await enqueueDispatchPush(id, "-cancelled-towers", {
        audience: "tower-candidates",
        title: "Tow request withdrawn",
        body: "A tow request near you was cancelled",
      });
    }
    const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    if (shopIds.length > 0) {
      await enqueueDispatchPush(id, `-status-${status}-operator`, {
        audience: "operator",
        title: "Request cancelled",
        body: isRider ?
          "The rider cancelled this ticket — tap to view" :
          "This ticket was cancelled — tap to view",
      });
    }
    if (ticket.ticketType === "TOW" &&
      typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId !== "") {
      const destId = ticket.destinationShopId as string;
      await enqueueDispatchPush(id, "-cancelled-destination", {
        audience: "destination-shop",
        shopId: destId,
        urgent: "true",
        title: "Tow cancelled",
        body: "The rider cancelled the tow to your shop",
      });
    }
    void operatorShopId;
  }
  if (
    (status === STATUS_DISPATCH.RESOLVED ||
      (status === STATUS_DISPATCH.CANCELLED && isRider)) &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await providerRepository.findById(
      ticket.assignedShopId as string,
    );
    if (shop && shop.kind === PROVIDER_KIND.TOW &&
      shop.accepting === false && !providerBlocked(shop)) {
      await providerRepository.update(shop.id, {accepting: true});
      cacheManager.del("shop");
      cacheManager.del("provider");
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW") {
    const quote = ticket.towFare as TowFareQuote | null | undefined;
    if (quote && typeof quote.estimate === "number") {
      const track = Array.isArray(ticket.jobTrack) ? ticket.jobTrack : [];
      let pickupIdx = -1;
      let pickupDist = Number.POSITIVE_INFINITY;
      track.forEach((point, index) => {
        const meters = haversineMeters(
          ticket.lat,
          ticket.lng,
          point.lat,
          point.lng,
        );
        if (meters < pickupDist) {
          pickupDist = meters;
          pickupIdx = index;
        }
      });
      const quotedKm = typeof quote.loadedKm === "number" ? quote.loadedKm : 0;
      const loaded = loadedTrackDistance(track, pickupIdx, quotedKm);
      const gpsKm = loaded.km;
      const gpsSparse = loaded.sparse;
      const actualKm = gpsSparse && quotedKm > 0 ? quotedKm : gpsKm;
      const cappedKm = quotedKm > 0 ? quotedKm * 1.15 : actualKm;
      const billableKm = Math.min(actualKm, cappedKm);
      const recomputed = quoteTowFare({
        vehicleClass: quote.vehicleClass,
        night: quote.night,
        deadheadKm: quote.deadheadKm,
        loadedKm: billableKm,
        rates: towFareRates,
      });
      await dispatchRepository.update(id, {
        towFare: {
          ...recomputed,
          ceiling: quote.ceiling ?? recomputed.ceiling,
          final: Math.min(recomputed.estimate, quote.ceiling),
        },
        towActual: {
          quotedKm,
          actualKm: Math.round(billableKm * 100) / 100,
          gpsKm: Math.round(gpsKm * 100) / 100,
          cappedKm: Math.round(cappedKm * 100) / 100,
          distanceSource: gpsSparse ? "ROUTE_QUOTE" : "GPS",
        },
      });
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED && ticket.ticketType === "TOW" &&
    typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "") {
    try {
      await spawnShopTicket(id, ticket, ticket.destinationShopId as string);
    } catch (err) {
      logError("dispatch", "walk-in spawn failed", {
        ticketId: id, shopId: ticket.destinationShopId,
      }, err);
    }
  }
  return {updated: 1};
};
