import {messaging} from "../config/firebase";
import * as fcmTokenRepository from "../repository/fcmTokenRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as providerRepository from "../repository/providerRepository";
import * as reportRepository from "../repository/reportRepository";
import * as userRepository from "../repository/userRepository";
import {
  PROVIDER_REPORT_REASONS,
  REPORT_ACTION,
  REPORT_STATUS,
  REPORT_TARGET,
  RIDER_REPORT_REASONS,
  STANDING,
} from "../constants/behaviorReports";
import {ROLE_ADMIN} from "../constants/roles";
import {STATUS_DISPATCH, STATUS_USER} from "../constants/status";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import {validatePhotoPathsStructure} from "../utils/media";
import {deliverAdminPush} from "./push/admin";
import * as auditService from "./auditService";
import {attachReportContext} from "./report/context";
import {
  applyStanding,
  clearRestriction,
  flagConduct,
  resetStanding,
  standingOf,
} from "./standing";
import {suspendProvider} from "./provider/admin";
import * as userService from "./userService";

const assertAdmin = async (adminUid: string) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
  return caller;
};

const reasonsFor = (targetKind: string): readonly string[] =>
  targetKind === REPORT_TARGET.RIDER ?
    RIDER_REPORT_REASONS :
    PROVIDER_REPORT_REASONS;


const PROVIDER_NO_SHOW_STATUSES = new Set<string>([
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.QUOTED,
  STATUS_DISPATCH.ESTIMATED,
  STATUS_DISPATCH.CANCELLED,
  STATUS_DISPATCH.DECLINED,
  STATUS_DISPATCH.UNFIXABLE,
  STATUS_DISPATCH.RESOLVED_UNFIXABLE,
]);

const RIDER_NO_SHOW_STATUSES = new Set<string>([
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.ARRIVED,
  STATUS_DISPATCH.CANCELLED,
  STATUS_DISPATCH.DECLINED,
  STATUS_DISPATCH.UNFIXABLE,
  STATUS_DISPATCH.RESOLVED_UNFIXABLE,
]);

const TICKETLESS_PROVIDER_REASONS = [
  "FAKE_BUSINESS",
  "WRONG_LOCATION",
  "UNSAFE",
  "HARASSMENT",
  "SPAM",
  "INFO_INACCURATE",
  "OTHER",
];

const TICKETLESS_RIDER_REASONS = [
  "CONDUCT",
  "UNSAFE",
  "OTHER",
];

const ticketReasonsFor = (targetKind: string, status: string): string[] => {
  if (status === STATUS_DISPATCH.PENDING) return [];
  if (targetKind === REPORT_TARGET.RIDER) {
    const reasons: string[] = [];
    if (RIDER_NO_SHOW_STATUSES.has(status)) reasons.push("NO_SHOW");
    reasons.push("LATE");
    if (status === STATUS_DISPATCH.RESOLVED) reasons.push("PAYMENT_REFUSED");
    reasons.push("CONDUCT", "UNSAFE", "OTHER");
    return reasons;
  }
  const reasons: string[] = [];
  if (PROVIDER_NO_SHOW_STATUSES.has(status)) reasons.push("NO_SHOW");
  reasons.push("LATE", "UNSAFE", "HARASSMENT", "OTHER");
  return reasons;
};

const ticketlessReasonsFor = (targetKind: string): string[] =>
  targetKind === REPORT_TARGET.RIDER ?
    TICKETLESS_RIDER_REASONS :
    TICKETLESS_PROVIDER_REASONS;

const providerIdsFor = (
  ticket: dispatchRepository.DispatchTicket,
): string[] => [
  ticket.assignedShopId,
  ticket.providerId,
  ticket.destinationShopId,
].filter((value): value is string =>
  typeof value === "string" && value !== "");

const reporterRoleFor = async (
  ticket: dispatchRepository.DispatchTicket,
  reportedBy: string,
  isAdmin: boolean,
): Promise<"RIDER" | "PROVIDER" | "ADMIN" | null> => {
  if (isAdmin) return "ADMIN";
  if (ticket.userId === reportedBy) return "RIDER";
  if (ticket.assignedUid === reportedBy) return "PROVIDER";
  const ids = providerIdsFor(ticket);
  if (ids.length === 0) return null;
  const providers = await providerRepository.findByIds(ids);
  const isOperator = [...providers.values()]
    .some((provider) => provider.operatorUid === reportedBy);
  return isOperator ? "PROVIDER" : null;
};

const assertTicketReport = (
  input: {
    targetKind: string;
    targetId: string;
    reason: string;
  },
  ticket: dispatchRepository.DispatchTicket,
  reporterRole: "RIDER" | "PROVIDER" | "ADMIN",
): void => {
  if (ticket.status === STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Reports unlock once a provider is assigned");
  }
  if (reporterRole === "RIDER") {
    if (input.targetKind !== REPORT_TARGET.PROVIDER) {
      throw new ValidationError("Riders can only report providers");
    }
    if (!providerIdsFor(ticket).includes(input.targetId)) {
      throw new ValidationError("That provider is not on this ticket");
    }
  }
  if (reporterRole === "PROVIDER" &&
    (input.targetKind !== REPORT_TARGET.RIDER ||
      input.targetId !== ticket.userId)) {
    throw new ValidationError(
      "Providers can only report the rider on this ticket",
    );
  }
  const allowed = ticketReasonsFor(input.targetKind, ticket.status);
  if (!allowed.includes(input.reason)) {
    throw new ValidationError(
      "That report reason is not available for this ticket status",
    );
  }
};

const resolveTarget = async (
  targetKind: string,
  targetId: string,
): Promise<{name: string; targetUid: string | null}> => {
  if (targetKind === REPORT_TARGET.PROVIDER) {
    const provider = await providerRepository.findById(targetId);
    if (!provider) throw new NotFoundError("Provider not found");
    return {
      name: provider.name,
      targetUid: typeof provider.operatorUid === "string" ?
        provider.operatorUid :
        null,
    };
  }
  const user = await userRepository.findById(targetId);
  if (!user) throw new NotFoundError("User not found");
  return {
    name: typeof user.displayName === "string" ?
      user.displayName :
      targetId,
    targetUid: user.id,
  };
};

const fileReport = async (input: {
  reportedBy: string;
  targetKind: string;
  targetId: string;
  ticketId?: string;
  reason: string;
  note?: string;
  photoUrls?: string[];
}) => {
  if (input.targetKind !== REPORT_TARGET.PROVIDER &&
    input.targetKind !== REPORT_TARGET.RIDER) {
    throw new ValidationError("Unknown report target");
  }
  const reporter = await userRepository.findById(input.reportedBy);
  if (!reporter || reporter.status === STATUS_USER.INACTIVE) {
    throw new ForbiddenError("Account inactive");
  }
  const ticketId = typeof input.ticketId === "string" && input.ticketId !== "" ?
    input.ticketId :
    null;
  if (ticketId !== null) {
    const ticket = await dispatchRepository.findById(ticketId);
    if (!ticket) throw new NotFoundError("Dispatch ticket not found");
    const reporterRole = await reporterRoleFor(
      ticket,
      input.reportedBy,
      reporter.role === ROLE_ADMIN,
    );
    if (reporterRole === null) {
      throw new ForbiddenError(
        "Only ticket participants can report this ticket",
      );
    }
    assertTicketReport({
      targetKind: input.targetKind,
      targetId: input.targetId,
      reason: input.reason,
    }, ticket, reporterRole);
  } else if (!ticketlessReasonsFor(input.targetKind).includes(input.reason)) {
    throw new ValidationError("Unknown report reason");
  }
  const target = await resolveTarget(input.targetKind, input.targetId);
  if (target.targetUid === input.reportedBy) {
    throw new ValidationError("You cannot report yourself");
  }
  const duplicate = await reportRepository.findOpenDuplicate(
    input.reportedBy,
    input.targetKind,
    input.targetId,
    ticketId,
  );
  if (duplicate) {
    throw new ConflictError("You already have an open report for this case");
  }
  const report = await reportRepository.create({
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetUid: target.targetUid,
    reportedBy: input.reportedBy,
    ticketId,
    reason: input.reason,
    note: input.note ?? null,
    photoUrls: validatePhotoPathsStructure(input.photoUrls),
  });
  await deliverAdminPush({
    event: "REPORT_FILED",
    title: "New behavior report",
    body: `${target.name}: ${input.reason}`,
    refId: report.id,
    route: "/admin?section=cases&kind=REPORT",
  }).catch(() => undefined);
  return report;
};

const fileAutoReport = async (input: {
  ticketId: string;
  reportedBy: string;
  accusedKind: string;
  accusedId?: string | null;
  reasonCode: string;
  type: string;
}): Promise<void> => {
  const targetKind = input.accusedKind === "RIDER" ?
    REPORT_TARGET.RIDER :
    REPORT_TARGET.PROVIDER;
  const targetId = input.accusedId ?? "";
  if (targetId === "") return;
  const target = await resolveTarget(targetKind, targetId);
  await reportRepository.create({
    targetKind,
    targetId,
    targetUid: target.targetUid,
    reportedBy: input.reportedBy,
    ticketId: input.ticketId,
    reason: reasonsFor(targetKind).includes(input.reasonCode) ?
      input.reasonCode :
      "OTHER",
    note: input.type,
  });
};

const myReports = async (userId: string) =>
  reportRepository.findByReporter(userId);

const listReports = async (input: {
  adminUid: string;
  targetKind?: string;
  status?: string;
}) => {
  await assertAdmin(input.adminUid);
  const rows = await reportRepository.list({
    ...(input.targetKind !== undefined ? {targetKind: input.targetKind} : {}),
    ...(input.status !== undefined ? {status: input.status} : {}),
  });
  const allReports = await reportRepository.list({limit: 200});
  const openCounts = new Map<string, number>();
  const totalCounts = new Map<string, number>();
  for (const row of allReports) {
    const key = `${row.targetKind}:${row.targetId}`;
    totalCounts.set(key, (totalCounts.get(key) ?? 0) + 1);
    if (row.status === REPORT_STATUS.OPEN) {
      openCounts.set(key, (openCounts.get(key) ?? 0) + 1);
    }
  }
  const withNames = await Promise.all(rows.map(async (row) => {
    const target = await resolveTarget(row.targetKind, row.targetId)
      .catch(() => ({name: row.targetId, targetUid: row.targetUid}));
    const reporter = await userRepository.findById(row.reportedBy)
      .catch(() => null);
    const key = `${row.targetKind}:${row.targetId}`;
    const [targetContext, reporterContext] = await Promise.all([
      personContextFor({
        kind: row.targetKind,
        id: row.targetId,
        uid: target.targetUid,
        openReports: openCounts.get(key) ?? 0,
        totalReports: totalCounts.get(key) ?? 0,
      }),
      personContextFor({
        kind: REPORT_TARGET.RIDER,
        id: row.reportedBy,
        uid: row.reportedBy,
        openReports: 0,
        totalReports: 0,
      }),
    ]);
    return {
      ...row,
      targetName: target.name,
      reporterName: reporter && typeof reporter.displayName === "string" ?
        reporter.displayName :
        row.reportedBy,
      targetContext,
      reporterContext,
    };
  }));
  return attachReportContext(withNames);
};

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const numberOrZero = (value: unknown): number =>
  typeof value === "number" ? value : 0;

const providerPersonContext = async (input: {
  id: string;
  uid: string | null;
  openReports: number;
  totalReports: number;
}): Promise<Record<string, unknown> | null> => {
  const provider = await providerRepository.findById(input.id)
    .catch(() => null);
  if (!provider) return null;
  const operator = input.uid === null ?
    null :
    await userRepository.findById(input.uid).catch(() => null);
  const standing = input.uid === null ?
    null :
    await standingOf(input.uid).catch(() => null);
  return {
    kind: "PROVIDER",
    id: provider.id,
    name: provider.name,
    providerKind: provider.kind,
    suspended: provider.suspended === true,
    accepting: provider.accepting === true,
    ratingAvg: numberOrZero(provider.ratingAvg),
    ratingCount: numberOrZero(provider.ratingCount),
    trustScore: numberOrZero(operator?.trustScore),
    declineCount: numberOrZero(provider.declineCount),
    operatorUid: input.uid,
    email: textOrNull(operator?.email),
    phone: textOrNull(operator?.phone),
    role: textOrNull(operator?.role),
    status: textOrNull(operator?.status),
    standingScore: standing?.score ?? null,
    bookingBlocked: standing?.bookingBlocked ?? false,
    restrictedUntil: standing?.restrictedUntil ?? null,
    restrictionReason: standing?.restrictionReason ?? null,
    conductFlag: standing?.conductFlag ?? false,
    openReports: input.openReports,
    totalReports: input.totalReports,
  };
};

const riderPersonContext = async (input: {
  id: string;
  openReports: number;
  totalReports: number;
}): Promise<Record<string, unknown> | null> => {
  const user = await userRepository.findById(input.id).catch(() => null);
  if (!user) return null;
  const standing = await standingOf(input.id).catch(() => null);
  return {
    kind: "RIDER",
    id: user.id,
    name: typeof user.displayName === "string" && user.displayName !== "" ?
      user.displayName :
      user.email ?? user.id,
    email: textOrNull(user.email),
    phone: textOrNull(user.phone),
    role: textOrNull(user.role),
    status: textOrNull(user.status),
    ratingAvg: numberOrZero(user.ratingAvg),
    ratingCount: numberOrZero(user.ratingCount),
    trustScore: numberOrZero(user.trustScore),
    standingScore: standing?.score ?? null,
    bookingBlocked: standing?.bookingBlocked ?? false,
    restrictedUntil: standing?.restrictedUntil ?? null,
    restrictionReason: standing?.restrictionReason ?? null,
    conductFlag: standing?.conductFlag ?? false,
    openReports: input.openReports,
    totalReports: input.totalReports,
  };
};

const personContextFor = async (input: {
  kind: string;
  id: string;
  uid: string | null;
  openReports: number;
  totalReports: number;
}): Promise<Record<string, unknown> | null> => {
  if (input.kind !== REPORT_TARGET.PROVIDER) {
    return riderPersonContext(input);
  }
  return providerPersonContext(input);
};

const sendUserPush = async (
  userId: string,
  title: string,
  body: string,
): Promise<void> => {
  try {
    const record = await fcmTokenRepository.findByUserId(userId);
    const tokens = (record?.tokens as string[] | undefined) ?? [];
    if (tokens.length === 0) return;
    await messaging.sendEach(tokens.map((token) => ({
      token,
      notification: {title, body},
      data: {reportDecision: "true"},
    })));
  } catch {
    void 0;
  }
};

const decideReport = async (input: {
  adminUid: string;
  reportId: string;
  action: string;
  note?: string;
}) => {
  await assertAdmin(input.adminUid);
  const report = await reportRepository.findById(input.reportId);
  if (!report) throw new NotFoundError("Report not found");
  if (report.status !== REPORT_STATUS.OPEN) {
    throw new ValidationError("Report already decided");
  }
  const action = input.action;
  const allowed = report.targetKind === REPORT_TARGET.RIDER ?
    [REPORT_ACTION.NONE, REPORT_ACTION.WARN, REPORT_ACTION.RESTRICT,
      REPORT_ACTION.BLOCK] :
    [REPORT_ACTION.NONE, REPORT_ACTION.WARN, REPORT_ACTION.RESTRICT,
      REPORT_ACTION.SUSPEND];
  if (!allowed.includes(action as never)) {
    throw new ValidationError("Action not allowed for this target");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (action !== REPORT_ACTION.NONE && note === "") {
    throw new ValidationError("A note is required for this action");
  }
  const status = action === REPORT_ACTION.NONE ?
    REPORT_STATUS.DISMISSED :
    REPORT_STATUS.RESOLVED;
  const updated = await reportRepository.decide(report.id, {
    status,
    action,
    actionNote: note === "" ? null : note,
    decidedBy: input.adminUid,
  });
  if (action !== REPORT_ACTION.NONE) {
    await applyStanding({
      targetKind: report.targetKind as "PROVIDER" | "RIDER",
      targetId: report.targetId,
      targetUid: report.targetUid,
      action,
      reason: note,
      sourceKind: "REPORT",
      sourceId: report.id,
      actor: input.adminUid,
      ...(action === REPORT_ACTION.RESTRICT ?
        {restrictDays: STANDING.DEFAULT_RESTRICT_DAYS} :
        {}),
    });
    if (report.targetKind === REPORT_TARGET.PROVIDER &&
      action === REPORT_ACTION.SUSPEND) {
      await suspendProvider({
        adminUid: input.adminUid,
        providerId: report.targetId,
        reason: note,
      });
    }
    if (report.targetKind === REPORT_TARGET.RIDER &&
      action === REPORT_ACTION.BLOCK && report.targetUid !== null) {
      await userService.updateStatus({
        actorId: input.adminUid,
        targetUserId: report.targetUid,
        status: STATUS_USER.INACTIVE,
        note,
      });
    }
    const since = new Date(
      Date.now() - STANDING.UPHELD_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const upheld = await reportRepository.countUpheldForTarget(
      report.targetKind,
      report.targetId,
      since,
    );
    if (upheld >= STANDING.FLAG_AFTER_UPHELD) {
      await flagConduct({
        targetKind: report.targetKind as "PROVIDER" | "RIDER",
        targetId: report.targetId,
        targetUid: report.targetUid,
      });
    }
  }
  await auditService.record({
    adminUid: input.adminUid,
    action: "REPORT_DECIDED",
    category: "CASE",
    targetType: "REPORT",
    targetId: report.id,
    targetLabel: `${report.targetKind} ${report.targetId}`,
    before: {status: report.status, action: report.action ?? null},
    after: {status, action},
    note: note === "" ? null : note,
    meta: {ticketId: report.ticketId ?? null},
  });
  const label = action === REPORT_ACTION.NONE ?
    "Report dismissed" :
    `Report resolved: ${action}`;
  if (report.targetUid !== null) {
    await sendUserPush(report.targetUid, "Behavior report", label);
  }
  await sendUserPush(report.reportedBy, "Behavior report", label);
  return updated;
};

const clearReportRestriction = async (input: {
  adminUid: string;
  targetKind: string;
  targetId: string;
}) => {
  await assertAdmin(input.adminUid);
  const target = await resolveTarget(input.targetKind, input.targetId);
  await clearRestriction({
    targetKind: input.targetKind as "PROVIDER" | "RIDER",
    targetId: input.targetId,
    targetUid: target.targetUid,
    actor: input.adminUid,
  });
  await auditService.record({
    adminUid: input.adminUid,
    action: "RESTRICTION_CLEARED",
    category: "USER",
    targetType: input.targetKind,
    targetId: input.targetId,
    targetLabel: target.name,
  });
  return {cleared: true};
};

const userStanding = async (input: {
  adminUid: string;
  userId: string;
}) => {
  await assertAdmin(input.adminUid);
  return standingOf(input.userId);
};

const resetUserStanding = async (input: {
  adminUid: string;
  userId: string;
}) => {
  await assertAdmin(input.adminUid);
  const target = await resolveTarget(REPORT_TARGET.RIDER, input.userId);
  const before = await standingOf(input.userId);
  await resetStanding(input.userId, input.adminUid);
  await auditService.record({
    adminUid: input.adminUid,
    action: "STANDING_RESET",
    category: "USER",
    targetType: "USER",
    targetId: input.userId,
    targetLabel: target.name,
    before: {standingScore: before.score},
    after: {standingScore: 100},
  });
  return standingOf(input.userId);
};

export {
  fileReport,
  fileAutoReport,
  myReports,
  listReports,
  decideReport,
  clearReportRestriction,
  userStanding,
  resetUserStanding,
};
