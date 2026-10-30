import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../repository/vehicleProfileRepository";

import {
  servesVehicleClass,
  vehicleClassOf,
  isOpenNow,
} from "../../providerService";
import {enqueueDispatchPush} from "../../taskQueueService";


import {
  NS,
  TERMINAL_STATUSES,
  WALK_IN_TTL_MS,
  TOWER_SEARCH_ACTIVE,
} from "../constants";


import {resolveDestination} from "../helpers";


import {findCandidates, findTowOperators} from "../candidates";


import {PROVIDER_KIND, PROVIDER_STATUS} from "../../../constants/status";

import {isCarVehicle} from "../../../utils/valhalla";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from "../../../utils/errors";

import * as cacheManager from "../../../utils/cacheManager";
import {validatePhotoPathsStructure} from "../../../utils/media";


export const createDispatch = async ({
  userId,
  ticketType,
  lat,
  lng,
  diagnosticId,
  note,
  description,
  photoUrls,
  providerId,
  destinationShopId,
  destinationPoint,
  vehicleId,
  vehicleType,
  vehicleWidth,
  vehicleLabel,
  allowOffDutyShop,
  allowVehicleOverlap,
  allowMissingVehicle,
  allowCarWalkIn,
  now,
  sourceTicketId,
  continuedFromTicketId,
  sosAttempt,
  excludedShopIds,
  excludedOperatorUids,
  addressedTow,
  id,
}: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
  note?: string;
  description?: string;
  photoUrls?: string[];
  providerId?: string;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleId?: string;
  vehicleType?: string;
  vehicleWidth?: number;
  vehicleLabel?: string;
  allowOffDutyShop?: boolean;
  allowVehicleOverlap?: boolean;
  allowMissingVehicle?: boolean;
  allowCarWalkIn?: boolean;
  now?: Date;
  sourceTicketId?: string;
  continuedFromTicketId?: string;
  sosAttempt?: number;
  excludedShopIds?: string[];
  excludedOperatorUids?: string[];
  addressedTow?: boolean;
  id?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (vehicleId !== undefined) {
    const profile = await vehicleProfileRepository.findById(userId, vehicleId);
    if (!profile) throw new ValidationError("Vehicle not found");
  }
  if (ticketType === "MECHANIC" && isCarVehicle(vehicleType)) {
    throw new ValidationError("Mechanic dispatch isn't available for cars");
  }
  if (ticketType === "WALK_IN" && isCarVehicle(vehicleType) &&
    allowCarWalkIn !== true) {
    throw new ValidationError("Walk-in repair isn't available for cars");
  }
  if (ticketType === "TOW" && !destinationShopId && !destinationPoint) {
    throw new ValidationError("Tow tickets need a destination");
  }
  if (ticketType !== "WALK_IN" && allowMissingVehicle !== true &&
    (vehicleId === undefined || vehicleId === "")) {
    throw new ValidationError("Select a vehicle before filing this request");
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
  if (!allowVehicleOverlap) {
    const mine = await dispatchRepository.findByUserId(userId);
    const live = vehicleId !== undefined ?
      mine.find((t) =>
        t.vehicleId === vehicleId &&
        !TERMINAL_STATUSES.has(t.status as string)) :
      mine.find((t) =>
        t.ticketType === ticketType &&
        !TERMINAL_STATUSES.has(t.status as string));
    if (live) {
      throw new ConflictError(
        vehicleId !== undefined ?
          "Vehicle already has an open ticket" :
          "Rider already holds a live ticket of this type",
        {
          ticketId: live.id,
          status: live.status,
          createdAt: live.createdAt ?? null,
          ...(vehicleId !== undefined ? {reason: "VEHICLE_BUSY"} : {}),
        },
      );
    }
  }
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
    vehicleId: vehicleId ?? null,
    vehicleType,
    vehicleWidth,
    vehicleClass: vehicleClassOf(vehicleType),
    vehicleLabel: vehicleLabel ?? vehicleType,
    sourceTicketId: sourceTicketId ?? null,
    continuedFromTicketId: continuedFromTicketId ?? null,
    sosAttempt: sosAttempt ?? 1,
    excludedShopIds: excludedShopIds ?? [],
    excludedOperatorUids: excludedOperatorUids ?? [],
    ...(id !== undefined ? {id} : {}),
    ...(ticketType === "WALK_IN" ?
      {expiresAt: new Date(Date.now() + WALK_IN_TTL_MS).toISOString()} :
      {}),
  });
  if (ticketType === "SOS") {
    const candidates = await findCandidates({
      lat,
      lng,
      vehicleType,
      ...(excludedOperatorUids !== undefined ?
        {excludeOperatorUids: excludedOperatorUids} :
        {}),
      ...(excludedShopIds !== undefined ?
        {excludeShopIds: excludedShopIds} :
        {}),
    });
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
    const candidates = addressedTow === true ? [] :
      await findTowOperators({lat, lng, vehicleType});
    if (candidates.length > 0) {
      await dispatchRepository.update(ticket.id, {
        candidates,
        candidateTs: new Date().toISOString(),
      });
    }
    if (addressedTow !== true) {
      await enqueueDispatchPush(ticket.id);
    }
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

