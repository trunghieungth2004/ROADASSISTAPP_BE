import {PROVIDER_NS, SHOP_NS} from "./crud";
import {isOpenNow, nextTransition, servesVehicleClass} from "./schedule";
import * as providerRepository from "../../repository/providerRepository";
import * as dispatchRepository from "../../repository/dispatchRepository";

import * as userRepository from "../../repository/userRepository";

import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  haversineMeters,
} from "../../utils/geo";
import {
  NEAR_SHOPS_MAX,
  PROVIDER_STATUS,
  VEHICLE_CLASS,
} from "../../constants/status";
import {TOW_FARE} from "../../constants/dispatch";

import {normalizeVehicleType} from "../../utils/vehicleType";
import {costingForVehicle, postRoute} from "../../utils/valhalla";
import {logWarn} from "../../utils/logger";

import {NotFoundError} from "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";
import * as platformConfigService from "../platformConfigService";
import {
  compareShopPrice,
  estimateShopPrice,
  type ShopPriceEstimate,
} from "./priceRank";

const myProvidersInner = async ({userId}: {userId: string}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const rows = await providerRepository.findByOperator(userId);
  return rows.map((provider) => {
    const vehicleType = normalizeVehicleType(provider.vehicleType);
    return vehicleType !== null ?
      {...provider, vehicleType} :
      provider;
  });
};

const myProvidersCached = cacheManager.wrap(myProvidersInner, {
  namespace: PROVIDER_NS,
  keyFn: ({userId}: {userId: string}) => userId,
});

export const getMyProviders = async ({userId}: {userId: string}) =>
  myProvidersCached({userId});

export const getProviderPricingLimits = async () => {
  const config = await platformConfigService.getConfig();
  return config.providerPricing;
};

const declinedSetForTicket = async (
  ticketId?: string,
): Promise<Set<string>> => {
  if (!ticketId) return new Set();
  try {
    const ticket = await dispatchRepository.findById(ticketId);
    const ids = ticket?.declinedShopIds;
    if (Array.isArray(ids)) return new Set(ids as string[]);
    return new Set();
  } catch {
    return new Set();
  }
};

type SearchExtrasRow = {
  distance?: unknown;
  ratingAvg?: unknown;
  id: string;
};

type PriceFields = Partial<ShopPriceEstimate>;

type PriceRow = {
  id: string;
  lat: number;
  lng: number;
  distance: number;
  openNow?: unknown;
  ratingAvg?: unknown;
  services?: unknown;
  serviceFee?: unknown;
} & PriceFields;

const PRICE_ROUTE_TOP_N = 12;

const perKmForClass = async (vehicleClass?: string): Promise<number> => {
  const rates = await platformConfigService.getTowRates()
    .catch(() => null);
  if (vehicleClass === VEHICLE_CLASS.CAR) {
    return rates?.CAR.perKm ?? TOW_FARE.CAR.perKm;
  }
  return rates?.SOLO_BIKE.perKm ?? TOW_FARE.SOLO_BIKE.perKm;
};

const withPriceEstimate = (
  row: PriceRow,
  {
    vehicleClass,
    serviceCategory,
    perKm,
  }: {
    vehicleClass?: string;
    serviceCategory?: string;
    perKm: number;
  },
): PriceRow => ({
  ...row,
  ...estimateShopPrice({
    provider: row,
    distanceMeters: row.distance,
    vehicleClass,
    serviceCategory,
    perKm,
  }),
});

const routePriceRows = async (
  rows: PriceRow[],
  {
    lat,
    lng,
    vehicleClass,
    serviceCategory,
    perKm,
  }: {
    lat: number;
    lng: number;
    vehicleClass?: string;
    serviceCategory?: string;
    perKm: number;
  },
): Promise<PriceRow[]> => {
  const top = [...rows]
    .filter((row) => typeof row.estimatedTotal === "number")
    .sort(compareShopPrice)
    .slice(0, PRICE_ROUTE_TOP_N);
  await Promise.all(top.map(async (row) => {
    try {
      const route = await postRoute(
        [{lat, lng}, {lat: row.lat, lng: row.lng}],
        [],
        costingForVehicle(
          vehicleClass === VEHICLE_CLASS.CAR ? "CAR" : undefined,
        ),
      );
      if (typeof route.distanceMeters !== "number" ||
        route.distanceMeters <= 0) {
        return;
      }
      Object.assign(row, withPriceEstimate(
        {...row, distance: route.distanceMeters},
        {vehicleClass, serviceCategory, perKm},
      ));
    } catch (err) {
      logWarn("providers", "price-route-fallback", {
        providerId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }));
  return rows.sort(compareShopPrice);
};

const priceSortedRows = async (
  rows: PriceRow[],
  {
    lat,
    lng,
    vehicleClass,
    serviceCategory,
  }: {
    lat: number;
    lng: number;
    vehicleClass?: string;
    serviceCategory?: string;
  },
): Promise<PriceRow[]> => {
  const perKm = await perKmForClass(vehicleClass);
  const priced = rows.map((row) => withPriceEstimate(row, {
    vehicleClass,
    serviceCategory,
    perKm,
  }));
  return routePriceRows(priced, {
    lat,
    lng,
    vehicleClass,
    serviceCategory,
    perKm,
  });
};

const toPublicProvider = (
  provider: providerRepository.Provider & {
    distance?: unknown;
    openNow?: unknown;
    closesInMinutes?: unknown;
  } & PriceFields,
): Record<string, unknown> => ({
  ...(provider.pricingMode !== undefined ? {
    estimatedServicePrice: provider.estimatedServicePrice ?? null,
    estimatedTravelFee: provider.estimatedTravelFee ?? null,
    estimatedTotal: provider.estimatedTotal ?? null,
    pricingMode: provider.pricingMode,
    matchedServiceCode: provider.matchedServiceCode ?? null,
    matchedServiceName: provider.matchedServiceName ?? null,
    estimatedDistanceKm: provider.estimatedDistanceKm ?? null,
  } : {}),
  id: provider.id,
  kind: provider.kind,
  name: provider.name,
  lat: provider.lat,
  lng: provider.lng,
  label: provider.label ?? null,
  openHours: provider.openHours ?? null,
  vehicleClasses: provider.vehicleClasses ?? null,
  services: Array.isArray(provider.services) ? provider.services : [],
  serviceFee: provider.serviceFee ?? null,
  accepting: provider.accepting === true,
  bookingEnabled: provider.bookingEnabled === true,
  plate: provider.plate ?? null,
  plateRaw: provider.plateRaw ?? null,
  vehicleType: provider.vehicleType ?? null,
  vehicleWidth: provider.vehicleWidth ?? null,
  towBaseFee: provider.towBaseFee ?? null,
  towPerKmFee: provider.towPerKmFee ?? null,
  callOutFee: provider.callOutFee ?? null,
  travelPerKmFee: provider.travelPerKmFee ?? null,
  status: provider.status,
  ratingAvg: typeof provider.ratingAvg === "number" ?
    provider.ratingAvg :
    0,
  ratingCount: typeof provider.ratingCount === "number" ?
    provider.ratingCount :
    0,
  distance: provider.distance,
  openNow: provider.openNow ?? null,
  closesInMinutes: provider.closesInMinutes ?? null,
});

const withSearchExtras = <T extends SearchExtrasRow>(
  rows: T[],
  declined: Set<string>,
): Array<T & Record<string, unknown> & {
  distanceMeters: number | null;
  ratingAvg: number;
  ratingCount: unknown;
  declined: boolean;
}> => {
  return rows.map((s) => ({
    ...toPublicProvider(s as T & providerRepository.Provider),
    distanceMeters: typeof s.distance === "number" ? s.distance : null,
    ratingAvg: typeof s.ratingAvg === "number" ? s.ratingAvg : 0,
    ratingCount: (s as {ratingCount?: unknown}).ratingCount ?? 0,
    declined: declined.has(s.id),
  })) as Array<T & Record<string, unknown> & {
    distanceMeters: number | null;
    ratingAvg: number;
    ratingCount: unknown;
    declined: boolean;
  }>;
};

const nearProvidersInner = async ({
  lat,
  lng,
  kind,
  radiusMeters = 2000,
  acceptingOnly = false,
  openOnly = false,
  vehicleClass,
  serviceCategory,
  limit = NEAR_SHOPS_MAX,
  minRating,
  sortBy,
  ticketId,
  now,
}: {
  lat: number;
  lng: number;
  kind?: string;
  radiusMeters?: number;
  acceptingOnly?: boolean;
  openOnly?: boolean;
  vehicleClass?: string;
  serviceCategory?: string;
  limit?: number;
  minRating?: number;
  sortBy?: string;
  ticketId?: string;
  now?: Date;
}) => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const found = await providerRepository.findByGeohashPrefixes(
    cellsCoveringBounds(bounds, 6),
  );
  const at = now ?? new Date();
  let filtered = found
    .filter((s) => s.status === PROVIDER_STATUS.ACTIVE &&
      (s as {suspended?: boolean}).suspended !== true)
    .map((s) => {
      const distance = haversineMeters(
        lat,
        lng,
        s.lat as number,
        s.lng as number,
      );
      const openNow = isOpenNow(s.openHours as string | null, at);
      const closesInMinutes = openNow === true ?
        nextTransition(s.openHours as string | null, at) :
        null;
      return {...s, distance, openNow, closesInMinutes};
    })
    .filter((s) => (s.distance as number) <= radiusMeters);
  if (kind) filtered = filtered.filter((s) => s.kind === kind);
  if (acceptingOnly) {
    filtered = filtered.filter((s) => s.accepting !== false);
  }
  if (openOnly) filtered = filtered.filter((s) => s.openNow === true);
  if (vehicleClass) {
    filtered = filtered.filter((s) => servesVehicleClass(s, vehicleClass));
  }
  if (serviceCategory) {
    filtered = filtered.filter((s) => {
      const services = Array.isArray(s.services) ? s.services : [];
      return services.some((service) =>
        (service as {category?: unknown}).category === serviceCategory);
    });
  }
  if (typeof minRating === "number") {
    filtered = filtered.filter((s) => {
      const avg = typeof s.ratingAvg === "number" ? s.ratingAvg : 0;
      return avg >= (minRating as number);
    });
  }
  if (sortBy === "price") {
    let priceCategory = serviceCategory;
    if (priceCategory === undefined && ticketId !== undefined) {
      try {
        const ticket = await dispatchRepository.findById(ticketId);
        if (typeof ticket?.symptom === "string") {
          priceCategory = ticket.symptom;
        }
      } catch {
        void 0;
      }
    }
    filtered = await priceSortedRows(
      filtered as unknown as PriceRow[],
      {
        lat,
        lng,
        vehicleClass,
        serviceCategory: priceCategory,
      },
    ) as unknown as typeof filtered;
  } else if (sortBy === "rating") {
    filtered.sort((a, b) => {
      const ar = typeof a.ratingAvg === "number" ? a.ratingAvg : 0;
      const br = typeof b.ratingAvg === "number" ? b.ratingAvg : 0;
      if (br !== ar) return br - ar;
      return (a.distance as number) - (b.distance as number);
    });
  } else {
    filtered.sort((a, b) => {
      const rank = (s: {openNow?: unknown}): number => {
        if (s.openNow === true) return 0;
        if (s.openNow === null || s.openNow === undefined) return 1;
        return 2;
      };
      const byState = rank(a) - rank(b);
      if (byState !== 0) return byState;
      return (a.distance as number) - (b.distance as number);
    });
  }
  const sliced = filtered.slice(0, limit);
  const declined = await declinedSetForTicket(ticketId);
  return withSearchExtras(sliced, declined);
};

const nearProvidersCached = cacheManager.wrap(nearProvidersInner, {
  namespace: SHOP_NS,
  keyFn: ({
    lat,
    lng,
    kind,
    radiusMeters = 2000,
    acceptingOnly = false,
    openOnly = false,
    vehicleClass,
    serviceCategory,
    limit = NEAR_SHOPS_MAX,
    minRating,
    sortBy,
    ticketId,
    now,
  }: {
    lat: number;
    lng: number;
    kind?: string;
    radiusMeters?: number;
    acceptingOnly?: boolean;
    openOnly?: boolean;
    vehicleClass?: string;
    serviceCategory?: string;
    limit?: number;
    minRating?: number;
    sortBy?: string;
    ticketId?: string;
    now?: Date;
  }) => {
    const at = now ?? new Date();
    const minute = Math.floor(at.getTime() / 60000);
    return `${lat.toFixed(3)},${lng.toFixed(3)},${kind ?? "-"},` +
      `${radiusMeters},${acceptingOnly ? "1" : "0"},` +
      `${openOnly ? "1" : "0"},${vehicleClass ?? "-"},` +
      `${serviceCategory ?? "-"},` +
      `${limit},${minute},${minRating ?? "-"},${sortBy ?? "-"},` +
      `${ticketId ?? "-"}`;
  },
});

export const getNearbyProviders = async ({
  lat,
  lng,
  kind,
  radiusMeters = 2000,
  acceptingOnly = false,
  openOnly = false,
  vehicleClass,
  serviceCategory,
  limit = NEAR_SHOPS_MAX,
  minRating,
  sortBy,
  ticketId,
  now,
}: {
  lat: number;
  lng: number;
  kind?: string;
  radiusMeters?: number;
  acceptingOnly?: boolean;
  openOnly?: boolean;
  vehicleClass?: string;
  serviceCategory?: string;
  limit?: number;
  minRating?: number;
  sortBy?: string;
  ticketId?: string;
  now?: Date;
}) =>
  nearProvidersCached({
    lat,
    lng,
    kind,
    radiusMeters,
    acceptingOnly,
    openOnly,
    vehicleClass,
    serviceCategory,
    limit,
    minRating,
    sortBy,
    ticketId,
    now,
  });

const searchProvidersInner = async ({
  lat,
  lng,
  query,
  kind,
  vehicleClass,
  serviceCategory,
  radiusMeters,
  limit = NEAR_SHOPS_MAX,
  minRating,
  sortBy,
  ticketId,
  now,
}: {
  lat: number;
  lng: number;
  query: string;
  kind?: string;
  vehicleClass?: string;
  serviceCategory?: string;
  radiusMeters?: number;
  limit?: number;
  minRating?: number;
  sortBy?: string;
  ticketId?: string;
  now?: Date;
}) => {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return [];
  const found = await providerRepository.findByNamePrefix(lowered, 50);
  const at = now ?? new Date();
  const scored = found
    .filter((s) => s.status === PROVIDER_STATUS.ACTIVE &&
      (s as {suspended?: boolean}).suspended !== true &&
      (kind === undefined || s.kind === kind))
    .map((s) => {
      const distance = haversineMeters(
        lat,
        lng,
        s.lat as number,
        s.lng as number,
      );
      const openNow = isOpenNow(s.openHours as string | null, at);
      const closesInMinutes = openNow === true ?
        nextTransition(s.openHours as string | null, at) :
        null;
      return {...s, distance, openNow, closesInMinutes};
    })
    .filter((s) => radiusMeters === undefined ||
      (s.distance as number) <= radiusMeters);
  let wanted = vehicleClass ?
    scored.filter((s) => servesVehicleClass(s, vehicleClass)) :
    scored;
  if (serviceCategory) {
    wanted = wanted.filter((s) => {
      const services = Array.isArray(s.services) ? s.services : [];
      return services.some((service) =>
        (service as {category?: unknown}).category === serviceCategory);
    });
  }
  if (typeof minRating === "number") {
    wanted = wanted.filter((s) => {
      const avg = typeof s.ratingAvg === "number" ? s.ratingAvg : 0;
      return avg >= (minRating as number);
    });
  }
  if (sortBy === "price") {
    let priceCategory = serviceCategory;
    if (priceCategory === undefined && ticketId !== undefined) {
      try {
        const ticket = await dispatchRepository.findById(ticketId);
        if (typeof ticket?.symptom === "string") {
          priceCategory = ticket.symptom;
        }
      } catch {
        void 0;
      }
    }
    wanted = await priceSortedRows(
      wanted as unknown as PriceRow[],
      {
        lat,
        lng,
        vehicleClass,
        serviceCategory: priceCategory,
      },
    ) as unknown as typeof wanted;
  } else if (sortBy === "rating") {
    wanted.sort((a, b) => {
      const ar = typeof a.ratingAvg === "number" ? a.ratingAvg : 0;
      const br = typeof b.ratingAvg === "number" ? b.ratingAvg : 0;
      if (br !== ar) return br - ar;
      return (a.distance as number) - (b.distance as number);
    });
  } else if (sortBy === "distance") {
    wanted.sort((a, b) => (a.distance as number) - (b.distance as number));
  } else {
    wanted.sort((a, b) => {
      const exact = (s: {nameLower?: unknown}): number =>
        s.nameLower === lowered ? 0 : 1;
      const byName = exact(a) - exact(b);
      if (byName !== 0) return byName;
      const rank = (s: {openNow?: unknown}): number => {
        if (s.openNow === true) return 0;
        if (s.openNow === null || s.openNow === undefined) return 1;
        return 2;
      };
      const byState = rank(a) - rank(b);
      if (byState !== 0) return byState;
      return (a.distance as number) - (b.distance as number);
    });
  }
  const sliced = wanted.slice(0, limit);
  const declined = await declinedSetForTicket(ticketId);
  return withSearchExtras(sliced, declined);
};

const searchProvidersCached = cacheManager.wrap(searchProvidersInner, {
  namespace: "providersSearch",
  keyFn: ({
    lat,
    lng,
    query,
    kind,
    vehicleClass,
    serviceCategory,
    radiusMeters,
    limit = NEAR_SHOPS_MAX,
    minRating,
    sortBy,
    ticketId,
    now,
  }: {
    lat: number;
    lng: number;
    query: string;
    kind?: string;
    vehicleClass?: string;
    serviceCategory?: string;
    radiusMeters?: number;
    limit?: number;
    minRating?: number;
    sortBy?: string;
    ticketId?: string;
    now?: Date;
  }) => {
    const at = now ?? new Date();
    const minute = Math.floor(at.getTime() / 60000);
    return `${lat.toFixed(3)},${lng.toFixed(3)},` +
      `${query.trim().toLowerCase()},${kind ?? "-"},` +
      `${vehicleClass ?? "-"},${serviceCategory ?? "-"},` +
      `${radiusMeters ?? "-"},${limit},${minute},` +
      `${minRating ?? "-"},${sortBy ?? "-"},${ticketId ?? "-"}`;
  },
});

export const searchProviders = async ({
  lat,
  lng,
  query,
  kind,
  vehicleClass,
  serviceCategory,
  radiusMeters,
  limit = NEAR_SHOPS_MAX,
  minRating,
  sortBy,
  ticketId,
  now,
}: {
  lat: number;
  lng: number;
  query: string;
  kind?: string;
  vehicleClass?: string;
  serviceCategory?: string;
  radiusMeters?: number;
  limit?: number;
  minRating?: number;
  sortBy?: string;
  ticketId?: string;
  now?: Date;
}) =>
  searchProvidersCached({
    lat,
    lng,
    query,
    kind,
    vehicleClass,
    serviceCategory,
    radiusMeters,
    limit,
    minRating,
    sortBy,
    ticketId,
    now,
  });
