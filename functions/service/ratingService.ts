import * as ratingRepository from "../repository/ratingRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
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
}: {
  byUserId: string;
  targetId: string;
  targetKind: string;
  ticketId: string;
  score: number;
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
    await ratingRepository.updateScore(existing.id, score);
  } else {
    await ratingRepository.create({
      targetId,
      targetKind,
      byUserId,
      ticketId,
      score,
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
  const ratings = await ratingRepository.listByTarget(userId, targetKind);
  const {avg, count} = await ratingRepository.aggregate(userId, targetKind);
  return {
    ratings: ratings.map((r) => ({
      id: r.id,
      score: r.score,
      ticketId: r.ticketId,
      reply: (r.reply as string | undefined) ?? null,
      repliedAt: (r.repliedAt as string | undefined) ?? null,
      createdAt: r.createdAt,
    })),
    avg,
    count,
  };
};

const providerRatings = async (providerId: string) => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const ratings = await ratingRepository.listByTarget(
    providerId,
    RATING_TARGET.SHOP,
  );
  const {avg, count} = await ratingRepository.aggregate(
    providerId,
    RATING_TARGET.SHOP,
  );
  return {
    ratings: ratings.map((r) => ({
      id: r.id,
      score: r.score,
      reply: (r.reply as string | undefined) ?? null,
      repliedAt: (r.repliedAt as string | undefined) ?? null,
      createdAt: r.createdAt,
    })),
    avg,
    count,
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
  return ratings.map((r) => ({
    id: r.id,
    targetId: r.targetId,
    targetKind: r.targetKind,
    score: r.score,
    reply: (r.reply as string | undefined) ?? null,
    repliedAt: (r.repliedAt as string | undefined) ?? null,
    createdAt: r.createdAt,
  }));
};

export {
  submitRating,
  replyToRating,
  providerRatings,
  ratingsByTicket,
  userRatings,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
