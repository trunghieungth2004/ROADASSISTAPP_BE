import * as providerRepository from "../../repository/providerRepository";
import * as vehicleProfileRepository from "../../repository/vehicleProfileRepository";
import {
  PROVIDER_KIND,
  VEHICLE_DEFAULT_HEIGHT,
  VEHICLE_DEFAULT_WIDTH,
} from "../../constants/status";
import {normalizeVehicleType} from "../../utils/vehicleType";

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ?
    value.trim() :
    null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function ensureProviderVehicleProfile(
  provider: Record<string, unknown> & {id: string},
): Promise<string | null> {
  const kind = String(provider.kind ?? "");
  if (kind !== PROVIDER_KIND.TOW && kind !== PROVIDER_KIND.MOBILE_SHOP) {
    return null;
  }
  const existingProfileId = nonEmpty(provider.vehicleProfileId);
  const userId = nonEmpty(provider.operatorUid);
  const plate = nonEmpty(provider.plate);
  const type = normalizeVehicleType(provider.vehicleType);
  if (userId === null || plate === null || type === null) {
    return existingProfileId;
  }
  const width = numberOrNull(provider.vehicleWidth) ??
    VEHICLE_DEFAULT_WIDTH[type] ??
    0.7;
  const height = numberOrNull(provider.vehicleHeight) ??
    VEHICLE_DEFAULT_HEIGHT[type] ??
    1.1;
  const label = nonEmpty(provider.vehicleLabel);
  const rawPlate = nonEmpty(provider.plateRaw) ?? plate;
  if (existingProfileId !== null) {
    await vehicleProfileRepository.update(userId, existingProfileId, {
      type,
      baseWidth: width,
      baseHeight: height,
      plate: rawPlate,
      ...(label !== null ? {label} : {}),
    });
    return existingProfileId;
  }
  const existing = await vehicleProfileRepository.findByPlate(userId, plate);
  if (existing !== null) {
    await vehicleProfileRepository.update(userId, existing.id, {
      type,
      baseWidth: width,
      baseHeight: height,
      plate: rawPlate,
      ...(label !== null ? {label} : {}),
    });
    await providerRepository.update(provider.id, {
      vehicleProfileId: existing.id,
    });
    return existing.id;
  }
  const profile = await vehicleProfileRepository.create(userId, {
    type,
    baseWidth: width,
    baseHeight: height,
    plate: rawPlate,
    ...(label !== null ? {label} : {}),
  });
  await providerRepository.update(provider.id, {vehicleProfileId: profile.id});
  return profile.id;
}
