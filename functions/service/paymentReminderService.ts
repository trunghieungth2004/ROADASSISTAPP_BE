import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentReminderRepository from
  "../repository/paymentReminderRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as paymentPush from "./push/payment";
import {billableAmountFor} from "./paymentService";
import {PAYMENT_RECEIVED_STATUSES} from "../constants/payments";

const FIRST_DELAY_MS = 30 * 60 * 1000;
const SECOND_DELAY_MS = 6 * 60 * 60 * 1000;
const THIRD_DELAY_MS = 24 * 60 * 60 * 1000;

const clearReminder = async (ticketId: string): Promise<void> => {
  await dispatchRepository.update(ticketId, {
    paymentDueAt: null,
    paymentReminderCount: 0,
    paymentRemindedAt: null,
  }).catch(() => undefined);
};

const PAYABLE_CLOSED = new Set<string>(["4", "12", "15"]);

const schedulePaymentReminder = async (
  ticketId: string,
  ticket: dispatchRepository.DispatchTicket,
): Promise<void> => {
  try {
    if (!PAYABLE_CLOSED.has(ticket.status)) return;
    if (typeof ticket.paymentDueAt === "string" &&
      ticket.paymentDueAt !== "") return;
    const billable = billableAmountFor(ticket);
    if (!billable || billable.amount <= 0) return;
    const payments = await paymentRepository.findByTicketId(ticketId);
    if (payments.some((row) =>
      PAYMENT_RECEIVED_STATUSES.includes(row.status))) return;
    await dispatchRepository.update(ticketId, {
      paymentDueAt: new Date(Date.now() + FIRST_DELAY_MS).toISOString(),
      paymentReminderCount: 0,
      paymentRemindedAt: null,
    });
  } catch {
    return;
  }
};

const sweepPaymentReminders = async (): Promise<{reminded: number}> => {
  const nowIso = new Date().toISOString();
  const tickets = await paymentReminderRepository.findDue(nowIso, 200);
  let reminded = 0;
  for (const ticket of tickets) {
    const payments = await paymentRepository.findByTicketId(ticket.id);
    if (payments.some((row) =>
      PAYMENT_RECEIVED_STATUSES.includes(row.status))) {
      await clearReminder(ticket.id);
      continue;
    }
    const billable = billableAmountFor(ticket);
    if (!billable || billable.amount <= 0) {
      await clearReminder(ticket.id);
      continue;
    }
    const count = (ticket.paymentReminderCount ?? 0) + 1;
    await paymentPush.deliverReminder(
      ticket.id,
      ticket.userId,
      billable.amount,
      count,
    ).catch(() => undefined);
    const nextAt = count === 1 ?
      new Date(Date.now() + SECOND_DELAY_MS) :
      count === 2 ? new Date(Date.now() + THIRD_DELAY_MS) : null;
    await dispatchRepository.update(ticket.id, {
      paymentDueAt: nextAt === null ? null : nextAt.toISOString(),
      paymentReminderCount: count,
      paymentRemindedAt: nowIso,
    });
    reminded += 1;
  }
  return {reminded};
};

export {schedulePaymentReminder, sweepPaymentReminders};
