import * as userRepository from "../repository/userRepository";
import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import * as volunteerLocationRepository from
  "../repository/volunteerLocationRepository";
import * as cacheManager from "../utils/cacheManager";
import {ROLE_ADMIN, ROLE_RIDER} from "../constants/roles";
import {VOLUNTEER_FRESH_MS} from "../constants/status";
import {auth} from "../config/firebase";

import {ForbiddenError, NotFoundError, ValidationError} from
  "../utils/errors";

const USER_NS = "user";

const getOneUser = cacheManager.wrap(
  async (userId: string) => {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError("User not found");
    return user;
  },
  {namespace: USER_NS, keyFn: (userId: string) => userId},
) as unknown as (userId: string) => Promise<Record<string, unknown>>;

const getAllUser = cacheManager.wrap(async () => userRepository.findAll(), {
  namespace: USER_NS,
  keyFn: () => "__all__",
}) as unknown as () => Promise<Record<string, unknown>[]>;

const register = async ({
  email,
  password,
  displayName,
}: {
  email: string;
  password: string;
  displayName?: string;
}) => {
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: displayName ?? undefined,
  });
  await userRepository.create(userRecord.uid, {
    email: userRecord.email ?? email,
    displayName: displayName ?? undefined,
    role: ROLE_RIDER,
  });
  cacheManager.del(USER_NS, "__all__");
  return {uid: userRecord.uid};
};

const updateRole = async ({
  actorId,
  targetUserId,
  role,
}: {
  actorId: string;
  targetUserId: string;
  role: string;
}) => {
  const target = await userRepository.findById(targetUserId);
  if (!target) throw new NotFoundError("Target user not found");
  if (actorId === targetUserId) {
    throw new ValidationError("Cannot change own role");
  }
  await userRepository.updateRole(targetUserId, role);
  cacheManager.del(USER_NS, targetUserId);
  cacheManager.del(USER_NS, "__all__");
  return {updated: 1};
};

const updateTrustScore = async ({
  targetUserId,
  trustScore,
}: {
  targetUserId: string;
  trustScore: number;
}) => {
  const target = await userRepository.findById(targetUserId);
  if (!target) throw new NotFoundError("Target user not found");
  await userRepository.updateTrustScore(targetUserId, trustScore);
  cacheManager.del(USER_NS, targetUserId);
  return {updated: 1};
};

const updateStatus = async ({
  actorId,
  targetUserId,
  status,
}: {
  actorId: string;
  targetUserId: string;
  status: string;
}) => {
  const target = await userRepository.findById(targetUserId);
  if (!target) throw new NotFoundError("Target user not found");
  if (actorId === targetUserId) {
    throw new ValidationError("Cannot update own status");
  }
  await userRepository.updateStatus(targetUserId, status);
  cacheManager.del(USER_NS, targetUserId);
  cacheManager.del(USER_NS, "__all__");
  return {updated: 1};
};

const updateProfile = async ({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  await userRepository.updateProfile(userId, displayName);
  cacheManager.del(USER_NS, userId);
  cacheManager.del(USER_NS, "__all__");
  return {updated: 1};
};

const setVolunteerAvailability = async ({
  userId,
  available,
  volunteerRadiusKm,
  capability,
}: {
  userId: string;
  available: boolean;
  volunteerRadiusKm?: number;
  capability?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  await userRepository.updateVolunteer(userId, {
    volunteerAvailable: available,
    ...(volunteerRadiusKm !== undefined ? {volunteerRadiusKm} : {}),
    ...(capability !== undefined ? {capability} : {}),
  });
  if (!available) {
    await volunteerLocationRepository.remove(userId);
  }
  cacheManager.del(USER_NS, userId);
  return {updated: 1, available};
};

const volunteerHeartbeat = async ({
  userId,
  lat,
  lng,
}: {
  userId: string;
  lat: number;
  lng: number;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (user.volunteerAvailable !== true) {
    throw new ValidationError("Volunteer mode is off");
  }
  return volunteerLocationRepository.upsert(userId, lat, lng);
};

const sweepStaleVolunteers = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - VOLUNTEER_FRESH_MS).toISOString();
  return volunteerLocationRepository.deleteStale(cutoff);
};

const me = async (userId: string) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const vehicles = await vehicleProfileRepository.findByUser(userId);
  const activeId =
    typeof user.activeVehicleId === "string" ? user.activeVehicleId : null;
  const activeProfile = activeId ?
    vehicles.find((v) => v.id === activeId) ?? null :
    null;
  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      role: user.role,
      status: user.status ?? null,
      trustScore: user.trustScore ?? 0,
      volunteerAvailable: user.volunteerAvailable === true,
      volunteerRadiusKm: user.volunteerRadiusKm ?? 5,
      capability: user.capability ?? "SOLO_BIKE",
      ratingAvg: user.ratingAvg ?? 0,
      ratingCount: user.ratingCount ?? 0,
      onboarded: user.onboarded === true,
      services: Array.isArray(user.services) ? user.services : [],
    },
    vehicles: vehicles.map((v) => ({
      id: v.id,
      type: v.type,
      baseWidth: v.baseWidth,
      baseHeight: v.baseHeight,
    })),
    activeVehicle: activeProfile ?
      {
        id: activeProfile.id,
        type: activeProfile.type,
        baseWidth: activeProfile.baseWidth,
        baseHeight: activeProfile.baseHeight,
      } :
      null,
  };
};

const setActiveVehicle = async ({
  userId,
  profileId,
}: {
  userId: string;
  profileId?: string | null;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const id = typeof profileId === "string" && profileId.length > 0 ?
    profileId :
    null;
  if (id) {
    const profile = await vehicleProfileRepository.findById(userId, id);
    if (!profile) throw new NotFoundError("Vehicle profile not found");
  }
  await userRepository.updateActiveVehicle(userId, id);
  cacheManager.del(USER_NS, userId);
  return {updated: 1, profileId: id};
};

const setOnboarded = async ({
  userId,
  role,
}: {
  userId: string;
  role: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const current = Array.isArray(user.services) ? user.services : [];
  const services = current.includes(role) ? current : [...current, role];
  await userRepository.updateOnboarded(userId, {
    onboarded: true,
    services,
  });
  cacheManager.del(USER_NS, userId);
  return {updated: 1, onboarded: true, services};
};

export {
  register,
  getOneUser,
  getAllUser,
  setActiveVehicle,
  setOnboarded,
  me,
  updateRole,
  updateTrustScore,
  updateStatus,
  updateProfile,
  setVolunteerAvailability,
  volunteerHeartbeat,
  sweepStaleVolunteers,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ROLE_ADMIN,
  ROLE_RIDER,
};
