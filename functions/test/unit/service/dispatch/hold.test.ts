import {expect, jest, test, beforeEach} from "@jest/globals";
import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as userRepository from "../../../../repository/userRepository";
import {chatService} from "../../../../service/chatService";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";
import {
  clearHold,
  setHold,
  sweepExpiredHolds,
} from "../../../../service/dispatchService";
import {STATUS_DISPATCH} from "../../../../constants/status";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => undefined),
}));

const riderTicket = (patch: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "rider1",
  ticketType: "SOS",
  status: STATUS_DISPATCH.MATCHED,
  lat: 10.7,
  lng: 106.6,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.update).mockResolvedValue();
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "rider1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(null);
  jest.mocked(dispatchRepository.findExpiredHolds).mockResolvedValue([]);
});

test("rejects a hold before the job is matched", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue(
    riderTicket({status: STATUS_DISPATCH.PENDING}) as never,
  );
  await expect(setHold({
    userId: "rider1",
    ticketId: "t1",
    reason: "TRAFFIC",
  })).rejects.toMatchObject({statusCode: 400});
});

test("saves a rider delay and mirrors it in chat", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue(
    riderTicket() as never,
  );
  const etaAt = new Date(Date.now() + 3600000).toISOString();
  await setHold({
    userId: "rider1",
    ticketId: "t1",
    reason: "TRAFFIC",
    note: "Stuck on the bridge",
    etaAt,
  });
  expect(dispatchRepository.update).toHaveBeenCalledWith("t1", {
    hold: expect.objectContaining({
      reason: "TRAFFIC",
      note: "Stuck on the bridge",
      etaAt,
      by: "rider1",
    }),
  });
  expect(enqueueDispatchPush).toHaveBeenCalledWith(
    "t1",
    "-hold",
    expect.objectContaining({
      audience: "operator",
      title: "Rider reported a delay",
      body: expect.stringContaining("Stuck on the bridge"),
    }),
  );
  expect(chatService.addSystemEvent).toHaveBeenCalledWith(
    "t1",
    expect.stringContaining("Stuck on the bridge"),
    "DELAY_REPORTED",
    expect.objectContaining({reason: "TRAFFIC", etaAt}),
  );
});

test("only the reporter can clear a delay", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue(
    riderTicket({
      hold: {
        reason: "PARTS",
        note: null,
        etaAt: null,
        by: "op1",
        at: new Date().toISOString(),
      },
    }) as never,
  );
  await expect(clearHold({userId: "rider1", ticketId: "t1"}))
    .rejects.toMatchObject({statusCode: 403});
  expect(dispatchRepository.update).not.toHaveBeenCalled();
});

test("clearing a delay notifies the other side and chat", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue(
    riderTicket({
      hold: {
        reason: "TRAFFIC",
        note: null,
        etaAt: null,
        by: "rider1",
        at: new Date().toISOString(),
      },
    }) as never,
  );
  await clearHold({userId: "rider1", ticketId: "t1"});
  expect(dispatchRepository.update).toHaveBeenCalledWith("t1", {hold: null});
  expect(enqueueDispatchPush).toHaveBeenCalledWith(
    "t1",
    "-hold-clear",
    expect.objectContaining({title: "Delay cleared"}),
  );
  expect(chatService.addSystemEvent).toHaveBeenCalledWith(
    "t1",
    "Delay cleared",
    "DELAY_CLEARED",
  );
});

test("expired holds clear, chat and notify the other side", async () => {
  jest.mocked(dispatchRepository.findExpiredHolds).mockResolvedValue([
    riderTicket({
      hold: {
        reason: "TRAFFIC",
        note: "Bridge traffic",
        etaAt: "2026-01-01T00:00:00.000Z",
        by: "rider1",
        at: "2025-12-31T23:00:00.000Z",
      },
    }) as never,
  ]);
  await expect(sweepExpiredHolds()).resolves.toEqual({cleared: 1});
  expect(dispatchRepository.update).toHaveBeenCalledWith("t1", {hold: null});
  expect(chatService.addSystemEvent).toHaveBeenCalledWith(
    "t1",
    "Delay cleared — new ETA passed",
    "DELAY_CLEARED",
    {automatic: "true"},
  );
  expect(enqueueDispatchPush).toHaveBeenCalledWith(
    "t1",
    "-hold-expired-t1",
    expect.objectContaining({
      audience: "operator",
      body: "The reported delay ETA has passed",
    }),
  );
});

test("holds without an ETA are left alone", async () => {
  jest.mocked(dispatchRepository.findExpiredHolds).mockResolvedValue([
    riderTicket({
      hold: {
        reason: "PARTS",
        note: null,
        etaAt: null,
        by: "op1",
        at: "2026-01-01T00:00:00.000Z",
      },
    }) as never,
  ]);
  await expect(sweepExpiredHolds()).resolves.toEqual({cleared: 0});
  expect(dispatchRepository.update).not.toHaveBeenCalled();
});
