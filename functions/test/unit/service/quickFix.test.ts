import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as paymentService from "../../../service/paymentService";
import {chatService} from "../../../service/chatService";
import {enqueueDispatchPush} from "../../../service/taskQueueService";
import {quickFix} from "../../../service/dispatch/shop";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/paymentService");
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const ticket = (patch: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "rider1",
  ticketType: "WALK_IN",
  status: "2",
  assignedShopId: "shop1",
  providerId: "shop1",
  quoteVersion: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...patch,
});

const shop = {
  id: "shop1",
  kind: "SHOP",
  operatorUid: "op1",
  status: "ACTIVE",
  services: [
    {
      code: "TIRE",
      name: "Flat tire",
      displayPrice: 50000,
      quoteRequired: false,
      category: "FLAT_TIRE",
    },
    {
      code: "ENGINE",
      name: "Engine check",
      displayPrice: 200000,
      quoteRequired: true,
      category: "ENGINE",
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(shop as never);
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket() as never);
});

describe("quickFix", () => {
  it("starts a fixed-price catalog job", async () => {
    const result = await quickFix({
      userId: "op1",
      ticketId: "t1",
      items: [{name: "flat tire", qty: 1, unitPrice: 50000}],
    });
    expect(result).toEqual({quickFix: true, amount: 50000});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "6",
      "op1",
    );
    expect(paymentService.createPaymentForTicket).toHaveBeenCalledWith({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    });
    expect(chatService.addSystemEvent).toHaveBeenCalled();
    expect(enqueueDispatchPush).toHaveBeenCalled();
  });

  it("rejects an inspection-only service", async () => {
    await expect(quickFix({
      userId: "op1",
      ticketId: "t1",
      items: [{name: "Engine check", qty: 1, unitPrice: 200000}],
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a price that does not match the catalog", async () => {
    await expect(quickFix({
      userId: "op1",
      ticketId: "t1",
      items: [{name: "Flat tire", qty: 1, unitPrice: 40000}],
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a total above the direct limit", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      ...shop,
      services: [{
        code: "BIG",
        name: "Big job",
        displayPrice: 400000,
        quoteRequired: false,
        category: "OTHER",
      }],
    } as never);
    await expect(quickFix({
      userId: "op1",
      ticketId: "t1",
      items: [{name: "Big job", qty: 1, unitPrice: 400000}],
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a non-operator", async () => {
    await expect(quickFix({
      userId: "other",
      ticketId: "t1",
      items: [{name: "Flat tire", qty: 1, unitPrice: 50000}],
    })).rejects.toMatchObject({statusCode: 403});
  });
});
