import {normalizeShopServices, vehicleClassOf} from "./schedule";
import * as providerRepository from "../../repository/providerRepository";
import * as dispatchRepository from "../../repository/dispatchRepository";

import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as userRepository from "../../repository/userRepository";
import * as vehicleProfileRepository from
  "../../repository/vehicleProfileRepository";
import {normalizeTowPlate} from "../../repository/providerRepository";

import {encodeGeohash} from "../../utils/geo";
import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  VEHICLE_CLASS,
  VEHICLE_DEFAULT_WIDTH,
  VEHICLE_TYPE,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";


import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";


export const PLATE_SHAPE = /^\d{2}[A-Z0-9]{1,3}\d{4,6}$/;
export const SHOP_NS = "shop";
export const PROVIDER_NS = "provider";

export const createShopProvider = async ({
  userId,
  name,
  lat,
  lng,
  label,
  openHours,
  vehicleClasses,
  services,
  serviceFee,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  openHours?: string;
  vehicleClasses?: string[];
  services?: unknown;
  serviceFee?: number;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (vehicleClasses !== undefined) {
    const valid = Object.values(VEHICLE_CLASS) as string[];
    if (
      vehicleClasses.length === 0 ||
      vehicleClasses.length > 2 ||
      vehicleClasses.some((c) => !valid.includes(c))
    ) {
      throw new ValidationError("Unknown vehicle class");
    }
  }
  const normalizedServices = services !== undefined ?
    normalizeShopServices(services) :
    undefined;
  const operated = await providerRepository.findByOperator(userId);
  if (operated.some((p) => p.kind === PROVIDER_KIND.SHOP &&
    p.status !== PROVIDER_STATUS.DENIED)) {
    throw new ConflictError("A shop provider already exists");
  }
  const created = await providerRepository.createShop({
    operatorUid: userId,
    name,
    lat,
    lng,
    label,
    openHours,
    vehicleClasses,
    ...(normalizedServices !== undefined ?
      {services: normalizedServices} :
      {}),
    serviceFee,
  });
  cacheManager.del(PROVIDER_NS, userId);
  cacheManager.del(SHOP_NS);
  return created;
};

export const createMobileShopProvider = async ({
  userId,
  name,
  lat,
  lng,
  label,
  plate,
  vehicleType,
  licenseNumber,
  licensePhotoUrl,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  plate: string;
  vehicleType: string;
  licenseNumber: string;
  licensePhotoUrl?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!(Object.values(VEHICLE_TYPE) as string[]).includes(vehicleType)) {
    throw new ValidationError("Mobile shop vehicle must be bike or car");
  }
  if (typeof licenseNumber !== "string" || licenseNumber.trim() === "") {
    throw new ValidationError("Mobile shop license is required");
  }
  const normalizedPlate = normalizeTowPlate(plate);
  if (!PLATE_SHAPE.test(normalizedPlate)) {
    throw new ValidationError("Plate number has an invalid shape");
  }
  const operated = await providerRepository.findByOperator(userId);
  if (operated.some((p) => p.kind === PROVIDER_KIND.MOBILE_SHOP &&
    p.status !== PROVIDER_STATUS.DENIED)) {
    throw new ConflictError("A mobile shop provider already exists");
  }
  const existing = await providerRepository.findByPlate(normalizedPlate);
  if (existing && existing.operatorUid !== userId) {
    throw new ConflictError("This plate is already registered");
  }
  const linkExisting = existing !== null &&
    (typeof existing.vehicleType !== "string" ||
      existing.vehicleType === vehicleType);
  const linkedProfileId = linkExisting ?
    existing?.vehicleProfileId ?? null :
    null;
  const created = await providerRepository.createMobileShop({
    operatorUid: userId,
    name,
    lat,
    lng,
    label,
    vehicleClasses: [vehicleClassOf(vehicleType)],
    licenseNumber: licenseNumber.trim(),
    licensePhotoUrl,
    plate: normalizedPlate,
    plateRaw: plate.trim(),
    vehicleType,
    vehicleWidth: VEHICLE_DEFAULT_WIDTH[vehicleType] ?? null,
    vehicleProfileId: linkedProfileId,
  });
  let vehicleProfileId = linkedProfileId;
  if (!vehicleProfileId) {
    const profile = await vehicleProfileRepository.create(userId, {
      type: vehicleType,
      baseWidth: VEHICLE_DEFAULT_WIDTH[vehicleType] ?? 0.7,
      baseHeight: vehicleType === "CAR" ? 1.6 : 1.1,
    });
    vehicleProfileId = profile.id;
    await providerRepository.update(created.id, {vehicleProfileId});
    if (linkExisting && existing && existing.id !== created.id) {
      await providerRepository.update(existing.id, {vehicleProfileId});
    }
  }
  cacheManager.del(PROVIDER_NS, userId);
  cacheManager.del(SHOP_NS);
  return {...created, vehicleProfileId};
};

export const createTowProvider = async ({
  userId,
  name,
  lat,
  lng,
  label,
  plate,
  vehicleType,
  vehicleWidth,
  towBaseFee,
  towPerKmFee,
}: {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  plate: string;
  vehicleType: string;
  vehicleWidth?: number;
  towBaseFee?: number;
  towPerKmFee?: number;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!plate || typeof plate !== "string") {
    throw new ValidationError("Plate number is required");
  }
  if (!vehicleType || typeof vehicleType !== "string") {
    throw new ValidationError("Vehicle type is required");
  }
  const normalized = normalizeTowPlate(plate);
  if (!PLATE_SHAPE.test(normalized)) {
    throw new ValidationError("Plate number has an invalid shape");
  }
  const operated = await providerRepository.findByOperator(userId);
  if (operated.some((p) => p.kind === PROVIDER_KIND.TOW &&
    p.status !== PROVIDER_STATUS.DENIED)) {
    throw new ConflictError("A tow provider already exists");
  }
  const existing = await providerRepository.findByPlate(normalized);
  if (existing && existing.operatorUid !== userId) {
    throw new ConflictError("This plate is already registered");
  }
  const linkExisting = existing !== null &&
    (typeof existing.vehicleType !== "string" ||
      existing.vehicleType === "CAR");
  const linkedProfileId = linkExisting ?
    existing?.vehicleProfileId ?? null :
    null;
  try {
    const created = await providerRepository.createTow({
      operatorUid: userId,
      name,
      lat,
      lng,
      label,
      plate: normalized,
      plateRaw: plate.trim(),
      vehicleType,
      vehicleWidth: vehicleWidth ?? VEHICLE_DEFAULT_WIDTH.CAR,
      vehicleProfileId: linkedProfileId,
      towBaseFee,
      towPerKmFee,
    });
    let vehicleProfileId = linkedProfileId;
    if (!vehicleProfileId) {
      const profile = await vehicleProfileRepository.create(userId, {
        type: "CAR",
        baseWidth: vehicleWidth ?? VEHICLE_DEFAULT_WIDTH.CAR,
        baseHeight: 1.6,
      });
      vehicleProfileId = profile.id;
      await providerRepository.update(created.id, {vehicleProfileId});
      if (linkExisting && existing && existing.id !== created.id) {
        await providerRepository.update(existing.id, {vehicleProfileId});
      }
    }
    cacheManager.del(PROVIDER_NS, userId);
    cacheManager.del(SHOP_NS);
    return {...created, vehicleProfileId};
  } catch (error) {
    const code = (error as {code?: number | string} | null)?.code;
    const message = error instanceof Error ? error.message : "";
    if (code === 6 || code === "already-exists" ||
      /already exists/i.test(message)) {
      throw new ConflictError("This plate is already registered");
    }
    throw error;
  }
};

export const updateProvider = async ({
  userId,
  providerId,
  fields,
}: {
  userId: string;
  providerId: string;
  fields: {
    name?: string;
    label?: string | null;
    openHours?: string | null;
    vehicleClasses?: string[];
    services?: unknown;
    serviceFee?: number;
    licenseNumber?: string;
    licensePhotoUrl?: string | null;
    plate?: string;
    vehicleType?: string;
    vehicleWidth?: number;
    towBaseFee?: number;
    towPerKmFee?: number;
    accepting?: boolean;
    lat?: number;
    lng?: number;
  };
}) => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = provider.operatorUid as string | null;
  if (operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates this provider");
  }
  if (fields.accepting === true && provider.kind === PROVIDER_KIND.TOW) {
    const live = await dispatchRepository.findActiveForShop(providerId);
    if (live.length > 0) {
      throw new ValidationError(
        "Finish the active job before switching tow duty back on",
      );
    }
  }
  if (fields.accepting === false && provider.kind === PROVIDER_KIND.TOW) {
    const live = await dispatchRepository.findActiveForShop(providerId);
    if (live.length > 0) {
      throw new ValidationError(
        "Finish the active job before switching tow duty off",
      );
    }
  }
  if (fields.accepting === false && provider.kind === PROVIDER_KIND.SHOP) {
    const [assigned, pending, named] = await Promise.all([
      dispatchRepository.findActiveForShop(providerId),
      dispatchRepository.findPendingForShop(providerId),
      dispatchRepository.findActiveForDestination(providerId),
    ]);
    if (assigned.length > 0 || pending.length > 0) {
      throw new ValidationError(
        "Decline or resolve open tickets before closing the shop",
      );
    }
    if (named.length > 0) {
      throw new ValidationError(
        "Decline the tow destination before closing the shop",
      );
    }
  }
  if (fields.vehicleClasses !== undefined &&
    provider.kind !== PROVIDER_KIND.SHOP &&
    provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ValidationError("Vehicle classes are shop-only");
  }
  if (fields.vehicleType !== undefined &&
    provider.kind !== PROVIDER_KIND.TOW &&
    provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ValidationError("Vehicle type is provider-vehicle-only");
  }
  if (fields.plate !== undefined &&
    provider.kind !== PROVIDER_KIND.TOW &&
    provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ValidationError("Plate is provider-vehicle-only");
  }
  if (fields.plate !== undefined || fields.vehicleType !== undefined ||
    fields.vehicleWidth !== undefined) {
    const active = await dispatchRepository.findActiveForShop(providerId);
    if (active.length > 0) {
      throw new ValidationError(
        "Finish the active job before changing the provider vehicle",
      );
    }
  }
  if (fields.services !== undefined &&
    provider.kind !== PROVIDER_KIND.SHOP) {
    throw new ValidationError("Services are shop-only");
  }
  if (fields.serviceFee !== undefined &&
    provider.kind !== PROVIDER_KIND.SHOP) {
    throw new ValidationError("Service fee is shop-only");
  }
  if ((fields.licenseNumber !== undefined ||
    fields.licensePhotoUrl !== undefined) &&
    provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ValidationError("License details are mobile-shop-only");
  }
  if ((fields.towBaseFee !== undefined ||
    fields.towPerKmFee !== undefined) &&
    provider.kind !== PROVIDER_KIND.TOW) {
    throw new ValidationError("Tow fees are tow-only");
  }
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) {
    patch.name = fields.name;
    patch.nameLower = fields.name.trim().toLowerCase();
  }
  if (fields.label !== undefined) patch.label = fields.label;
  if (fields.openHours !== undefined) patch.openHours = fields.openHours;
  if (fields.vehicleClasses !== undefined) {
    const valid = Object.values(VEHICLE_CLASS) as string[];
    if (
      fields.vehicleClasses.length === 0 ||
      fields.vehicleClasses.length > 2 ||
      fields.vehicleClasses.some((c) => !valid.includes(c))
    ) {
      throw new ValidationError("Unknown vehicle class");
    }
    patch.vehicleClasses = fields.vehicleClasses;
  }
  if (fields.services !== undefined) {
    patch.services = normalizeShopServices(fields.services);
  }
  if (fields.serviceFee !== undefined) patch.serviceFee = fields.serviceFee;
  if (fields.licenseNumber !== undefined) {
    patch.licenseNumber = fields.licenseNumber;
  }
  if (fields.licensePhotoUrl !== undefined) {
    patch.licensePhotoUrl = fields.licensePhotoUrl;
  }
  if (fields.plate !== undefined) {
    const normalized = normalizeTowPlate(fields.plate);
    if (!PLATE_SHAPE.test(normalized)) {
      throw new ValidationError("Plate number has an invalid shape");
    }
    const existing = await providerRepository.findByPlate(normalized);
    if (existing && existing.id !== providerId &&
      existing.operatorUid !== provider.operatorUid) {
      throw new ConflictError("This plate is already registered");
    }
    patch.plate = normalized;
    patch.plateRaw = fields.plate.trim();
    const compatible = existing !== null &&
      (typeof existing.vehicleType !== "string" ||
        typeof provider.vehicleType !== "string" ||
        existing.vehicleType === provider.vehicleType);
    if (existing && existing.id !== providerId && compatible) {
      const existingProfile = typeof existing.vehicleProfileId === "string" ?
        existing.vehicleProfileId :
        "";
      const currentProfile = typeof provider.vehicleProfileId === "string" ?
        provider.vehicleProfileId :
        "";
      if (existingProfile !== "") {
        patch.vehicleProfileId = existingProfile;
      } else if (currentProfile !== "") {
        await providerRepository.update(existing.id, {
          vehicleProfileId: currentProfile,
        });
      }
    }
  }
  if (fields.vehicleType !== undefined) {
    if (provider.kind === PROVIDER_KIND.TOW &&
      fields.vehicleType !== VEHICLE_TYPE.CAR) {
      throw new ValidationError("Tow vehicles must be cars");
    }
    if (provider.kind === PROVIDER_KIND.MOBILE_SHOP &&
      !(Object.values(VEHICLE_TYPE) as string[]).includes(fields.vehicleType)) {
      throw new ValidationError("Mobile shop vehicles must be bike or car");
    }
    patch.vehicleType = fields.vehicleType;
    if (provider.kind === PROVIDER_KIND.MOBILE_SHOP) {
      patch.vehicleClasses = [vehicleClassOf(fields.vehicleType)];
    }
  }
  if (fields.vehicleWidth !== undefined) {
    patch.vehicleWidth = fields.vehicleWidth;
  }
  if (fields.towBaseFee !== undefined) patch.towBaseFee = fields.towBaseFee;
  if (fields.towPerKmFee !== undefined) {
    patch.towPerKmFee = fields.towPerKmFee;
  }
  if (fields.accepting !== undefined) patch.accepting = fields.accepting;
  if (fields.lat !== undefined || fields.lng !== undefined) {
    if (typeof fields.lat !== "number" || typeof fields.lng !== "number") {
      throw new ValidationError("Location needs both lat and lng");
    }
    patch.lat = fields.lat;
    patch.lng = fields.lng;
    patch.geoHash = encodeGeohash(fields.lat, fields.lng, 8);
    patch.geoCell = encodeGeohash(fields.lat, fields.lng, 6);
  }
  await providerRepository.update(providerId, patch);
  const linkedProfileId = typeof patch.vehicleProfileId === "string" ?
    patch.vehicleProfileId :
    typeof provider.vehicleProfileId === "string" ?
      provider.vehicleProfileId :
      "";
  const ownerUid = typeof provider.operatorUid === "string" ?
    provider.operatorUid :
    "";
  if (linkedProfileId !== "" && ownerUid !== "" &&
    (fields.vehicleType !== undefined || fields.vehicleWidth !== undefined)) {
    const nextType = fields.vehicleType ??
      (typeof provider.vehicleType === "string" ?
        provider.vehicleType :
        "BIKE");
    const nextWidth = fields.vehicleWidth ??
      (typeof provider.vehicleWidth === "number" ?
        provider.vehicleWidth :
        undefined);
    await vehicleProfileRepository.update(ownerUid, linkedProfileId, {
      type: nextType,
      ...(nextWidth !== undefined ? {baseWidth: nextWidth} : {}),
    });
  }
  if (fields.accepting === false) {
    await providerLocationRepository.remove(providerId);
  }
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {updated: 1};
};
