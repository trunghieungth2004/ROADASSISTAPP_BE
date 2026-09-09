import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import * as userRepository from "../repository/userRepository";
import * as cacheManager from "../utils/cacheManager";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}

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

export {
  getProfiles,
  createProfile,
  addRideConfig,
  ValidationError,
  NotFoundError,
};
