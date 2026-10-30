import {createDispatch} from "./create";
import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";

import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import {vehicleClassOf} from "../../providerService";
import {enqueueDispatchPush} from "../../taskQueueService";


import {autoFile, bumpCancelCounters} from "../../disputeService";
import * as platformConfigService from "../../platformConfigService";
import {accrue, stopWaiting} from "../waiting";
import {
  NS,
  TERMINAL_STATUSES,
  TOWER_CANCEL_SOURCE,
  TOWER_SEARCH_ACTIVE,
} from "../constants";
import {ACCUSED_KIND, DISPUTE_TYPE} from "../../../constants/disputes";

import {freezeTowLeg} from "../helpers";

import {
  actualDeadheadKm,
  DEFAULT_TOW_RATES,
  isNightFare,
  partialTowFare,
  quoteTowFareForRoute,
  type TowFareQuote,
} from "../fare";
import {findTowOperators} from "../candidates";
import {stampTowEta} from "../accept";

import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";

import * as cacheManager from "../../../utils/cacheManager";


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
  const towRates = await platformConfigService.getTowRates()
    .catch(() => DEFAULT_TOW_RATES);
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
  await dispatchRepository.update(ticketId, {
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

export const spawnShopTicket = async (
  parentId: string,
  ticket: {
    userId: string;
    lat: number;
    lng: number;
    vehicleId?: unknown;
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
  const parent = await dispatchRepository.findById(parentId);
  const mine = await dispatchRepository.findByUserId(ticket.userId);
  const linkedChild = mine.find((t) => {
    if (t.ticketType !== "WALK_IN") return false;
    const links = Array.isArray(t.linkedTicketIds) ?
      t.linkedTicketIds as string[] :
      [];
    return links.includes(parentId);
  });
  if (linkedChild) {
    const parentLinks = Array.isArray(parent?.linkedTicketIds) ?
      parent?.linkedTicketIds as string[] :
      [];
    if (!parentLinks.includes(linkedChild.id)) {
      await dispatchRepository.update(parentId, {
        linkedTicketIds: [...parentLinks, linkedChild.id],
      });
    }
    return;
  }
  const live = mine.find((t) => {
    if (t.ticketType !== "WALK_IN") return false;
    if (TERMINAL_STATUSES.has(t.status as string)) return false;
    if (!(t.providerId === shopId || t.assignedShopId === shopId)) return false;
    const links = Array.isArray(t.linkedTicketIds) ?
      t.linkedTicketIds as string[] :
      [];
    if (links.length > 0 && !links.includes(parentId)) return false;
    if (typeof parent?.createdAt === "string" &&
      typeof t.createdAt === "string") {
      if (Date.parse(t.createdAt) < Date.parse(parent.createdAt)) return false;
    }
    return true;
  });
  if (live) {
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
    if (typeof ticket.vehicleId === "string" && ticket.vehicleId !== "" &&
      !(typeof live.vehicleId === "string" && live.vehicleId !== "")) {
      childPatch.vehicleId = ticket.vehicleId;
    }
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
      allowVehicleOverlap: true,
      allowOffDutyShop: shop.accepting === false,
      allowCarWalkIn: true,
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleType: ticket.vehicleType} :
        {}),
      ...(typeof ticket.vehicleId === "string" ?
        {vehicleId: ticket.vehicleId} :
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
    const parentLinks = Array.isArray(parent?.linkedTicketIds) ?
      parent?.linkedTicketIds as string[] :
      [];
    await dispatchRepository.update(parentId, {
      linkedTicketIds: [...new Set([...parentLinks, child.id])],
    });
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


export const getTowFareEstimate = async ({
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
    rates: await platformConfigService.getTowRates()
      .catch(() => DEFAULT_TOW_RATES),
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
