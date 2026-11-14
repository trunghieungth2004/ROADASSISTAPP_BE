import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as providerRepository from "../../repository/providerRepository";
import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  haversineMeters,
} from "../../utils/geo";
import {
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  TOW_DISPATCH_RADIUS,
} from "../../constants/status";
import {servesVehicleClass, vehicleClassOf} from "../providerService";
import {providerBlocked} from "./providerEligibility";

const operatorBusy = async (
  operatorUid: string,
  cache: Map<string, boolean>,
): Promise<boolean> => {
  const known = cache.get(operatorUid);
  if (known !== undefined) return known;
  const operated = (await providerRepository.findByOperator(operatorUid)) ?? [];
  let busy = false;
  for (const provider of operated) {
    if (provider.kind !== PROVIDER_KIND.TOW &&
      provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
      continue;
    }
    const active =
      (await dispatchRepository.findActiveForShop(provider.id)) ?? [];
    if (active.length > 0) {
      busy = true;
      break;
    }
  }
  cache.set(operatorUid, busy);
  return busy;
};

export const findMobileShopOperators = async ({
  lat,
  lng,
  radiusMeters = TOW_DISPATCH_RADIUS,
  vehicleType,
  excludeOperatorUids = [],
  excludeShopIds = [],
  serviceCategory,
}: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  vehicleType?: string;
  excludeOperatorUids?: string[];
  excludeShopIds?: string[];
  serviceCategory?: string;
}): Promise<string[]> => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const cells = cellsCoveringBounds(bounds, 6);
  const locations =
    await providerLocationRepository.findByGeohashPrefixes(cells);
  const cutoff = Date.now() - PROVIDER_FRESH_MS;
  const fresh = locations.filter((loc) => {
    if (Date.parse(loc.lastSeen) < cutoff) return false;
    return haversineMeters(lat, lng, loc.lat, loc.lng) <= radiusMeters;
  });
  if (fresh.length === 0) return [];
  const providers = await Promise.all(
    fresh.map((loc) => providerRepository.findById(loc.providerId)),
  );
  const eligible: Array<{uid: string; providerId: string; match: boolean}> = [];
  for (const provider of providers) {
    if (!provider) continue;
    if (provider.kind !== PROVIDER_KIND.MOBILE_SHOP) continue;
    if (providerBlocked(provider)) continue;
    if (provider.status !== PROVIDER_STATUS.ACTIVE) continue;
    if (provider.accepting === false) continue;
    if (typeof provider.operatorUid !== "string" ||
      provider.operatorUid === "") continue;
    if (!servesVehicleClass(provider, vehicleClassOf(vehicleType))) continue;
    if (excludeOperatorUids.includes(provider.operatorUid)) continue;
    if (excludeShopIds.includes(provider.id)) continue;
    const services = Array.isArray(provider.services) ?
      provider.services :
      [];
    const match = serviceCategory === undefined ||
      services.some((service) =>
        (service as {category?: unknown}).category === serviceCategory);
    if (!eligible.some((item) => item.uid === provider.operatorUid)) {
      eligible.push({
        uid: provider.operatorUid,
        providerId: provider.id,
        match,
      });
    }
  }
  const preferred = serviceCategory !== undefined &&
    eligible.some((item) => item.match) ?
    eligible.filter((item) => item.match) :
    eligible;
  const free: string[] = [];
  const busyCache = new Map<string, boolean>();
  for (const item of preferred) {
    if (!(await operatorBusy(item.uid, busyCache))) free.push(item.uid);
  }
  return free;
};

export const findCandidates = async (input: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  vehicleType?: string;
  excludeOperatorUids?: string[];
  excludeShopIds?: string[];
  serviceCategory?: string;
}): Promise<string[]> => findMobileShopOperators(input);

export const findTowOperators = async ({
  lat,
  lng,
  radiusMeters = TOW_DISPATCH_RADIUS,
  vehicleType,
  excludeOperatorUids = [],
  excludeShopIds = [],
}: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  vehicleType?: string;
  excludeOperatorUids?: string[];
  excludeShopIds?: string[];
}): Promise<string[]> => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const cells = cellsCoveringBounds(bounds, 6);
  const locations =
    await providerLocationRepository.findByGeohashPrefixes(cells);
  const cutoff = Date.now() - PROVIDER_FRESH_MS;
  const fresh = locations.filter((loc) => {
    if (Date.parse(loc.lastSeen) < cutoff) return false;
    return haversineMeters(lat, lng, loc.lat, loc.lng) <= radiusMeters;
  });
  if (fresh.length === 0) return [];
  const providers = await Promise.all(
    fresh.map((loc) => providerRepository.findById(loc.providerId)),
  );
  const operators: string[] = [];
  for (const shop of providers) {
    if (!shop) continue;
    if (shop.kind !== PROVIDER_KIND.TOW) continue;
    if (providerBlocked(shop)) continue;
    if (shop.status !== PROVIDER_STATUS.ACTIVE) continue;
    if (shop.accepting === false) continue;
    if (typeof shop.plate !== "string" || shop.plate === "") continue;
    if (typeof shop.operatorUid !== "string" || shop.operatorUid === "") {
      continue;
    }
    if (excludeOperatorUids.includes(shop.operatorUid)) continue;
    if (excludeShopIds.includes(shop.id)) continue;
    if (!servesVehicleClass(shop, vehicleClassOf(vehicleType))) continue;
    if (!operators.includes(shop.operatorUid)) {
      operators.push(shop.operatorUid);
    }
  }
  const free: string[] = [];
  const busyCache = new Map<string, boolean>();
  for (const operatorUid of operators) {
    if (!(await operatorBusy(operatorUid, busyCache))) free.push(operatorUid);
  }
  return free;
};
