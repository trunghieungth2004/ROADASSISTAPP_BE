import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import {
  nearProviders,
  servesVehicleClass,
  vehicleClassOf,
} from "../providerService";
import {haversineMeters} from "../../utils/geo";
import {
  MOBILE_SHOP_DEFAULT_RADIUS,
  NEAR_SHOPS_MAX,
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../constants/status";
import {NS} from "./constants";
import {
  requireProviderForTicket,
  towEstimateFor,
} from "./helpers";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";

export const nearDispatchInner = async ({
  userId,
  lat,
  lng,
  radiusMeters = MOBILE_SHOP_DEFAULT_RADIUS,
  ticketType,
  limit = 50,
}: {
  userId?: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  ticketType?: string;
  limit?: number;
}) => {
  let activeTow = false;
  let activeMobileShop = false;
  let mobile: {vehicleClasses?: unknown} | undefined;
  const ownedShopIds: string[] = [];
  if (userId) {
    const me = await userRepository.findById(userId);
    if (!me) return [];
    const operated =
      (await providerRepository.findByOperator(me.id)) ?? [];
    ownedShopIds.push(...operated.map((p) => p.id));
    activeTow = operated.some(
      (p) => p.kind === PROVIDER_KIND.TOW &&
        p.status === PROVIDER_STATUS.ACTIVE,
    );
    mobile = operated.find(
      (p) => p.kind === PROVIDER_KIND.MOBILE_SHOP &&
        p.status === PROVIDER_STATUS.ACTIVE &&
        p.accepting !== false,
    );
    activeMobileShop = mobile !== undefined;
    if (!activeTow && !activeMobileShop) return [];
  }
  const tickets = await dispatchRepository.findByStatusForTypes(
    STATUS_DISPATCH.PENDING,
    ticketType ? [ticketType] : ["SOS", "TOW", "MECHANIC"],
    limit,
  );
  const nearby = tickets
    .filter((t) => {
      if (t.ticketType !== "SOS") return true;
      if (!activeMobileShop || !mobile) return false;
      if (Array.isArray(t.excludedOperatorUids) &&
        t.excludedOperatorUids.includes(userId ?? "")) {
        return false;
      }
      if (Array.isArray(t.excludedShopIds) &&
        t.excludedShopIds.some((id) => ownedShopIds.includes(id))) {
        return false;
      }
      return servesVehicleClass(
        mobile,
        vehicleClassOf(t.vehicleType as string | undefined),
      );
    })
    .map((t) => ({
      ...t,
      distance: haversineMeters(lat, lng, t.lat, t.lng),
    }))
    .filter((t) => (t.distance as number) <= radiusMeters)
    .sort((a, b) => (a.distance as number) - (b.distance as number))
    .slice(0, limit);
  return nearby.map((t) => {
    const row: Record<string, unknown> = {...t};
    const keepPhotos =
      (activeTow && t.ticketType === "TOW") ||
      (activeMobileShop && t.ticketType === "SOS");
    if (!keepPhotos) delete row.photoUrls;
    return row;
  });
};

export const nearDispatchCached = cacheManager.wrap(nearDispatchInner, {
  namespace: NS,
  keyFn: ({
    userId,
    lat,
    lng,
    radiusMeters = MOBILE_SHOP_DEFAULT_RADIUS,
    ticketType,
    limit = 50,
  }: {
    userId?: string;
    lat: number;
    lng: number;
    radiusMeters?: number;
    ticketType?: string;
    limit?: number;
  }) =>
    `${userId ?? "-"},${lat.toFixed(3)},${lng.toFixed(3)},` +
    `${radiusMeters},${ticketType ?? "-"},${limit}`,
});

export const getNearbyDispatch = async ({
  userId,
  lat,
  lng,
  radiusMeters = MOBILE_SHOP_DEFAULT_RADIUS,
  ticketType,
  limit = 50,
}: {
  userId?: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  ticketType?: string;
  limit?: number;
}) =>
  nearDispatchCached({userId, lat, lng, radiusMeters, ticketType, limit});


export const getDispatchOffers = async ({
  lat,
  lng,
  radiusMeters = MOBILE_SHOP_DEFAULT_RADIUS,
  kind,
  limit = NEAR_SHOPS_MAX,
  ticketId,
  minRating,
  sortBy,
}: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  kind?: string;
  limit?: number;
  ticketId?: string;
  minRating?: number;
  sortBy?: string;
}) => {
  const shops = await nearProviders({
    lat,
    lng,
    kind,
    radiusMeters,
    acceptingOnly: true,
    openOnly: false,
    limit,
    ticketId,
    minRating,
    sortBy,
  });
  const liveById = shops.length > 0 ?
    await providerLocationRepository.findByIds(shops.map((s) => s.id)) :
    new Map();
  const cutoff = Date.now() - PROVIDER_FRESH_MS;
  const withLive = shops.map((shop) => {
    const loc = liveById.get(shop.id);
    let plat = shop.lat as number;
    let plng = shop.lng as number;
    let live = false;
    if (shop.kind === PROVIDER_KIND.TOW && loc &&
      typeof loc.lat === "number" && typeof loc.lng === "number" &&
      Date.parse(loc.lastSeen) >= cutoff) {
      plat = loc.lat;
      plng = loc.lng;
      live = true;
    }
    const distance = live ?
      haversineMeters(lat, lng, plat, plng) :
      (shop.distance as number);
    return {...shop, lat: plat, lng: plng, distance, live};
  })
    .filter((s) => (s.distance as number) <= radiusMeters);
  withLive.sort((a, b) => (a.distance as number) - (b.distance as number));
  return withLive.slice(0, limit);
};


export const selectDispatch = async ({
  userId,
  ticketId,
  shopId,
}: {
  userId: string;
  ticketId: string;
  shopId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider selects a provider");
  }
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  if (shop.accepting === false) {
    throw new ValidationError("Provider is not accepting requests");
  }
  requireProviderForTicket(shop, ticket.ticketType);
  const dest = (ticket.destinationSnapshot ??
    ticket.destinationPoint) as {lat?: unknown; lng?: unknown} | null;
  const dLat = typeof dest?.lat === "number" ? dest.lat : shop.lat;
  const dLng = typeof dest?.lng === "number" ? dest.lng : shop.lng;
  const estimate = typeof dLat === "number" && typeof dLng === "number" ?
    towEstimateFor({
      shop,
      ticketLat: ticket.lat,
      ticketLng: ticket.lng,
      destLat: dLat,
      destLng: dLng,
      vehicleType: ticket.vehicleType ?? undefined,
    }) :
    null;
  await dispatchRepository.update(ticketId, {
    suggestedShopId: shopId,
    suggestedTs: new Date().toISOString(),
    ...(estimate === null ? {} : {priceEstimate: estimate}),
    priceCurrency: "VND",
  });
  cacheManager.del(NS);
  return {selected: shopId};
};
