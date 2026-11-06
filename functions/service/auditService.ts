import * as auditRepository from "../repository/auditRepository";
import * as userRepository from "../repository/userRepository";
import {ROLE_ADMIN} from "../constants/roles";
import {ForbiddenError, NotFoundError} from "../utils/errors";

const record = async (data: {
  adminUid: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> => {
  await auditRepository.create(data).catch(() => undefined);
};

const list = async ({
  adminUid,
  limit,
}: {
  adminUid: string;
  limit?: number;
}): Promise<auditRepository.AuditRow[]> => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
  return auditRepository.findAll(Math.min(limit ?? 100, 200));
};

export {record, list};
