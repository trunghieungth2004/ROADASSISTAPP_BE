import * as appealRepository from "../repository/appealRepository";
import * as disputeRepository from "../repository/disputeRepository";
import * as providerRepository from "../repository/providerRepository";
import * as ratingRepository from "../repository/ratingRepository";
import * as reportRepository from "../repository/reportRepository";
import * as userRepository from "../repository/userRepository";
import * as ratingService from "./ratingService";
import {applyAppealOutcome} from "./dispute/appealOutcome";
import * as standingService from "./standing";
import * as userService from "./userService";
import {restoreProvider} from "./provider/admin";
import {deliverAdminPush} from "./push/admin";
import * as auditService from "./auditService";
import {sendUserPush} from "./push/user";
import {
  APPEAL_MAX,
  APPEAL_REASONS,
  APPEAL_RESOLUTION,
  APPEAL_STATUS,
  APPEAL_SUBJECT,
  APPEAL_WINDOW_DAYS,
} from "../constants/appeals";
import {ROLE_ADMIN} from "../constants/roles";
import {STATUS_USER} from "../constants/status";
import {validatePhotoPathsStructure} from "../utils/media";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";

const assertAdmin = async (userId: string): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
};

const inWindow = (
  createdAt: string | null | undefined,
  days: number,
): boolean => {
  if (typeof createdAt !== "string" || createdAt === "") return true;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return true;
  return Date.now() - at <= days * 24 * 60 * 60 * 1000;
};

const providerIdsFor = async (userId: string): Promise<string[]> => {
  const providers = await providerRepository.findByOperator(userId)
    .catch(() => []);
  return providers.map((provider) => provider.id);
};

const isProviderOperator = async (
  providerId: string,
  userId: string,
): Promise<boolean> => {
  const provider = await providerRepository.findById(providerId)
    .catch(() => null);
  return provider?.operatorUid === userId;
};

const ratingSubject = async (userId: string, ratingId: string) => {
  const rating = await ratingRepository.findById(ratingId);
  if (!rating) throw new NotFoundError("Rating not found");
  if (rating.excluded === true) {
    throw new ValidationError("This rating has already been removed");
  }
  const isRated = rating.targetKind === "RIDER" ?
    rating.targetId === userId :
    await isProviderOperator(rating.targetId, userId);
  if (!isRated) throw new ForbiddenError("Only the rated party can appeal");
  if (!inWindow(rating.createdAt, APPEAL_WINDOW_DAYS.RATING)) {
    throw new ValidationError("The appeal window has passed");
  }
  return {
    ticketId: rating.ticketId,
    snapshot: {
      ratingId: rating.id,
      score: rating.score,
      text: (rating.text as string | undefined) ?? null,
      targetId: rating.targetId,
      targetKind: rating.targetKind,
      byUserId: rating.byUserId,
      ticketId: rating.ticketId,
      createdAt: rating.createdAt,
      excluded: false,
    },
  };
};

const reportSubject = async (userId: string, reportId: string) => {
  const report = await reportRepository.findById(reportId);
  if (!report) throw new NotFoundError("Report not found");
  if (report.status !== "RESOLVED" || report.action === "NONE") {
    throw new ValidationError("Only an actioned report can be appealed");
  }
  const isTarget = report.targetKind === "RIDER" ?
    report.targetId === userId :
    await isProviderOperator(report.targetId, userId);
  if (!isTarget) throw new ForbiddenError("Only the report target can appeal");
  if (!inWindow(
    report.decidedAt ?? report.createdAt,
    APPEAL_WINDOW_DAYS.REPORT,
  )) {
    throw new ValidationError("The appeal window has passed");
  }
  return {
    ticketId: report.ticketId,
    snapshot: {
      reportId: report.id,
      targetKind: report.targetKind,
      targetId: report.targetId,
      reportedBy: report.reportedBy,
      reason: report.reason,
      note: report.note,
      action: report.action,
      actionNote: report.actionNote,
      ticketId: report.ticketId,
      createdAt: report.createdAt,
      decidedAt: report.decidedAt,
    },
  };
};

const disputeSubject = async (userId: string, disputeId: string) => {
  const dispute = await disputeRepository.findById(disputeId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  if (dispute.status !== "RESOLVED" && dispute.status !== "DISMISSED") {
    throw new ValidationError("Only a decided dispute can be appealed");
  }
  const providerIds = await providerIdsFor(userId);
  const isParty = dispute.filedBy === userId ||
    dispute.accusedId === userId ||
    (dispute.accusedId !== null && providerIds.includes(dispute.accusedId));
  if (!isParty) throw new ForbiddenError("Only dispute parties can appeal");
  if (!inWindow(
    dispute.resolvedAt ?? dispute.updatedAt,
    APPEAL_WINDOW_DAYS.DISPUTE,
  )) {
    throw new ValidationError("The appeal window has passed");
  }
  return {
    ticketId: dispute.ticketId,
    snapshot: {
      disputeId: dispute.id,
      type: dispute.type,
      reasonCode: dispute.reasonCode,
      filedBy: dispute.filedBy,
      accusedKind: dispute.accusedKind,
      accusedId: dispute.accusedId,
      outcome: dispute.outcome,
      resolution: dispute.resolution,
      adjustedAmount: dispute.adjustedAmount,
      ticketId: dispute.ticketId,
      createdAt: dispute.createdAt,
      resolvedAt: dispute.resolvedAt,
    },
  };
};

const fileAppeal = async (input: {
  userId: string;
  subjectKind: string;
  subjectId: string;
  reason: string;
  note?: string;
  photoUrls?: string[];
}) => {
  if (!(APPEAL_REASONS[input.subjectKind] ?? []).includes(input.reason)) {
    throw new ValidationError("Unknown appeal reason");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note === "") throw new ValidationError("Add appeal details");
  const open = await appealRepository.findOpen(
    input.subjectKind,
    input.subjectId,
    input.userId,
  );
  if (open) throw new ValidationError("An appeal is already open");
  const count = await appealRepository.countBySubject(
    input.subjectKind,
    input.subjectId,
    input.userId,
  );
  if (count >= (APPEAL_MAX[input.subjectKind] ?? 1)) {
    throw new ValidationError("This case has reached the appeal limit");
  }
  const subject = input.subjectKind === APPEAL_SUBJECT.RATING ?
    await ratingSubject(input.userId, input.subjectId) :
    input.subjectKind === APPEAL_SUBJECT.REPORT ?
      await reportSubject(input.userId, input.subjectId) :
      await disputeSubject(input.userId, input.subjectId);
  const appeal = await appealRepository.create({
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    ticketId: subject.ticketId,
    filedBy: input.userId,
    reason: input.reason,
    note,
    photoUrls: validatePhotoPathsStructure(input.photoUrls),
    snapshot: subject.snapshot,
  });
  await deliverAdminPush({
    event: "APPEAL_FILED",
    title: "New appeal",
    body: `${input.subjectKind} · ${input.reason}`,
    refId: appeal.id,
    route: "/admin?section=cases&kind=APPEAL",
  }).catch(() => undefined);
  return appeal;
};

const eligibleAppeals = async (userId: string) => {
  const providerIds = await providerIdsFor(userId);
  const ratings = await ratingService.receivedRatings(userId);
  const ratingItems = [ratings.rider, ...ratings.providers]
    .flatMap((group) => group.ratings.map((rating) => ({
      subjectKind: APPEAL_SUBJECT.RATING,
      subjectId: rating.id,
      ticketId: rating.ticketId,
      label: `Rating ${rating.score} · ${group.name}`,
      createdAt: rating.createdAt,
      canAppeal: rating.canAppeal,
      appealStatus: rating.appealStatus,
      snapshot: rating,
    })));
  const reportRows = await reportRepository.list({
    status: "RESOLVED",
    limit: 100,
  });
  const reports = reportRows.filter((report) =>
    report.action !== "NONE" &&
    (report.targetUid === userId ||
      report.targetId === userId ||
      providerIds.includes(report.targetId)));
  const reportAppeals = await appealRepository.findBySubjectIds(
    APPEAL_SUBJECT.REPORT,
    reports.map((report) => report.id),
    userId,
  );
  const reportItems = reports.map((report) => {
    const related = reportAppeals.filter((appeal) =>
      appeal.subjectId === report.id);
    const open = related.some((appeal) =>
      appeal.status === APPEAL_STATUS.OPEN);
    return {
      subjectKind: APPEAL_SUBJECT.REPORT,
      subjectId: report.id,
      ticketId: report.ticketId,
      label: `${report.reason} · ${report.action}`,
      createdAt: report.decidedAt ?? report.createdAt,
      canAppeal: inWindow(
        report.decidedAt ?? report.createdAt,
        APPEAL_WINDOW_DAYS.REPORT,
      ) && !open && related.length < APPEAL_MAX.REPORT,
      appealStatus: open ?
        APPEAL_STATUS.OPEN :
        related[0]?.status ?? null,
      appealReason: related[0]?.reason ?? null,
      appealNote: related[0]?.note ?? null,
      appealResolution: related[0]?.resolution ?? null,
      appealCreatedAt: related[0]?.createdAt ?? null,
      appealDecidedAt: related[0]?.decidedAt ?? null,
      snapshot: {
        reason: report.reason,
        action: report.action,
        note: report.note,
        actionNote: report.actionNote,
      },
    };
  });
  const disputeRows = await disputeRepository.findAll(200);
  const disputes = disputeRows.filter((dispute) =>
    (dispute.status === "RESOLVED" || dispute.status === "DISMISSED") &&
    (dispute.filedBy === userId ||
      dispute.accusedId === userId ||
      (dispute.accusedId !== null && providerIds.includes(dispute.accusedId))));
  const disputeAppeals = await appealRepository.findBySubjectIds(
    APPEAL_SUBJECT.DISPUTE,
    disputes.map((dispute) => dispute.id),
    userId,
  );
  const disputeItems = disputes.map((dispute) => {
    const related = disputeAppeals.filter((appeal) =>
      appeal.subjectId === dispute.id);
    const open = related.some((appeal) =>
      appeal.status === APPEAL_STATUS.OPEN);
    return {
      subjectKind: APPEAL_SUBJECT.DISPUTE,
      subjectId: dispute.id,
      ticketId: dispute.ticketId,
      label: `${dispute.type} · ${dispute.outcome ?? dispute.status}`,
      createdAt: dispute.resolvedAt ?? dispute.updatedAt,
      canAppeal: inWindow(
        dispute.resolvedAt ?? dispute.updatedAt,
        APPEAL_WINDOW_DAYS.DISPUTE,
      ) && !open && related.length < APPEAL_MAX.DISPUTE,
      appealStatus: open ?
        APPEAL_STATUS.OPEN :
        related[0]?.status ?? null,
      appealReason: related[0]?.reason ?? null,
      appealNote: related[0]?.note ?? null,
      appealResolution: related[0]?.resolution ?? null,
      appealCreatedAt: related[0]?.createdAt ?? null,
      appealDecidedAt: related[0]?.decidedAt ?? null,
      snapshot: {
        type: dispute.type,
        reasonCode: dispute.reasonCode,
        outcome: dispute.outcome,
        resolution: dispute.resolution,
        adjustedAmount: dispute.adjustedAmount,
      },
    };
  });
  const byDate = (a: {createdAt: string}, b: {createdAt: string}) =>
    a.createdAt < b.createdAt ? 1 : -1;
  return {
    ratings: ratingItems.sort(byDate),
    reports: reportItems.sort(byDate),
    disputes: disputeItems.sort(byDate),
  };
};

const listAppeals = async (input: {
  adminUid: string;
  subjectKind?: string;
  status?: string;
}) => {
  await assertAdmin(input.adminUid);
  const rows = await appealRepository.list({
    ...(input.subjectKind !== undefined ?
      {subjectKind: input.subjectKind} :
      {}),
    ...(input.status !== undefined ? {status: input.status} : {}),
  });
  return Promise.all(rows.map(async (appeal) => {
    const appellant = await userRepository.findById(appeal.filedBy)
      .catch(() => null);
    return {
      ...appeal,
      appellantName: typeof appellant?.displayName === "string" ?
        appellant.displayName :
        appeal.filedBy,
    };
  }));
};

const applyRatingDecision = async (
  appeal: appealRepository.Appeal,
  resolution: string,
  note: string,
  adminUid: string,
): Promise<void> => {
  if (resolution !== APPEAL_RESOLUTION.REMOVE) return;
  const rating = await ratingRepository.findById(appeal.subjectId);
  if (!rating) throw new NotFoundError("Rating not found");
  await ratingRepository.exclude(rating.id, {
    excludedBy: adminUid,
    exclusionReason: note,
    exclusionSource: "APPEAL",
    exclusionRef: appeal.id,
  });
  await ratingService.recomputeTargetRating(
    rating.targetId,
    rating.targetKind,
  );
};

const applyReportDecision = async (
  appeal: appealRepository.Appeal,
  resolution: string,
  note: string,
  adminUid: string,
): Promise<void> => {
  if (resolution !== APPEAL_RESOLUTION.OVERTURN) return;
  const report = await reportRepository.findById(appeal.subjectId);
  if (!report) throw new NotFoundError("Report not found");
  await standingService.overturnReportAction({
    targetKind: report.targetKind as "PROVIDER" | "RIDER",
    targetId: report.targetId,
    targetUid: report.targetUid,
    action: report.action,
    sourceId: report.id,
    actor: adminUid,
    note,
  });
  if (report.targetKind === "PROVIDER" && report.action === "SUSPEND") {
    await restoreProvider({
      adminUid,
      providerId: report.targetId,
    });
  }
  if (report.targetKind === "RIDER" &&
    report.action === "BLOCK" &&
    report.targetUid !== null) {
    await userService.updateStatus({
      actorId: adminUid,
      targetUserId: report.targetUid,
      status: STATUS_USER.ACTIVE,
      note,
    });
  }
};

const applyDisputeDecision = async (
  appeal: appealRepository.Appeal,
  resolution: string,
  note: string,
  adminUid: string,
  adjustedAmount?: number,
): Promise<void> => {
  if (resolution === APPEAL_RESOLUTION.UPHOLD) return;
  const dispute = await disputeRepository.findById(appeal.subjectId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  if (resolution === APPEAL_RESOLUTION.ADJUST) {
    if (typeof adjustedAmount !== "number") {
      throw new ValidationError("Adjusted amount is required");
    }
    await applyAppealOutcome({
      disputeId: dispute.id,
      outcome: "PARTIAL",
      adjustedAmount,
      resolution: note,
      by: adminUid,
    });
    return;
  }
  const outcome = dispute.outcome === "SHOP" ? "RIDER" :
    dispute.outcome === "RIDER" ? "SHOP" : "";
  if (outcome === "") {
    throw new ValidationError("Use ADJUST for a partial outcome");
  }
  await applyAppealOutcome({
    disputeId: dispute.id,
    outcome,
    resolution: note,
    by: adminUid,
  });
};

const decideAppeal = async (input: {
  adminUid: string;
  appealId: string;
  resolution: string;
  note: string;
  adjustedAmount?: number;
}) => {
  await assertAdmin(input.adminUid);
  const appeal = await appealRepository.findById(input.appealId);
  if (!appeal) throw new NotFoundError("Appeal not found");
  if (appeal.status !== APPEAL_STATUS.OPEN) {
    throw new ValidationError("Appeal already decided");
  }
  const note = input.note.trim();
  if (note === "") throw new ValidationError("A note is required");
  const allowed: string[] = appeal.subjectKind === APPEAL_SUBJECT.RATING ?
    [APPEAL_RESOLUTION.REMOVE, APPEAL_RESOLUTION.KEEP] :
    appeal.subjectKind === APPEAL_SUBJECT.REPORT ?
      [APPEAL_RESOLUTION.UPHOLD, APPEAL_RESOLUTION.OVERTURN] :
      [APPEAL_RESOLUTION.UPHOLD, APPEAL_RESOLUTION.OVERTURN,
        APPEAL_RESOLUTION.ADJUST];
  if (!allowed.includes(input.resolution)) {
    throw new ValidationError("Resolution not allowed");
  }
  if (appeal.subjectKind === APPEAL_SUBJECT.RATING) {
    await applyRatingDecision(appeal, input.resolution, note, input.adminUid);
  } else if (appeal.subjectKind === APPEAL_SUBJECT.REPORT) {
    await applyReportDecision(appeal, input.resolution, note, input.adminUid);
  } else {
    await applyDisputeDecision(
      appeal,
      input.resolution,
      note,
      input.adminUid,
      input.adjustedAmount,
    );
  }
  const changed = input.resolution === APPEAL_RESOLUTION.REMOVE ||
    input.resolution === APPEAL_RESOLUTION.OVERTURN ||
    input.resolution === APPEAL_RESOLUTION.ADJUST;
  const updated = await appealRepository.decide(appeal.id, {
    status: changed ? APPEAL_STATUS.RESOLVED : APPEAL_STATUS.DISMISSED,
    resolution: input.resolution,
    decisionNote: note,
    ...(typeof input.adjustedAmount === "number" ?
      {adjustedAmount: input.adjustedAmount} :
      {}),
    decidedBy: input.adminUid,
  });
  await auditService.record({
    adminUid: input.adminUid,
    action: "APPEAL_DECIDED",
    category: "CASE",
    targetType: "APPEAL",
    targetId: appeal.id,
    targetLabel: `${appeal.subjectKind} ${appeal.subjectId}`,
    before: {status: appeal.status, resolution: appeal.resolution},
    after: {
      status: changed ? APPEAL_STATUS.RESOLVED : APPEAL_STATUS.DISMISSED,
      resolution: input.resolution,
      ...(typeof input.adjustedAmount === "number" ?
        {adjustedAmount: input.adjustedAmount} :
        {}),
    },
    note,
    meta: {ticketId: appeal.ticketId ?? null},
  });
  const title = changed ? "Appeal accepted" : "Appeal rejected";
  await sendUserPush(appeal.filedBy, title, note);
  const subject = appeal.snapshot;
  const counterparty = appeal.subjectKind === APPEAL_SUBJECT.RATING ?
    subject.byUserId :
    appeal.subjectKind === APPEAL_SUBJECT.REPORT ?
      subject.reportedBy :
      subject.filedBy;
  if (typeof counterparty === "string" && counterparty !== appeal.filedBy) {
    await sendUserPush(counterparty, title, note);
  }
  return updated;
};

export {
  fileAppeal,
  eligibleAppeals,
  listAppeals,
  decideAppeal,
};
