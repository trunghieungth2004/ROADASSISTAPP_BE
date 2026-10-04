import * as alleySegmentRepository from
  "../../repository/alleySegmentRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import {haversineMeters} from "../../utils/geo";
import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  TOW_CLASS_MULTIPLIER_BIKE,
  TOW_CLASS_MULTIPLIER_CAR,
  VOLUNTEER_CAPABILITY,
} from "../../constants/status";
import {vehicleClassOf, servesVehicleClass} from "../providerService";
import {isCarVehicle} from "../../utils/valhalla";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";

export const resolveAccessWidth = async (
  alleySegmentId: string | undefined,
  accessWidthMeters: number | undefined,
): Promise<number | undefined> => {
  if (accessWidthMeters !== undefined) return accessWidthMeters;
  if (!alleySegmentId) return undefined;
  const segment = await alleySegmentRepository.findById(alleySegmentId);
  if (!segment) throw new NotFoundError("Alley segment not found");
  const width = segment.baseWidth as number | null;
  return typeof width === "number" ? width : undefined;
};


export const resolveDestination = async (
  destinationShopId: string | undefined,
  destinationPoint:
    | {lat: number; lng: number; label?: string}
    | undefined,
  ticketType?: string,
  vehicleType?: string,
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
    throw new ForbiddenError("Tickets of this type are volunteer-only");
  }
  if (shop.kind !== expected) {
    throw new ValidationError(`Ticket needs a ${expected} provider`);
  }
};


export const volunteerFitsTicket = (
  capability: unknown,
  vehicleType: string | undefined,
): boolean => {
  if (!isCarVehicle(vehicleType)) return true;
  return capability === VOLUNTEER_CAPABILITY.CAR;
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
