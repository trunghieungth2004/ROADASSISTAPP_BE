import {spawnShopTicket} from "./tow";
import type {PickupHistoryEntry} from "./types";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";

import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import {vehicleClassOf} from "../../providerService";
import {enqueueDispatchPush} from "../../taskQueueService";
import {chatService} from "../../chatService";
import {haversineMeters} from "../../../utils/geo";
import {autoFile, bumpCancelCounters} from "../../disputeService";
import {startWaiting, stopWaiting} from "../waiting";
import {
  NS,
  TERMINAL_STATUSES,
  TOWER_CANCEL_SOURCE,
  VALID_STATUSES,
  TOWER_SEARCH_ACTIVE,
  ARRIVAL_RADIUS_M,
} from "../constants";
import {
  ACCUSED_KIND,
  DISPUTE_REASON,
  DISPUTE_TYPE,
} from "../../../constants/disputes";
import {PAYMENT_STATUS} from "../../../constants/payments";
import {freezeTowLeg} from "../helpers";

import {
  actualDeadheadKm,
  DEFAULT_TOW_RATES,
  isNightFare,
  partialTowFare,
  quoteTowFare,
  type TowFareQuote,
} from "../fare";
import {findTowOperators} from "../candidates";

import * as paymentService from "../../paymentService";
import * as platformConfigService from "../../platformConfigService";
import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  PROVIDER_FRESH_MS,
  STATUS_DISPATCH,
} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import {db, FieldValue} from "../../../config/firebase";
import * as cacheManager from "../../../utils/cacheManager";

import {logError} from "../../../utils/logger";


export const assertTransition = ({
  ticket,
  status,
  isRider,
  isOperator,
  isAssignee,
  isAdmin,
}: {
  ticket: {status: string; ticketType: string; shopQuotedAmount?: unknown};
  status: string;
  isRider: boolean;
  isOperator: boolean;
  isAssignee: boolean;
  isAdmin: boolean;
}): void => {
  if (isAdmin) return;
  const from = ticket.status;
  if (TERMINAL_STATUSES.has(from)) {
    throw new ValidationError("Ticket is already closed");
  }
  const shopFlow = isOperator;
  if (status === STATUS_DISPATCH.MATCHED) {
    throw new ValidationError("Use accept to match a ticket");
  }
  if (status === STATUS_DISPATCH.ARRIVED) {
    if (from === STATUS_DISPATCH.MATCHED && isRider) return;
    throw new ForbiddenError("Only the rider marks arrival");
  }
  if (status === STATUS_DISPATCH.QUOTED ||
    status === STATUS_DISPATCH.ESTIMATED ||
    status === STATUS_DISPATCH.EST_APPROVED ||
    status === STATUS_DISPATCH.FINAL_QUOTED ||
    status === STATUS_DISPATCH.UNFIXABLE ||
    status === STATUS_DISPATCH.RESOLVED_UNFIXABLE) {
    throw new ValidationError("Quotes are sent, not set");
  }
  if (status === STATUS_DISPATCH.IN_SHOP) {
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if ((from === STATUS_DISPATCH.ARRIVED ||
      from === STATUS_DISPATCH.MATCHED ||
      from === STATUS_DISPATCH.QUOTED ||
      from === STATUS_DISPATCH.EST_APPROVED) && shopFlow) return;
    throw new ForbiddenError("Only the helper receives the vehicle");
  }
  if (status === STATUS_DISPATCH.IN_PROGRESS) {
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if (from === STATUS_DISPATCH.QUOTED) {
      throw new ForbiddenError("Quote needs rider approval");
    }
    if (from === STATUS_DISPATCH.FINAL_QUOTED) {
      throw new ForbiddenError("Quote needs rider approval");
    }
    const quoted = typeof ticket.shopQuotedAmount === "number";
    const arrived = from === STATUS_DISPATCH.MATCHED &&
      ticket.ticketType === "WALK_IN" && !quoted;
    if ((from === STATUS_DISPATCH.ARRIVED || arrived) && shopFlow) return;
    throw new ForbiddenError("Only the helper starts work");
  }
  if (status === STATUS_DISPATCH.READY) {
    if (ticket.ticketType === "SOS") {
      if (from === STATUS_DISPATCH.ARRIVED && shopFlow) return;
      throw new ForbiddenError("Only the mobile shop marks the fix complete");
    }
    if (ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if (from === STATUS_DISPATCH.IN_PROGRESS && shopFlow) return;
    throw new ForbiddenError("Only the helper marks work ready");
  }
  if (status === STATUS_DISPATCH.RESOLVED) {
    if ((from === STATUS_DISPATCH.ARRIVED ||
      from === STATUS_DISPATCH.READY) && isRider) {
      return;
    }
    throw new ForbiddenError("Only the rider resolves a ticket");
  }
  if (status === STATUS_DISPATCH.CANCELLED) {
    if (isRider && ticket.ticketType === "SOS" &&
      from === STATUS_DISPATCH.READY) {
      throw new ForbiddenError("The mobile shop has completed the fix");
    }
    if (isRider && from !== STATUS_DISPATCH.IN_PROGRESS &&
      from !== STATUS_DISPATCH.IN_SHOP) return;
    if ((isOperator || isAssignee) && ticket.ticketType === "TOW" &&
      (from === STATUS_DISPATCH.MATCHED || from === STATUS_DISPATCH.ARRIVED)) {
      return;
    }
    if (isOperator && ticket.ticketType === "SOS" &&
      from === STATUS_DISPATCH.MATCHED) {
      return;
    }
    throw new ForbiddenError(
      "Cannot cancel once work is underway",
    );
  }
  if (status === STATUS_DISPATCH.DECLINED) {
    if (from === STATUS_DISPATCH.PENDING &&
      ticket.ticketType === "WALK_IN" && isOperator) {
      return;
    }
    throw new ForbiddenError("Only the shop declines a walk-in");
  }
  throw new ValidationError("Invalid dispatch status");
};


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
  const isRider = ticket.userId === userId;
  if (isRider && status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "SOS" &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" &&
    typeof ticket.finalAmount !== "number") {
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
  if (!isRider && !isAssignee && !isOperator && !isAdmin) {
    throw new ForbiddenError("Only the rider, helper, or operator updates");
  }
  const destinationId = typeof ticket.destinationShopId === "string" ?
    ticket.destinationShopId :
    "";
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    destinationId !== "") {
    const destination = await providerRepository.findById(destinationId);
    if (!destination ||
      destination.status !== PROVIDER_STATUS.ACTIVE ||
      (destination as {suspended?: boolean}).suspended === true) {
      throw new ValidationError(
        "Destination shop is no longer available — choose another drop-off",
      );
    }
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
  if (status === STATUS_DISPATCH.ARRIVED && isRider &&
    (ticket.ticketType === "SOS" || ticket.ticketType === "TOW")) {
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
    const towerId = ticket.assignedShopId as string;
    const destId = typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId !== "" ?
      ticket.destinationShopId as string :
      null;
    await freezeTowLeg(id, {
      towLegs: ticket.towLegs,
      towDistanceMeters: ticket.towDistanceMeters,
      assignedShopId: ticket.assignedShopId,
      lat: ticket.lat,
      lng: ticket.lng,
    }, destId);
    const fresh = await dispatchRepository.findById(id);
    const partialKm = actualDeadheadKm(fresh?.towLegs);
    const partial = partialTowFare({
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleClass: vehicleClassOf(ticket.vehicleType)} :
        {}),
      night: isNightFare(new Date(), towRates.nightWindow),
      deadheadKm: partialKm,
      rates: towRates,
    });
    const prior = fresh?.towFare as TowFareQuote | null | undefined;
    const cappedKm = Math.round(partialKm * 10) / 10;
    await dispatchRepository.update(id, {
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
        quotedKm: typeof prior?.loadedKm === "number" ? prior.loadedKm : null,
        actualKm: cappedKm,
        cappedKm,
      },
    });
    const nextLat = typeof lat === "number" ? lat : ticket.lat;
    const nextLng = typeof lng === "number" ? lng : ticket.lng;
    const history = Array.isArray(ticket.pickupHistory) ?
      [...(ticket.pickupHistory as PickupHistoryEntry[])] :
      [];
    history.push({
      lat: nextLat,
      lng: nextLng,
      at: new Date().toISOString(),
      reason: TOWER_CANCEL_SOURCE.STATUS,
    });
    const chatVersion = typeof ticket.chatVersion === "number" ?
      ticket.chatVersion :
      0;
    const archived = await chatService.archiveTicketRoom({
      ticketId: id,
      version: chatVersion,
    }).catch(() => null);
    let shopName: string | null = null;
    try {
      const tower = await providerRepository.findById(towerId);
      shopName = tower && typeof tower.name === "string" ? tower.name : null;
    } catch {
      shopName = null;
    }
    await dispatchRepository.update(id, {
      lat: nextLat,
      lng: nextLng,
      pickupHistory: history,
      assignedShopId: null,
      assignedUid: null,
      assignedKind: null,
      chatVersion: chatVersion + 1,
      ...(archived !== null ?
        {
          chatHistory: FieldValue.arrayUnion({
            version: chatVersion,
            roomId: archived.roomId,
            shopId: towerId,
            shopName,
            at: archived.at,
          }),
        } :
        {}),
      formerAssignedShopIds: FieldValue.arrayUnion(towerId),
      towCancelHistory: FieldValue.arrayUnion({
        shopId: towerId,
        by: userId,
        at: new Date().toISOString(),
        ...(typeof reasonCode === "string" && reasonCode !== "" ?
          {reasonCode} :
          {}),
      }),
      towerSearch: TOWER_SEARCH_ACTIVE,
      etaPickupAt: null,
      etaDropoffAt: null,
      etaNotifiedAt: null,
      cancelledBy: userId,
      candidates: [],
      candidateTs: null,
    });
    await dispatchRepository.updateStatus(id, STATUS_DISPATCH.PENDING, userId);
    try {
      const tower = await providerRepository.findById(towerId);
      if (tower && tower.kind === PROVIDER_KIND.TOW &&
        tower.accepting === false) {
        await providerRepository.update(towerId, {accepting: true});
        cacheManager.del("shop");
        cacheManager.del("provider");
      }
    } catch {
      return {updated: 1, requeued: true};
    }
    try {
      const operators = await findTowOperators({
        lat: nextLat,
        lng: nextLng,
        vehicleType: ticket.vehicleType as string | undefined,
      });
      if (operators.length > 0) {
        await dispatchRepository.update(id, {
          candidates: operators,
          candidateTs: new Date().toISOString(),
        });
      }
    } catch {
      return {updated: 1, requeued: true};
    }
    cacheManager.del(NS);
    await enqueueDispatchPush(id, "-cancelled-rider", {
      audience: "rider",
      urgent: "true",
      title: "Tow cancelled by tower",
      body: partialKm > 0 ?
        "The tower cancelled — searching for a new tower " +
        `(${cappedKm} km on record)` :
        "The tower cancelled — searching for a new tower",
    });
    await enqueueDispatchPush(id, "-requeue-towers", {
      audience: "tower-candidates",
      title: "Tow request available",
      body: "A tow request needs a tower — tap to view",
    });
    try {
      await autoFile({
        ticketId: id,
        reporterUid: ticket.userId,
        accusedKind: ACCUSED_KIND.TOWER,
        accusedId: towerId,
        reasonCode: typeof reasonCode === "string" && reasonCode !== "" ?
          reasonCode :
          DISPUTE_REASON.TOWER_CANCEL_OTHER,
        type: DISPUTE_TYPE.TOWER_CANCEL_MID,
      });
    } catch {
      return {updated: 1, requeued: true};
    }
    try {
      await bumpCancelCounters({providerId: towerId, userId});
      try {
        await db.collection("users").doc(ticket.userId).update({
          disputes: FieldValue.increment(0),
        });
      } catch {
        return {updated: 1, requeued: true};
      }
    } catch {
      return {updated: 1, requeued: true};
    }
    return {updated: 1, requeued: true};
  }
  if ((isRider ||
    (isOperator && ticket.ticketType === "SOS" &&
      ticket.status === STATUS_DISPATCH.MATCHED)) &&
    status === STATUS_DISPATCH.CANCELLED) {
    if (ticket.ticketType === "TOW" &&
      typeof ticket.assignedShopId === "string" &&
      ticket.assignedShopId !== "") {
      const prior = ticket.towFare as TowFareQuote | null | undefined;
      const deadheadKm = typeof prior?.deadheadKm === "number" ?
        prior.deadheadKm :
        0;
      const partial = partialTowFare({
        vehicleClass: vehicleClassOf(ticket.vehicleType),
        night: isNightFare(new Date(), towRates.nightWindow),
        deadheadKm,
        rates: towRates,
      });
      await dispatchRepository.update(id, {
        towFare: {
          estimate: typeof prior?.estimate === "number" ? prior.estimate : 0,
          ceiling: typeof prior?.ceiling === "number" ? prior.ceiling : 0,
          final: partial,
          partial: true,
          deadheadKm,
          loadedKm: typeof prior?.loadedKm === "number" ? prior.loadedKm : 0,
          night: isNightFare(new Date(), towRates.nightWindow),
          vehicleClass: typeof prior?.vehicleClass === "string" ?
            prior.vehicleClass :
            vehicleClassOf(ticket.vehicleType),
        },
      });
    }
    try {
      await paymentService.cancelPendingPayments(id);
    } catch {
      void 0;
    }
    try {
      const payments = await paymentRepository.findByTicketId(id);
      for (const payment of payments) {
        if (payment.status === PAYMENT_STATUS.HELD ||
          payment.status === PAYMENT_STATUS.CONFIRMED ||
          payment.status === PAYMENT_STATUS.PARTIAL) {
          await paymentService.refundPayment({
            paymentId: payment.id,
            adminUid: userId,
          });
        }
      }
    } catch {
      void 0;
    }
  }
  await dispatchRepository.updateStatus(id, status, userId);
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
          linked.status === STATUS_DISPATCH.READY) {
          await dispatchRepository.updateStatus(
            linked.id,
            STATUS_DISPATCH.RESOLVED,
            userId,
          );
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
    typeof ticket.assignedShopId === "string" && ticket.assignedShopId !== "") {
    try {
      await startWaiting(id);
    } catch {
      return {updated: 1};
    }
  }
  cacheManager.del(NS);
  if (
    status === STATUS_DISPATCH.MATCHED ||
    status === STATUS_DISPATCH.ARRIVED ||
    status === STATUS_DISPATCH.RESOLVED ||
    status === STATUS_DISPATCH.IN_PROGRESS ||
    status === STATUS_DISPATCH.READY ||
    status === STATUS_DISPATCH.DECLINED
  ) {
    await enqueueDispatchPush(id, `-status-${status}`);
  }
  if (status === STATUS_DISPATCH.ARRIVED ||
    status === STATUS_DISPATCH.RESOLVED) {
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
    const wasEngaged = ticket.ticketType === "TOW" &&
      typeof ticket.assignedShopId === "string" &&
      ticket.assignedShopId !== "";
    let partialKm = 0;
    if (wasEngaged) {
      const destId = typeof ticket.destinationShopId === "string" &&
        ticket.destinationShopId !== "" ?
        ticket.destinationShopId as string :
        null;
      await freezeTowLeg(id, {
        towLegs: ticket.towLegs,
        towDistanceMeters: ticket.towDistanceMeters,
        assignedShopId: ticket.assignedShopId,
        lat: ticket.lat,
        lng: ticket.lng,
      }, destId);
      const fresh = await dispatchRepository.findById(id);
      partialKm = actualDeadheadKm(fresh?.towLegs);
      const partial = partialTowFare({
        ...(typeof ticket.vehicleType === "string" ?
          {vehicleClass: vehicleClassOf(ticket.vehicleType)} :
          {}),
        night: isNightFare(new Date(), towRates.nightWindow),
        deadheadKm: partialKm,
        rates: towRates,
      });
      const prior = fresh?.towFare as TowFareQuote | null | undefined;
      await dispatchRepository.update(id, {
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
      });
    }
    const preserveTowerCancel = ticket.ticketType === "TOW" &&
      (typeof ticket.assignedShopId !== "string" ||
        ticket.assignedShopId === "") &&
      typeof ticket.cancelledBy === "string" &&
      ticket.cancelledBy !== "" &&
      ticket.cancelledBy !== userId;
    if (!preserveTowerCancel) {
      await dispatchRepository.update(id, {cancelledBy: userId});
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
      status === STATUS_DISPATCH.CANCELLED) &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await providerRepository.findById(
      ticket.assignedShopId as string,
    );
    if (shop && shop.kind === PROVIDER_KIND.TOW && shop.accepting === false) {
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
      let trackedKm = 0;
      for (let i = Math.max(0, pickupIdx); i < track.length - 1; i += 1) {
        const a = track[i];
        const b = track[i + 1];
        trackedKm += haversineMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
      }
      const quotedKm = typeof quote.loadedKm === "number" ? quote.loadedKm : 0;
      const actualKm = trackedKm > 0 ? trackedKm : quotedKm;
      const cappedKm = quotedKm > 0 ? quotedKm * 1.15 : actualKm;
      const billableKm = Math.min(actualKm, cappedKm);
      const recomputed = quoteTowFare({
        vehicleClass: quote.vehicleClass,
        night: quote.night,
        deadheadKm: quote.deadheadKm,
        loadedKm: billableKm,
        rates: towRates,
      });
      await dispatchRepository.update(id, {
        towFare: {
          ...recomputed,
          final: Math.min(recomputed.estimate, quote.ceiling),
        },
        towActual: {
          quotedKm,
          actualKm: Math.round(billableKm * 100) / 100,
          cappedKm: Math.round(cappedKm * 100) / 100,
        },
      });
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "") {
    try {
      await spawnShopTicket(id, ticket, ticket.destinationShopId as string);
    } catch (err) {
      logError("dispatch", "walk-in spawn failed", {
        ticketId: id,
        shopId: ticket.destinationShopId,
      }, err);
    }
  }
  return {updated: 1};
};
