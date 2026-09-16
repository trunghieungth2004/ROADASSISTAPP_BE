import * as ratingRepository from "../repository/ratingRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as shopRepository from "../repository/shopRepository";
import * as userRepository from "../repository/userRepository";
import * as cacheManager from "../utils/cacheManager";
import {
  RATING_MAX,
  RATING_MIN,
  RATING_TARGET,
  STATUS_DISPATCH,
} from "../constants/status";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}
class ForbiddenError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

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
    const shop = await shopRepository.findById(assignedShop);
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
    await shopRepository.updateRating(targetId, avg, count);
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

export {
  submitRating,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
