import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import {haversineMeters} from "../../utils/geo";
import {costingForVehicle, postRoute} from "../../utils/valhalla";
import {enqueueDispatchPush} from "../taskQueueService";
import {NS} from "./constants";
import {roundFare, stampTowFare} from "./fare";
import {chatService} from "../chatService";
import {
  estimateTowEta,
  requireProviderForTicket,
} from "./helpers";
import {
  HELPER_KIND,
  MOBILE_SHOP_CALL_OUT_FEE,
  MOBILE_SHOP_CALL_OUT_WAIVER_M,
  MOBILE_SHOP_TRAVEL_PER_KM,
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {ConflictError, ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import {logError, logWarn} from "../../utils/logger";
import * as cacheManager from "../../utils/cacheManager";
import {providerBlocked} from "./providerEligibility";

export const mobileVisitNotice = (
  ticket: Record<string, unknown>,
): {body: string; chat: string} => {
  const callOut = typeof ticket.mobileCallOutFee === "number" ?
    Math.round(ticket.mobileCallOutFee) :
    0;
  const travel = typeof ticket.mobileTravelFee === "number" ?
    Math.round(ticket.mobileTravelFee) :
    0;
  const waived = ticket.mobileCallOutWaived === true;
  const km = typeof ticket.mobileTravelKm === "number" ?
    ticket.mobileTravelKm :
    null;
  const rate = typeof ticket.mobileTravelRate === "number" ?
    Math.round(ticket.mobileTravelRate) :
    0;
  const money = (value: number): string => `${value.toLocaleString("en-US")} VND`;
  const total = (waived ? 0 : callOut) + travel;
  if (total <= 0) {
    return {
      body: "No call-out or travel fee. Repair is quoted separately.",
      chat: "Mobile shop accepted. No call-out or travel fee. Repair is quoted separately.",
    };
  }
  const callOutPart = waived ?
    "call-out waived (shop within 1 km)" :
    callOut > 0 ?
      `call-out ${money(callOut)}` :
      "no call-out fee";
  const travelPart = travel > 0 ?
    `travel ${money(travel)}` :
    "no travel fee";
  const detail = `${callOutPart} + ${travelPart}`;
  const distance = travel > 0 && km !== null && km > 0 ?
    ` (${km.toFixed(1)} km${rate > 0 ? ` × ${money(rate)}/km` : ""})` :
    "";
  return {
    body: `Visit estimate ${money(total)} — ${detail}. Repair is quoted separately.`,
    chat: `Mobile shop accepted. Visit estimate ${money(total)} — ${detail}${distance}. ` +
      "Travel is not charged if the vehicle is marked unfixable. Repair is quoted separately.",
  };
};

export const acceptAsShop = async (
  userId: string,
  ticketId: string,
  shopId: string,
) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = shop.operatorUid as string | null;
  if (operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator accepts for this provider");
  }
  if (Array.isArray(ticket.excludedShopIds) &&
    ticket.excludedShopIds.includes(shopId)) {
    throw new ForbiddenError("This shop is excluded from the ticket");
  }
  if (Array.isArray(ticket.excludedOperatorUids) &&
    ticket.excludedOperatorUids.includes(userId)) {
    throw new ForbiddenError("This operator is excluded from the ticket");
  }
  requireProviderForTicket(shop, ticket.ticketType);
  if (providerBlocked(shop)) {
    throw new ValidationError("Provider is not available");
  }
  if (shop.accepting === false) {
    throw new ValidationError("Provider is not accepting requests");
  }
  if (typeof ticket.providerId === "string" && ticket.providerId !== "" &&
    ticket.providerId !== shopId) {
    throw new ForbiddenError("Ticket is addressed to another provider");
  }
  if (shop.kind === PROVIDER_KIND.TOW &&
    (typeof shop.plate !== "string" ||
      shop.plate === "")) {
    throw new ForbiddenError("Approved tow provider required");
  }
  if (shop.kind === PROVIDER_KIND.TOW ||
    shop.kind === PROVIDER_KIND.MOBILE_SHOP) {
    const operatorUid = typeof shop.operatorUid === "string" ?
      shop.operatorUid :
      "";
    const operated = operatorUid !== "" ?
      (await providerRepository.findByOperator(operatorUid)) ?? [] :
      [];
    for (const provider of operated) {
      if (provider.kind !== PROVIDER_KIND.TOW &&
        provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
        continue;
      }
      const active =
        (await dispatchRepository.findActiveForShop(provider.id)) ?? [];
      if (active.length > 0) {
        throw new ConflictError("Provider already has an active ticket");
      }
    }
  }
  const mobileFees: Record<string, unknown> = {};
  if (shop.kind === PROVIDER_KIND.MOBILE_SHOP &&
    ticket.ticketType === "SOS") {
    const fixes = await providerLocationRepository.findByIds([shopId]);
    const fix = fixes.get(shopId);
    const fresh = fix &&
      typeof fix.lat === "number" &&
      typeof fix.lng === "number" &&
      typeof fix.lastSeen === "string" &&
      Date.now() - Date.parse(fix.lastSeen) < PROVIDER_FRESH_MS;
    const origin = fresh && fix ?
      {lat: fix.lat, lng: fix.lng} :
      typeof shop.lat === "number" && typeof shop.lng === "number" ?
        {lat: shop.lat, lng: shop.lng} :
        null;
    let travelKm: number | null = null;
    let travelSource: string | null = null;
    if (origin !== null) {
      try {
        const route = await postRoute(
          [
            {lat: origin.lat, lng: origin.lng},
            {lat: ticket.lat, lng: ticket.lng},
          ],
          [],
          costingForVehicle(shop.vehicleType ?? undefined),
        );
        const meters = route.distanceMeters;
        if (typeof meters === "number" && meters > 0) {
          travelKm = meters / 1000;
          travelSource = fresh ? "ROUTE" : "PROVIDER_BASE";
        }
      } catch (err) {
        logWarn("dispatch", "sos-travel-route-fallback", {
          ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (travelKm === null) {
        travelKm = haversineMeters(
          ticket.lat,
          ticket.lng,
          origin.lat,
          origin.lng,
        ) / 1000;
        travelSource = fresh ? "FALLBACK" : "PROVIDER_BASE";
      }
    }
    const waived = travelKm !== null &&
      travelKm * 1000 <= MOBILE_SHOP_CALL_OUT_WAIVER_M;
    const callOutFee = typeof shop.callOutFee === "number" ?
      shop.callOutFee :
      MOBILE_SHOP_CALL_OUT_FEE;
    const travelPerKm = typeof shop.travelPerKmFee === "number" ?
      shop.travelPerKmFee :
      MOBILE_SHOP_TRAVEL_PER_KM;
    mobileFees.mobileCallOutFee = waived ? 0 : callOutFee;
    mobileFees.mobileCallOutWaived = waived;
    mobileFees.mobileTravelKm = travelKm;
    mobileFees.mobileTravelRate = travelPerKm;
    mobileFees.mobileTravelSource = travelSource;
    mobileFees.mobileTravelFee = travelKm !== null ?
      roundFare(travelKm * travelPerKm) :
      0;
  }
  const claimed = await dispatchRepository.claimForAssignment(ticketId, {
    assignedShopId: shopId,
    assignedAt: new Date().toISOString(),
    assignedKind: shop.kind === PROVIDER_KIND.TOW ?
      HELPER_KIND.TOW :
      shop.kind === PROVIDER_KIND.MOBILE_SHOP ?
        HELPER_KIND.MOBILE_SHOP :
        HELPER_KIND.SHOP,
    status: STATUS_DISPATCH.MATCHED,
    cancelledBy: null,
    ...mobileFees,
    ...(ticket.ticketType === "WALK_IN" &&
    typeof shop.serviceFee === "number" ?
      {priceEstimate: shop.serviceFee, priceCurrency: "VND"} :
      {}),
  }, userId);
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  await chatService.addSystemEvent(
    ticketId,
    "The provider accepted the request.",
    "ACCEPTED",
    {kind: shop.kind},
  );
  if (shop.kind === PROVIDER_KIND.TOW) {
    await providerRepository.update(shopId, {accepting: false});
  }
  if (ticket.ticketType === "TOW") {
    await stampTowEta(ticketId, ticket, shopId);
    await stampTowFare(ticketId, ticket, shopId);
  }
  const fresh = await dispatchRepository.findById(ticketId);
  let acceptNotice: {title: string; body: string} | null = null;
  if (fresh && ticket.ticketType === "TOW") {
    const fare = fresh.towFare as {estimate?: unknown} | null | undefined;
    const estimate = typeof fare?.estimate === "number" ? fare.estimate : null;
    const fareText = estimate !== null ?
      Math.round(estimate).toLocaleString("en-US") :
      null;
    const feeText = fareText !== null ?
      `Tow accepted. Estimated fare ${fareText} VND.` :
      "Tow accepted.";
    await chatService.addSystemEvent(ticketId, feeText);
    acceptNotice = {title: "Tow accepted", body: feeText};
  }
  if (fresh && ticket.ticketType === "SOS") {
    const notice = mobileVisitNotice(fresh);
    await chatService.addSystemEvent(ticketId, notice.chat);
    acceptNotice = {title: "Mobile shop accepted", body: notice.body};
  }
  cacheManager.del(NS);
  cacheManager.del("shop");
  cacheManager.del("provider");
  await enqueueDispatchPush(
    ticketId,
    `-status-${STATUS_DISPATCH.MATCHED}-rider`,
    {audience: "rider", ...(acceptNotice ?? {})},
  );
  return {
    matched: true,
    kind: shop.kind === PROVIDER_KIND.TOW ?
      HELPER_KIND.TOW :
      shop.kind === PROVIDER_KIND.MOBILE_SHOP ?
        HELPER_KIND.MOBILE_SHOP :
        HELPER_KIND.SHOP,
  };
};

export const stampTowEta = async (
  ticketId: string,
  ticket: {
    lat: number;
    lng: number;
    vehicleType?: unknown;
    destinationShopId?: unknown;
    destinationPoint?: unknown;
  },
  shopId: string,
): Promise<void> => {
  try {
    const fixes = await providerLocationRepository.findByIds([shopId]);
    const fix = fixes.get(shopId);
    if (!fix || typeof fix.lat !== "number" || typeof fix.lng !== "number" ||
      typeof fix.lastSeen !== "string" ||
      Date.now() - Date.parse(fix.lastSeen) >= PROVIDER_FRESH_MS) {
      return;
    }
    const towerLat = fix.lat;
    const towerLng = fix.lng;
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
    const eta = await estimateTowEta({
      towerLat,
      towerLng,
      ticketLat: ticket.lat,
      ticketLng: ticket.lng,
      ...(destLat !== undefined && destLng !== undefined ?
        {destLat, destLng} :
        {}),
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleType: ticket.vehicleType} :
        {}),
    });
    if (!eta) return;
    const now = Date.now();
    await dispatchRepository.update(ticketId, {
      etaPickupAt: new Date(now + eta.pickupSeconds * 1000).toISOString(),
      etaDropoffAt: eta.dropoffSeconds === null ?
        null :
        new Date(now + eta.dropoffSeconds * 1000).toISOString(),
      etaNotifiedAt: null,
    });
  } catch (err) {
    logError("dispatch", "tow-eta-stamp-failed", {ticketId}, err);
    return;
  }
};

export const acceptDispatch = async ({
  userId,
  ticketId,
  shopId,
}: {
  userId: string;
  ticketId: string;
  shopId?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  if (!shopId) {
    throw new ValidationError("A provider is required to accept this ticket");
  }
  return acceptAsShop(userId, ticketId, shopId);
};
