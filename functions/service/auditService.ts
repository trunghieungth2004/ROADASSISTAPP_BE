import * as auditRepository from "../repository/auditRepository";
import * as userRepository from "../repository/userRepository";
import {ROLE_ADMIN} from "../constants/roles";
import {ForbiddenError, NotFoundError} from "../utils/errors";
import {currentRequestId, logError} from "../utils/logger";

const categoryFor = (action: string): string => {
  if (action.startsWith("USER_") || action.includes("TRUST") ||
    action.includes("STANDING") || action.includes("RESTRICTION")) {
    return "USER";
  }
  if (action.includes("REFUND") || action.includes("PAYOUT") ||
    action.includes("COMMISSION")) {
    return "MONEY";
  }
  if (action.startsWith("CONFIG_")) return "CONFIG";
  if (action.includes("REPORT") || action.includes("DISPUTE") ||
    action.includes("APPEAL")) {
    return "CASE";
  }
  if (action.includes("PROVIDER")) return "PROVIDER";
  if (action.includes("WARRANTY") || action.includes("SUPPORT") ||
    action.includes("FLAG")) {
    return "CONTENT";
  }
  return "SYSTEM";
};

const record = async (data: {
  adminUid: string;
  action: string;
  category?: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> => {
  const actor = await userRepository.findById(data.adminUid).catch(() => null);
  const row = {
    adminUid: data.adminUid,
    actorName: typeof actor?.displayName === "string" ?
      actor.displayName :
      null,
    actorEmail: typeof actor?.email === "string" ? actor.email : null,
    action: data.action,
    category: data.category ?? categoryFor(data.action),
    targetType: data.targetType,
    targetId: data.targetId ?? null,
    targetLabel: data.targetLabel ?? null,
    before: data.before ?? null,
    after: data.after ?? null,
    note: data.note ?? null,
    requestId: currentRequestId() ?? null,
    meta: data.meta ?? null,
  };
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await auditRepository.create(row);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  logError("audit", "admin-audit-write-failed", {
    adminUid: data.adminUid,
    action: data.action,
    targetType: data.targetType,
    targetId: data.targetId ?? null,
  }, lastError);
};

const list = async ({
  adminUid,
  limit,
  before,
  from,
  to,
}: {
  adminUid: string;
  limit?: number;
  before?: string;
  from?: string;
  to?: string;
}): Promise<auditRepository.AuditRow[]> => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
  return auditRepository.findAll({
    limit: Math.min(limit ?? 100, 200),
    ...(before !== undefined ? {before} : {}),
    ...(from !== undefined ? {from} : {}),
    ...(to !== undefined ? {to} : {}),
  });
};

export {record, list};
