import * as disputeRepository from "../../repository/disputeRepository";
import * as paymentRepository from "../../repository/paymentRepository";
import {db, FieldValue} from "../../config/firebase";
import {DISPUTE_STATUS, DISPUTE_TYPE} from "../../constants/disputes";
import {PAYMENT_STATUS, USER_COLLECTION} from "../../constants/payments";
import {ConflictError, ValidationError} from "../../utils/errors";

const MAX_DISPUTES_PER_TICKET = 3;
const MAX_OPEN_DISPUTES_PER_FILER = 2;
const DISPUTE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const EVIDENCE_REQUIRED_TYPES = new Set<string>([
  DISPUTE_TYPE.FARE_DISPUTE,
  DISPUTE_TYPE.SERVICE_QUALITY,
]);

const DISPUTE_PAYMENT_STATUSES = new Set<string>([
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.CONFIRMED,
  PAYMENT_STATUS.PARTIAL,
]);

const assertCanFileDispute = async ({
  ticketId,
  filedBy,
  adminFiling,
}: {
  ticketId: string;
  filedBy: string;
  adminFiling: boolean;
}): Promise<void> => {
  const history = await disputeRepository.findByTicketId(ticketId);
  if (history.some((row) => row.status === DISPUTE_STATUS.OPEN)) {
    throw new ConflictError("A dispute is already open on this ticket");
  }
  if (adminFiling) return;
  if (history.length >= MAX_DISPUTES_PER_TICKET) {
    throw new ConflictError("This ticket has reached the dispute limit");
  }
  const lastClosed = history[0];
  const closedAt = lastClosed ?
    Date.parse(lastClosed.resolvedAt ?? lastClosed.updatedAt) :
    0;
  if (Number.isFinite(closedAt) &&
    Date.now() - closedAt < DISPUTE_COOLDOWN_MS) {
    throw new ConflictError(
      "Wait 24 hours before disputing this ticket again",
    );
  }
  const filed = await disputeRepository.findByFiledBy(filedBy);
  const openByFiler = filed.filter(
    (row) => row.status === DISPUTE_STATUS.OPEN,
  );
  if (openByFiler.length >= MAX_OPEN_DISPUTES_PER_FILER) {
    throw new ConflictError("You already have too many open disputes");
  }
};

const assertDisputeEvidence = (
  filer: "RIDER" | "PROVIDER" | "ADMIN",
  type: string,
  photoCount: number,
): void => {
  if (filer === "RIDER" &&
    EVIDENCE_REQUIRED_TYPES.has(type) &&
    photoCount === 0) {
    throw new ValidationError("Add at least one photo as evidence");
  }
};

const markPaymentsDisputed = async (
  ticketId: string,
  disputeId: string,
  hold: boolean,
): Promise<void> => {
  try {
    const payments = await paymentRepository.findByTicketId(ticketId);
    const now = new Date().toISOString();
    await Promise.all(
      payments
        .filter((payment) => DISPUTE_PAYMENT_STATUSES.has(payment.status))
        .map((payment) => paymentRepository.update(payment.id, {
          disputeId,
          disputedAt: now,
          disputeHold: hold,
          disputeResolvedAt: null,
        })),
    );
  } catch {
    void 0;
  }
};

const clearPaymentDisputeFlags = async (
  ticketId: string,
  disputeId: string,
): Promise<void> => {
  try {
    const payments = await paymentRepository.findByTicketId(ticketId);
    const now = new Date().toISOString();
    await Promise.all(
      payments
        .filter((payment) => payment.disputeId === disputeId)
        .map((payment) => paymentRepository.update(payment.id, {
          disputeHold: false,
          disputeResolvedAt: now,
        })),
    );
  } catch {
    void 0;
  }
};

const trackDisputeFiling = async (filedBy: string): Promise<void> => {
  await db.collection(USER_COLLECTION).doc(filedBy).set({
    disputeCount: FieldValue.increment(1),
    lastDisputeAt: new Date().toISOString(),
  }, {merge: true}).catch(() => undefined);
};

export {
  assertCanFileDispute,
  assertDisputeEvidence,
  markPaymentsDisputed,
  clearPaymentDisputeFlags,
  trackDisputeFiling,
  DISPUTE_PAYMENT_STATUSES,
  MAX_DISPUTES_PER_TICKET,
  MAX_OPEN_DISPUTES_PER_FILER,
  DISPUTE_COOLDOWN_MS,
};
