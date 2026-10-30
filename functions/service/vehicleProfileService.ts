import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import * as userRepository from "../repository/userRepository";
import * as providerRepository from "../repository/providerRepository";
import * as providerLocationRepository from
  "../repository/providerLocationRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as cacheManager from "../utils/cacheManager";
import {normalizeVehicleType} from "../utils/vehicleType";
import {PROVIDER_KIND, PROVIDER_STATUS} from "../constants/status";

import {ConflictError, NotFoundError, ValidationError} from
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
    const rows = await vehicleProfileRepository.findByUser(userId);
    for (const row of rows) {
      const normalized = normalizeVehicleType(row.type);
      if (normalized !== null && normalized !== row.type) {
        row.type = normalized;
        try {
          await vehicleProfileRepository.update(
            userId,
            row.id,
            {type: normalized},
          );
        } catch {
          continue;
        }
      }
    }
    return rows;
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

const removeProfile = async ({
  userId,
  profileId,
}: {
  userId: string;
  profileId: string;
}) => {
  const user = await ensureUser(userId);
  const profile = await vehicleProfileRepository.findById(userId, profileId);
  if (!profile) throw new NotFoundError("Vehicle profile not found");
  const linked = await providerRepository.findByVehicleProfileId(profileId);
  for (const provider of linked) {
    let active: Array<{id: string}> =
      (await dispatchRepository.findActiveForShop(provider.id)) ?? [];
    if (provider.kind === PROVIDER_KIND.SHOP) {
      const pending = await dispatchRepository.findPendingForShop(provider.id);
      const destination = await dispatchRepository.findActiveForDestination(
        provider.id,
      );
      active = [...active, ...pending, ...destination];
    }
    if (active.length > 0) {
      throw new ConflictError("Vehicle is on an active ticket", {
        ticketId: active[0].id,
      });
    }
  }
  const now = new Date().toISOString();
  for (const provider of linked) {
    await providerRepository.update(provider.id, {
      status: PROVIDER_STATUS.DENIED,
      accepting: false,
      vehicleProfileId: null,
      reviewedBy: userId,
      reviewNote: "Vehicle removed by operator",
      decidedAt: now,
    });
    await providerLocationRepository.remove(provider.id);
  }
  await vehicleProfileRepository.remove(userId, profileId);
  if (user.activeVehicleId === profileId) {
    await userRepository.updateActiveVehicle(userId, null);
  }
  cacheManager.del(NS, userId);
  cacheManager.del("provider");
  return {removed: true, revokedProviders: linked.map((p) => p.id)};
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


export {
  getProfiles,
  createProfile,
  removeProfile,
  addRideConfig,
  ValidationError,
  NotFoundError,
};
