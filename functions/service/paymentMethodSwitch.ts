import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as sepayService from "./sepayService";
import {
  PAYMENT_ACTIVE_STATUSES,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../constants/payments";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors";

const cancelActiveForSwitch = async ({
  active,
  ticketId,
}: {
  active: paymentRepository.Payment;
  ticketId: string;
}): Promise<void> => {
  if (active.status !== PAYMENT_STATUS.PENDING) {
    throw new ConflictError(
      "Payment already received; refund required to change method",
    );
  }
  if (active.method === PAYMENT_METHOD.SEPAY) {
    const qrRef = typeof active.qrRef === "string" ? active.qrRef : "";
    const result = await sepayService.cancelOrder(qrRef);
    if (!result.ok) {
      throw new ConflictError(
        result.message ?? "SePay payment is already captured",
      );
    }
  }
  const cancelled = await paymentRepository.updateStatus(
    active.id,
    PAYMENT_STATUS.CANCELLED,
  );
  if (!cancelled) {
    throw new ConflictError("Payment could not be cancelled");
  }
  await Promise.resolve()
    .then(() => dispatchRepository.update(ticketId, {
      paymentId: cancelled.id,
      paymentMethod: cancelled.method,
      paymentStatus: cancelled.status,
      checkoutUrl: null,
      qrUrl: null,
    }))
    .catch(() => undefined);
  await paymentRepository.clearGuard(ticketId, active.id);
};


const cancelPendingPayment = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}): Promise<{cancelled: boolean; method: string | null}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider cancels this payment");
  }
  const payments = await paymentRepository.findByTicketId(ticketId);
  const active = payments.find((payment) =>
    PAYMENT_ACTIVE_STATUSES.includes(payment.status));
  if (!active) return {cancelled: false, method: null};
  if (active.status !== PAYMENT_STATUS.PENDING) {
    throw new ConflictError(
      "Payment already received; refund required to cancel",
    );
  }
  await cancelActiveForSwitch({active, ticketId});
  return {cancelled: true, method: active.method};
};

export {cancelActiveForSwitch, cancelPendingPayment};
