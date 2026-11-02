import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as paymentRepository from "../../../../repository/paymentRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as userRepository from "../../../../repository/userRepository";
import {
  approveQuote,
  declineQuote,
  sendQuote,
} from "../../../../service/dispatch/shop";
import {chatService} from "../../../../service/chatService";
import * as paymentService from "../../../../service/paymentService";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/paymentRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../../service/paymentService", () => ({
  cancelPendingPayments: jest.fn(async () => undefined),
  createPaymentForTicket: jest.fn(async () => ({id: "pay2"})),
  refundPayment: jest.fn(async () => undefined),
}));
jest.mock("../../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const shop = {
  id: "shop9",
  name: "Fix Co",
  kind: "SHOP",
  operatorUid: "op1",
  status: "ACTIVE",
};

const quotedTicket = (patch: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "rider1",
  ticketType: "WALK_IN",
  status: "9",
  providerId: "shop9",
  assignedShopId: "shop9",
  assignedUid: "op1",
  shopQuotedAmount: 150000,
  quoteItems: [{name: "Brake pads", qty: 1, unitPrice: 150000}],
  quoteVersion: 1,
  invoiceItems: [{name: "Brake pads", qty: 1, unitPrice: 150000}],
  invoiceAmount: 150000,
  invoiceApproval: "PENDING",
  invoiceApprovedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.update).mockResolvedValue(undefined);
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(providerRepository.findById).mockResolvedValue(shop as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
});

describe("walk-in quote decline", () => {
  it("clears the quote and returns a walk-in to matched", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );

    await expect(declineQuote({
      userId: "rider1",
      ticketId: "t1",
      reason: "Price too high",
    })).resolves.toEqual({declined: true});

    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        shopQuotedAmount: null,
        quoteItems: null,
        invoiceItems: null,
        invoiceAmount: null,
        invoiceApproval: null,
        invoiceApprovedAt: null,
        preQuoteStatus: null,
        quoteDeclineReason: "Price too high",
        quoteDeclinedAt: expect.any(String),
      }),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "2",
      "rider1",
    );
    expect(paymentService.cancelPendingPayments).toHaveBeenCalledWith("t1");
    expect(chatService.addSystemEvent).toHaveBeenCalledWith(
      "t1",
      "Quote declined by the rider.",
      "QUOTE_DECLINED",
      {},
    );
    expect(enqueueDispatchPush).toHaveBeenCalledTimes(1);
    expect(enqueueDispatchPush).not.toHaveBeenCalledWith(
      "t1",
      expect.stringMatching(/^-quote-declined-\d+$/),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      expect.stringMatching(/^-quote-declined-operator-/),
      expect.objectContaining({
        audience: "operator",
        urgent: "true",
      }),
    );
  });

  it("lets the shop send a revised quote after a decline", async () => {
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValueOnce(quotedTicket() as never)
      .mockResolvedValueOnce(quotedTicket({
        status: "2",
        shopQuotedAmount: null,
        quoteItems: null,
      }) as never);

    await declineQuote({
      userId: "rider1",
      ticketId: "t1",
      reason: "Items are wrong",
    });
    await expect(sendQuote({
      userId: "op1",
      ticketId: "t1",
      quotedAmount: 180000,
      items: [{name: "Brake pads and fluid", qty: 1, unitPrice: 180000}],
    })).resolves.toEqual({quoted: true, version: 2});

    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({preQuoteStatus: "2"}),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenLastCalledWith(
      "t1",
      "9",
      "op1",
    );
  });

  it("restores the recorded pre-quote state", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket({preQuoteStatus: "10"}) as never,
    );

    await declineQuote({userId: "rider1", ticketId: "t1"});

    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "10",
      "rider1",
    );
  });

  it("returns a mechanic quote to arrived by default", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket({ticketType: "MECHANIC"}) as never,
    );

    await declineQuote({userId: "rider1", ticketId: "t1"});

    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "3",
      "rider1",
    );
  });

  it("creates a fresh cash charge for a re-quoted ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      {id: "old", method: "CASH", status: "CANCELLED"},
    ] as never);

    await expect(approveQuote({
      userId: "rider1",
      ticketId: "t1",
    })).resolves.toEqual({approved: true});

    expect(paymentService.createPaymentForTicket).toHaveBeenCalledWith({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    });
  });

  it("only lets the rider decline a quote", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket() as never,
    );

    await expect(declineQuote({
      userId: "op1",
      ticketId: "t1",
    })).rejects.toMatchObject({statusCode: 403});

    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects SOS quotes", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket({ticketType: "SOS"}) as never,
    );

    await expect(declineQuote({
      userId: "rider1",
      ticketId: "t1",
    })).rejects.toMatchObject({statusCode: 400});

    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects tickets that are not quoted", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      quotedTicket({status: "6"}) as never,
    );

    await expect(declineQuote({
      userId: "rider1",
      ticketId: "t1",
    })).rejects.toMatchObject({statusCode: 400});

    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });
});
