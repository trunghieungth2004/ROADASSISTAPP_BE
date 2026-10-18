import * as paymentRepository from "../repository/paymentRepository";
import {
  PAYMENT_PAYOUT_PREFIX,
  PAYMENT_RECEIVED_STATUSES,
} from "../constants/payments";
import {NotFoundError, ValidationError} from "../utils/errors";

const payout = async ({
  paymentId,
  adminUid,
}: {
  paymentId: string;
  adminUid: string;
}): Promise<paymentRepository.Payment | null> => {
  const payment = await paymentRepository.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (!PAYMENT_RECEIVED_STATUSES.includes(payment.status)) {
    throw new ValidationError("Payment is not payable");
  }
  const ref =
    `${PAYMENT_PAYOUT_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  await paymentRepository.update(paymentId, {
    payoutRef: ref,
    payoutAt: new Date().toISOString(),
    payoutBy: adminUid,
  });
  return paymentRepository.findById(paymentId);
};

export {payout};
