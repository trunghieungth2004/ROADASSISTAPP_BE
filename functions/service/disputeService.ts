import * as disputeRepository from "../repository/disputeRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {db, FieldValue} from "../config/firebase";
import {ROLE_ADMIN} from "../constants/roles";
import {
  ACCUSED_KIND,
  DISPUTE_FALLBACK_REASON,
  DISPUTE_FALLBACK_TYPE,
  DISPUTE_LIST_LIMIT,
  DISPUTE_LIST_MAX,
  DISPUTE_REASON,
  DISPUTE_STATUS,
  DISPUTE_TYPE,
  PROVIDER_COLLECTION,
  RIDER_DISPUTE_ALIASES,
  USER_COLLECTION,
} from "../constants/payments";
import {ForbiddenError, NotFoundError, ValidationError} from "../utils/errors";
import {validatePhotoPathsStructure} from "../utils/media";

type TicketLike = {
  id: string;
  userId: string;
  assignedShopId?: string | null;
  destinationShopId?: string | null;
  providerId?: string | null;
  assignedUid?: string | null;
};

interface DisputeInput {
  ticketId: string;
  filedBy: string;
  accusedKind: string;
  accusedId?: string | null;
  type: string;
  reasonCode: string;
  note?: string | null;
  photoUrls?: string[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const isReasonCode = (reasonCode: string): boolean =>
  (Object.values(DISPUTE_REASON) as string[]).includes(reasonCode);

const isDisputeType = (type: string): boolean =>
  (Object.values(DISPUTE_TYPE) as string[]).includes(type);

const isAccusedKind = (accusedKind: string): boolean =>
  (Object.values(ACCUSED_KIND) as string[]).includes(accusedKind);

const validateCodes = ({
  accusedKind,
  type,
  reasonCode,
}: {
  accusedKind: string;
  type: string;
  reasonCode: string;
}): void => {
  if (!isAccusedKind(accusedKind)) {
    throw new ValidationError("Unknown accused kind");
  }
  if (!isDisputeType(type)) {
    throw new ValidationError("Unknown dispute type");
  }
  if (!isReasonCode(reasonCode)) {
    throw new ValidationError("Unknown dispute reason");
  }
};

const normalizeCodes = ({
  accusedKind,
  type,
  reasonCode,
  reason,
}: {
  accusedKind?: string;
  type?: string;
  reasonCode?: string;
  reason?: string;
}): {accusedKind: string; type: string; reasonCode: string} => {
  if (
    typeof accusedKind === "string" && isAccusedKind(accusedKind) &&
    typeof type === "string" && isDisputeType(type) &&
    typeof reasonCode === "string" && isReasonCode(reasonCode)
  ) {
    return {accusedKind, type, reasonCode};
  }
  const alias = typeof reason === "string" ?
    RIDER_DISPUTE_ALIASES[reason] :
    undefined;
  if (alias) return {...alias};
  const kind = typeof accusedKind === "string" && isAccusedKind(accusedKind) ?
    accusedKind :
    ACCUSED_KIND.SHOP;
  return {
    accusedKind: kind,
    type: typeof type === "string" && isDisputeType(type) ?
      type :
      DISPUTE_FALLBACK_TYPE[kind],
    reasonCode: typeof reasonCode === "string" && isReasonCode(reasonCode) ?
      reasonCode :
      DISPUTE_FALLBACK_REASON[kind],
  };
};

const isOperatorOfTicket = async (
  ticket: TicketLike,
  userId: string,
): Promise<boolean> => {
  if (nonEmpty(ticket.assignedUid) && ticket.assignedUid === userId) {
    return true;
  }
  const shopIds = [
    ticket.assignedShopId,
    ticket.destinationShopId,
    ticket.providerId,
  ].filter(nonEmpty);
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) return true;
  }
  return false;
};

const isParticipant = async (
  ticket: TicketLike,
  userId: string,
): Promise<boolean> => {
  if (ticket.userId === userId) return true;
  return isOperatorOfTicket(ticket, userId);
};

const assertAdmin = async (userId: string): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
};

const file = async (
  input: DisputeInput,
): Promise<disputeRepository.Dispute> => {
  validateCodes(input);
  const ticket = await dispatchRepository.findById(input.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  return disputeRepository.create({
    ticketId: input.ticketId,
    filedBy: input.filedBy,
    accusedKind: input.accusedKind,
    accusedId: input.accusedId ?? null,
    type: input.type,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    photoUrls: validatePhotoPathsStructure(input.photoUrls),
    status: DISPUTE_STATUS.OPEN,
  });
};

const userFile = async (
  input: DisputeInput,
): Promise<disputeRepository.Dispute> => {
  const ticket = await dispatchRepository.findById(input.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(input.filedBy);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    const participant = await isParticipant(ticket, input.filedBy);
    if (!participant) {
      throw new ForbiddenError("Only ticket participants file disputes");
    }
  }
  return file(input);
};

const one = async ({
  disputeId,
  userId,
}: {
  disputeId: string;
  userId: string;
}): Promise<disputeRepository.Dispute | null> => {
  const dispute = await disputeRepository.findById(disputeId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return dispute;
  if (dispute.filedBy === userId) return dispute;
  if (dispute.accusedId === userId) return dispute;
  throw new ForbiddenError("Not allowed to view this dispute");
};

const resolve = async ({
  disputeId,
  resolution,
  by,
  refundAdjust,
  payoutAdjust,
}: {
  disputeId: string;
  resolution: string;
  by: string;
  refundAdjust?: number;
  payoutAdjust?: number;
}): Promise<disputeRepository.Dispute | null> => {
  await assertAdmin(by);
  const dispute = await disputeRepository.findById(disputeId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  const patch: Record<string, unknown> = {
    status: DISPUTE_STATUS.RESOLVED,
    resolution,
    resolvedBy: by,
    resolvedAt: new Date().toISOString(),
  };
  if (typeof refundAdjust === "number") patch.refundAdjust = refundAdjust;
  if (typeof payoutAdjust === "number") patch.payoutAdjust = payoutAdjust;
  await disputeRepository.update(disputeId, patch);
  return disputeRepository.findById(disputeId);
};

const dismiss = async ({
  disputeId,
  by,
  resolution,
}: {
  disputeId: string;
  by: string;
  resolution?: string;
}): Promise<disputeRepository.Dispute | null> => {
  await assertAdmin(by);
  const dispute = await disputeRepository.findById(disputeId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  await disputeRepository.update(disputeId, {
    status: DISPUTE_STATUS.DISMISSED,
    resolution: resolution ?? null,
    resolvedBy: by,
    resolvedAt: new Date().toISOString(),
  });
  return disputeRepository.findById(disputeId);
};

const list = async ({
  adminUid,
  status,
  limit,
}: {
  adminUid: string;
  status?: string;
  limit?: number;
}): Promise<disputeRepository.Dispute[]> => {
  await assertAdmin(adminUid);
  const capped = typeof limit === "number" ?
    Math.min(limit, DISPUTE_LIST_MAX) :
    DISPUTE_LIST_LIMIT;
  if (typeof status === "string" && status !== "") {
    return disputeRepository.findByStatus(status, capped);
  }
  return disputeRepository.findAll(capped);
};

const bumpUserCancelRate = async (uid: string): Promise<void> => {
  await db.collection(USER_COLLECTION).doc(uid).set({
    cancelRate: FieldValue.increment(1),
    disputesLost: FieldValue.increment(1),
  }, {merge: true});
};

const bumpProviderCounters = async (
  providerId: string,
  counters: {cancel?: boolean; decline?: boolean},
): Promise<void> => {
  const patch: Record<string, unknown> = {};
  if (counters.cancel === true) {
    patch.cancelCount = FieldValue.increment(1);
  }
  if (counters.decline === true) {
    patch.declineCount = FieldValue.increment(1);
  }
  if (Object.keys(patch).length === 0) return;
  await db
    .collection(PROVIDER_COLLECTION)
    .doc(providerId)
    .set(patch, {merge: true});
};

const normalizeReason = (accusedKind: string, reasonCode: string): string => {
  if (isReasonCode(reasonCode)) return reasonCode;
  return DISPUTE_FALLBACK_REASON[accusedKind] ?? DISPUTE_REASON.RIDER_OTHER;
};

const normalizeType = (accusedKind: string, type: string): string => {
  if (isDisputeType(type)) return type;
  return DISPUTE_FALLBACK_TYPE[accusedKind] ?? DISPUTE_TYPE.RIDER_NO_SHOW;
};

const autoFile = async (input: {
  ticketId: string;
  filedBy?: string;
  reporterUid?: string;
  accusedKind: string;
  accusedId?: string | null;
  reasonCode: string;
  type: string;
}): Promise<void> => {
  const filedBy = input.filedBy ?? input.reporterUid ?? "";
  if (!nonEmpty(filedBy) || !isAccusedKind(input.accusedKind)) return;
  await disputeRepository.create({
    ticketId: input.ticketId,
    filedBy,
    accusedKind: input.accusedKind,
    accusedId: input.accusedId ?? null,
    type: normalizeType(input.accusedKind, input.type),
    reasonCode: normalizeReason(input.accusedKind, input.reasonCode),
    note: null,
    photoUrls: [],
    status: DISPUTE_STATUS.OPEN,
  });
};

const bumpCancelCounters = async ({
  providerId,
  userId,
}: {
  providerId?: string;
  userId?: string;
}): Promise<void> => {
  if (nonEmpty(providerId)) {
    await bumpProviderCounters(providerId, {cancel: true});
  }
  if (nonEmpty(userId)) {
    await bumpUserCancelRate(userId);
  }
};

export {
  DisputeInput,
  file,
  userFile,
  one,
  resolve,
  dismiss,
  list,
  normalizeCodes,
  bumpUserCancelRate,
  bumpProviderCounters,
  autoFile,
  bumpCancelCounters,
};
