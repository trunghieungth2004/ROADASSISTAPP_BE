import * as userRepository from "../repository/userRepository";
import * as cacheManager from "../utils/cacheManager";
import {auth} from "../config/firebase";

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
class ForbiddenError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 403;
  }
}

const USER_NS = "user";
const ROLE_ADMIN = "1";
const ROLE_RIDER = "2";

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
  status: boolean;
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

export {
  register,
  getOneUser,
  getAllUser,
  updateRole,
  updateTrustScore,
  updateStatus,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ROLE_ADMIN,
  ROLE_RIDER,
};
