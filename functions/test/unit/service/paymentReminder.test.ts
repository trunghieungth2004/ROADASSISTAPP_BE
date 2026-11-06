import {expect, jest, test, beforeEach} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentReminderRepository from
  "../../../repository/paymentReminderRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as paymentPush from "../../../service/push/payment";
import {billableAmountFor} from "../../../service/paymentService";
import {
  schedulePaymentReminder,
  sweepPaymentReminders,
} from "../../../service/paymentReminderService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentReminderRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../service/push/payment");
jest.mock("../../../service/paymentService");

const ticket = (patch: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "rider1",
  ticketType: "TOW",
  status: "4",
  lat: 10.7,
  lng: 106.6,
  ...patch,
} as never);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.update).mockResolvedValue();
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(paymentReminderRepository.findDue).mockResolvedValue([]);
  jest.mocked(paymentPush.deliverReminder).mockResolvedValue({
    delivered: 1,
    skipped: false,
  });
  jest.mocked(billableAmountFor).mockReturnValue({
    amount: 50000,
    waitingFee: 0,
  });
});

test("schedules a reminder for a closed unpaid ticket", async () => {
  await schedulePaymentReminder("t1", ticket());
  expect(dispatchRepository.update).toHaveBeenCalledWith("t1",
    expect.objectContaining({
      paymentReminderCount: 0,
      paymentRemindedAt: null,
    }));
});

test("does not schedule while a received payment exists", async () => {
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
    {status: "CONFIRMED"},
  ] as never);
  await schedulePaymentReminder("t1", ticket());
  expect(dispatchRepository.update).not.toHaveBeenCalled();
});

test("sweeps due unpaid tickets and schedules the next reminder", async () => {
  jest.mocked(paymentReminderRepository.findDue).mockResolvedValue([
    ticket({paymentReminderCount: 0}),
  ]);
  await expect(sweepPaymentReminders()).resolves.toEqual({reminded: 1});
  expect(paymentPush.deliverReminder).toHaveBeenCalledWith(
    "t1",
    "rider1",
    50000,
    1,
  );
  expect(dispatchRepository.update).toHaveBeenCalledWith("t1",
    expect.objectContaining({
      paymentReminderCount: 1,
    }));
});

test("sweep clears the reminder for a paid ticket", async () => {
  jest.mocked(paymentReminderRepository.findDue).mockResolvedValue([
    ticket({paymentReminderCount: 1}),
  ]);
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
    {status: "CONFIRMED"},
  ] as never);
  await expect(sweepPaymentReminders()).resolves.toEqual({reminded: 0});
  expect(dispatchRepository.update).toHaveBeenCalledWith("t1", {
    paymentDueAt: null,
    paymentReminderCount: 0,
    paymentRemindedAt: null,
  });
});
