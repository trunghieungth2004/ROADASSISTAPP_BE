import * as disputeRepository from "../repository/disputeRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {db, FieldValue} from "../config/firebase";
import {ROLE_ADMIN} from "../constants/roles";
import {PROVIDER_KIND, STATUS_DISPATCH} from "../constants/status";
import {
  ACCUSED_KIND,
  DISPUTE_FALLBACK_REASON,
  DISPUTE_FALLBACK_TYPE,
  DISPUTE_LIST_LIMIT,
  DISPUTE_LIST_MAX,
  DISPUTE_OUTCOME,
  DISPUTE_REASON,
  DISPUTE_STATUS,
  DISPUTE_TYPE,
  PROVIDER_DISPUTE_ALIASES,
  RIDER_DISPUTE_ALIASES,
} from "../constants/disputes";
import {
  PAYMENT_STATUS,
  PROVIDER_COLLECTION,
  USER_COLLECTION,
} from "../constants/payments";
import * as paymentService from "./paymentService";
import {chatService} from "./chatService";
import {enqueueDispatchPush} from "./taskQueueService";
import {NS} from "./dispatch/constants";
import * as cacheManager from "../utils/cacheManager";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import {validatePhotoPathsStructure} from "../utils/media";

type TicketLike = {
  id: string;
  userId: string;
  ticketType?: string;
  status?: string;
  assignedShopId?: string | null;
  destinationShopId?: string | null;
  providerId?: string | null;
  assignedUid?: string | null;
  disputeHold?: boolean | null;
  openDisputeId?: string | null;
  dispute?: Record<string, unknown> | null;
  finalAmount?: number | null;
  shopQuotedAmount?: number | null;
  mobileCallOutFee?: number | null;
  mobileTravelFee?: number | null;
  towFare?: Record<string, unknown> | null;
};

interface DisputeInput {
  ticketId: string;
  filedBy: string;
  accusedKind?: string;
  accusedId?: string | null;
  type?: string;
  reasonCode?: string;
  reason?: string;
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
  filer,
  defaultAccusedKind,
}: {
  accusedKind?: string;
  type?: string;
  reasonCode?: string;
  reason?: string;
  filer?: "RIDER" | "PROVIDER" | "ADMIN";
  defaultAccusedKind?: string;
}): {accusedKind: string; type: string; reasonCode: string} => {
  if (
    typeof accusedKind === "string" && isAccusedKind(accusedKind) &&
    typeof type === "string" && isDisputeType(type) &&
    typeof reasonCode === "string" && isReasonCode(reasonCode)
  ) {
    return {accusedKind, type, reasonCode};
  }
  const aliases = filer === "PROVIDER" ?
    PROVIDER_DISPUTE_ALIASES :
    RIDER_DISPUTE_ALIASES;
  const alias = typeof reason === "string" ? aliases[reason] : undefined;
  const kind = typeof accusedKind === "string" && isAccusedKind(accusedKind) ?
    accusedKind :
    defaultAccusedKind && isAccusedKind(defaultAccusedKind) ?
      defaultAccusedKind :
      filer === "PROVIDER" ? ACCUSED_KIND.RIDER : ACCUSED_KIND.SHOP;
  if (alias) return {accusedKind: kind, ...alias};
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

const providerPartyFor = async (
  ticket: TicketLike,
): Promise<{id: string; accusedKind: string} | null> => {
  const ids = [
    ticket.assignedShopId,
    ticket.providerId,
    ticket.destinationShopId,
  ].filter(nonEmpty);
  for (const id of ids) {
    const provider = await providerRepository.findById(id);
    if (!provider) continue;
    return {
      id,
      accusedKind: provider.kind === PROVIDER_KIND.TOW ?
        ACCUSED_KIND.TOWER :
        ACCUSED_KIND.SHOP,
    };
  }
  return null;
};

const holdFor = (
  ticket: TicketLike,
  type: string,
  filer: "RIDER" | "PROVIDER" | "ADMIN",
): boolean => {
  if (filer !== "RIDER") return false;
  if (type !== DISPUTE_TYPE.SERVICE_QUALITY &&
    type !== DISPUTE_TYPE.FARE_DISPUTE &&
    type !== DISPUTE_TYPE.UNFIXABLE_DISAGREEMENT) {
    return false;
  }
  if (ticket.ticketType === "SOS") {
    return ticket.status === STATUS_DISPATCH.ARRIVED ||
      ticket.status === STATUS_DISPATCH.READY;
  }
  if (ticket.ticketType === "WALK_IN" || ticket.ticketType === "MECHANIC") {
    return ticket.status === STATUS_DISPATCH.READY;
  }
  return false;
};

const disputeSnapshot = (dispute: disputeRepository.Dispute) => ({
  id: dispute.id,
  status: dispute.status,
  type: dispute.type,
  reasonCode: dispute.reasonCode,
  filedBy: dispute.filedBy,
  accusedKind: dispute.accusedKind,
  accusedId: dispute.accusedId,
  hold: dispute.hold === true,
  outcome: dispute.outcome ?? null,
  resolution: dispute.resolution ?? null,
  at: dispute.createdAt,
  resolvedAt: dispute.resolvedAt ?? null,
});

const assertAdmin = async (userId: string): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin role required");
  }
};

const file = async (
  input: DisputeInput & {
    accusedKind: string;
    type: string;
    reasonCode: string;
    hold?: boolean;
    filer?: "RIDER" | "PROVIDER" | "ADMIN";
  },
): Promise<disputeRepository.Dispute> => {
  validateCodes(input);
  const ticket = await dispatchRepository.findById(input.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const dispute = await disputeRepository.create({
    ticketId: input.ticketId,
    filedBy: input.filedBy,
    accusedKind: input.accusedKind,
    accusedId: input.accusedId ?? null,
    type: input.type,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    photoUrls: validatePhotoPathsStructure(input.photoUrls),
    status: DISPUTE_STATUS.OPEN,
    hold: input.hold === true,
  });
  const hold = input.hold === true;
  await dispatchRepository.update(ticket.id, {
    dispute: disputeSnapshot(dispute),
    disputeHold: hold,
    openDisputeId: dispute.id,
  });
  cacheManager.del(NS);
  if (hold) {
    try {
      await paymentService.cancelPendingPayments(ticket.id);
    } catch {
      void 0;
    }
  }
  try {
    const who = input.filer === "PROVIDER" ? "The provider" : "The rider";
    await chatService.addSystemEvent(
      ticket.id,
      `${who} filed a dispute: ${input.reasonCode}.`,
    );
  } catch {
    void 0;
  }
  try {
    await enqueueDispatchPush(ticket.id, "-dispute-filed", {
      audience: input.filer === "PROVIDER" ? "rider" : "operator",
      urgent: "true",
      title: "Dispute filed",
      body: "A dispute was filed — tap to review",
    });
  } catch {
    void 0;
  }
  return dispute;
};

const userFile = async (
  input: DisputeInput,
): Promise<disputeRepository.Dispute> => {
  const ticket = await dispatchRepository.findById(input.ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(input.filedBy);
  if (!caller) throw new NotFoundError("User not found");
  const isAdmin = caller.role === ROLE_ADMIN;
  const isRider = ticket.userId === input.filedBy;
  const isProvider = !isRider &&
    await isOperatorOfTicket(ticket, input.filedBy);
  if (!isAdmin && !isRider && !isProvider) {
    throw new ForbiddenError("Only ticket participants file disputes");
  }
  const open = (await disputeRepository.findByTicketId(input.ticketId))
    .filter((dispute) => dispute.status === DISPUTE_STATUS.OPEN);
  if (open.length > 0) {
    throw new ConflictError("A dispute is already open on this ticket");
  }
  const filer: "RIDER" | "PROVIDER" | "ADMIN" = isAdmin ?
    "ADMIN" :
    isProvider ? "PROVIDER" : "RIDER";
  const providerParty = isRider || isAdmin ?
    await providerPartyFor(ticket) :
    null;
  const defaultAccusedKind = filer === "PROVIDER" ?
    ACCUSED_KIND.RIDER :
    providerParty?.accusedKind;
  const codes = normalizeCodes({
    accusedKind: input.accusedKind,
    type: input.type,
    reasonCode: input.reasonCode,
    reason: input.reason,
    filer,
    ...(defaultAccusedKind ? {defaultAccusedKind} : {}),
  });
  const accusedId = filer === "PROVIDER" ?
    ticket.userId :
    input.accusedId ?? providerParty?.id ?? null;
  const accusedKind = filer === "PROVIDER" ?
    ACCUSED_KIND.RIDER :
    providerParty?.accusedKind ?? codes.accusedKind;
  return file({
    ...input,
    ...codes,
    accusedKind,
    accusedId,
    filer,
    hold: holdFor(ticket, codes.type, filer),
  });
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

const refundTicketPayments = async (
  ticketId: string,
  by: string,
  keepAmount = 0,
): Promise<void> => {
  try {
    await paymentService.cancelPendingPayments(ticketId);
  } catch {
    void 0;
  }
  const payments = await paymentRepository.findByTicketId(ticketId);
  for (const payment of payments) {
    if (payment.status !== PAYMENT_STATUS.HELD &&
      payment.status !== PAYMENT_STATUS.CONFIRMED &&
      payment.status !== PAYMENT_STATUS.PARTIAL &&
      payment.status !== PAYMENT_STATUS.DISPUTED) {
      continue;
    }
    const amount = keepAmount > 0 ?
      Math.max(0, payment.amount - keepAmount) :
      undefined;
    if (amount === 0) continue;
    try {
      await paymentService.refundPayment({
        paymentId: payment.id,
        adminUid: by,
        ...(typeof amount === "number" ? {amount} : {}),
      });
    } catch {
      continue;
    }
  }
};

const applyDisputeOutcome = async ({
  ticket,
  outcome,
  adjustedAmount,
  resolution,
  by,
  dispute,
}: {
  ticket: dispatchRepository.DispatchTicket;
  outcome: string;
  adjustedAmount?: number;
  resolution: string;
  by: string;
  dispute: disputeRepository.Dispute;
}): Promise<void> => {
  const resolvedAt = new Date().toISOString();
  const snapshot = {
    ...disputeSnapshot(dispute),
    status: DISPUTE_STATUS.RESOLVED,
    hold: false,
    outcome,
    resolution,
    resolvedAt,
  };
  const base = {
    dispute: snapshot,
    disputeHold: false,
    openDisputeId: null,
  };
  if (outcome === DISPUTE_OUTCOME.SHOP) {
    await dispatchRepository.update(ticket.id, base);
    cacheManager.del(NS);
    return;
  }
  if (outcome === DISPUTE_OUTCOME.PARTIAL) {
    if (typeof adjustedAmount !== "number") {
      throw new ValidationError("Partial resolution needs adjustedAmount");
    }
    const towFare = ticket.towFare && typeof ticket.towFare === "object" ?
      {...ticket.towFare, final: adjustedAmount, waitingFee: 0} :
      null;
    const sosUnfixable = ticket.ticketType === "SOS" &&
      (ticket.status === STATUS_DISPATCH.UNFIXABLE ||
        ticket.status === STATUS_DISPATCH.RESOLVED_UNFIXABLE);
    await dispatchRepository.update(ticket.id, {
      ...base,
      ...(sosUnfixable ?
        {
          mobileCallOutFee: adjustedAmount,
          mobileTravelFee: 0,
          finalAmount: 0,
        } :
        {
          finalAmount: adjustedAmount,
          shopQuotedAmount: adjustedAmount,
        }),
      ...(towFare ? {towFare} : {}),
    });
    cacheManager.del(NS);
    if (ticket.ticketType === "SOS" &&
      ticket.status === STATUS_DISPATCH.ARRIVED) {
      await dispatchRepository.updateStatus(
        ticket.id,
        STATUS_DISPATCH.READY,
        by,
      );
      cacheManager.del(NS);
    }
    const callOut = typeof ticket.mobileCallOutFee === "number" ?
      ticket.mobileCallOutFee :
      0;
    const travel = typeof ticket.mobileTravelFee === "number" ?
      ticket.mobileTravelFee :
      0;
    const keepAmount = sosUnfixable ?
      adjustedAmount :
      ticket.ticketType === "SOS" ?
        callOut + travel + adjustedAmount :
        adjustedAmount;
    await refundTicketPayments(ticket.id, by, keepAmount);
    return;
  }
  if (outcome !== DISPUTE_OUTCOME.RIDER) {
    throw new ValidationError("Unknown dispute outcome");
  }
  const towFare = ticket.towFare && typeof ticket.towFare === "object" ?
    {...ticket.towFare, final: 0, waitingFee: 0} :
    null;
  await dispatchRepository.update(ticket.id, {
    ...base,
    finalAmount: 0,
    shopQuotedAmount: 0,
    mobileCallOutFee: 0,
    mobileTravelFee: 0,
    ...(towFare ? {towFare} : {}),
  });
  cacheManager.del(NS);
  if (ticket.ticketType === "SOS" &&
    ticket.status === STATUS_DISPATCH.ARRIVED) {
    await dispatchRepository.update(ticket.id, {
      unfixable: {
        reason: "DISPUTE_RESOLVED",
        photoUrls: [],
        by,
        at: resolvedAt,
      },
    });
    await dispatchRepository.updateStatus(
      ticket.id,
      STATUS_DISPATCH.UNFIXABLE,
      by,
    );
    cacheManager.del(NS);
  }
  await refundTicketPayments(ticket.id, by, 0);
};

const resolve = async ({
  disputeId,
  resolution,
  by,
  outcome,
  adjustedAmount,
  refundAdjust,
  payoutAdjust,
}: {
  disputeId: string;
  resolution: string;
  by: string;
  outcome?: string;
  adjustedAmount?: number;
  refundAdjust?: number;
  payoutAdjust?: number;
}): Promise<disputeRepository.Dispute | null> => {
  await assertAdmin(by);
  const dispute = await disputeRepository.findById(disputeId);
  if (!dispute) throw new NotFoundError("Dispute not found");
  const resolvedOutcome = typeof outcome === "string" && outcome !== "" ?
    outcome :
    DISPUTE_OUTCOME.SHOP;
  if (!(Object.values(DISPUTE_OUTCOME) as string[]).includes(resolvedOutcome)) {
    throw new ValidationError("Unknown dispute outcome");
  }
  const patch: Record<string, unknown> = {
    status: DISPUTE_STATUS.RESOLVED,
    resolution,
    outcome: resolvedOutcome,
    resolvedBy: by,
    resolvedAt: new Date().toISOString(),
  };
  if (typeof adjustedAmount === "number") {
    patch.adjustedAmount = adjustedAmount;
  }
  if (typeof refundAdjust === "number") patch.refundAdjust = refundAdjust;
  if (typeof payoutAdjust === "number") patch.payoutAdjust = payoutAdjust;
  await disputeRepository.update(disputeId, patch);
  const resolved = await disputeRepository.findById(disputeId);
  if (!resolved) throw new NotFoundError("Dispute not found");
  const ticket = await dispatchRepository.findById(dispute.ticketId);
  const activeDispute = ticket && (
    ticket.openDisputeId === dispute.id ||
    (ticket.dispute && typeof ticket.dispute === "object" &&
      (ticket.dispute as {id?: unknown}).id === dispute.id)
  );
  if (ticket && activeDispute) {
    await applyDisputeOutcome({
      ticket,
      outcome: resolvedOutcome,
      ...(typeof adjustedAmount === "number" ? {adjustedAmount} : {}),
      resolution,
      by,
      dispute: resolved,
    });
    try {
      await chatService.addSystemEvent(
        ticket.id,
        `Dispute resolved: ${resolution}`,
      );
    } catch {
      void 0;
    }
    try {
      await enqueueDispatchPush(ticket.id, "-dispute-resolved", {
        audience: "status-blind",
        urgent: "true",
        title: "Dispute resolved",
        body: resolution,
      });
    } catch {
      void 0;
    }
  }
  return resolved;
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
  const dismissed = await disputeRepository.findById(disputeId);
  if (!dismissed) throw new NotFoundError("Dispute not found");
  const ticket = await dispatchRepository.findById(dispute.ticketId);
  const activeDispute = ticket && (
    ticket.openDisputeId === dispute.id ||
    (ticket.dispute && typeof ticket.dispute === "object" &&
      (ticket.dispute as {id?: unknown}).id === dispute.id)
  );
  if (ticket && activeDispute) {
    await dispatchRepository.update(ticket.id, {
      dispute: {...disputeSnapshot(dismissed), hold: false},
      disputeHold: false,
      openDisputeId: null,
    });
    cacheManager.del(NS);
  }
  return dismissed;
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
