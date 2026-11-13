import {expect, jest, test, beforeEach} from "@jest/globals";
import * as disputeRepository from "../../../repository/disputeRepository";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as paymentService from "../../../service/paymentService";
import * as refundService from "../../../service/refundService";
import {chatService} from "../../../service/chatService";
import * as taskQueueService from "../../../service/taskQueueService";
import {
  autoFile,
  userFile,
  resolve,
  list,
} from "../../../service/disputeService";

jest.mock("../../../repository/disputeRepository");
jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/paymentService");
jest.mock("../../../service/refundService");
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
  jest.mocked(refundService.requestRefund).mockResolvedValue({
    id: "refund1",
  } as never);
  jest.clearAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue(admin as never);
  jest.mocked(disputeRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(disputeRepository.findByFiledBy).mockResolvedValue([]);
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(paymentService.cancelPendingPayments).mockResolvedValue();
  jest.mocked(dispatchRepository.update).mockResolvedValue();
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue();
  jest.mocked(chatService.addSystemEvent).mockResolvedValue(undefined as never);
});

test("rider quality dispute accuses the tower and does not hold", async () => {
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

  await userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "FIX_NOT_DONE",
    photoUrls: ["dispatch/dispute-t1/1.jpg"],
  });

  expect(disputeRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accusedKind: "TOWER",
      accusedId: "tow1",
      type: "SERVICE_QUALITY",
      reasonCode: "SERVICE_NOT_DONE",
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
    photoUrls: ["dispatch/dispute-t1/1.jpg"],
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
    reason: "RIDER_REFUSED_PAYMENT",
  });

  expect(disputeRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      accusedKind: "RIDER",
      accusedId: RIDER,
      type: "RIDER_PAYMENT",
      reasonCode: "RIDER_PAYMENT_REFUSED",
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
    userFile({
      ticketId: "t1",
      filedBy: RIDER,
      reason: "FIX_NOT_DONE",
      photoUrls: ["dispatch/dispute-t1/1.jpg"],
    }),
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
  expect(taskQueueService.enqueueDispatchPush).toHaveBeenCalledWith(
    "t1",
    "-dispute-resolved",
    expect.objectContaining({audience: "participants"}),
  );
});

test("admin list attaches ticket, rider and provider context", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(admin as never);
  jest.mocked(disputeRepository.findAll).mockResolvedValue([
    disputeFor("t1"),
  ]);
  jest.mocked(dispatchRepository.findByIds).mockResolvedValue([{
    id: "t1",
    userId: RIDER,
    ticketType: "TOW",
    status: "7",
    symptom: "flat tire",
    description: null,
    photoUrls: [],
    paymentStatus: "PAID",
    waiting: {fee: 10000},
    assignedShopId: "tow1",
    quotes: [{
      shopId: "tow1",
      amount: 150000,
      kind: "TOW",
      at: "2026-01-01T00:00:00.000Z",
    }],
  }] as never);
  jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
    [RIDER, {
      id: RIDER,
      displayName: "Rider One",
      email: "rider@example.com",
      ratingAvg: 4.5,
      ratingCount: 10,
      trustScore: 80,
    } as never],
  ]));
  jest.mocked(providerRepository.findByIds).mockResolvedValue(new Map([
    ["tow1", {
      id: "tow1",
      name: "Tow Co",
      kind: "TOW",
      status: "ACTIVE",
      suspended: false,
      ratingAvg: 4.2,
      ratingCount: 5,
    } as never],
  ]));

  const rows = await list({adminUid: ADMIN});

  expect(rows).toHaveLength(1);
  expect(rows[0].context.ticket?.quoteAmount).toBe(150000);
  expect(rows[0].context.ticket?.waitingFee).toBe(10000);
  expect(rows[0].context.rider?.name).toBe("Rider One");
  expect(rows[0].context.provider?.name).toBe("Tow Co");
});

test("provider-filed dispute joins the provider and filer", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(admin as never);
  jest.mocked(disputeRepository.findAll).mockResolvedValue([
    disputeFor("t1", {
      filedBy: OPERATOR,
      accusedId: RIDER,
      accusedKind: "RIDER",
    }),
  ]);
  jest.mocked(dispatchRepository.findByIds).mockResolvedValue([{
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    assignedShopId: "tow1",
    finalAmount: 120000,
    quotes: [],
  }] as never);
  jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
    [RIDER, {
      id: RIDER,
      displayName: "Rider One",
      email: "rider@example.com",
      ratingAvg: 4.5,
      ratingCount: 10,
      trustScore: 80,
    } as never],
  ]));
  jest.mocked(providerRepository.findByIds).mockResolvedValue(new Map([
    ["tow1", {
      id: "tow1",
      name: "Tow Co",
      kind: "TOW",
      status: "ACTIVE",
      operatorUid: OPERATOR,
      suspended: false,
      ratingAvg: 4.2,
      ratingCount: 5,
    } as never],
  ]));

  const rows = await list({adminUid: ADMIN});

  expect(rows[0].context.filer).toBe("PROVIDER");
  expect(rows[0].context.provider?.id).toBe("tow1");
  expect(rows[0].context.rider?.id).toBe(RIDER);
  expect(rows[0].context.ticket?.finalAmount).toBe(120000);
});

test("rider fare dispute requires a received payment", async () => {
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
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);

  await expect(userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "OVERCHARGE",
    photoUrls: ["dispatch/dispute-t1/1.jpg"],
  })).rejects.toThrow("Pay the fare before disputing it");
});

test("rider fare dispute marks received payments as disputed", async () => {
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
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([{
    id: "p1",
    ticketId: "t1",
    status: "CONFIRMED",
    amount: 120000,
    method: "SEPAY",
  }] as never);
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
    reason: "OVERCHARGE",
    photoUrls: ["dispatch/dispute-t1/1.jpg"],
  });

  expect(paymentRepository.update).toHaveBeenCalledWith(
    "p1",
    expect.objectContaining({disputeId: "d1", disputeHold: true}),
  );
});

test("fare and quality disputes require evidence", async () => {
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
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([{
    id: "p1",
    ticketId: "t1",
    status: "CONFIRMED",
    amount: 120000,
    method: "SEPAY",
  }] as never);

  await expect(userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "OVERCHARGE",
  })).rejects.toThrow("Add at least one photo as evidence");
});

test("a ticket has a lifetime dispute cap", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(rider as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    assignedShopId: "mobile1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(mobile as never);
  jest.mocked(disputeRepository.findByTicketId).mockResolvedValue([
    disputeFor("t1", {
      status: "RESOLVED",
      resolvedAt: "2026-01-01T00:00:00.000Z",
    }),
    disputeFor("t1", {
      status: "RESOLVED",
      resolvedAt: "2026-01-02T00:00:00.000Z",
    }),
    disputeFor("t1", {
      status: "RESOLVED",
      resolvedAt: "2026-01-03T00:00:00.000Z",
    }),
  ]);

  await expect(userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "LATE",
  })).rejects.toThrow("This ticket has reached the dispute limit");
});

test("a closed dispute starts a cooldown", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(rider as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    assignedShopId: "mobile1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(mobile as never);
  jest.mocked(disputeRepository.findByTicketId).mockResolvedValue([
    disputeFor("t1", {
      status: "DISMISSED",
      resolvedAt: new Date().toISOString(),
    }),
  ]);

  await expect(userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "LATE",
  })).rejects.toThrow("Wait 24 hours before disputing this ticket again");
});

test("dismiss notifies both parties and posts a chat event", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(admin as never);
  jest.mocked(disputeRepository.findById).mockResolvedValue(
    disputeFor("t1", {status: "OPEN"}),
  );
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "SOS",
    status: "7",
    openDisputeId: "d1",
    dispute: {id: "d1"},
  } as never);
  jest.mocked(disputeRepository.update).mockResolvedValue();
  jest.mocked(dispatchRepository.update).mockResolvedValue();

  const {dismiss} = await import("../../../service/disputeService");
  await dismiss({
    disputeId: "d1",
    by: ADMIN,
    resolution: "Withdrawn",
  });

  expect(chatService.addSystemEvent).toHaveBeenCalledWith(
    "t1",
    "Dispute dismissed: Withdrawn.",
  );
  expect(taskQueueService.enqueueDispatchPush).toHaveBeenCalledWith(
    "t1",
    "-dispute-dismissed",
    expect.objectContaining({audience: "participants"}),
  );
});

test("conduct issues are rejected in favor of reports", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue(rider as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: RIDER,
    ticketType: "TOW",
    status: "2",
    assignedShopId: "tow1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(tower as never);

  await expect(userFile({
    ticketId: "t1",
    filedBy: RIDER,
    reason: "LATE",
  })).rejects.toThrow("Behavior issues are handled as reports");
});

describe("autoFile", () => {
  it("files a drop-off decline as a system dispute", async () => {
    await autoFile({
      ticketId: "t1",
      reporterUid: RIDER,
      accusedKind: "SHOP",
      accusedId: "shop1",
      reasonCode: "SHOP_FULL",
      type: "SHOP_DECLINE_DROPOFF",
    });
    expect(disputeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "t1",
        filedBy: RIDER,
        filedByRole: "SYSTEM",
        accusedKind: "SHOP",
        accusedId: "shop1",
        type: "SHOP_DECLINE_DROPOFF",
        reasonCode: "SHOP_FULL",
      }),
    );
  });

  it("files a mid-tow cancel as a system dispute", async () => {
    await autoFile({
      ticketId: "t1",
      reporterUid: RIDER,
      accusedKind: "TOWER",
      accusedId: "tow1",
      reasonCode: "TOWER_CANCEL_UNREACHABLE",
      type: "TOWER_CANCEL_MID",
    });
    expect(disputeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        filedByRole: "SYSTEM",
        type: "TOWER_CANCEL_MID",
        reasonCode: "TOWER_CANCEL_UNREACHABLE",
      }),
    );
  });

  it("maps the shop parts-delay decline reason", async () => {
    await autoFile({
      ticketId: "t1",
      reporterUid: RIDER,
      accusedKind: "SHOP",
      accusedId: "shop1",
      reasonCode: "SHOP_PARTS_DELAY",
      type: "SHOP_DECLINE_DROPOFF",
    });
    expect(disputeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "SHOP_PART_DELAY",
      }),
    );
  });
});
