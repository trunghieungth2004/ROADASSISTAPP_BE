import * as ratingRepository from "../repository/ratingRepository";
import * as appealRepository from "../repository/appealRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as disputeRepository from "../repository/disputeRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import * as cacheManager from "../utils/cacheManager";
import {
  RATING_MAX,
  RATING_MIN,
  RATING_TARGET,
  STATUS_DISPATCH,
} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";

import {DISPUTE_TYPE} from "../constants/disputes";
import {
  RATING_AUTO_EXCLUDE_MAX,
  RATING_WINDOW,
} from "../constants/ratings";
import {
  APPEAL_MAX,
  APPEAL_STATUS,
  APPEAL_WINDOW_DAYS,
} from "../constants/appeals";


import {ForbiddenError, NotFoundError, ValidationError} from
  "../utils/errors";

const VALID_TARGETS: string[] = Object.values(RATING_TARGET);

const checkHelperTarget = (
  ticket: Record<string, unknown>,
  byUserId: string,
  targetId: string,
): void => {
  if (ticket.userId !== byUserId) {
    throw new ForbiddenError("Only the rider rates the helper");
  }
  const assignedShop = ticket.assignedShopId as string | null;
  const destinationShop = ticket.destinationShopId as string | null;
  const assignedUid = ticket.assignedUid as string | null;
  if (targetId !== assignedUid && targetId !== assignedShop) {
    if (targetId !== destinationShop) {
      throw new ValidationError("Target did not help on this ticket");
    }
    const fulfilled = ticket.fulfilledByShopId as string | null;
    if (fulfilled !== destinationShop) {
      throw new ValidationError("Shop did not fulfil this ticket");
    }
  }
};

const checkRiderTarget = async (
  ticket: Record<string, unknown>,
  byUserId: string,
  targetId: string,
): Promise<void> => {
  if (ticket.userId !== targetId) {
    throw new ValidationError("Target is not the rider");
  }
  if (ticket.assignedUid === byUserId) return;
  const assignedShop = ticket.assignedShopId as string | null;
  if (typeof assignedShop === "string" && assignedShop !== "") {
    const shop = await providerRepository.findById(assignedShop);
    if (shop && shop.operatorUid === byUserId) return;
  }
  throw new ForbiddenError("Only the helper rates the rider");
};

const submitRating = async ({
  byUserId,
  targetId,
  targetKind,
  ticketId,
  score,
  text,
}: {
  byUserId: string;
  targetId: string;
  targetKind: string;
  ticketId: string;
  score: number;
  text?: string;
}) => {
  if (!VALID_TARGETS.includes(targetKind)) {
    throw new ValidationError("Invalid rating target");
  }
  if (
    !Number.isInteger(score) ||
    score < RATING_MIN ||
    score > RATING_MAX
  ) {
    throw new ValidationError("Score must be an integer 1-5");
  }
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.status !== STATUS_DISPATCH.RESOLVED) {
    throw new ValidationError("Ticket must be resolved to rate");
  }
  if (targetKind === RATING_TARGET.RIDER) {
    await checkRiderTarget(
      ticket as unknown as Record<string, unknown>,
      byUserId,
      targetId,
    );
  } else {
    checkHelperTarget(
      ticket as unknown as Record<string, unknown>,
      byUserId,
      targetId,
    );
  }
  const existing = await ratingRepository.findExisting(
    targetId,
    targetKind,
    byUserId,
    ticketId,
  );
  if (existing) {
    await ratingRepository.updateScore(
      existing.id,
      score,
      typeof text === "string" && text.trim() !== "" ?
        text.trim() :
        undefined,
    );
  } else {
    await ratingRepository.create({
      targetId,
      targetKind,
      byUserId,
      ticketId,
      score,
      ...(typeof text === "string" && text.trim() !== "" ?
        {text: text.trim()} :
        {}),
    });
  }
  const {avg, count} = await ratingRepository.aggregate(
    targetId,
    targetKind,
  );
  if (targetKind === RATING_TARGET.SHOP) {
    await providerRepository.updateRating(targetId, avg, count);
    cacheManager.del("shop");
    cacheManager.del("provider");
  } else {
    await userRepository.updateRating(targetId, avg, count);
    cacheManager.del("user", targetId);
  }
  if (targetKind === RATING_TARGET.RIDER) {
    await dispatchRepository.update(ticketId, {riderRating: score});
  } else {
    await dispatchRepository.update(ticketId, {helperRating: score});
  }
  const disputes = await disputeRepository.findByTicketId(ticketId)
    .catch(() => []);
  let excluded = 0;
  for (const dispute of disputes) {
    if (dispute.status !== "RESOLVED") continue;
    excluded += await autoExcludeForDispute({
      ticketId,
      disputeId: dispute.id,
      type: dispute.type,
      outcome: dispute.outcome ?? "",
      filedBy: dispute.filedBy,
    }).catch(() => 0);
  }
  if (excluded > 0) {
    const next = await ratingRepository.aggregate(targetId, targetKind);
    return {avg: next.avg, count: next.count, updated: 1};
  }
  return {avg, count, updated: 1};
};

const replyToRating = async ({
  userId,
  ratingId,
  reply,
}: {
  userId: string;
  ratingId: string;
  reply: string;
}) => {
  const text = reply.trim();
  if (!text) throw new ValidationError("Reply needs text");
  const rating = await ratingRepository.findById(ratingId);
  if (!rating) throw new NotFoundError("Rating not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const isAdmin = caller.role === ROLE_ADMIN;
  if (!isAdmin) {
    if (rating.targetKind === RATING_TARGET.SHOP) {
      const shop = await providerRepository.findById(rating.targetId);
      if (!shop || shop.operatorUid !== userId) {
        throw new ForbiddenError("Only the shop replies to its ratings");
      }
    } else if (rating.targetId !== userId) {
      throw new ForbiddenError("Only the rated user replies");
    }
  }
  await ratingRepository.updateReply(ratingId, text, userId);
  return {replied: true};
};

const userRatings = async ({
  callerId,
  userId,
  targetKind,
  ticketId,
}: {
  callerId: string;
  userId: string;
  targetKind: string;
  ticketId?: string;
}) => {
  if (!VALID_TARGETS.includes(targetKind) ||
    targetKind === RATING_TARGET.SHOP) {
    throw new ValidationError("Invalid rating target");
  }
  const caller = await userRepository.findById(callerId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    if (!ticketId) throw new ForbiddenError("Ticket context required");
    const ticket = await dispatchRepository.findById(ticketId);
    if (!ticket) throw new NotFoundError("Dispatch ticket not found");
    const involved = new Set<string>();
    if (typeof ticket.userId === "string") involved.add(ticket.userId);
    if (typeof ticket.assignedUid === "string" && ticket.assignedUid !== "") {
      involved.add(ticket.assignedUid);
    }
    for (const shopId of [ticket.assignedShopId, ticket.providerId]) {
      if (typeof shopId !== "string" || shopId === "") continue;
      const shop = await providerRepository.findById(shopId);
      if (shop && typeof shop.operatorUid === "string") {
        involved.add(shop.operatorUid);
      }
    }
    if (!involved.has(callerId) || !involved.has(userId)) {
      throw new ForbiddenError("No shared ticket with this user");
    }
  }
  const ratings = await ratingRepository.listRecentByTarget(userId, targetKind);
  const {avg, count} = await ratingRepository.aggregate(userId, targetKind);
  const authorIds = ratings
    .map((r) => r.byUserId)
    .filter((v): v is string => typeof v === "string" && v !== "");
  const names = await userRepository.findByIds(authorIds);
  return {
    ratings: ratings.map((r) => {
      const author = typeof r.byUserId === "string" ?
        names.get(r.byUserId) :
        undefined;
      const rawName = author?.displayName;
      const byUserName = typeof rawName === "string" && rawName !== "" ?
        rawName :
        null;
      return {
        id: r.id,
        score: r.score,
        text: (r.text as string | undefined) ?? null,
        byUserName,
        ticketId: r.ticketId,
        reply: (r.reply as string | undefined) ?? null,
        repliedAt: (r.repliedAt as string | undefined) ?? null,
        createdAt: r.createdAt,
      };
    }),
    avg,
    count,
    window: RATING_WINDOW,
  };
};

const providerRatings = async (providerId: string) => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const ratings = await ratingRepository.listRecentByTarget(
    providerId,
    RATING_TARGET.SHOP,
  );
  const {avg, count} = await ratingRepository.aggregate(
    providerId,
    RATING_TARGET.SHOP,
  );
  const completedJobs = await dispatchRepository.countFulfilled(providerId);
  const authorIds = ratings
    .map((r) => r.byUserId)
    .filter((v): v is string => typeof v === "string" && v !== "");
  const names = await userRepository.findByIds(authorIds);
  return {
    ratings: ratings.map((r) => {
      const author = typeof r.byUserId === "string" ?
        names.get(r.byUserId) :
        undefined;
      const rawName = author?.displayName;
      const byUserName = typeof rawName === "string" && rawName !== "" ?
        rawName :
        null;
      return {
        id: r.id,
        score: r.score,
        text: (r.text as string | undefined) ?? null,
        byUserName,
        reply: (r.reply as string | undefined) ?? null,
        repliedAt: (r.repliedAt as string | undefined) ?? null,
        createdAt: r.createdAt,
      };
    }),
    avg,
    count,
    window: RATING_WINDOW,
    completedJobs,
  };
};

const ratingsByTicket = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const involved = ticket.userId === userId ||
    ticket.assignedUid === userId;
  if (!involved && caller.role !== ROLE_ADMIN) {
    let operator = false;
    for (const shopId of [ticket.assignedShopId, ticket.providerId]) {
      if (typeof shopId !== "string" || shopId === "") continue;
      const shop = await providerRepository.findById(shopId);
      if (shop && shop.operatorUid === userId) {
        operator = true;
        break;
      }
    }
    if (!operator) {
      throw new ForbiddenError("Only ticket participants view ratings");
    }
  }
  const ratings = await ratingRepository.listByTicket(ticketId);
  const appeals = await appealRepository.findBySubjectIds(
    "RATING",
    ratings.map((r) => r.id),
    userId,
  );
  const appealByRating = new Map<string, string>();
  for (const appeal of appeals) {
    if (!appealByRating.has(appeal.subjectId) ||
      appeal.status === APPEAL_STATUS.OPEN) {
      appealByRating.set(appeal.subjectId, appeal.status);
    }
  }
  const nameIds = new Set<string>();
  for (const r of ratings) {
    if (typeof r.byUserId === "string" && r.byUserId !== "") {
      nameIds.add(r.byUserId);
    }
    if (typeof r.repliedBy === "string" && r.repliedBy !== "") {
      nameIds.add(r.repliedBy as string);
    }
  }
  const users = await userRepository.findByIds([...nameIds]);
  const nameOf = (id: unknown): string | null => {
    if (typeof id !== "string" || id === "") return null;
    const user = users.get(id);
    const name = user?.displayName;
    return typeof name === "string" && name !== "" ? name : null;
  };
  return ratings.map((r) => ({
    id: r.id,
    targetId: r.targetId,
    targetKind: r.targetKind,
    byUserId: r.byUserId,
    byUserName: nameOf(r.byUserId),
    score: r.score,
    text: (r.text as string | undefined) ?? null,
    reply: (r.reply as string | undefined) ?? null,
    repliedByName: nameOf(r.repliedBy),
    repliedAt: (r.repliedAt as string | undefined) ?? null,
    createdAt: r.createdAt,
    excluded: r.excluded === true,
    appealStatus: appealByRating.get(r.id) ?? null,
  }));
};


const recomputeTargetRating = async (
  targetId: string,
  targetKind: string,
): Promise<{avg: number; count: number}> => {
  const result = await ratingRepository.aggregate(targetId, targetKind);
  if (targetKind === RATING_TARGET.SHOP) {
    await providerRepository.updateRating(
      targetId,
      result.avg,
      result.count,
    );
    cacheManager.del("shop");
    cacheManager.del("provider");
  } else {
    await userRepository.updateRating(
      targetId,
      result.avg,
      result.count,
    );
    cacheManager.del("user", targetId);
  }
  return result;
};

const appealView = (
  rating: ratingRepository.Rating,
  appeals: appealRepository.Appeal[],
) => {
  const sorted = appeals
    .filter((appeal) =>
      appeal.subjectKind === "RATING" && appeal.subjectId === rating.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const open = sorted.find(
    (appeal) => appeal.status === APPEAL_STATUS.OPEN,
  );
  const created = Date.parse(rating.createdAt);
  const inWindow = !Number.isFinite(created) ||
    Date.now() - created <= APPEAL_WINDOW_DAYS.RATING * 24 * 60 * 60 * 1000;
  return {
    appealStatus: open ? APPEAL_STATUS.OPEN : sorted[0]?.status ?? null,
    appealResolution: sorted[0]?.resolution ?? null,
    appealReason: sorted[0]?.reason ?? null,
    appealNote: sorted[0]?.note ?? null,
    appealCreatedAt: sorted[0]?.createdAt ?? null,
    appealDecidedAt: sorted[0]?.decidedAt ?? null,
    canAppeal: rating.excluded !== true &&
      inWindow &&
      open === undefined &&
      sorted.length < APPEAL_MAX.RATING,
  };
};

const receivedRatings = async (userId: string) => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const providers = await providerRepository.findByOperator(userId);
  const riderRows = await ratingRepository.listByTarget(
    userId,
    RATING_TARGET.RIDER,
  );
  const providerRows = await Promise.all(providers.map(async (provider) => ({
    provider,
    rows: await ratingRepository.listByTarget(
      provider.id,
      RATING_TARGET.SHOP,
    ),
  })));
  const allRows = [
    ...riderRows,
    ...providerRows.flatMap((group) => group.rows),
  ];
  const authorIds = [...new Set(allRows.map((row) => row.byUserId))];
  const names = await userRepository.findByIds(authorIds);
  const appeals = await appealRepository.findBySubjectIds(
    "RATING",
    allRows.map((row) => row.id),
    userId,
  );
  const authorName = (id: string): string | null => {
    const name = names.get(id)?.displayName;
    return typeof name === "string" && name !== "" ? name : null;
  };
  const view = (row: ratingRepository.Rating) => ({
    id: row.id,
    score: row.score,
    text: (row.text as string | undefined) ?? null,
    ticketId: row.ticketId,
    createdAt: row.createdAt,
    byUserId: row.byUserId,
    byUserName: authorName(row.byUserId),
    excluded: row.excluded === true,
    ...appealView(row, appeals),
  });
  const riderAggregate = await ratingRepository.aggregate(
    userId,
    RATING_TARGET.RIDER,
  );
  const providerGroups = await Promise.all(providerRows.map(async (group) => ({
    id: group.provider.id,
    name: group.provider.name,
    ...(await ratingRepository.aggregate(
      group.provider.id,
      RATING_TARGET.SHOP,
    )),
    window: RATING_WINDOW,
    ratings: group.rows
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(view),
  })));
  return {
    rider: {
      id: userId,
      name: typeof caller.displayName === "string" &&
        caller.displayName !== "" ?
        caller.displayName :
        "Rider",
      ...riderAggregate,
      window: RATING_WINDOW,
      ratings: riderRows
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(view),
    },
    providers: providerGroups,
  };
};

const autoExcludeForDispute = async (input: {
  ticketId: string;
  disputeId: string;
  type: string;
  outcome: string;
  filedBy: string;
}): Promise<number> => {
  if (input.outcome !== "SHOP" && input.outcome !== "RIDER") return 0;
  const ratings = await ratingRepository.listByTicket(input.ticketId);
  const candidates = ratings.filter((rating) => {
    if (rating.excluded === true || rating.score > RATING_AUTO_EXCLUDE_MAX) {
      return false;
    }
    if (rating.byUserId !== input.filedBy) return false;
    if (input.type === DISPUTE_TYPE.SERVICE_QUALITY &&
      input.outcome === "SHOP") {
      return rating.targetKind === RATING_TARGET.SHOP;
    }
    if (input.type === DISPUTE_TYPE.RIDER_CONDUCT &&
      input.outcome === "RIDER") {
      return rating.targetKind === RATING_TARGET.RIDER;
    }
    return false;
  });
  const targets = new Map<string, string>();
  for (const rating of candidates) {
    await ratingRepository.exclude(rating.id, {
      excludedBy: "system",
      exclusionReason:
        `Dispute ${input.disputeId} resolved in favour of the rated party`,
      exclusionSource: "DISPUTE",
      exclusionRef: input.disputeId,
    });
    targets.set(`${rating.targetKind}:${rating.targetId}`,
      `${rating.targetKind}|${rating.targetId}`);
  }
  for (const value of targets.values()) {
    const [targetKind, targetId] = value.split("|");
    await recomputeTargetRating(targetId, targetKind);
  }
  return candidates.length;
};

const recomputeAllRatings = async (): Promise<{targets: number}> => {
  const rows = await ratingRepository.listAll();
  const targets = new Map<string, {targetId: string; targetKind: string}>();
  for (const row of rows) {
    targets.set(`${row.targetKind}:${row.targetId}`, {
      targetId: row.targetId,
      targetKind: row.targetKind,
    });
  }
  for (const target of targets.values()) {
    await recomputeTargetRating(target.targetId, target.targetKind);
  }
  return {targets: targets.size};
};

export {
  submitRating,
  replyToRating,
  providerRatings,
  ratingsByTicket,
  userRatings,
  receivedRatings,
  autoExcludeForDispute,
  recomputeAllRatings,
  recomputeTargetRating,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
