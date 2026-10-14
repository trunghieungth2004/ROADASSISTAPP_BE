import {
  NIGHT_END_MINUTES,
  NIGHT_START_MINUTES,
  TOW_FARE,
  TOW_FARE_CEILING,
  TOW_FARE_NIGHT_MULT,
} from "./constants";
import {
  TOW_CLASS_MULTIPLIER_BIKE,
  TOW_CLASS_MULTIPLIER_CAR,
  PROVIDER_FRESH_MS,
  VEHICLE_CLASS,
} from "../../constants/status";
import {isCarVehicle, postRoute} from "../../utils/valhalla";
import {vehicleClassOf} from "../providerService";
import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as providerRepository from
  "../../repository/providerRepository";

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export const isNightFare = (now: Date = new Date()): boolean => {
  const shifted = new Date(now.getTime() + ICT_OFFSET_MS);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return minutes >= NIGHT_START_MINUTES || minutes < NIGHT_END_MINUTES;
};

export const roundFare = (amount: number): number =>
  Math.round(amount / 1000) * 1000;

export type TowFareQuote = {
  estimate: number;
  ceiling: number;
  deadheadKm: number;
  loadedKm: number;
  night: boolean;
  vehicleClass: string;
};

export const nightMult = (night: boolean): number =>
  night ? TOW_FARE_NIGHT_MULT : 1;

export const quoteTowFare = ({
  vehicleClass,
  night,
  deadheadKm,
  loadedKm,
}: {
  vehicleClass?: string;
  night: boolean;
  deadheadKm: number;
  loadedKm: number;
}): TowFareQuote => {
  const table = vehicleClass === VEHICLE_CLASS.CAR ?
    TOW_FARE.CAR :
    TOW_FARE.SOLO_BIKE;
  const classMult = vehicleClass === VEHICLE_CLASS.CAR ?
    TOW_CLASS_MULTIPLIER_CAR :
    TOW_CLASS_MULTIPLIER_BIKE;
  const billable = Math.max(0, loadedKm - table.includedKm);
  const estimate = roundFare(
    nightMult(night) * classMult *
    (table.base + table.perKm * billable),
  );
  return {
    estimate,
    ceiling: roundFare(estimate * TOW_FARE_CEILING),
    deadheadKm,
    loadedKm,
    night,
    vehicleClass: vehicleClass ?? VEHICLE_CLASS.SOLO_BIKE,
  };
};

export const settleTowFare = (quote: TowFareQuote): number =>
  Math.min(quote.estimate, quote.ceiling);

export const partialTowFare = ({
  vehicleClass,
  night,
  deadheadKm,
}: {
  vehicleClass?: string;
  night: boolean;
  deadheadKm: number;
}): number => {
  const table = vehicleClass === VEHICLE_CLASS.CAR ?
    TOW_FARE.CAR :
    TOW_FARE.SOLO_BIKE;
  const classMult = vehicleClass === VEHICLE_CLASS.CAR ?
    TOW_CLASS_MULTIPLIER_CAR :
    TOW_CLASS_MULTIPLIER_BIKE;
  return roundFare(
    nightMult(night) * classMult * table.perKm * Math.max(0, deadheadKm),
  );
};

export const quoteTowFareForRoute = async ({
  vehicleType,
  towerLat,
  towerLng,
  ticketLat,
  ticketLng,
  destLat,
  destLng,
  now,
}: {
  vehicleType?: string;
  towerLat: number;
  towerLng: number;
  ticketLat: number;
  ticketLng: number;
  destLat?: number;
  destLng?: number;
  now?: Date;
}): Promise<TowFareQuote | null> => {
  try {
    const costing = isCarVehicle(vehicleType) ? "auto" : "motor_scooter";
    const deadhead = await postRoute(
      [{lat: towerLat, lng: towerLng}, {lat: ticketLat, lng: ticketLng}],
      [],
      costing,
    );
    let loadedKm = 0;
    if (typeof destLat === "number" && typeof destLng === "number") {
      const loaded = await postRoute(
        [{lat: ticketLat, lng: ticketLng}, {lat: destLat, lng: destLng}],
        [],
        costing,
      );
      loadedKm = (loaded.distanceMeters ?? 0) / 1000;
    }
    return quoteTowFare({
      vehicleClass: vehicleClassOf(vehicleType),
      night: isNightFare(now),
      deadheadKm: (deadhead.distanceMeters ?? 0) / 1000,
      loadedKm,
    });
  } catch {
    return null;
  }
};

export const actualDeadheadKm = (towLegs: unknown): number => {
  if (!Array.isArray(towLegs)) return 0;
  return towLegs.reduce((sum, leg) => {
    if (typeof leg !== "object" || leg === null) return sum;
    const entry = leg as {km?: unknown; actual?: unknown};
    if (entry.actual !== true || typeof entry.km !== "number") return sum;
    return sum + entry.km / 1000;
  }, 0);
};

export const stampTowFare = async (
  ticketId: string,
  ticket: {
    lat: number;
    lng: number;
    vehicleType?: unknown;
    destinationShopId?: unknown;
    destinationPoint?: unknown;
    towFare?: {ceiling?: unknown} | null;
  },
  shopId: string,
): Promise<void> => {
  try {
    const fixes = await providerLocationRepository.findByIds([shopId]);
    const fix = fixes.get(shopId);
    const fresh = fix && typeof fix.lat === "number" &&
      typeof fix.lng === "number" &&
      typeof fix.lastSeen === "string" &&
      Date.now() - Date.parse(fix.lastSeen) < PROVIDER_FRESH_MS;
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
    const tower = fresh ?
      {lat: fix.lat, lng: fix.lng} :
      {lat: ticket.lat, lng: ticket.lng};
    const quote = await quoteTowFareForRoute({
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleType: ticket.vehicleType} :
        {}),
      towerLat: tower.lat,
      towerLng: tower.lng,
      ticketLat: ticket.lat,
      ticketLng: ticket.lng,
      ...(destLat !== undefined && destLng !== undefined ?
        {destLat, destLng} :
        {}),
    });
    if (!quote) return;
    const priorCeiling = ticket.towFare &&
      typeof ticket.towFare.ceiling === "number" ?
      ticket.towFare.ceiling :
      null;
    const estimate = priorCeiling === null ?
      quote.estimate :
      Math.min(quote.estimate, priorCeiling);
    await dispatchRepository.update(ticketId, {
      towFare: {
        ...quote,
        estimate,
        ceiling: priorCeiling ?? quote.ceiling,
        final: null,
      },
    });
  } catch {
    return;
  }
};
