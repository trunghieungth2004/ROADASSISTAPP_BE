import {SHOP_NS, PROVIDER_NS} from "./crud";
import * as providerRepository from "../../repository/providerRepository";
import * as dispatchRepository from "../../repository/dispatchRepository";
import * as providerReportRepository from
  "../../repository/providerReportRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as userRepository from "../../repository/userRepository";


import {
  PROVIDER_KIND,
  PROVIDER_REPORT_REASON,
  PROVIDER_REPORT_STATUS,
  PROVIDER_STATUS,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";


import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";


export const listPending = async (adminUid?: string) => {
  if (adminUid) {
    const caller = await userRepository.findById(adminUid);
    if (!caller) throw new NotFoundError("User not found");
    if (caller.role !== ROLE_ADMIN) {
      throw new ForbiddenError("Admin role required");
    }
  }
  const pending = await providerRepository.findPending();
  const out = [];
  for (const item of pending) {
    const applicant = await userRepository.findById(item.operatorUid ?? "");
    const openReportCount =
      await providerReportRepository.countOpenForProvider(item.id);
    out.push({
      ...item,
      applicantEmail: applicant?.email ?? null,
      applicantName: applicant?.displayName ?? null,
      openReportCount,
    });
  }
  return out;
};

export const reviewProvider = async ({
  adminUid,
  providerId,
  approve,
  reviewNote,
}: {
  adminUid: string;
  providerId: string;
  approve: boolean;
  reviewNote?: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const existing = await providerRepository.findById(providerId);
  if (!existing) throw new NotFoundError("Provider not found");
  const decided = await providerRepository.decide(providerId, {
    status: approve ? PROVIDER_STATUS.ACTIVE : PROVIDER_STATUS.DENIED,
    reviewedBy: adminUid,
    reviewNote,
  });
  if (!decided) {
    return {decided: false, status: existing.status};
  }
  await providerRepository.update(providerId, {accepting: approve});
  if (!approve) {
    await providerLocationRepository.remove(providerId);
  }
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {
    decided: true,
    status: approve ? PROVIDER_STATUS.ACTIVE : PROVIDER_STATUS.DENIED,
  };
};

export const reportProvider = async ({
  userId,
  providerId,
  reason,
  note,
  ticketId,
}: {
  userId: string;
  providerId: string;
  reason: string;
  note?: string;
  ticketId?: string;
}) => {
  const reporter = await userRepository.findById(userId);
  if (!reporter) throw new NotFoundError("User not found");
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  if (provider.status !== PROVIDER_STATUS.ACTIVE ||
    (provider as {suspended?: boolean}).suspended === true) {
    throw new ValidationError("Only active providers can be reported");
  }
  if (!(Object.values(PROVIDER_REPORT_REASON) as string[]).includes(reason)) {
    throw new ValidationError("Unknown report reason");
  }
  const dupe = await providerReportRepository.findOpenByReporter(
    providerId,
    userId,
  );
  if (dupe) {
    throw new ConflictError(
      "You already have an open report for this provider",
    );
  }
  return providerReportRepository.create({
    providerId,
    providerKind: provider.kind,
    targetUid: (provider.operatorUid as string | null) ?? null,
    reportedBy: userId,
    ticketId,
    reason,
    note,
  });
};

export const listReports = async (adminUid: string) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const reports = await providerReportRepository.listOpen();
  const out = [];
  for (const report of reports) {
    const provider = await providerRepository.findById(report.providerId);
    out.push({
      ...report,
      providerName: provider?.name ?? null,
      providerStatus: provider?.status ?? null,
      providerSuspended: (provider as {suspended?: boolean} | null)
        ?.suspended === true,
    });
  }
  return out;
};

export const dismissReport = async ({
  adminUid,
  reportId,
}: {
  adminUid: string;
  reportId: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const report = await providerReportRepository.findById(reportId);
  if (!report) throw new NotFoundError("Report not found");
  const dismissed = await providerReportRepository.decide(reportId, {
    status: PROVIDER_REPORT_STATUS.DISMISSED,
    resolution: "NONE",
    decidedBy: adminUid,
  });
  return {dismissed};
};

export const revokeProvider = async ({
  userId,
  providerId,
}: {
  userId: string;
  providerId: string;
}) => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (provider.operatorUid !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator removes this licence");
  }
  const active = (await dispatchRepository.findActiveForShop(providerId)) ?? [];
  if (active.length > 0) {
    throw new ConflictError("Provider is on an active ticket", {
      ticketId: active[0].id,
    });
  }
  if (provider.kind === PROVIDER_KIND.SHOP) {
    const pending = await dispatchRepository.findPendingForShop(providerId);
    if (pending.length > 0) {
      throw new ConflictError("Provider has pending tickets", {
        ticketId: pending[0].id,
      });
    }
    const destination = await dispatchRepository.findActiveForDestination(
      providerId,
    );
    if (destination.length > 0) {
      throw new ConflictError("Provider has active drop-offs", {
        ticketId: destination[0].id,
      });
    }
  }
  await providerRepository.update(providerId, {
    status: PROVIDER_STATUS.DENIED,
    accepting: false,
    vehicleProfileId: null,
    reviewNote: "Licence removed by operator",
    reviewedBy: userId,
    decidedAt: new Date().toISOString(),
  });
  await providerLocationRepository.remove(providerId);
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {revoked: true};
};

export const suspendProvider = async ({
  adminUid,
  providerId,
  reason,
  reportId,
}: {
  adminUid: string;
  providerId: string;
  reason?: string;
  reportId?: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const now = new Date().toISOString();
  await providerRepository.update(providerId, {
    suspended: true,
    suspendedAt: now,
    suspendedReason: reason ?? null,
    suspendedBy: adminUid,
    accepting: false,
  });
  await providerLocationRepository.remove(providerId);
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  let reportDecided: boolean | null = null;
  if (reportId) {
    const report = await providerReportRepository.findById(reportId);
    if (!report) throw new NotFoundError("Report not found");
    reportDecided = await providerReportRepository.decide(reportId, {
      status: PROVIDER_REPORT_STATUS.RESOLVED,
      resolution: "SUSPENDED",
      decidedBy: adminUid,
    });
  }
  return {suspended: true, reportDecided};
};

export const restoreProvider = async ({
  adminUid,
  providerId,
}: {
  adminUid: string;
  providerId: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  if ((provider as {suspended?: boolean}).suspended !== true) {
    return {restored: false, suspended: false};
  }
  await providerRepository.update(providerId, {
    suspended: false,
    suspendedAt: null,
    suspendedReason: null,
    suspendedBy: null,
    accepting: false,
  });
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  return {restored: true, suspended: false};
};
