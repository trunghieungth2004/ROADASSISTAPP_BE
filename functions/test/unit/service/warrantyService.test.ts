import {expect, jest, test, beforeEach} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as warrantyRepository from "../../../repository/warrantyRepository";
import * as refundService from "../../../service/refundService";
import {enqueueDispatchPush} from "../../../service/taskQueueService";
import {
  fileClaim,
  resolve,
  respond,
  sweepWarrantyRebooks,
} from "../../../service/warrantyService";
import {STATUS_DISPATCH} from "../../../constants/status";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/warrantyRepository");
jest.mock("../../../service/refundService");
jest.mock("../../../service/dispatch/tickets", () => ({
  createDispatch: jest.fn(async () => ({id: "rework1"})),
}));
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => undefined),
}));

const FUTURE = new Date(Date.now() + 86400000).toISOString();

const ticket = (
  patch: Record<string, unknown> = {},
): dispatchRepository.DispatchTicket => ({
  id: "t1",
  userId: "rider1",
  ticketType: "WALK_IN",
  status: STATUS_DISPATCH.RESOLVED,
  lat: 10.7,
  lng: 106.6,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...patch,
} as dispatchRepository.DispatchTicket);

const claim = (
  patch: Record<string, unknown> = {},
): warrantyRepository.WarrantyClaim => ({
  id: "wc1",
  ticketId: "t1",
  lineId: "line1",
  serviceCode: "TIRE",
  serviceName: "Flat tire",
  category: "FLAT_TIRE",
  riderUid: "rider1",
  providerId: "shop1",
  lineAmount: 50000,
  purchasedAt: "2026-10-01T00:00:00.000Z",
  warrantyUntil: FUTURE,
  reason: "Patch failed",
  photoUrls: [],
  status: "OPEN",
  shopResponse: null,
  respondedAt: null,
  outcome: null,
  refundAmount: null,
  refundRequestId: null,
  linkedTicketId: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: "2026-10-02T00:00:00.000Z",
  ...patch,
} as warrantyRepository.WarrantyClaim);

const resolvedTicket = () => ticket({
  assignedShopId: "shop1",
  providerId: "shop1",
  invoiceItems: [{
    lineId: "line1",
    kind: "SERVICE",
    serviceCode: "TIRE",
    name: "Flat tire",
    qty: 1,
    unitPrice: 50000,
    amount: 50000,
    warrantyUntil: FUTURE,
  }],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "admin1",
    role: "1",
  } as never);
  jest.mocked(dispatchRepository.update).mockResolvedValue();
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue();
  jest.mocked(warrantyRepository.update).mockResolvedValue();
  jest.mocked(warrantyRepository.findByLine).mockResolvedValue([]);
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(refundService.requestRefund).mockResolvedValue({
    id: "rf1",
  } as never);
});

test("rejects a second claim on the same service line", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue(resolvedTicket());
  jest.mocked(warrantyRepository.findByLine).mockResolvedValue([claim()]);
  await expect(fileClaim({
    userId: "rider1",
    ticketId: "t1",
    lineId: "line1",
    reason: "Patch failed again",
  })).rejects.toMatchObject({statusCode: 400});
});

test("declining a claim notifies the rider", async () => {
  jest.mocked(warrantyRepository.findById)
    .mockResolvedValueOnce(claim())
    .mockResolvedValueOnce(claim({status: "DECLINED"}));
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop1",
    operatorUid: "op1",
  } as never);
  const result = await respond({
    userId: "op1",
    claimId: "wc1",
    accept: false,
    note: "Wear and tear",
  });
  expect(result.status).toBe("DECLINED");
  expect(warrantyRepository.update).toHaveBeenCalledWith("wc1",
    expect.objectContaining({status: "DECLINED"}));
  expect(enqueueDispatchPush).toHaveBeenCalledWith(
    "t1",
    "-warranty-declined-wc1",
    expect.objectContaining({audience: "rider"}),
  );
});

test("accepting a claim creates a linked rework ticket", async () => {
  jest.mocked(warrantyRepository.findById)
    .mockResolvedValueOnce(claim())
    .mockResolvedValueOnce(claim({
      status: "REBOOKED",
      linkedTicketId: "rework1",
    }));
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop1",
    operatorUid: "op1",
  } as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket({
    id: "t1",
    assignedShopId: "shop1",
  }));
  const result = await respond({
    userId: "op1",
    claimId: "wc1",
    accept: true,
    note: "Bring it in",
  });
  expect(result.status).toBe("REBOOKED");
  expect(dispatchRepository.update).toHaveBeenCalledWith("rework1",
    expect.objectContaining({
      warrantyOfTicketId: "t1",
      warrantyClaimId: "wc1",
    }));
  expect(warrantyRepository.update).toHaveBeenCalledWith("wc1",
    expect.objectContaining({
      status: "REBOOKED",
      linkedTicketId: "rework1",
    }));
});

test("only the provider operator answers a claim", async () => {
  jest.mocked(warrantyRepository.findById).mockResolvedValue(claim());
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "admin1",
    role: "1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop1",
    operatorUid: "op1",
  } as never);
  await expect(respond({
    userId: "admin1",
    claimId: "wc1",
    accept: true,
  })).rejects.toMatchObject({statusCode: 403});
});

test("refuses to resolve a rebooked claim while rework is active", async () => {
  jest.mocked(warrantyRepository.findById).mockResolvedValue(claim({
    status: "REBOOKED",
    linkedTicketId: "rework1",
  }));
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket({
    id: "rework1",
    status: STATUS_DISPATCH.IN_PROGRESS,
  }));
  await expect(resolve({
    adminUid: "admin1",
    claimId: "wc1",
    outcome: "SHOP",
  })).rejects.toMatchObject({statusCode: 400});
});

test("resolves a rebooked claim once rework is terminal", async () => {
  jest.mocked(warrantyRepository.findById)
    .mockResolvedValueOnce(claim({
      status: "REBOOKED",
      linkedTicketId: "rework1",
    }))
    .mockResolvedValueOnce(claim({status: "RESOLVED"}));
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket({
    id: "rework1",
    status: STATUS_DISPATCH.CANCELLED,
  }));
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([{
    id: "p1",
    status: "CONFIRMED",
  } as never]);
  const result = await resolve({
    adminUid: "admin1",
    claimId: "wc1",
    outcome: "RIDER",
  });
  expect(result.status).toBe("RESOLVED");
  expect(refundService.requestRefund).toHaveBeenCalledWith(
    expect.objectContaining({paymentId: "p1", amount: 50000}),
  );
});

test("reopens a rebooked claim when rework was cancelled", async () => {
  jest.mocked(warrantyRepository.findByStatus).mockResolvedValue([claim({
    status: "REBOOKED",
    linkedTicketId: "rework1",
  })]);
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket({
    id: "rework1",
    status: STATUS_DISPATCH.CANCELLED,
  }));
  await expect(sweepWarrantyRebooks()).resolves.toEqual({
    completed: 0,
    reopened: 1,
  });
  expect(warrantyRepository.update).toHaveBeenCalledWith("wc1",
    expect.objectContaining({status: "OPEN", linkedTicketId: null}));
});

test("completes a rebooked claim when rework resolved", async () => {
  jest.mocked(warrantyRepository.findByStatus).mockResolvedValue([claim({
    status: "REBOOKED",
    linkedTicketId: "rework1",
  })]);
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket({
    id: "rework1",
    status: STATUS_DISPATCH.RESOLVED,
  }));
  await expect(sweepWarrantyRebooks()).resolves.toEqual({
    completed: 1,
    reopened: 0,
  });
  expect(warrantyRepository.update).toHaveBeenCalledWith("wc1",
    expect.objectContaining({status: "COMPLETED"}));
});
