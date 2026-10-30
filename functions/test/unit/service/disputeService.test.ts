import {expect, jest, test, beforeEach} from "@jest/globals";
import * as disputeRepository from "../../../repository/disputeRepository";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as paymentService from "../../../service/paymentService";
import {chatService} from "../../../service/chatService";
import {userFile, resolve} from "../../../service/disputeService";

jest.mock("../../../repository/disputeRepository");
jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/paymentService");
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => undefined),
}));

const RIDER = "rider1";
const OPERATOR = "op1";
const ADMIN = "admin1";

const rider = {id: RIDER, role: "2"};
const operator = {id: OPERATOR, role: "2"};
const admin = {id: ADMIN, role: "1"};

const tower = {id: "tow1", kind: "TOW", operatorUid: OPERATOR};
const mobile = {
  id: "mobile1",
  kind: "MOBILE_SHOP",
  operatorUid: OPERATOR,
};

function disputeFor(
  ticketId: string,
  fields: Record<string, unknown> = {},
): disputeRepository.Dispute {
  return {
    id: "d1",
    ticketId,
    filedBy: RIDER,
    accusedId: "tow1",
    accusedKind: "TOWER",
    type: "PROVIDER_LATE",
    reasonCode: "PROVIDER_LATE",
    note: null,
    photoUrls: [],
    status: "OPEN",
    resolution: null,
    outcome: null,
    adjustedAmount: null,
    hold: false,
    resolvedBy: null,
    resolvedAt: null,
    refundAdjust: null,
    payoutAdjust: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue(admin as never);
  jest.mocked(disputeRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(paymentService.cancelPendingPayments).mockResolvedValue();
  jest.mocked(dispatchRepository.update).mockResolvedValue();
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue();
  jest.mocked(chatService.addSystemEvent).mockResolvedValue(undefined as never);
});

test("rider late on a tow accuses the tower and does not hold", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(rider as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "TOW",
    status: "2",
    assignedShopId: "tow1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(tower as never);
  jest.mocked(disputeRepository.create).mockImplementation(async (data) =>
    disputeFor(data.ticketId, {
      filedBy: data.filedBy,
      accusedId: data.accusedId ?? null,
      accusedKind: data.accusedKind,
      type: data.type,
      reasonCode: data.reasonCode,
      hold: data.hold === true,
    }),
  );

  await userFile({ticketId: "t1", filedBy: RIDER, reason: "LATE"});

  expect(disputeRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accusedKind: "TOWER",
      accusedId: "tow1",
      type: "PROVIDER_LATE",
      reasonCode: "PROVIDER_LATE",
      hold: false,
    }),
  );
  expect(dispatchRepository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({disputeHold: false, openDisputeId: "d1"}),
  );
});

test("rider fix dispute on a ready SOS holds the ticket", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(rider as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    assignedShopId: "mobile1",
    finalAmount: 120000,
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(mobile as never);
  jest.mocked(disputeRepository.create).mockImplementation(async (data) =>
    disputeFor(data.ticketId, {
      filedBy: data.filedBy,
      accusedId: data.accusedId ?? null,
      accusedKind: data.accusedKind,
      type: data.type,
      reasonCode: data.reasonCode,
      hold: data.hold === true,
    }),
  );

  await userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "FIX_NOT_DONE",
  });

  expect(disputeRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accusedKind: "SHOP",
      accusedId: "mobile1",
      type: "SERVICE_QUALITY",
      reasonCode: "SERVICE_NOT_DONE",
      hold: true,
    }),
  );
  expect(dispatchRepository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({disputeHold: true, openDisputeId: "d1"}),
  );
  expect(paymentService.cancelPendingPayments).toHaveBeenCalledWith("t1");
});

test("provider dispute accuses the rider", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(operator as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "TOW",
    status: "4",
    assignedShopId: "tow1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(tower as never);
  jest.mocked(disputeRepository.create).mockImplementation(async (data) =>
    disputeFor(data.ticketId, {
      filedBy: data.filedBy,
      accusedId: data.accusedId ?? null,
      accusedKind: data.accusedKind,
      type: data.type,
      reasonCode: data.reasonCode,
    }),
  );

  await userFile({
    ticketId: "t1",
    filedBy: OPERATOR,
    reason: "RIDER_NO_SHOW",
  });

  expect(disputeRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accusedKind: "RIDER",
      accusedId: RIDER,
      type: "RIDER_NO_SHOW",
      reasonCode: "RIDER_NO_RESPONSE",
    }),
  );
});

test("refuses a second open dispute on one ticket", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(rider as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    assignedShopId: "mobile1",
  } as never);
  jest.mocked(disputeRepository.findByTicketId).mockResolvedValue([
    disputeFor("t1", {status: "OPEN"}),
  ]);

  await expect(
    userFile({ticketId: "t1", filedBy: RIDER, reason: "FIX_NOT_DONE"}),
  ).rejects.toMatchObject({statusCode: 409});
});

test("rider win clears the hold and zeroes SOS charges", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(admin as never);
  jest.mocked(disputeRepository.findById)
    .mockResolvedValueOnce(
      disputeFor("t1", {
        accusedKind: "SHOP",
        accusedId: "mobile1",
        type: "SERVICE_QUALITY",
        reasonCode: "SERVICE_NOT_DONE",
        hold: true,
      }),
    )
    .mockResolvedValueOnce(
      disputeFor("t1", {
        status: "RESOLVED",
        accusedKind: "SHOP",
        accusedId: "mobile1",
        type: "SERVICE_QUALITY",
        reasonCode: "SERVICE_NOT_DONE",
        hold: true,
        outcome: "RIDER",
      }),
    );
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    assignedShopId: "mobile1",
    finalAmount: 120000,
    mobileCallOutFee: 50000,
    mobileTravelFee: 20000,
    openDisputeId: "d1",
  } as never);

  await resolve({
    disputeId: "d1",
    resolution: "Rider wins",
    by: ADMIN,
    outcome: "RIDER",
  });

  expect(dispatchRepository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({
      disputeHold: false,
      openDisputeId: null,
      finalAmount: 0,
      mobileCallOutFee: 0,
      mobileTravelFee: 0,
    }),
  );
  expect(paymentService.cancelPendingPayments).toHaveBeenCalledWith("t1");
});
