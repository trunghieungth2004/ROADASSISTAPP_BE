import * as providerRepository from
  "../../repository/providerRepository";
import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import {haversineMeters} from "../../utils/geo";
import {
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  TOW_CLASS_MULTIPLIER_BIKE,
  TOW_CLASS_MULTIPLIER_CAR,
} from "../../constants/status";
import {vehicleClassOf, servesVehicleClass} from "../providerService";
import {isCarVehicle, postRoute} from "../../utils/valhalla";
import {logError} from "../../utils/logger";
import {
  LOADED_FACTOR,
  SECURE_MINUTES_BIKE,
  SECURE_MINUTES_CAR,
} from "./constants";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";

export const resolveDestination = async (
  destinationShopId: string | undefined,
  destinationPoint:
    | {lat: number; lng: number; label?: string}
    | undefined,
  ticketType?: string,
  vehicleType?: string,
  allowOffDuty = false,
): Promise<Record<string, unknown> | undefined> => {
  if (destinationShopId) {
    const shop = await providerRepository.findById(destinationShopId);
    if (!shop) throw new NotFoundError("Destination provider not found");
    if (shop.status !== PROVIDER_STATUS.ACTIVE ||
      (shop as {suspended?: boolean}).suspended === true) {
      throw new ValidationError("Destination provider is not available");
    }
    if (shop.kind !== PROVIDER_KIND.SHOP) {
      throw new ValidationError("Destination must be a repair shop");
    }
    if (ticketType === "TOW" && shop.accepting === false && !allowOffDuty) {
      throw new ValidationError("Destination shop is not accepting drop-offs");
    }
    if (ticketType && ticketType !== "TOW" && ticketType !== "MECHANIC") {
      throw new ValidationError("This ticket type takes no shop destination");
    }
    if (typeof vehicleType === "string" && vehicleType !== "") {
      const wanted = vehicleClassOf(vehicleType);
      if (!servesVehicleClass(shop, wanted)) {
        throw new ValidationError(
          "Destination shop does not service this vehicle class",
        );
      }
    }
    return {
      id: shop.id,
      name: shop.name,
      lat: shop.lat,
      lng: shop.lng,
      kind: shop.kind,
    };
  }
  if (destinationPoint) {
    return {
      lat: destinationPoint.lat,
      lng: destinationPoint.lng,
      label: destinationPoint.label ?? null,
      source: "point",
    };
  }
  return undefined;
};


export const providerKindForTicket = (ticketType: unknown): string | null => {
  if (ticketType === "TOW") return PROVIDER_KIND.TOW;
  if (ticketType === "SOS") return PROVIDER_KIND.MOBILE_SHOP;
  if (ticketType === "MECHANIC" || ticketType === "WALK_IN") {
    return PROVIDER_KIND.SHOP;
  }
  return null;
};


export const requireProviderForTicket = (
  shop: {status?: unknown; kind?: unknown; suspended?: unknown},
  ticketType: unknown,
): void => {
  if (shop.status !== PROVIDER_STATUS.ACTIVE || shop.suspended === true) {
    throw new ForbiddenError("Provider is not available");
  }
  const expected = providerKindForTicket(ticketType);
  if (!expected) {
    throw new ForbiddenError("Unsupported ticket type");
  }
  if (shop.kind !== expected) {
    throw new ValidationError(`Ticket needs a ${expected} provider`);
  }
};


export const towEstimateFor = ({
  shop,
  ticketLat,
  ticketLng,
  destLat,
  destLng,
  vehicleType,
}: {
  shop: {towBaseFee?: unknown; towPerKmFee?: unknown};
  ticketLat: number;
  ticketLng: number;
  destLat: number;
  destLng: number;
  vehicleType?: string;
}): number | null => {
  if (typeof shop.towBaseFee !== "number" ||
    typeof shop.towPerKmFee !== "number") {
    return null;
  }
  const km = haversineMeters(ticketLat, ticketLng, destLat, destLng) / 1000;
  const mult = isCarVehicle(vehicleType) ?
    TOW_CLASS_MULTIPLIER_CAR :
    TOW_CLASS_MULTIPLIER_BIKE;
  return Math.round(shop.towBaseFee + shop.towPerKmFee * mult * km);
};

export const estimateTowEta = async ({
  towerLat,
  towerLng,
  ticketLat,
  ticketLng,
  destLat,
  destLng,
  vehicleType,
}: {
  towerLat: number;
  towerLng: number;
  ticketLat: number;
  ticketLng: number;
  destLat?: number;
  destLng?: number;
  vehicleType?: string;
}): Promise<{pickupSeconds: number; dropoffSeconds: number | null} | null> => {
  try {
    const costing = isCarVehicle(vehicleType) ? "auto" : "motor_scooter";
    const leg0 = await postRoute(
      [{lat: towerLat, lng: towerLng}, {lat: ticketLat, lng: ticketLng}],
      [],
      costing,
    );
    const secureMinutes = isCarVehicle(vehicleType) ?
      SECURE_MINUTES_CAR :
      SECURE_MINUTES_BIKE;
    const rawMinutes = leg0.durationSeconds / 60 + secureMinutes;
    const pickupMinutes = rawMinutes < 15 ?
      Math.ceil(rawMinutes) :
      Math.ceil(rawMinutes / 5) * 5;
    const pickupSeconds = pickupMinutes * 60;
    if (typeof destLat !== "number" || typeof destLng !== "number") {
      return {pickupSeconds, dropoffSeconds: null};
    }
    const leg1 = await postRoute(
      [{lat: ticketLat, lng: ticketLng}, {lat: destLat, lng: destLng}],
      [],
      costing,
    );
    const dropoffRaw = pickupSeconds / 60 +
      leg1.durationSeconds * LOADED_FACTOR / 60;
    const dropoffSeconds = (dropoffRaw < 15 ?
      Math.ceil(dropoffRaw) :
      Math.ceil(dropoffRaw / 5) * 5) * 60;
    return {pickupSeconds, dropoffSeconds};
  } catch (err) {
    logError("dispatch", "tow-eta-failed", {}, err);
    return null;
  }
};

export const trackedDeadheadKm = (
  ticket: {
    lat: number;
    lng: number;
    assignedAt?: unknown;
    jobTrack?: unknown;
  },
  shopId: string,
): number | null => {
  const track = Array.isArray(ticket.jobTrack) ? ticket.jobTrack : [];
  const since = typeof ticket.assignedAt === "string" ?
    Date.parse(ticket.assignedAt) :
    null;
  const points = track.filter((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const point = raw as {
      lat?: unknown;
      lng?: unknown;
      at?: unknown;
      shopId?: unknown;
    };
    if (typeof point.lat !== "number" || typeof point.lng !== "number") {
      return false;
    }
    if (typeof point.shopId === "string" && point.shopId !== shopId) {
      return false;
    }
    if (since !== null && typeof point.at === "string") {
      const at = Date.parse(point.at);
      if (!Number.isNaN(at) && at < since - 5000) return false;
    }
    return true;
  });
  if (points.length < 2) return null;
  let meters = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i] as {lat: number; lng: number};
    const b = points[i + 1] as {lat: number; lng: number};
    meters += haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (haversineMeters(b.lat, b.lng, ticket.lat, ticket.lng) <= 120) {
      break;
    }
  }
  return Math.round((meters / 1000) * 1000) / 1000;
};

export const trackedLoadedKm = (
  ticket: {
    loadedAt?: unknown;
    jobTrack?: unknown;
  },
  shopId: string,
): number | null => {
  if (typeof ticket.loadedAt !== "string") return null;
  const since = Date.parse(ticket.loadedAt);
  if (Number.isNaN(since)) return null;
  const track = Array.isArray(ticket.jobTrack) ? ticket.jobTrack : [];
  const points = track.filter((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const point = raw as {
      lat?: unknown;
      lng?: unknown;
      at?: unknown;
      shopId?: unknown;
    };
    if (typeof point.lat !== "number" || typeof point.lng !== "number") {
      return false;
    }
    if (typeof point.shopId === "string" && point.shopId !== shopId) {
      return false;
    }
    if (typeof point.at !== "string") return false;
    const at = Date.parse(point.at);
    return !Number.isNaN(at) && at >= since - 5000;
  });
  if (points.length < 2) return null;
  let meters = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i] as {lat: number; lng: number};
    const b = points[i + 1] as {lat: number; lng: number};
    meters += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return Math.round((meters / 1000) * 1000) / 1000;
};

export const freezeTowLeg = async (
  ticketId: string,
  ticket: {
    towLegs?: unknown;
    towDistanceMeters?: unknown;
    assignedShopId?: unknown;
    lat: number;
    lng: number;
  },
  toShopId: string | null,
  traveledKm?: number,
): Promise<number> => {
  const legs = Array.isArray(ticket.towLegs) ?
    [...(ticket.towLegs as unknown[])] :
    [];
  let legKm = 0;
  let actual = false;
  const towerId = typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" ?
    ticket.assignedShopId :
    "";
  if (towerId !== "") {
    const fixes = await providerLocationRepository.findByIds([towerId]);
    const fix = fixes.get(towerId);
    if (fix && typeof fix.lat === "number" && typeof fix.lng === "number") {
      legKm = Math.round(
        haversineMeters(fix.lat, fix.lng, ticket.lat, ticket.lng),
      );
      actual = Date.now() - Date.parse(fix.lastSeen) < PROVIDER_FRESH_MS;
    }
    const traveled = typeof traveledKm === "number" ?
      Math.max(0, traveledKm) :
      0;
    legs.push({
      toShopId,
      km: legKm,
      traveledKm: Math.round(traveled * 1000) / 1000,
      actual,
      at: new Date().toISOString(),
    });
  }
  const total = (typeof ticket.towDistanceMeters === "number" ?
    ticket.towDistanceMeters :
    0) + legKm;
  if (towerId !== "") {
    await dispatchRepository.update(ticketId, {
      towLegs: legs,
      towDistanceMeters: total,
    });
  }
  return legKm;
};
