import * as userRepository from "../repository/userRepository";
import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import * as providerRepository from "../repository/providerRepository";
import {normalizeVehicleType} from "../utils/vehicleType";
import * as providerLocationRepository from
  "../repository/providerLocationRepository";
import * as cacheManager from "../utils/cacheManager";
import {ROLE_ADMIN, ROLE_USER} from "../constants/roles";
import {PROVIDER_FRESH_MS, SERVICE_ROLE} from "../constants/status";
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
  phone,
}: {
  email: string;
  password: string;
  displayName?: string;
  phone: string;
}) => {
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: displayName ?? undefined,
  });
  await userRepository.create(userRecord.uid, {
    email: userRecord.email ?? email,
    displayName: displayName ?? undefined,
    role: ROLE_USER,
    phone,
    services: [SERVICE_ROLE.RIDER],
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
  if (role !== ROLE_ADMIN && role !== ROLE_USER) {
    throw new ValidationError("Unknown role");
  }
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
  if (!Number.isInteger(trustScore) || trustScore < 0 || trustScore > 100) {
    throw new ValidationError("Trust score must be an integer from 0 to 100");
  }
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

const sweepStalePresence = async (): Promise<number> => {
  const providerCutoff =
    new Date(Date.now() - PROVIDER_FRESH_MS).toISOString();
  return providerLocationRepository.deleteStale(providerCutoff);
};

const me = async (userId: string) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const vehicles = await vehicleProfileRepository.findByUser(userId);
  for (const vehicle of vehicles) {
    const normalized = normalizeVehicleType(vehicle.type);
    if (normalized !== null && normalized !== vehicle.type) {
      vehicle.type = normalized;
      try {
        await vehicleProfileRepository.update(
          userId,
          vehicle.id,
          {type: normalized},
        );
      } catch {
        continue;
      }
    }
  }
  let operated:
    Awaited<ReturnType<typeof providerRepository.findByOperator>> = [];
  try {
    operated = (await providerRepository.findByOperator(userId)) ?? [];
  } catch {
    operated = [];
  }
  const linked = new Map<string, Array<{
    id: string;
    kind: string;
    name: string;
    status: string;
    plate: string | null;
    vehicleType: string | null;
    vehicleWidth: number | null;
  }>>();
  for (const provider of operated) {
    if (typeof provider.vehicleProfileId === "string" &&
      provider.vehicleProfileId !== "") {
      const rows = linked.get(provider.vehicleProfileId) ?? [];
      rows.push({
        id: provider.id,
        kind: String(provider.kind),
        name: String(provider.name),
        status: String(provider.status),
        plate: typeof provider.plate === "string" ? provider.plate : null,
        vehicleType: typeof provider.vehicleType === "string" ?
          provider.vehicleType :
          null,
        vehicleWidth: typeof provider.vehicleWidth === "number" ?
          provider.vehicleWidth :
          null,
      });
      linked.set(provider.vehicleProfileId, rows);
    }
  }
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
      points: user.points ?? 0,
      ratingAvg: user.ratingAvg ?? 0,
      ratingCount: user.ratingCount ?? 0,
      onboarded: user.onboarded === true,
      services: Array.isArray(user.services) ?
        [...new Set(
          user.services.filter((s): s is string => typeof s === "string"),
        )] :
        [],
    },
    vehicles: vehicles.map((v) => ({
      id: v.id,
      type: v.type,
      baseWidth: v.baseWidth,
      baseHeight: v.baseHeight,
      ...(linked.get(v.id) ? {providerLinks: linked.get(v.id)} : {}),
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
  service,
  role,
}: {
  userId: string;
  service?: string;
  role?: string;
}) => {
  const license = service ?? role;
  if (!license) throw new ValidationError("A service license is required");
  if (!(Object.values(SERVICE_ROLE) as string[]).includes(license)) {
    throw new ValidationError("Unknown service license");
  }
  if (license !== SERVICE_ROLE.RIDER) {
    throw new ForbiddenError(
      "Provider access comes from a provider record",
    );
  }
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  const current = Array.isArray(user.services) ? user.services : [];
  const services = current.includes(license) ? current : [...current, license];
  await userRepository.updateOnboarded(userId, {
    onboarded: true,
    services,
  });
  cacheManager.del(USER_NS, userId);
  return {updated: 1, onboarded: true, services};
};

const updateServices = async ({
  isAdmin,
  targetUserId,
  grant,
  revoke,
}: {
  isAdmin: boolean;
  targetUserId: string;
  grant?: string[];
  revoke?: string[];
}) => {
  const target = await userRepository.findById(targetUserId);
  if (!target) throw new NotFoundError("Target user not found");
  const known = Object.values(SERVICE_ROLE) as string[];
  for (const license of [...(grant ?? []), ...(revoke ?? [])]) {
    if (!known.includes(license)) {
      throw new ValidationError(`Unknown service license: ${license}`);
    }
  }
  if (!isAdmin) {
    throw new ForbiddenError("Only admins change services");
  }
  const current = Array.isArray(target.services) ? target.services : [];
  const granted = current.concat(
    (grant ?? []).filter((license) => !current.includes(license)),
  );
  const revoked = new Set(revoke ?? []);
  const services = granted.filter((license) => !revoked.has(license));
  await userRepository.updateOnboarded(targetUserId, {
    onboarded: target.onboarded === true,
    services,
  });
  cacheManager.del(USER_NS, targetUserId);
  cacheManager.del(USER_NS, "__all__");
  return {updated: 1, services};
};

export {
  register,
  getOneUser,
  getAllUser,
  setActiveVehicle,
  setOnboarded,
  updateServices,
  me,
  updateRole,
  updateTrustScore,
  updateStatus,
  updateProfile,
  sweepStalePresence,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ROLE_ADMIN,
  ROLE_USER,
};
