import * as bookingRepository from "../repository/bookingRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as platformConfigService from "./platformConfigService";
import * as sepayService from "./sepayService";
import * as paymentPush from "./push/payment";
import {
  COMMISSION_RATE_PERCENT,
  DEPOSIT_PURPOSE,
  PAYMENT_ACTIVE_STATUSES,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../constants/payments";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import {generateQrRef, resolvePayeeId} from "./payment/helpers";

type DepositPayment = paymentRepository.Payment & {
  checkout?: sepayService.SepayCheckoutFields;
  reused?: boolean;
};

const notify = (promise: Promise<unknown>): void => {
  void promise.catch(() => undefined);
};

const createDepositPayment = async ({
  userId,
  ticketId,
  method,
}: {
  userId: string;
  ticketId: string;
  method: string;
}): Promise<DepositPayment> => {
  if (method !== PAYMENT_METHOD.SEPAY) {
    throw new ValidationError("Deposits are collected online only");
  }
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider pays the deposit");
  }
  const amount = typeof ticket.depositAmount === "number" ?
    ticket.depositAmount :
    0;
  if (amount <= 0) throw new ValidationError("This ticket has no deposit");
  const existing = await paymentRepository.findByTicketId(ticketId);
  const active = existing.find((payment) =>
    payment.purpose === DEPOSIT_PURPOSE &&
    PAYMENT_ACTIVE_STATUSES.includes(payment.status));
  if (active) {
    if (active.status === PAYMENT_STATUS.PENDING &&
      active.method === PAYMENT_METHOD.SEPAY) {
      const checkout = sepayService.buildCheckoutFields(active);
      return {...active, checkout, reused: true};
    }
    return {...active, reused: true};
  }
  const payeeId = await resolvePayeeId(ticket);
  const rate = await platformConfigService.getCommissionRate(
    ticket.ticketType,
  );
  const commissionAmount = Math.round(amount * rate / COMMISSION_RATE_PERCENT);
  const payoutAmount = amount - commissionAmount;
  const qrRef = generateQrRef(ticketId);
  const created = await paymentRepository.createGuarded({
    ticketId,
    riderUid: userId,
    payeeId,
    amount,
    method,
    qrRef,
    status: PAYMENT_STATUS.PENDING,
    commissionRate: rate,
    commissionAmount,
    payoutAmount,
    purpose: DEPOSIT_PURPOSE,
  });
  const payment = created.payment;
  const checkout = sepayService.buildCheckoutFields(payment);
  await dispatchRepository.update(ticketId, {
    depositStatus: "REQUESTED",
    depositMethod: PAYMENT_METHOD.SEPAY,
    depositPaymentId: payment.id,
  });
  notify(paymentPush.deliverOpened(payment));
  return {...payment, checkout};
};

const depositCheckout = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}): Promise<DepositPayment> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider pays the deposit");
  }
  const payments = await paymentRepository.findByTicketId(ticketId);
  const deposit = payments.find((payment) =>
    payment.purpose === DEPOSIT_PURPOSE);
  if (!deposit) throw new NotFoundError("No deposit request found");
  if (deposit.method !== PAYMENT_METHOD.SEPAY) {
    throw new ValidationError("This deposit is not paid online");
  }
  if (deposit.status !== PAYMENT_STATUS.PENDING) {
    return {...deposit, reused: true};
  }
  const checkout = sepayService.buildCheckoutFields(deposit);
  return {...deposit, checkout, reused: true};
};

const markDepositConfirmed = async (
  payment: paymentRepository.Payment,
  paidAt: string,
): Promise<void> => {
  await dispatchRepository.update(payment.ticketId, {
    depositStatus: "CONFIRMED",
    depositPaidAt: paidAt,
  });
  const ticket = await dispatchRepository.findById(payment.ticketId);
  if (ticket && typeof ticket.bookingId === "string" &&
    ticket.bookingId !== "") {
    await bookingRepository.update(ticket.bookingId, {
      depositStatus: "CONFIRMED",
    }).catch(() => undefined);
  }
};

export {
  createDepositPayment,
  depositCheckout,
  markDepositConfirmed,
};
export type {DepositPayment};
