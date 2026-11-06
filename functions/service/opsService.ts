import * as paymentRepository from "../repository/paymentRepository";
import * as refundRepository from "../repository/refundRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as commissionRepository from "../repository/commissionRepository";
import {PAYMENT_STATUS} from "../constants/payments";

const STUCK_PAYMENT_MS = 30 * 60 * 1000;

const snapshot = async () => {
  const now = Date.now();
  const [payments, requested, approved, sent, failed, quotes, pending,
    owed] = await Promise.all([
    paymentRepository.findAll(5000),
    refundRepository.findByStatus("REQUESTED", 200),
    refundRepository.findByStatus("APPROVED", 200),
    refundRepository.findByStatus("SENT", 200),
    refundRepository.findByStatus("FAILED", 200),
    dispatchRepository.findByStatus("9", 500),
    dispatchRepository.findByStatus("1", 500),
    commissionRepository.findAllOwed(),
  ]);
  const stuck = payments.filter((payment) =>
    payment.status === PAYMENT_STATUS.PENDING &&
    typeof payment.createdAt === "string" &&
    now - Date.parse(payment.createdAt) > STUCK_PAYMENT_MS);
  const expiredQuotes = quotes.filter((ticket) =>
    typeof ticket.quoteExpiresAt === "string" &&
    Date.parse(ticket.quoteExpiresAt) < now);
  const walkIns = pending.filter((ticket) => ticket.ticketType === "WALK_IN");
  const openRefunds = [...requested, ...approved, ...sent];
  const owedTotal = owed.reduce((sum, entry) => sum + Math.max(
    0,
    entry.amount - (entry.settledAmount ?? 0) - (entry.reversedAmount ?? 0),
  ), 0);
  return {
    generatedAt: new Date().toISOString(),
    payments: {
      stuckPending: stuck.length,
      stuckAmount: stuck.reduce((sum, payment) => sum + payment.amount, 0),
    },
    refunds: {
      requested: requested.length,
      approved: approved.length,
      sent: sent.length,
      failed: failed.length,
      openAmount: openRefunds.reduce((sum, row) => sum + row.amount, 0),
    },
    quotes: {expiredNotSwept: expiredQuotes.length},
    walkIns: {pending: walkIns.length},
    commission: {owedTotal},
  };
};

export {snapshot};
