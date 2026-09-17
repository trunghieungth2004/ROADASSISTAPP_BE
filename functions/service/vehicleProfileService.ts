import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import * as userRepository from "../repository/userRepository";
import * as cacheManager from "../utils/cacheManager";
import {SERVICE_ROLE, TOW_VEHICLE_TYPE} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";

import {ForbiddenError, NotFoundError, ValidationError} from
  "../utils/errors";

const NS = "vehicleProfile";

const ensureUser = async (userId: string) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return user;
};

const getProfiles = cacheManager.wrap(
  async (userId: string) => {
    await ensureUser(userId);
    return vehicleProfileRepository.findByUser(userId);
  },
  {namespace: NS, keyFn: (userId: string) => userId},
) as unknown as (userId: string) => Promise<Record<string, unknown>[]>;

const createProfile = async ({
  userId,
  type,
  baseWidth,
  baseHeight,
}: {
  userId: string;
  type: string;
  baseWidth: number;
  baseHeight: number;
}) => {
  await ensureUser(userId);
  const profile = await vehicleProfileRepository.create(userId, {
    type,
    baseWidth,
    baseHeight,
  });
  cacheManager.del(NS, userId);
  return profile;
};

const addRideConfig = async ({
  userId,
  profileId,
  configType,
  estWidth,
  estHeight,
}: {
  userId: string;
  profileId: string;
  configType: string;
  estWidth?: number;
  estHeight?: number;
}) => {
  await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  const config = await vehicleProfileRepository.addRideConfig(
    userId,
    profileId,
    {
      configType,
      estWidth,
      estHeight,
    },
  );
  cacheManager.del(NS, userId);
  return config;
};

const setTowVehicle = async ({
  userId,
  profileId,
  towVehicleType,
}: {
  userId: string;
  profileId: string;
  towVehicleType?: string | null;
}) => {
  const owner = await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  if (towVehicleType) {
    if (owner.role !== ROLE_ADMIN) {
      const held = Array.isArray(owner.services) ? owner.services : [];
      if (!held.includes(SERVICE_ROLE.TOW)) {
        throw new ForbiddenError("Tow license required");
      }
    }
  }
  if (
    towVehicleType !== undefined &&
    towVehicleType !== null &&
    !(Object.values(TOW_VEHICLE_TYPE) as string[]).includes(towVehicleType)
  ) {
    throw new ValidationError("Invalid tow vehicle type");
  }
  if (towVehicleType) {
    const profiles = await vehicleProfileRepository.findByUser(userId);
    for (const other of profiles) {
      if (other.id !== profileId && other.towVehicleType) {
        await vehicleProfileRepository.update(userId, other.id, {
          towVehicleType: null,
        });
      }
    }
  }
  await vehicleProfileRepository.update(userId, profileId, {
    towVehicleType: towVehicleType ?? null,
  });
  cacheManager.del(NS, userId);
  return vehicleProfileRepository.findById(userId, profileId);
};

export {
  getProfiles,
  createProfile,
  addRideConfig,
  setTowVehicle,
  ValidationError,
  NotFoundError,
};
