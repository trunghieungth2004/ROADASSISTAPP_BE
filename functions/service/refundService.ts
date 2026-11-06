import * as paymentRepository from "../repository/paymentRepository";
import * as refundRepository from "../repository/refundRepository";
import * as userRepository from "../repository/userRepository";
import * as commissionRepository from "../repository/commissionRepository";
import * as paymentService from "./paymentService";
import * as platformConfigService from "./platformConfigService";
import * as auditService from "./auditService";
import {
  PAYMENT_STATUS,
  REFUND_LIST_LIMIT,
  REFUND_LIST_MAX,
  REFUND_POLICY,
  REFUND_STATUS,
} from "../constants/payments";
import {ROLE_ADMIN} from "../constants/roles";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";

const REFUNDABLE_STATUSES: string[] = [
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.CONFIRMED,
  PAYMENT_STATUS.PARTIAL,
];

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const requestRefund = async ({
  paymentId,
  requestedBy,
  amount,
  reason,
  automatic = false,
}: {
  paymentId: string;
  requestedBy: string;
  amount?: number;
  reason?: string;
  automatic?: boolean;
}): Promise<refundRepository.RefundRequest> => {
  const payment = await paymentRepository.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  const caller = await userRepository.findById(requestedBy);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN && payment.riderUid !== requestedBy) {
    throw new ForbiddenError("Only the rider requests a refund");
  }
  if (!REFUNDABLE_STATUSES.includes(payment.status)) {
    throw new ValidationError("Payment cannot be refunded");
  }
  const already = typeof payment.refundAmount === "number" ?
    payment.refundAmount :
    0;
  const remaining = payment.amount - already;
  if (remaining <= 0) throw new ValidationError("Payment already refunded");
  const requested = typeof amount === "number" ? amount : remaining;
  if (!Number.isInteger(requested) || requested <= 0 ||
    requested > remaining) {
    throw new ValidationError("Invalid refund amount");
  }
  const config = await platformConfigService.getConfig();
  const policy = String(config.refundPolicy ?? REFUND_POLICY.FULL);
  if (policy === REFUND_POLICY.NONE) {
    throw new ValidationError("Refunds are disabled");
  }
  if (policy === REFUND_POLICY.PARTIAL && requested >= remaining) {
    throw new ValidationError("Full refunds are disabled");
  }
  const open = await refundRepository.findOpenByPaymentId(paymentId);
  if (open) return open;
  const rider = await userRepository.findById(payment.riderUid);
  const account = rider?.payoutAccount;
  const bank = typeof account === "object" && account !== null ?
    account as Record<string, unknown> :
    {};
  return refundRepository.create({
    paymentId,
    ticketId: payment.ticketId,
    riderUid: payment.riderUid,
    payeeId: payment.payeeId,
    amount: requested,
    originalAmount: payment.amount,
    reason: nonEmpty(reason) ? reason : null,
    automatic,
    requestedBy,
    bankCode: nonEmpty(bank.bankCode) ? bank.bankCode : null,
    bankName: nonEmpty(bank.bankName) ? bank.bankName : null,
    accountNumber: nonEmpty(bank.accountNumber) ?
      bank.accountNumber :
      null,
    holderName: nonEmpty(bank.holderName) ? bank.holderName : null,
  });
};

const listRefunds = async ({
  adminUid,
  status,
  limit,
}: {
  adminUid: string;
  status?: string;
  limit?: number;
}): Promise<refundRepository.RefundRequest[]> => {
  const caller = await userRepository.findById(adminUid);
  if (!caller || caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Admin only");
  }
  const capped = typeof limit === "number" ?
    Math.min(limit, REFUND_LIST_MAX) :
    REFUND_LIST_LIMIT;
  return refundRepository.findByStatus(status, capped);
};

const myRefunds = async ({
  userId,
  limit,
}: {
  userId: string;
  limit?: number;
}): Promise<refundRepository.RefundRequest[]> => {
  const capped = typeof limit === "number" ?
    Math.min(limit, REFUND_LIST_MAX) :
    REFUND_LIST_LIMIT;
  return refundRepository.findByRider(userId, capped);
};

const decideRefund = async ({
  adminUid,
  refundId,
  approve,
  note,
}: {
  adminUid: string;
  refundId: string;
  approve: boolean;
  note?: string;
}): Promise<refundRepository.RefundRequest> => {
  const request = await refundRepository.findById(refundId);
  if (!request) throw new NotFoundError("Refund request not found");
  if (request.status !== REFUND_STATUS.REQUESTED) {
    throw new ValidationError("Refund request is already decided");
  }
  await refundRepository.update(refundId, {
    status: approve ? REFUND_STATUS.APPROVED : REFUND_STATUS.REJECTED,
    decidedAt: new Date().toISOString(),
    decidedBy: adminUid,
    decisionNote: nonEmpty(note) ? note : null,
  });
  const updated = await refundRepository.findById(refundId);
  await auditService.record({
    adminUid,
    action: approve ? "REFUND_APPROVED" : "REFUND_REJECTED",
    targetType: "refund",
    targetId: refundId,
    meta: {paymentId: request.paymentId, amount: request.amount},
  });
  return updated ?? request;
};

const markRefundSent = async ({
  adminUid,
  refundId,
  transferRef,
}: {
  adminUid: string;
  refundId: string;
  transferRef?: string;
}): Promise<refundRepository.RefundRequest> => {
  const request = await refundRepository.findById(refundId);
  if (!request) throw new NotFoundError("Refund request not found");
  if (request.status !== REFUND_STATUS.APPROVED) {
    throw new ValidationError("Refund must be approved before sending");
  }
  await refundRepository.update(refundId, {
    status: REFUND_STATUS.SENT,
    sentAt: new Date().toISOString(),
    sentBy: adminUid,
    transferRef: nonEmpty(transferRef) ? transferRef : null,
  });
  const updated = await refundRepository.findById(refundId);
  return updated ?? request;
};

const confirmRefund = async ({
  adminUid,
  refundId,
  transferRef,
}: {
  adminUid: string;
  refundId: string;
  transferRef?: string;
}): Promise<{
  request: refundRepository.RefundRequest;
  payment: paymentRepository.Payment | null;
}> => {
  const request = await refundRepository.findById(refundId);
  if (!request) throw new NotFoundError("Refund request not found");
  if (request.status !== REFUND_STATUS.APPROVED &&
    request.status !== REFUND_STATUS.SENT) {
    throw new ValidationError("Refund is not ready to confirm");
  }
  const payment = await paymentRepository.findById(request.paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  const refunded = await paymentService.refund({
    paymentId: request.paymentId,
    amount: request.amount,
    by: adminUid,
  });
  await commissionRepository.reverseForRefund({
    paymentId: request.paymentId,
    refundAmount: request.amount,
    paymentAmount: payment.amount,
  });
  await refundRepository.update(refundId, {
    status: REFUND_STATUS.CONFIRMED,
    confirmedAt: new Date().toISOString(),
    confirmedBy: adminUid,
    ...(nonEmpty(transferRef) ? {transferRef} : {}),
  });
  const updated = await refundRepository.findById(refundId);
  await auditService.record({
    adminUid,
    action: "REFUND_CONFIRMED",
    targetType: "refund",
    targetId: refundId,
    meta: {paymentId: request.paymentId, amount: request.amount},
  });
  return {request: updated ?? request, payment: refunded};
};

const failRefund = async ({
  adminUid,
  refundId,
  reason,
}: {
  adminUid: string;
  refundId: string;
  reason?: string;
}): Promise<refundRepository.RefundRequest> => {
  const request = await refundRepository.findById(refundId);
  if (!request) throw new NotFoundError("Refund request not found");
  if (request.status !== REFUND_STATUS.APPROVED &&
    request.status !== REFUND_STATUS.SENT) {
    throw new ValidationError("Refund cannot be failed");
  }
  await refundRepository.update(refundId, {
    status: REFUND_STATUS.FAILED,
    failureReason: nonEmpty(reason) ? reason : null,
    decidedBy: adminUid,
    decidedAt: new Date().toISOString(),
  });
  const updated = await refundRepository.findById(refundId);
  await auditService.record({
    adminUid,
    action: "REFUND_FAILED",
    targetType: "refund",
    targetId: refundId,
    meta: {paymentId: request.paymentId, amount: request.amount},
  });
  return updated ?? request;
};

export {
  requestRefund,
  listRefunds,
  myRefunds,
  decideRefund,
  markRefundSent,
  confirmRefund,
  failRefund,
};
