import * as providerRepository from "../../../repository/providerRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import {PROVIDER_FRESH_MS} from "../../../constants/status";
import {ARRIVAL_RADIUS_M} from "../constants";
import {haversineMeters} from "../../../utils/geo";
import {ValidationError} from "../../../utils/errors";

type TicketLike = {
  ticketType?: unknown;
  assignedShopId?: unknown;
  providerId?: unknown;
  destinationShopId?: unknown;
  destinationPoint?: unknown;
  destinationSnapshot?: unknown;
};

const coordsOf = (value: unknown): {lat: number; lng: number} | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as {lat?: unknown; lng?: unknown};
  return typeof row.lat === "number" && typeof row.lng === "number" ?
    {lat: row.lat, lng: row.lng} :
    null;
};

export const assertNearTowDestination = async (
  ticket: TicketLike,
): Promise<void> => {
  if (ticket.ticketType !== "TOW") return;
  const towerId = typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "" ?
    ticket.assignedShopId :
    typeof ticket.providerId === "string" ? ticket.providerId : "";
  if (towerId === "") return;
  let dest = coordsOf(ticket.destinationPoint) ??
    coordsOf(ticket.destinationSnapshot);
  const destinationShopId =
    typeof ticket.destinationShopId === "string" ?
      ticket.destinationShopId :
      "";
  if (destinationShopId !== "") {
    const shop = await providerRepository.findById(destinationShopId);
    const shopCoords = shop && typeof shop.lat === "number" &&
      typeof shop.lng === "number" ?
      {lat: shop.lat, lng: shop.lng} :
      null;
    if (shopCoords !== null) dest = shopCoords;
  }
  if (dest === null) return;
  const fixes = await providerLocationRepository.findByIds([towerId]);
  const fix = fixes.get(towerId);
  if (!fix || typeof fix.lat !== "number" ||
    typeof fix.lng !== "number" ||
    typeof fix.lastSeen !== "string" ||
    Date.now() - Date.parse(fix.lastSeen) >= PROVIDER_FRESH_MS) {
    return;
  }
  const meters = Math.round(haversineMeters(fix.lat, fix.lng,
    dest.lat, dest.lng));
  if (meters > ARRIVAL_RADIUS_M) {
    throw new ValidationError(
      "Too far from the drop-off point to mark delivered",
    );
  }
};
