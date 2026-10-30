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
import {NEAR_SHOPS_MAX, PROVIDER_STATUS} from "../../constants/status";

import {normalizeVehicleType} from "../../utils/vehicleType";


import {NotFoundError} from "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";


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

const withSearchExtras = <T extends SearchExtrasRow>(
  rows: T[],
  declined: Set<string>,
) => {
  return rows.map((s) => ({
    ...s,
    distanceMeters: typeof s.distance === "number" ? s.distance : null,
    ratingAvg: typeof s.ratingAvg === "number" ? s.ratingAvg : 0,
    ratingCount: (s as {ratingCount?: unknown}).ratingCount ?? 0,
    declined: declined.has(s.id),
  }));
};

const nearProvidersInner = async ({
  lat,
  lng,
  kind,
  radiusMeters = 2000,
  acceptingOnly = false,
  openOnly = false,
  vehicleClass,
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
  if (typeof minRating === "number") {
    filtered = filtered.filter((s) => {
      const avg = typeof s.ratingAvg === "number" ? s.ratingAvg : 0;
      return avg >= (minRating as number);
    });
  }
  if (sortBy === "rating") {
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
  if (typeof minRating === "number") {
    wanted = wanted.filter((s) => {
      const avg = typeof s.ratingAvg === "number" ? s.ratingAvg : 0;
      return avg >= (minRating as number);
    });
  }
  if (sortBy === "rating") {
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
      `${vehicleClass ?? "-"},` +
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
    radiusMeters,
    limit,
    minRating,
    sortBy,
    ticketId,
    now,
  });

