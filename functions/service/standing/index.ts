import {db} from "../../config/firebase";
import * as cacheManager from "../../utils/cacheManager";
import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import {
  STANDING,
  STANDING_ACTION_DELTA,
  STANDING_EVENTS_COLLECTION,
} from "../../constants/behaviorReports";
import {ValidationError} from "../../utils/errors";
import {deliverAdminPush} from "../push/admin";
import {sendUserPush} from "../push/user";

type StandingTarget = {
  targetKind: "PROVIDER" | "RIDER";
  targetId: string;
  targetUid: string | null;
};

type ApplyStandingInput = StandingTarget & {
  action: string;
  reason: string;
  sourceKind: string;
  sourceId: string;
  actor: string;
  restrictDays?: number;
};

const nowIso = (): string => new Date().toISOString();

const addDays = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const clamp = (value: number): number =>
  Math.max(0, Math.min(STANDING.START, value));

const invalidateUserCache = (uid: string | null): void => {
  if (uid === null || uid === "") return;
  cacheManager.del("user", uid);
  cacheManager.del("user", "__all__");
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value as Record<string, unknown> | null;

const scoreOf = (user: Record<string, unknown> | null): number =>
  typeof user?.standingScore === "number" ?
    user.standingScore :
    STANDING.START;

const restrictedUntilOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ?
    value :
    null;

const isFuture = (iso: string | null): boolean =>
  iso !== null && Date.parse(iso) > Date.now();

const writeEvent = async (
  target: StandingTarget,
  input: ApplyStandingInput,
  delta: number,
  scoreAfter: number,
  restrictedUntil: string | null,
): Promise<void> => {
  await db.collection(STANDING_EVENTS_COLLECTION).doc().set({
    targetKind: target.targetKind,
    targetId: target.targetId,
    targetUid: target.targetUid,
    delta,
    scoreAfter,
    reason: input.reason,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    action: input.action,
    actor: input.actor,
    restrictedUntil,
    createdAt: nowIso(),
  });
};

const applyStanding = async (
  input: ApplyStandingInput,
): Promise<{score: number; restrictedUntil: string | null}> => {
  const user = input.targetUid === null ?
    null :
    asRecord(await userRepository.findById(input.targetUid));
  if (!user) return {score: STANDING.START, restrictedUntil: null};
  const delta = STANDING_ACTION_DELTA[input.action] ?? 0;
  const score = clamp(scoreOf(user) + delta);
  const explicitRestrict = input.action === "RESTRICT";
  const autoRestrict = score < STANDING.AUTO_RESTRICT_BELOW;
  const restrictedUntil = explicitRestrict || autoRestrict ?
    addDays(explicitRestrict ?
      input.restrictDays ?? STANDING.DEFAULT_RESTRICT_DAYS :
      STANDING.AUTO_RESTRICT_DAYS) :
    null;
  const provider = input.targetKind === "PROVIDER" ?
    await providerRepository.findById(input.targetId).catch(() => null) :
    null;
  const patch: Record<string, unknown> = {
    standingScore: score,
    standingUpdatedAt: nowIso(),
    ...(restrictedUntil !== null ? {
      restrictedUntil,
      restrictionReason: input.reason,
      restrictedBy: input.actor,
      restrictionSourceKind: input.sourceKind,
      restrictionSourceId: input.sourceId,
      ...(input.targetKind === "RIDER" ? {bookingBlocked: true} : {}),
    } : {}),
    ...(score < STANDING.REVIEW_BELOW ? {
      conductFlag: true,
      conductFlagAt: nowIso(),
    } : {}),
  };
  await db.collection("users").doc(input.targetUid as string).update(patch);
  invalidateUserCache(input.targetUid);
  if (input.targetKind === "PROVIDER" && restrictedUntil !== null) {
    const before = typeof provider?.acceptingBeforeRestriction === "boolean" ?
      provider.acceptingBeforeRestriction :
      provider?.accepting === true;
    await providerRepository.update(input.targetId, {
      accepting: false,
      acceptingBeforeRestriction: before,
      restrictedUntil,
      restrictionReason: input.reason,
      restrictedBy: input.actor,
      restrictedAt: nowIso(),
    });
  }
  await writeEvent(input, input, delta, score, restrictedUntil);
  if (score < STANDING.REVIEW_BELOW) {
    await deliverAdminPush({
      event: "STANDING_REVIEW",
      title: "Standing review needed",
      body: `${input.targetKind} ${input.targetId} · score ${score}`,
      refId: input.targetId,
      route: "/admin?section=users",
    }).catch(() => undefined);
  }
  return {score, restrictedUntil};
};

const standingOf = async (
  userId: string,
): Promise<{
  score: number;
  bookingBlocked: boolean;
  restrictedUntil: string | null;
  restrictionReason: string | null;
  conductFlag: boolean;
  events: Array<Record<string, unknown>>;
}> => {
  const user = asRecord(await userRepository.findById(userId));
  const events = await db
    .collection(STANDING_EVENTS_COLLECTION)
    .where("targetUid", "==", userId)
    .get();
  const rows: Array<Record<string, unknown>> = [];
  events.forEach((doc) => rows.push({id: doc.id, ...doc.data()}));
  rows.sort((a, b) =>
    String(a.createdAt ?? "") < String(b.createdAt ?? "") ? 1 : -1);
  return {
    score: scoreOf(user),
    bookingBlocked: user?.bookingBlocked === true,
    restrictedUntil: restrictedUntilOf(user?.restrictedUntil),
    restrictionReason: typeof user?.restrictionReason === "string" ?
      user.restrictionReason :
      null,
    conductFlag: user?.conductFlag === true,
    events: rows.slice(0, 50),
  };
};

const assertRiderCanRequest = async (userId: string): Promise<void> => {
  const user = await userRepository.findById(userId);
  if (!user) return;
  const until = restrictedUntilOf(user.restrictedUntil);
  const blocked = user.bookingBlocked === true ||
    (until !== null && isFuture(until));

  if (!blocked) {
    if (user.bookingBlocked === true && until !== null && !isFuture(until)) {
      await db.collection("users").doc(userId).update({
        bookingBlocked: false,
        restrictedUntil: null,
        restrictionReason: null,
      });
      invalidateUserCache(userId);
    }
    return;
  }
  const when = until === null ?
    "" :
    ` until ${new Date(until).toLocaleString()}`;
  throw new ValidationError(
    `Your account is restricted from new requests${when}`,
  );
};

const providerRestricted = (provider: {
  restrictedUntil?: unknown;
} | null): boolean => {
  const until = restrictedUntilOf(provider?.restrictedUntil);
  return isFuture(until);
};

const clearRestriction = async (input: StandingTarget & {
  actor: string;
}): Promise<void> => {
  if (input.targetUid !== null) {
    await db.collection("users").doc(input.targetUid).update({
      bookingBlocked: false,
      restrictedUntil: null,
      restrictionReason: null,
      restrictedBy: null,
      restrictionSourceKind: null,
      restrictionSourceId: null,
    }).catch(() => undefined);
    invalidateUserCache(input.targetUid);
  }
  if (input.targetKind === "PROVIDER") {
    await providerRepository.update(input.targetId, {
      acceptingBeforeRestriction: null,
      restrictedUntil: null,
      restrictionReason: null,
      restrictedBy: null,
      restrictedAt: null,
      restrictionSourceKind: null,
      restrictionSourceId: null,
    });
  }
  await db.collection(STANDING_EVENTS_COLLECTION).doc().set({
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetUid: input.targetUid,
    delta: 0,
    scoreAfter: null,
    reason: "Restriction cleared by admin",
    sourceKind: "ADMIN",
    sourceId: input.targetId,
    action: "CLEAR",
    actor: input.actor,
    restrictedUntil: null,
    createdAt: nowIso(),
  });
};

const overturnReportAction = async (input: {
  targetKind: "PROVIDER" | "RIDER";
  targetId: string;
  targetUid: string | null;
  action: string;
  sourceId: string;
  actor: string;
  note: string;
}): Promise<{score: number}> => {
  if (input.targetUid === null) return {score: STANDING.START};
  const user = asRecord(await userRepository.findById(input.targetUid));
  if (!user) return {score: STANDING.START};
  const delta = -(STANDING_ACTION_DELTA[input.action] ?? 0);
  const score = clamp(scoreOf(user) + delta);
  const sourceMatches = user.restrictionSourceId === input.sourceId;
  const patch: Record<string, unknown> = {
    standingScore: score,
    standingUpdatedAt: nowIso(),
    ...(sourceMatches ? {
      bookingBlocked: false,
      restrictedUntil: null,
      restrictionReason: null,
      restrictedBy: null,
      restrictionSourceKind: null,
      restrictionSourceId: null,
    } : {}),
  };
  await db.collection("users").doc(input.targetUid).update(patch);
  invalidateUserCache(input.targetUid);
  if (input.targetKind === "PROVIDER" && sourceMatches) {
    const provider = await providerRepository.findById(input.targetId)
      .catch(() => null);
    const before = typeof provider?.acceptingBeforeRestriction === "boolean" ?
      provider.acceptingBeforeRestriction :
      true;
    await providerRepository.update(input.targetId, {
      accepting: before,
      acceptingBeforeRestriction: null,
      restrictedUntil: null,
      restrictionReason: null,
      restrictedBy: null,
      restrictedAt: null,
      restrictionSourceKind: null,
      restrictionSourceId: null,
    });
  }
  await writeEvent({
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetUid: input.targetUid,
  }, {
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetUid: input.targetUid,
    action: "APPEAL_OVERTURN",
    reason: input.note,
    sourceKind: "APPEAL",
    sourceId: input.sourceId,
    actor: input.actor,
  }, delta, score, null);
  return {score};
};

const writeExpiryEvent = async (
  target: StandingTarget,
  score: number,
  reason: string,
): Promise<void> => {
  await db.collection(STANDING_EVENTS_COLLECTION).doc().set({
    targetKind: target.targetKind,
    targetId: target.targetId,
    targetUid: target.targetUid,
    delta: 0,
    scoreAfter: score,
    reason,
    sourceKind: "SYSTEM",
    sourceId: target.targetId,
    action: "EXPIRED",
    actor: "system",
    restrictedUntil: null,
    createdAt: nowIso(),
  });
};

const recoverStanding = async (): Promise<{recovered: number}> => {
  const cutoff = addDays(-STANDING.RECOVERY_AFTER_DAYS);
  const snap = await db
    .collection("users")
    .where("standingScore", "<", STANDING.START)
    .get();
  let recovered = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const updatedAt = typeof data.standingUpdatedAt === "string" ?
      data.standingUpdatedAt :
      "";
    if (updatedAt !== "" && updatedAt > cutoff) continue;
    await doc.ref.update({
      standingScore: clamp(scoreOf(data) + STANDING.RECOVERY_PER_WEEK),
      standingUpdatedAt: nowIso(),
    });
    invalidateUserCache(doc.id);
    recovered += 1;
  }
  const blocked = await db
    .collection("users")
    .where("bookingBlocked", "==", true)
    .get();
  for (const doc of blocked.docs) {
    const data = doc.data();
    const until = restrictedUntilOf(data.restrictedUntil);
    if (until !== null && !isFuture(until)) {
      await doc.ref.update({
        bookingBlocked: false,
        restrictedUntil: null,
        restrictionReason: null,
        restrictedBy: null,
        restrictionSourceKind: null,
        restrictionSourceId: null,
      });
      invalidateUserCache(doc.id);
      await writeExpiryEvent({
        targetKind: "RIDER",
        targetId: doc.id,
        targetUid: doc.id,
      }, scoreOf(data), "Restriction expired");
      await sendUserPush(
        doc.id,
        "Restriction ended",
        "Your account can request new bookings again",
      );
    }
  }
  const expiredProviders = await db
    .collection("providers")
    .where("restrictedUntil", "<=", nowIso())
    .get();
  for (const doc of expiredProviders.docs) {
    const data = doc.data();
    const before = typeof data.acceptingBeforeRestriction === "boolean" ?
      data.acceptingBeforeRestriction :
      true;
    const operatorUid = typeof data.operatorUid === "string" ?
      data.operatorUid :
      null;
    await providerRepository.update(doc.id, {
      accepting: before,
      acceptingBeforeRestriction: null,
      restrictedUntil: null,
      restrictionReason: null,
      restrictedBy: null,
      restrictedAt: null,
    });
    const operator = operatorUid === null ?
      null :
      await userRepository.findById(operatorUid).catch(() => null);
    await writeExpiryEvent({
      targetKind: "PROVIDER",
      targetId: doc.id,
      targetUid: operatorUid,
    }, scoreOf(operator), "Restriction expired");
    if (operatorUid !== null) {
      await sendUserPush(
        operatorUid,
        "Restriction ended",
        "Your provider can accept new jobs again",
      );
    }
  }
  return {recovered};
};

const resetStanding = async (
  userId: string,
  actor: string,
): Promise<void> => {
  await db.collection("users").doc(userId).update({
    standingScore: STANDING.START,
    standingUpdatedAt: nowIso(),
    conductFlag: false,
    conductFlagAt: null,
  });
  invalidateUserCache(userId);
  await db.collection(STANDING_EVENTS_COLLECTION).doc().set({
    targetKind: "RIDER",
    targetId: userId,
    targetUid: userId,
    delta: STANDING.START,
    scoreAfter: STANDING.START,
    reason: "Standing reset by admin",
    sourceKind: "ADMIN",
    sourceId: userId,
    action: "RESET",
    actor,
    restrictedUntil: null,
    createdAt: nowIso(),
  });
};

const flagConduct = async (input: StandingTarget): Promise<void> => {
  if (input.targetUid === null) return;
  await db.collection("users").doc(input.targetUid).update({
    conductFlag: true,
    conductFlagAt: nowIso(),
  }).catch(() => undefined);
  invalidateUserCache(input.targetUid);
  await deliverAdminPush({
    event: "CONDUCT_FLAG",
    title: "Repeat conduct reports",
    body: `${input.targetKind} ${input.targetId} flagged for review`,
    refId: input.targetId,
    route: "/admin?section=users",
  }).catch(() => undefined);
};

export {
  applyStanding,
  standingOf,
  assertRiderCanRequest,
  providerRestricted,
  clearRestriction,
  recoverStanding,
  overturnReportAction,
  resetStanding,
  flagConduct,
  STANDING,
};
