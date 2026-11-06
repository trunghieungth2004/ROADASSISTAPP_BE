import type {DispatchTicket} from "../../repository/dispatchRepository";
import {
  BILL_ITEM_STATUS,
  PAYMENT_STATUS,
} from "../../constants/payments";
const SETTLED_STATUSES: Set<string> = new Set([
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.CONFIRMED,
]);

type DepositView = {
  amount: number;
  status: string;
  method: string | null;
  paidAt: string | null;
};

const depositInfoFor = (ticket: DispatchTicket): {
  amount: number;
  status: string;
  credit: number;
  view: DepositView | null;
} => {
  const amount = typeof ticket.depositAmount === "number" ?
    ticket.depositAmount :
    0;
  const status = typeof ticket.depositStatus === "string" ?
    ticket.depositStatus :
    "";
  const credit = amount > 0 &&
    (status === "COLLECTED" || status === "CONFIRMED" ||
      status === "APPLIED") ? amount : 0;
  return {
    amount,
    status,
    credit,
    view: amount > 0 ? {
      amount,
      status,
      method: typeof ticket.depositMethod === "string" ?
        ticket.depositMethod :
        null,
      paidAt: typeof ticket.depositPaidAt === "string" ?
        ticket.depositPaidAt :
        null,
    } : null,
  };
};

const billStatusFor = (input: {
  paymentStatus: string | null;
  paymentMissing: boolean;
  depositPayment: boolean;
  depositCredit: number;
  amountDue: number;
  voided: boolean;
}): string => {
  if (input.paymentStatus !== null &&
    SETTLED_STATUSES.has(input.paymentStatus)) {
    if (input.depositPayment) {
      if (input.amountDue === 0) return BILL_ITEM_STATUS.PAID;
      return input.depositCredit > 0 ?
        BILL_ITEM_STATUS.PARTIAL :
        BILL_ITEM_STATUS.PENDING;
    }
    return BILL_ITEM_STATUS.PAID;
  }
  if (input.paymentStatus === PAYMENT_STATUS.REFUNDED) {
    return BILL_ITEM_STATUS.REFUNDED;
  }
  if (input.paymentStatus === PAYMENT_STATUS.PARTIAL) {
    return BILL_ITEM_STATUS.PARTIAL;
  }
  if (input.voided) return BILL_ITEM_STATUS.VOID;
  if (input.paymentStatus === PAYMENT_STATUS.PENDING) {
    return BILL_ITEM_STATUS.PENDING;
  }
  if (input.paymentMissing && input.depositCredit > 0 &&
    input.amountDue === 0) {
    return BILL_ITEM_STATUS.PAID;
  }
  return BILL_ITEM_STATUS.UNPAID;
};

export {depositInfoFor, billStatusFor};
export type {DepositView};
