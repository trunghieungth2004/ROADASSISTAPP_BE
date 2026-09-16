import * as shopRepository from "../repository/shopRepository";
import * as userRepository from "../repository/userRepository";
import {
  boundsForRadiusMeters,
  encodeGeohash,
  haversineMeters,
} from "../utils/geo";
import {NEAR_SHOPS_MAX} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";

class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}
class ForbiddenError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

const toMinutes = (hm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

const isOpenNow = (
  openHours: string | null | undefined,
  now: Date = new Date(),
): boolean | null => {
  if (!openHours) return null;
  const parts = openHours.split("-");
  if (parts.length !== 2) return null;
  const open = toMinutes(parts[0]);
  const close = toMinutes(parts[1]);
  if (open === null || close === null) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (open <= close) return cur >= open && cur < close;
  return cur >= open || cur < close;
};

const createShop = async ({
  userId,
  name,
  lat,
  lng,
  type,
  openHours,
  hasTow,
  towVehicleType,
  towVehicleWidth,
  operatorUid,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  openHours?: string;
  hasTow?: boolean;
  towVehicleType?: string;
  towVehicleWidth?: number;
  operatorUid?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return shopRepository.create({
    name,
    lat,
    lng,
    type,
    openHours: openHours ?? undefined,
    hasTow,
    towVehicleType,
    towVehicleWidth,
    operatorUid: operatorUid ?? userId,
  });
};

const updateShop = async ({
  userId,
  shopId,
  fields,
}: {
  userId: string;
  shopId: string;
  fields: {
    name?: string;
    openHours?: string | null;
    accepting?: boolean;
    hasTow?: boolean;
    towVehicleType?: string | null;
    towVehicleWidth?: number | null;
    operatorUid?: string | null;
  };
}) => {
  const shop = await shopRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Shop not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = shop.operatorUid as string | null;
  if (operator && operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates this shop");
  }
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) {
    patch.name = fields.name;
    patch.nameLower = fields.name.trim().toLowerCase();
  }
  if (fields.openHours !== undefined) patch.openHours = fields.openHours;
  if (fields.accepting !== undefined) patch.accepting = fields.accepting;
  if (fields.hasTow !== undefined) patch.hasTow = fields.hasTow;
  if (fields.towVehicleType !== undefined) {
    patch.towVehicleType = fields.towVehicleType;
  }
  if (fields.towVehicleWidth !== undefined) {
    patch.towVehicleWidth = fields.towVehicleWidth;
  }
  if (fields.operatorUid !== undefined) {
    patch.operatorUid = fields.operatorUid;
  }
  await shopRepository.update(shopId, patch);
  return {updated: 1};
};

const nearShops = async ({
  lat,
  lng,
  type,
  radiusMeters = 2000,
  acceptingOnly = false,
  openOnly = false,
  limit = NEAR_SHOPS_MAX,
  now,
}: {
  lat: number;
  lng: number;
  type?: string;
  radiusMeters?: number;
  acceptingOnly?: boolean;
  openOnly?: boolean;
  limit?: number;
  now?: Date;
}) => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const prefixes = Array.from({length: 9}, (_, i) => {
    const r = (i % 3) - 1;
    const c = Math.floor(i / 3) - 1;
    const dLat = (bounds.maxLat - bounds.minLat) / 3;
    const dLng = (bounds.maxLng - bounds.minLng) / 3;
    return encodeGeohash(
      bounds.minLat + (r + 0.5) * dLat,
      bounds.minLng + (c + 0.5) * dLng,
      6,
    ).slice(0, 6);
  });
  const found = await shopRepository.findByGeohashPrefixes(
    Array.from(new Set(prefixes)),
  );
  const at = now ?? new Date();
  let filtered = found
    .map((s) => {
      const distance = haversineMeters(
        lat,
        lng,
        s.lat as number,
        s.lng as number,
      );
      const openNow = isOpenNow(s.openHours as string | null, at);
      return {...s, distance, openNow};
    })
    .filter((s) => (s.distance as number) <= radiusMeters);
  if (type) filtered = filtered.filter((s) => s.type === type);
  if (acceptingOnly) {
    filtered = filtered.filter((s) => s.accepting !== false);
  }
  if (openOnly) filtered = filtered.filter((s) => s.openNow === true);
  filtered.sort((a, b) => (a.distance as number) - (b.distance as number));
  return filtered.slice(0, limit);
};

export {createShop, updateShop, nearShops, isOpenNow, NotFoundError,
  ForbiddenError};
