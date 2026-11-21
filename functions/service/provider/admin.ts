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
import {deliverAdminPush} from "../push/admin";
import {sendUserPush} from "../push/user";
import * as auditService from "../auditService";
import {ensureProviderVehicleProfile} from "./vehicle";

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

export const listProviders = async ({
  adminUid,
  status,
  kind,
  startDate,
  endDate,
  limit,
}: {
  adminUid: string;
  status?: string;
  kind?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
  const all = await providerRepository.findAll();
  const statusCounts: Record<string, number> = {
    ALL: all.length,
    PENDING: 0,
    ACTIVE: 0,
    DENIED: 0,
  };
  const kindCounts: Record<string, number> = {
    SHOP: 0,
    TOW: 0,
    MOBILE_SHOP: 0,
  };
  for (const provider of all) {
    const providerStatus = typeof provider.status === "string" ?
      provider.status :
      "UNKNOWN";
    statusCounts[providerStatus] = (statusCounts[providerStatus] ?? 0) + 1;
    const providerKind = typeof provider.kind === "string" ?
      provider.kind :
      "UNKNOWN";
    kindCounts[providerKind] = (kindCounts[providerKind] ?? 0) + 1;
  }
  const from = startDate ? `${startDate}T00:00:00.000Z` : "";
  const to = endDate ? `${endDate}T23:59:59.999Z` : "";
  const filtered = all.filter((provider) => {
    if (status && provider.status !== status) return false;
    if (kind && provider.kind !== kind) return false;
    if (from === "" && to === "") return true;
    const requested = typeof provider.requestedAt === "string" ?
      provider.requestedAt :
      typeof provider.createdAt === "string" ? provider.createdAt : "";
    if (from !== "" && requested < from) return false;
    if (to !== "" && requested > to) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const av = typeof a.requestedAt === "string" ? a.requestedAt : "";
    const bv = typeof b.requestedAt === "string" ? b.requestedAt : "";
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
  const page = filtered.slice(0, typeof limit === "number" ? limit : 200);
  const items = [];
  for (const item of page) {
    const applicant = await userRepository.findById(item.operatorUid ?? "");
    const openReportCount =
      await providerReportRepository.countOpenForProvider(item.id);
    items.push({
      ...item,
      applicantEmail: applicant?.email ?? null,
      applicantName: applicant?.displayName ?? null,
      applicantPhone: applicant?.phone ?? null,
      openReportCount,
    });
  }
  return {
    total: filtered.length,
    counts: statusCounts,
    kindCounts,
    items,
  };
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
  await providerRepository.update(providerId, {
    accepting: approve,
    ...(!approve && typeof existing.vehicleProfileId === "string" ?
      {vehicleProfileId: null} :
      {}),
  });
  if (!approve) {
    await providerLocationRepository.remove(providerId);
  }
  if (approve) {
    const linked = existing.vehicleProfileId;
    await ensureProviderVehicleProfile({
      ...existing,
      id: providerId,
      vehicleProfileId: typeof linked === "string" ? linked : null,
    }).catch(() => undefined);
  }
  cacheManager.del(PROVIDER_NS);
  cacheManager.del(SHOP_NS);
  await auditService.record({
    adminUid,
    action: approve ? "PROVIDER_APPROVED" : "PROVIDER_DENIED",
    category: "PROVIDER",
    targetType: "PROVIDER",
    targetId: providerId,
    targetLabel: existing.name,
    before: {status: existing.status},
    after: {status: approve ? PROVIDER_STATUS.ACTIVE : PROVIDER_STATUS.DENIED},
    note: reviewNote ?? null,
    meta: {kind: existing.kind},
  });
  const operatorUid = typeof existing.operatorUid === "string" ?
    existing.operatorUid :
    "";
  if (operatorUid !== "") {
    await sendUserPush(
      operatorUid,
      approve ? "Provider approved" : "Provider application declined",
      approve ?
        `${existing.name} is approved and can start accepting jobs.` :
        `${existing.name} was not approved.${reviewNote ? ` ${reviewNote}` : ""}`,
      {
        event: "PROVIDER_REVIEWED",
        providerId,
        status: approve ? PROVIDER_STATUS.ACTIVE : PROVIDER_STATUS.DENIED,
      },
    ).catch(() => undefined);
  }
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
  const report = await providerReportRepository.create({
    providerId,
    providerKind: provider.kind,
    targetUid: (provider.operatorUid as string | null) ?? null,
    reportedBy: userId,
    ticketId,
    reason,
    note,
  });
  await deliverAdminPush({
    event: "PROVIDER_REPORT",
    title: "New provider report",
    body: `${provider.name}: ${reason}`,
    refId: report.id,
    route: `/admin?section=providers&providerId=${provider.id}`,
  }).catch(() => undefined);
  return report;
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
  await auditService.record({
    adminUid,
    action: "PROVIDER_REPORT_DISMISSED",
    category: "PROVIDER",
    targetType: "PROVIDER_REPORT",
    targetId: reportId,
    targetLabel: report.providerId,
    before: {status: report.status},
    after: {status: PROVIDER_REPORT_STATUS.DISMISSED},
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
  if (caller.role === ROLE_ADMIN) {
    await auditService.record({
      adminUid: userId,
      action: "PROVIDER_REVOKED",
      category: "PROVIDER",
      targetType: "PROVIDER",
      targetId: providerId,
      targetLabel: provider.name,
      before: {status: provider.status},
      after: {status: PROVIDER_STATUS.DENIED},
    });
  }
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
  await auditService.record({
    adminUid,
    action: "PROVIDER_SUSPENDED",
    category: "PROVIDER",
    targetType: "PROVIDER",
    targetId: providerId,
    targetLabel: provider.name,
    before: {suspended: provider.suspended === true},
    after: {suspended: true},
    note: reason ?? null,
    meta: {reportId: reportId ?? null},
  });
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
  await auditService.record({
    adminUid,
    action: "PROVIDER_RESTORED",
    category: "PROVIDER",
    targetType: "PROVIDER",
    targetId: providerId,
    targetLabel: provider.name,
    before: {suspended: true},
    after: {suspended: false},
  });
  return {restored: true, suspended: false};
};
