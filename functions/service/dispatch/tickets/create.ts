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


import {
  MOBILE_SHOP_DEFAULT_RADIUS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  TOW_DISPATCH_RADIUS,
} from "../../../constants/status";
import {DISPATCH_SLA_MINUTES} from "../../../constants/dispatch";

import {isCarVehicle} from "../../../utils/valhalla";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from "../../../utils/errors";

import * as cacheManager from "../../../utils/cacheManager";
import {validatePhotoPathsStructure} from "../../../utils/media";


const liveTicketConflict = (
  mine: dispatchRepository.DispatchTicket[],
  ticketType: string,
  vehicleId?: string,
): ConflictError | null => {
  if (ticketType === "SOS") {
    const liveSos = mine.find((t) =>
      t.ticketType === "SOS" &&
      !TERMINAL_STATUSES.has(t.status as string));
    if (liveSos) {
      return new ConflictError(
        "Rider already has a live SOS",
        {
          ticketId: liveSos.id,
          status: liveSos.status,
          createdAt: liveSos.createdAt ?? null,
          reason: "SOS_BUSY",
        },
      );
    }
  }
  const live = vehicleId !== undefined ?
    mine.find((t) =>
      t.vehicleId === vehicleId &&
      !TERMINAL_STATUSES.has(t.status as string)) :
    mine.find((t) =>
      t.ticketType === ticketType &&
      !TERMINAL_STATUSES.has(t.status as string));
  if (!live) return null;
  return new ConflictError(
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
};

const vehicleProfileFor = async (
  userId: string,
  vehicleId?: string,
) => {
  if (vehicleId === undefined || vehicleId === "") return null;
  const profile = await vehicleProfileRepository.findById(userId, vehicleId);
  if (!profile) throw new ValidationError("Vehicle not found");
  return profile;
};

export const createDispatch = async ({
  userId,
  ticketType,
  lat,
  lng,
  diagnosticId,
  symptom,
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
  towKind,
  allowOffDutyShop,
  allowVehicleOverlap,
  allowMissingVehicle,
  allowCarWalkIn,
  now,
  sourceTicketId,
  continuedFromTicketId,
  bookingId,
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
  symptom?: string;
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
  towKind?: "NORMAL" | "RETURN";
  allowOffDutyShop?: boolean;
  allowVehicleOverlap?: boolean;
  allowMissingVehicle?: boolean;
  allowCarWalkIn?: boolean;
  now?: Date;
  sourceTicketId?: string;
  continuedFromTicketId?: string;
  bookingId?: string;
  sosAttempt?: number;
  excludedShopIds?: string[];
  excludedOperatorUids?: string[];
  addressedTow?: boolean;
  id?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const vehicleProfile = await vehicleProfileFor(userId, vehicleId);
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
      services: Array.isArray(shop.services) ? shop.services : [],
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
    const conflict = liveTicketConflict(mine, ticketType, vehicleId);
    if (conflict !== null) throw conflict;
  }
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticketType,
    vehicleType,
  );
  const nowIso = new Date().toISOString();
  const slaMinutes = DISPATCH_SLA_MINUTES[ticketType] ?? 10;
  const broadcast = ticketType === "TOW" || ticketType === "SOS";
  const ticket = await dispatchRepository.create({
    userId,
    ticketType,
    lat,
    lng,
    diagnosticId,
    ...(symptom !== undefined ? {symptom} : {}),
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
    vehicleLabel: typeof vehicleProfile?.label === "string" &&
      vehicleProfile.label !== "" ? vehicleProfile.label :
      vehicleLabel ?? vehicleType,
    ...(typeof vehicleProfile?.plate === "string" &&
      vehicleProfile.plate !== "" ?
      {vehiclePlate: vehicleProfile.plate} : {}),
    vehicleHeight: vehicleProfile?.baseHeight ?? null,
    ...(ticketType === "TOW" ? {towKind: towKind ?? "NORMAL"} : {}),
    sourceTicketId: sourceTicketId ?? null,
    continuedFromTicketId: continuedFromTicketId ?? null,
    bookingId: bookingId ?? null,
    sosAttempt: sosAttempt ?? 1,
    excludedShopIds: excludedShopIds ?? [],
    excludedOperatorUids: excludedOperatorUids ?? [],
    ...(broadcast ? {
      acceptByAt: new Date(Date.now() + slaMinutes * 60 * 1000).toISOString(),
      dispatchRound: 1,
      dispatchRadiusMeters: ticketType === "TOW" ?
        TOW_DISPATCH_RADIUS :
        MOBILE_SHOP_DEFAULT_RADIUS,
      notifiedOperatorUids: [],
    } : {}),
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
      ...(symptom !== undefined ? {serviceCategory: symptom} : {}),
    });
    if (candidates.length > 0) {
      await dispatchRepository.update(ticket.id, {
        candidates,
        candidateTs: new Date().toISOString(),
        notifiedOperatorUids: candidates,
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
        notifiedOperatorUids: candidates,
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
