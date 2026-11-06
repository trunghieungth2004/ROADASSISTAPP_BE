import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as paymentRepository from "../../../../repository/paymentRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as userRepository from "../../../../repository/userRepository";
import {
  approveMobileFix,
  declineMobileFix,
  setMobileShopFix,
} from "../../../../service/dispatch/shop";
import {chatService} from "../../../../service/chatService";
import {findCandidates} from "../../../../service/dispatch/candidates";
import * as paymentService from "../../../../service/paymentService";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/paymentRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../service/chatService", () => ({
  chatService: {
    addSystemEvent: jest.fn(async () => undefined),
    archiveTicketRoom: jest.fn(async () => ({
      roomId: "room-old",
      at: "2026-01-01T00:10:00.000Z",
    })),
  },
}));
jest.mock("../../../../service/dispatch/candidates", () => ({
  findCandidates: jest.fn(async () => ["op2"]),
}));
jest.mock("../../../../service/paymentService", () => ({
  cancelPendingPayments: jest.fn(async () => undefined),
  createPaymentForTicket: jest.fn(async () => ({id: "pay1"})),
  requestRefund: jest.fn(async () => ({id: "refund1"})),
}));
jest.mock("../../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const mobileShop = {
  id: "mobile1",
  name: "Mobile Fix",
  kind: "MOBILE_SHOP",
  operatorUid: "op1",
  status: "ACTIVE",
};

const quotedTicket = (patch: Record<string, unknown> = {}) => ({
  id: "sos1",
  userId: "rider1",
  ticketType: "SOS",
  status: "9",
  assignedShopId: "mobile1",
  assignedUid: "op1",
  assignedKind: "MOBILE_SHOP",
  lat: 10.7,
  lng: 106.6,
  vehicleType: "CAR",
  finalAmount: 120000,
  invoiceItems: [{name: "Battery", qty: 1, unitPrice: 120000, amount: 120000}],
  mobileCallOutFee: 50000,
  mobileTravelFee: 15000,
  mobileCallOutWaived: false,
  chatVersion: 2,
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.update).mockResolvedValue(undefined);
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(providerRepository.findById).mockResolvedValue(
    mobileShop as never,
  );
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
});

describe("mobile shop fix quote", () => {
  it("moves an arrived SOS to quoted and itemizes the fix", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...quotedTicket(),
      status: "3",
    } as never);

    await expect(setMobileShopFix({
      userId: "op1",
      ticketId: "sos1",
      fixAmount: 120000,
      items: [{name: "Battery", qty: 1, unitPrice: 120000}],
    })).resolves.toEqual({updated: 1});

    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        finalAmount: 120000,
        invoiceItems: [
          expect.objectContaining({
            name: "Battery",
            qty: 1,
            unitPrice: 120000,
            amount: 120000,
          }),
        ],
        mobileFixApprovedAt: null,
        mobileFixDeclinedAt: null,
        mobileFixDeclineReason: null,
      }),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "sos1",
      "9",
      "op1",
    );
    expect(chatService.addSystemEvent).toHaveBeenCalledWith(
      "sos1",
      "The mobile shop sent a fix quote.",
      "MOBILE_FIX_QUOTED",
      {amount: 120000},
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "sos1",
      expect.stringMatching(/^-status-9-/),
    );
  });

  it("refuses to change the fix fee after the quote is sent", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );

    await expect(setMobileShopFix({
      userId: "op1",
      ticketId: "sos1",
      fixAmount: 90000,
    })).rejects.toMatchObject({statusCode: 400});

    expect(dispatchRepository.update).not.toHaveBeenCalled();
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("requires the item total to match the fix fee", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...quotedTicket(),
      status: "3",
    } as never);

    await expect(setMobileShopFix({
      userId: "op1",
      ticketId: "sos1",
      fixAmount: 100000,
      items: [{name: "Battery", qty: 1, unitPrice: 120000}],
    })).rejects.toMatchObject({statusCode: 400});

    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });
});

describe("mobile fix approval", () => {
  it("arms cash and moves the SOS to ready on rider approval", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );

    await expect(approveMobileFix({
      userId: "rider1",
      ticketId: "sos1",
    })).resolves.toEqual({approved: true});

    expect(paymentService.createPaymentForTicket).toHaveBeenCalledWith({
      userId: "rider1",
      ticketId: "sos1",
      method: "CASH",
    });
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        mobileFixApprovedAt: expect.any(String),
        fulfilledByShopId: "mobile1",
      }),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "sos1",
      "7",
      "rider1",
    );
    expect(chatService.addSystemEvent).toHaveBeenCalledWith(
      "sos1",
      "The rider approved the fix quote.",
      "MOBILE_FIX_APPROVED",
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "sos1",
      expect.stringMatching(/^-mobile-fix-approved-operator-/),
      expect.objectContaining({
        audience: "operator",
        urgent: "true",
      }),
    );
  });

  it("accepts pending cash without creating a second charge", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      {id: "pay1", method: "CASH", status: "PENDING"},
    ] as never);

    await expect(approveMobileFix({
      userId: "rider1",
      ticketId: "sos1",
    })).resolves.toEqual({approved: true});

    expect(paymentService.createPaymentForTicket).not.toHaveBeenCalled();
  });

  it("creates a fresh cash charge after a cancelled one", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      {id: "old", method: "CASH", status: "CANCELLED"},
    ] as never);

    await expect(approveMobileFix({
      userId: "rider1",
      ticketId: "sos1",
    })).resolves.toEqual({approved: true});

    expect(paymentService.createPaymentForTicket).toHaveBeenCalledWith({
      userId: "rider1",
      ticketId: "sos1",
      method: "CASH",
    });
  });

  it("blocks approval when a SePay payment is not funded", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      {id: "pay1", method: "SEPAY", status: "PENDING"},
    ] as never);

    await expect(approveMobileFix({
      userId: "rider1",
      ticketId: "sos1",
    })).rejects.toMatchObject({statusCode: 400});

    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("accepts a held SePay payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      {id: "pay1", method: "SEPAY", status: "HELD"},
    ] as never);

    await expect(approveMobileFix({
      userId: "rider1",
      ticketId: "sos1",
    })).resolves.toEqual({approved: true});
  });
});

describe("mobile fix decline", () => {
  it("keeps call-out payable and rebroadcasts", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket({
        mobileFeeHistory: [{
          shopId: "mobile0",
          callOutFee: 30000,
          travelFee: 5000,
          waived: false,
          declinedAt: "2025-12-31T23:00:00.000Z",
        }],
      }) as never,
    );

    await expect(declineMobileFix({
      userId: "rider1",
      ticketId: "sos1",
      reason: "Price too high",
    })).resolves.toEqual({declined: true});

    expect(chatService.archiveTicketRoom).toHaveBeenCalledWith({
      ticketId: "sos1",
      version: 2,
    });
    expect(findCandidates).toHaveBeenCalledWith(expect.objectContaining({
      excludeShopIds: ["mobile1"],
      excludeOperatorUids: ["op1"],
    }));
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        assignedShopId: null,
        assignedUid: null,
        assignedKind: null,
        mobileCallOutFee: null,
        mobileTravelFee: null,
        finalAmount: null,
        invoiceItems: null,
        mobileFixDeclineReason: "Price too high",
        excludedShopIds: ["mobile1"],
        excludedOperatorUids: ["op1"],
        formerAssignedShopIds: ["mobile1"],
        chatVersion: 3,
        candidates: ["op2"],
        mobileFeeHistory: [
          expect.objectContaining({shopId: "mobile0"}),
          expect.objectContaining({
            shopId: "mobile1",
            callOutFee: 50000,
            travelFee: 15000,
            fixAmount: 120000,
            reason: "Price too high",
          }),
        ],
      }),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "sos1",
      "1",
      "rider1",
    );
    expect(paymentService.cancelPendingPayments).toHaveBeenCalledWith("sos1");
    expect(chatService.addSystemEvent).toHaveBeenCalledWith(
      "sos1",
      "The rider declined the fix quote.",
      "MOBILE_FIX_DECLINED",
      {reason: "Price too high"},
    );
    expect(jest.mocked(chatService.addSystemEvent).mock
      .invocationCallOrder[0]).toBeLessThan(
      jest.mocked(chatService.archiveTicketRoom).mock
        .invocationCallOrder[0],
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "sos1",
      expect.stringMatching(/^-mobile-fix-declined-/),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "sos1",
      expect.stringMatching(/^-mobile-fix-declined-shop-/),
      expect.objectContaining({
        audience: "shop",
        shopId: "mobile1",
        urgent: "true",
      }),
    );
  });

  it("only lets the rider decline the fix", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );

    await expect(declineMobileFix({
      userId: "op1",
      ticketId: "sos1",
    })).rejects.toMatchObject({statusCode: 403});

    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });
});
