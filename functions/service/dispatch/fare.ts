import {
  NIGHT_END_MINUTES,
  NIGHT_START_MINUTES,
  TOW_FARE,
  TOW_FARE_CEILING,
  TOW_FARE_NIGHT_MULT,
} from "./constants";
import {
  PROVIDER_FRESH_MS,
  VEHICLE_CLASS,
} from "../../constants/status";
import {isCarVehicle, postRoute} from "../../utils/valhalla";
import {vehicleClassOf} from "../providerService";
import {haversineMeters} from "../../utils/geo";
import {logError, logWarn} from "../../utils/logger";
import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import * as platformConfigService from "../platformConfigService";

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export type TowRateTable = {
  base: number;
  perKm: number;
  includedKm: number;
};

export type TowRates = {
  SOLO_BIKE: TowRateTable;
  CAR: TowRateTable;
  nightMultiplier: number;
  nightWindow: {start: number; end: number};
  ceilingMultiplier: number;
  minimumFee: number;
  deadheadPayable: boolean;
};

export const DEFAULT_TOW_RATES: TowRates = {
  SOLO_BIKE: {...TOW_FARE.SOLO_BIKE},
  CAR: {...TOW_FARE.CAR},
  nightMultiplier: TOW_FARE_NIGHT_MULT,
  nightWindow: {
    start: NIGHT_START_MINUTES / 60,
    end: NIGHT_END_MINUTES / 60,
  },
  ceilingMultiplier: TOW_FARE_CEILING,
  minimumFee: 0,
  deadheadPayable: true,
};

export const isNightFare = (
  now: Date = new Date(),
  window: {start: number; end: number} = DEFAULT_TOW_RATES.nightWindow,
): boolean => {
  const shifted = new Date(now.getTime() + ICT_OFFSET_MS);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const start = window.start * 60;
  const end = window.end * 60;
  return minutes >= start || minutes < end;
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

export const nightMult = (
  night: boolean,
  multiplier: number = TOW_FARE_NIGHT_MULT,
): number => night ? multiplier : 1;

export const quoteTowFare = ({
  vehicleClass,
  night,
  deadheadKm,
  loadedKm,
  rates = DEFAULT_TOW_RATES,
}: {
  vehicleClass?: string;
  night: boolean;
  deadheadKm: number;
  loadedKm: number;
  rates?: TowRates;
}): TowFareQuote => {
  const table = vehicleClass === VEHICLE_CLASS.CAR ?
    rates.CAR :
    rates.SOLO_BIKE;
  const billable = Math.max(0, loadedKm - table.includedKm);
  const estimate = roundFare(
    Math.max(
      rates.minimumFee,
      nightMult(night, rates.nightMultiplier) *
        (table.base + table.perKm * billable),
    ),
  );
  return {
    estimate,
    ceiling: roundFare(estimate * rates.ceilingMultiplier),
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
  rates = DEFAULT_TOW_RATES,
}: {
  vehicleClass?: string;
  night: boolean;
  deadheadKm: number;
  rates?: TowRates;
}): number => {
  if (!rates.deadheadPayable) return 0;
  const table = vehicleClass === VEHICLE_CLASS.CAR ?
    rates.CAR :
    rates.SOLO_BIKE;
  return roundFare(
    nightMult(night, rates.nightMultiplier) *
      table.perKm * Math.max(0, deadheadKm),
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
  rates = DEFAULT_TOW_RATES,
}: {
  vehicleType?: string;
  towerLat: number;
  towerLng: number;
  ticketLat: number;
  ticketLng: number;
  destLat?: number;
  destLng?: number;
  now?: Date;
  rates?: TowRates;
}): Promise<TowFareQuote | null> => {
  const costing = isCarVehicle(vehicleType) ? "auto" : "motor_scooter";
  let deadheadKm = 0;
  let loadedKm = 0;
  try {
    const deadhead = await postRoute(
      [{lat: towerLat, lng: towerLng}, {lat: ticketLat, lng: ticketLng}],
      [],
      costing,
    );
    deadheadKm = (deadhead.distanceMeters ?? 0) / 1000;
    if (typeof destLat === "number" && typeof destLng === "number") {
      const loaded = await postRoute(
        [{lat: ticketLat, lng: ticketLng}, {lat: destLat, lng: destLng}],
        [],
        costing,
      );
      loadedKm = (loaded.distanceMeters ?? 0) / 1000;
    }
  } catch (err) {
    logWarn("dispatch", "tow-fare-route-fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    deadheadKm = haversineMeters(towerLat, towerLng, ticketLat, ticketLng) /
      1000;
    if (typeof destLat === "number" && typeof destLng === "number") {
      loadedKm = haversineMeters(ticketLat, ticketLng, destLat, destLng) /
        1000;
    }
  }
  return quoteTowFare({
    vehicleClass: vehicleClassOf(vehicleType),
    night: isNightFare(now, rates.nightWindow),
    deadheadKm,
    loadedKm,
    rates,
  });
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
    const rates = await platformConfigService.getTowRates()
      .catch(() => DEFAULT_TOW_RATES);
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
      rates,
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
  } catch (err) {
    logError("dispatch", "tow-fare-stamp-failed", {ticketId}, err);
    return;
  }
};
