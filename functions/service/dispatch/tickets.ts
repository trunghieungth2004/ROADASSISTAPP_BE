import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as paymentRepository from
  "../../repository/paymentRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import {servesVehicleClass, vehicleClassOf, isOpenNow} from
  "../providerService";
import {enqueueDispatchPush} from "../taskQueueService";
import {autoFile, bumpCancelCounters} from "../disputeService";
import {
  accrue,
  currentWaitingFee,
  startWaiting,
  stopWaiting,
} from "./waiting";
import {
  DISPUTE_TYPE,
  NS,
  TERMINAL_STATUSES,
  TOWER_CANCEL_SOURCE,
  VALID_STATUSES,
  WALK_IN_TTL_MS,
  TOWER_SEARCH_ACTIVE,
} from "./constants";
import {
  ACCUSED_KIND,
  DISPUTE_REASON,
  PAYMENT_STATUS,
} from "../../constants/payments";
import {
  freezeTowLeg,
  resolveAccessWidth,
  resolveDestination,
} from "./helpers";
import {
  actualDeadheadKm,
  isNightFare,
  partialTowFare,
  quoteTowFareForRoute,
  settleTowFare,
  stampTowFare,
  type TowFareQuote,
} from "./fare";
import {findCandidates, findTowOperators} from "./candidates";
import {stampTowEta} from "./accept";
import * as paymentService from "../paymentService";
import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {isCarVehicle} from "../../utils/valhalla";
import {ForbiddenError, NotFoundError, ValidationError, ConflictError} from
  "../../utils/errors";
import {db, FieldValue} from "../../config/firebase";
import * as cacheManager from "../../utils/cacheManager";
import {validatePhotoPathsStructure} from "../../utils/media";

type PickupHistoryEntry = {
  lat: number;
  lng: number;
  at: string;
  reason: string;
};

export const createDispatch = async ({
  userId,
  ticketType,
  lat,
  lng,
  diagnosticId,
  alleySegmentId,
  accessWidthMeters,
  note,
  description,
  photoUrls,
  providerId,
  destinationShopId,
  destinationPoint,
  vehicleType,
  vehicleWidth,
  vehicleLabel,
  force,
  allowOffDutyShop,
  now,
}: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
  alleySegmentId?: string;
  accessWidthMeters?: number;
  note?: string;
  description?: string;
  photoUrls?: string[];
  providerId?: string;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleType?: string;
  vehicleWidth?: number;
  vehicleLabel?: string;
  force?: boolean;
  allowOffDutyShop?: boolean;
  now?: Date;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (ticketType === "MECHANIC" && isCarVehicle(vehicleType)) {
    throw new ValidationError("Mechanic dispatch isn't available for cars");
  }
  if (ticketType === "WALK_IN" && isCarVehicle(vehicleType)) {
    throw new ValidationError("Walk-in repair isn't available for cars");
  }
  if (ticketType === "TOW" && !destinationShopId && !destinationPoint) {
    throw new ValidationError("Tow tickets need a destination");
  }
  if (typeof description === "string" && description.length > 1000) {
    throw new ValidationError("Description is too long");
  }
  validatePhotoPathsStructure(photoUrls);
  let providerSnapshot: Record<string, unknown> | undefined;
  if (ticketType === "WALK_IN") {
    if (!providerId) {
      throw new ValidationError("Walk-in tickets need a shop");
    }
    const shop = await providerRepository.findById(providerId);
    if (!shop) throw new NotFoundError("Provider not found");
    if (shop.kind !== PROVIDER_KIND.SHOP) {
      throw new ValidationError("Walk-in tickets need a repair shop");
    }
    if (shop.status !== PROVIDER_STATUS.ACTIVE ||
      (shop as {suspended?: boolean}).suspended === true ||
      (shop.accepting === false && allowOffDutyShop !== true)) {
      throw new ValidationError("Walk-in shop is not available");
    }
    if (!servesVehicleClass(shop, vehicleClassOf(vehicleType))) {
      throw new ValidationError(
        "Walk-in shop does not service this vehicle class",
      );
    }
    providerSnapshot = {
      id: shop.id,
      name: shop.name,
      lat: shop.lat,
      lng: shop.lng,
      kind: shop.kind,
      closed: isOpenNow(shop.openHours as string | null, now) === false,
    };
  }
  if (ticketType === "TOW" && destinationShopId) {
    const dest = await providerRepository.findById(destinationShopId);
    if (!dest) throw new NotFoundError("Destination provider not found");
    if (dest.status !== PROVIDER_STATUS.ACTIVE) {
      throw new ValidationError("Destination provider is not available");
    }
    if (dest.kind !== PROVIDER_KIND.SHOP) {
      throw new ValidationError("Destination must be a repair shop");
    }
  }
  if (!force) {
    const mine = await dispatchRepository.findByUserId(userId);
    const live = mine.find((t) =>
      t.ticketType === ticketType &&
      !TERMINAL_STATUSES.has(t.status as string));
    if (live) {
      throw new ConflictError(
        "Rider already holds a live ticket of this type",
        {
          ticketId: live.id,
          status: live.status,
          createdAt: live.createdAt ?? null,
        },
      );
    }
  }
  const width = await resolveAccessWidth(
    alleySegmentId,
    accessWidthMeters,
  );
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticketType,
    vehicleType,
  );
  const nowIso = new Date().toISOString();
  const ticket = await dispatchRepository.create({
    userId,
    ticketType,
    lat,
    lng,
    diagnosticId,
    alleySegmentId,
    accessWidthMeters: width,
    note,
    ...(description !== undefined ? {description} : {}),
    ...(photoUrls !== undefined ? {photoUrls} : {}),
    pickupHistory: [{lat, lng, at: nowIso, reason: "created"}],
    towerSearch: TOWER_SEARCH_ACTIVE,
    needsNewDestination: false,
    providerId,
    providerSnapshot,
    destinationShopId,
    destinationSnapshot,
    destinationPoint,
    vehicleType,
    vehicleWidth,
    vehicleClass: vehicleClassOf(vehicleType),
    vehicleLabel: vehicleLabel ?? vehicleType,
    ...(ticketType === "WALK_IN" ?
      {expiresAt: new Date(Date.now() + WALK_IN_TTL_MS).toISOString()} :
      {}),
  });
  if (ticketType === "SOS") {
    const candidates = await findCandidates({lat, lng, vehicleType});
    if (candidates.length > 0) {
      await dispatchRepository.update(ticket.id, {
        candidates,
        candidateTs: new Date().toISOString(),
      });
      await enqueueDispatchPush(ticket.id);
      cacheManager.del(NS);
      const refreshed = await dispatchRepository.findById(ticket.id);
      return refreshed ?? ticket;
    }
  }
  if (ticketType === "WALK_IN") {
    await enqueueDispatchPush(ticket.id);
  }
  if (ticketType === "TOW") {
    const candidates = await findTowOperators({lat, lng, vehicleType});
    if (candidates.length > 0) {
      await dispatchRepository.update(ticket.id, {
        candidates,
        candidateTs: new Date().toISOString(),
      });
    }
    await enqueueDispatchPush(ticket.id);
    if (typeof destinationShopId === "string" && destinationShopId !== "") {
      await enqueueDispatchPush(
        ticket.id,
        `-destination-shop-${destinationShopId}`,
        {
          audience: "destination-shop",
          shopId: destinationShopId,
          title: "Incoming tow",
          body: "A rider picked your shop as drop-off — tap to view",
        },
      );
    }
    cacheManager.del(NS);
    if (candidates.length > 0) {
      const refreshed = await dispatchRepository.findById(ticket.id);
      return refreshed ?? ticket;
    }
    return ticket;
  }
  cacheManager.del(NS);
  return ticket;
};


export const getMyTicketsInner = async (userId: string) => {
  return dispatchRepository.findByUserId(userId);
};

export const getMyTicketsCached = cacheManager.wrap(getMyTicketsInner, {
  namespace: NS,
  keyFn: (userId: string) => userId,
});

export const getMyTickets = async (userId: string) =>
  getMyTicketsCached(userId);


export const getDispatch = async (id: string, userId: string) => {
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId && ticket.assignedUid !== userId) {
    const caller = await userRepository.findById(userId);
    if (!caller) throw new NotFoundError("User not found");
    if (caller.role !== ROLE_ADMIN) {
      let operator = false;
      if (
        typeof ticket.assignedShopId === "string" &&
        ticket.assignedShopId !== ""
      ) {
        const shop = await providerRepository.findById(ticket.assignedShopId);
        operator = !!shop && shop.operatorUid === userId;
      }
      if (!operator) {
        const destId = typeof ticket.destinationShopId === "string" &&
          ticket.destinationShopId !== "" ?
          ticket.destinationShopId :
          "";
        if (destId !== "") {
          const dest = await providerRepository.findById(destId);
          operator = !!dest && dest.operatorUid === userId;
        }
      }
      if (!operator) {
        const offered = Array.isArray(ticket.candidates) &&
          (ticket.candidates as unknown[]).includes(userId);
        if (!offered) {
          throw new ForbiddenError(
            "Only ticket participants or providers view this",
          );
        }
      }
    }
  }
  let out: Record<string, unknown> = {...ticket};
  if (
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await providerRepository.findById(ticket.assignedShopId);
    if (
      shop &&
      shop.kind === PROVIDER_KIND.TOW &&
      typeof shop.plate === "string" &&
      shop.plate !== ""
    ) {
      out = {...out, towPlate: shop.plate};
    }
  }
  try {
    const fee = await currentWaitingFee({
      id: ticket.id,
      lat: ticket.lat,
      lng: ticket.lng,
      assignedShopId: ticket.assignedShopId,
      waiting: ticket.waiting,
    });
    if (fee !== null) {
      const towFare =
        (out.towFare as Record<string, unknown> | null | undefined) ??
        (ticket.towFare as Record<string, unknown> | null | undefined);
      if (towFare && typeof towFare === "object") {
        out = {...out, towFare: {...towFare, waitingFee: fee}};
      } else if (fee !== null) {
        out = {...out, towFare: {waitingFee: fee}};
      }
    }
  } catch {
    return out;
  }
  return out;
};


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
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
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
    if (isRider && from !== STATUS_DISPATCH.IN_PROGRESS &&
      from !== STATUS_DISPATCH.IN_SHOP) return;
    if ((isOperator || isAssignee) && ticket.ticketType === "TOW" &&
      (from === STATUS_DISPATCH.MATCHED || from === STATUS_DISPATCH.ARRIVED)) {
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
  const isRider = ticket.userId === userId;
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
  if (!isRider && !isAssignee && !isOperator && !isAdmin) {
    throw new ForbiddenError("Only the rider, helper, or operator updates");
  }
  const destinationId = typeof ticket.destinationShopId === "string" ?
    ticket.destinationShopId :
    "";
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    destinationId !== "" &&
    !Array.isArray(ticket.linkedTicketIds)) {
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
      night: isNightFare(),
      deadheadKm: partialKm,
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
        night: isNightFare(),
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
    await dispatchRepository.update(id, {
      lat: nextLat,
      lng: nextLng,
      pickupHistory: history,
      assignedShopId: null,
      assignedUid: null,
      assignedKind: null,
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
  if (isRider && status === STATUS_DISPATCH.CANCELLED) {
    try {
      await paymentService.cancelPendingPayments(id);
    } catch {
      // Keep the cancellation available even if payment cleanup fails.
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
      // Payment refund failures do not block the cancellation.
    }
  }
  await dispatchRepository.updateStatus(id, status, userId);
  if (status === STATUS_DISPATCH.READY) {
    await dispatchRepository.update(id, {
      fulfilledByShopId: ticket.assignedShopId ?? null,
    });
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
        night: isNightFare(),
        deadheadKm: partialKm,
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
          night: isNightFare(),
          vehicleClass: typeof prior?.vehicleClass === "string" ?
            prior.vehicleClass :
            vehicleClassOf(ticket.vehicleType),
        },
      });
    }
    await dispatchRepository.update(id, {cancelledBy: userId});
    await enqueueDispatchPush(id, "-cancelled-rider", {
      title: "Request cancelled",
      body: "Your request was cancelled",
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
        body: "The rider cancelled this ticket — tap to view",
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
      await dispatchRepository.update(id, {
        towFare: {...quote, final: settleTowFare(quote)},
      });
      const loaded = typeof quote.loadedKm === "number" ? quote.loadedKm : null;
      await dispatchRepository.update(id, {
        towActual: {
          quotedKm: loaded,
          actualKm: loaded,
          cappedKm: loaded,
        },
      });
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" &&
    !Array.isArray(ticket.linkedTicketIds)) {
    await spawnShopTicket(id, ticket, ticket.destinationShopId as string);
  }
  return {updated: 1};
};

export const cancelTowerSearch = async ({
  userId,
  ticketId,
  lat,
  lng,
  reasonCode,
  note,
}: {
  userId: string;
  ticketId: string;
  lat?: number;
  lng?: number;
  reasonCode: string;
  note?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "TOW") {
    throw new ValidationError("Only tow tickets are re-matched");
  }
  if (ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED) {
    throw new ValidationError("Re-match needs an engaged tow");
  }
  if (typeof ticket.assignedShopId !== "string" ||
    ticket.assignedShopId === "") {
    throw new ValidationError("Re-match needs an assigned tower");
  }
  if (typeof reasonCode !== "string" || reasonCode.trim() === "") {
    throw new ValidationError("Reason code is required");
  }
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const towerId = ticket.assignedShopId;
  const isAssignee = ticket.assignedUid === userId;
  let isOperator = false;
  const tower = await providerRepository.findById(towerId);
  if (tower && tower.operatorUid === userId) isOperator = true;
  if (!isAssignee && !isOperator && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the tower cancels mid-tow");
  }
  const nextLat = typeof lat === "number" ? lat : ticket.lat;
  const nextLng = typeof lng === "number" ? lng : ticket.lng;
  const destId = typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" ?
    ticket.destinationShopId as string :
    null;
  await freezeTowLeg(ticketId, {
    towLegs: ticket.towLegs,
    towDistanceMeters: ticket.towDistanceMeters,
    assignedShopId: ticket.assignedShopId,
    lat: nextLat,
    lng: nextLng,
  }, destId);
  const fresh = await dispatchRepository.findById(ticketId);
  const partialKm = actualDeadheadKm(fresh?.towLegs);
  const partial = partialTowFare({
    ...(typeof ticket.vehicleType === "string" ?
      {vehicleClass: vehicleClassOf(ticket.vehicleType)} :
      {}),
    night: isNightFare(),
    deadheadKm: partialKm,
  });
  const prior = fresh?.towFare as TowFareQuote | null | undefined;
  const cappedKm = Math.round(partialKm * 10) / 10;
  await dispatchRepository.update(ticketId, {
    towFare: {
      estimate: typeof prior?.estimate === "number" ? prior.estimate : 0,
      ceiling: typeof prior?.ceiling === "number" ? prior.ceiling : 0,
      final: partial,
      partial: true,
      deadheadKm: partialKm,
      loadedKm: typeof prior?.loadedKm === "number" ? prior.loadedKm : 0,
      night: isNightFare(),
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
  const history = Array.isArray(ticket.pickupHistory) ?
    [...(ticket.pickupHistory as Array<{
      lat: number;
      lng: number;
      at: string;
      reason: string;
    }>)] :
    [];
  history.push({
    lat: nextLat,
    lng: nextLng,
    at: new Date().toISOString(),
    reason: TOWER_CANCEL_SOURCE.REMATCH,
  });
  await dispatchRepository.update(ticketId, {
    lat: nextLat,
    lng: nextLng,
    pickupHistory: history,
    assignedShopId: null,
    assignedUid: null,
    assignedKind: null,
    towerSearch: TOWER_SEARCH_ACTIVE,
    etaPickupAt: null,
    etaDropoffAt: null,
    etaNotifiedAt: null,
    candidates: [],
    candidateTs: null,
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.PENDING,
    userId,
  );
  try {
    await stopWaiting(ticketId);
  } catch {
    return {updated: 1, requeued: true};
  }
  try {
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
      await dispatchRepository.update(ticketId, {
        candidates: operators,
        candidateTs: new Date().toISOString(),
      });
    }
  } catch {
    return {updated: 1, requeued: true};
  }
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, "-rematch-rider", {
    audience: "rider",
    urgent: "true",
    title: "Finding another tower",
    body: partialKm > 0 ?
      "The tower cancelled — searching for a new tower " +
      `(${cappedKm} km on record)` :
      "The tower cancelled — searching for a new tower",
  });
  await enqueueDispatchPush(ticketId, "-rematch-towers", {
    audience: "tower-candidates",
    title: "Tow request available",
    body: "A tow request needs a tower — tap to view",
  });
  try {
    await autoFile({
      ticketId,
      reporterUid: ticket.userId,
      accusedKind: ACCUSED_KIND.TOWER,
      accusedId: towerId,
      reasonCode,
      ...(note !== undefined ? {note} : {}),
      type: DISPUTE_TYPE.TOWER_CANCEL_MID,
    });
  } catch {
    return {updated: 1, requeued: true};
  }
  try {
    await bumpCancelCounters({providerId: towerId, userId});
  } catch {
    return {updated: 1, requeued: true};
  }
  return {updated: 1, requeued: true};
};

const spawnShopTicket = async (
  parentId: string,
  ticket: {
    userId: string;
    lat: number;
    lng: number;
    vehicleType?: unknown;
    vehicleWidth?: unknown;
    vehicleClass?: unknown;
    vehicleLabel?: unknown;
    note?: unknown;
    description?: unknown;
    photoUrls?: unknown;
  },
  shopId: string,
): Promise<void> => {
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Destination provider not found");
  if (shop.status !== PROVIDER_STATUS.ACTIVE ||
    (shop as {suspended?: boolean}).suspended === true) {
    throw new ValidationError("Destination provider is not available");
  }
  const mine = await dispatchRepository.findByUserId(ticket.userId);
  const live = mine.find((t) =>
    t.ticketType === "WALK_IN" &&
    !TERMINAL_STATUSES.has(t.status as string) &&
    (t.providerId === shopId || t.assignedShopId === shopId));
  if (live) {
    const parent = await dispatchRepository.findById(parentId);
    const parentLinks = Array.isArray(parent?.linkedTicketIds) ?
      parent?.linkedTicketIds as string[] :
      [];
    if (!parentLinks.includes(live.id)) {
      await dispatchRepository.update(parentId, {
        linkedTicketIds: [...parentLinks, live.id],
      });
    }
    const childLinks = Array.isArray(live.linkedTicketIds) ?
      live.linkedTicketIds as string[] :
      [];
    if (!childLinks.includes(parentId)) {
      await dispatchRepository.update(live.id, {
        linkedTicketIds: [...childLinks, parentId],
      });
    }
    const childPatch: Record<string, unknown> = {};
    if (typeof ticket.note === "string" && ticket.note !== "" &&
      !(typeof live.note === "string" && live.note !== "")) {
      childPatch.note = ticket.note;
    }
    if (typeof ticket.description === "string" && ticket.description !== "" &&
      !(typeof live.description === "string" && live.description !== "")) {
      childPatch.description = ticket.description;
    }
    if (Array.isArray(ticket.photoUrls) && ticket.photoUrls.length > 0) {
      const existing = Array.isArray(live.photoUrls) ? live.photoUrls : [];
      const merged = [...existing];
      for (const path of ticket.photoUrls) {
        if (typeof path === "string" && path !== "" && !merged.includes(path)) {
          merged.push(path);
        }
      }
      if (merged.length > existing.length) childPatch.photoUrls = merged;
    }
    if (Object.keys(childPatch).length > 0) {
      await dispatchRepository.update(live.id, childPatch);
    }
  } else {
    const child = await createDispatch({
      userId: ticket.userId,
      ticketType: "WALK_IN",
      lat: typeof shop.lat === "number" ? shop.lat : ticket.lat,
      lng: typeof shop.lng === "number" ? shop.lng : ticket.lng,
      providerId: shopId,
      force: true,
      allowOffDutyShop: shop.accepting === false,
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleType: ticket.vehicleType} :
        {}),
      ...(typeof ticket.vehicleWidth === "number" ?
        {vehicleWidth: ticket.vehicleWidth} :
        {}),
      ...(typeof ticket.vehicleLabel === "string" ?
        {vehicleLabel: ticket.vehicleLabel} :
        {}),
      ...(typeof ticket.note === "string" && ticket.note !== "" ?
        {note: ticket.note} :
        {}),
      ...(typeof ticket.description === "string" && ticket.description !== "" ?
        {description: ticket.description} :
        {}),
      ...(Array.isArray(ticket.photoUrls) && ticket.photoUrls.length > 0 ?
        {photoUrls: ticket.photoUrls} :
        {}),
    });
    await dispatchRepository.update(parentId, {linkedTicketIds: [child.id]});
    await dispatchRepository.update(child.id, {linkedTicketIds: [parentId]});
  }
  if (shop.accepting === false) {
    await enqueueDispatchPush(parentId, "-dropoff-arrived", {
      audience: "destination-shop",
      shopId,
      urgent: "true",
      title: "Tow drop-off arrived",
      body: "A tow is dropping a vehicle at your shop — tap to review",
    });
  }
  cacheManager.del(NS);
};


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


export const estimateTowFarePreview = async ({
  userId,
  ticketId,
  lat,
  lng,
  now,
}: {
  userId: string;
  ticketId: string;
  lat: number;
  lng: number;
  now?: Date;
}) => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "TOW" ||
    ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Fare preview needs a pending tow");
  }
  let destLat: number | undefined;
  let destLng: number | undefined;
  if (typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "") {
    const dest = await providerRepository.findById(
      ticket.destinationShopId as string,
    );
    if (dest && typeof dest.lat === "number" &&
      typeof dest.lng === "number") {
      destLat = dest.lat;
      destLng = dest.lng;
    }
  } else if (ticket.destinationPoint &&
    typeof ticket.destinationPoint === "object") {
    const point = ticket.destinationPoint as {
      lat?: unknown;
      lng?: unknown;
    };
    if (typeof point.lat === "number" && typeof point.lng === "number") {
      destLat = point.lat;
      destLng = point.lng;
    }
  }
  const quote = await quoteTowFareForRoute({
    ...(typeof ticket.vehicleType === "string" ?
      {vehicleType: ticket.vehicleType} :
      {}),
    towerLat: lat,
    towerLng: lng,
    ticketLat: ticket.lat,
    ticketLng: ticket.lng,
    ...(destLat !== undefined && destLng !== undefined ?
      {destLat, destLng} :
      {}),
    ...(now ? {now} : {}),
  });
  if (!quote) throw new ValidationError("Route unavailable for estimate");
  return quote;
};

export const refreshTowEta = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider refreshes the ETA");
  }
  if (ticket.ticketType !== "TOW" ||
    (ticket.status !== STATUS_DISPATCH.MATCHED &&
      ticket.status !== STATUS_DISPATCH.ARRIVED) ||
    typeof ticket.assignedShopId !== "string" ||
    ticket.assignedShopId === "") {
    throw new ValidationError("ETA refresh needs an engaged tow");
  }
  await stampTowEta(ticketId, {
    lat: ticket.lat,
    lng: ticket.lng,
    vehicleType: ticket.vehicleType,
    destinationShopId: ticket.destinationShopId ?? null,
    destinationPoint: ticket.destinationPoint ?? null,
  }, ticket.assignedShopId as string);
  try {
    const fixes = await providerLocationRepository.findByIds([
      ticket.assignedShopId as string,
    ]);
    const fix = fixes.get(ticket.assignedShopId as string);
    if (fix && typeof fix.lat === "number" && typeof fix.lng === "number") {
      await accrue({
        ticketId,
        towerLat: fix.lat,
        towerLng: fix.lng,
        riderLat: ticket.lat,
        riderLng: ticket.lng,
      });
    }
  } catch {
    return {updated: 1};
  }
  return {updated: 1};
};
