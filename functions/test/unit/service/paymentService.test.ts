import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as platformConfigService from
  "../../../service/platformConfigService";
import * as sepayService from "../../../service/sepayService";
import * as subscriptionService from
  "../../../service/subscriptionService";
import {
  auditLedger,
  cancelPendingPayment,
  cancelPendingPayments,
  confirmCash,
  createPaymentForTicket,
  handleSepayIpn,
  refund,
} from "../../../service/paymentService";
import {ForbiddenError} from "../../../utils/errors";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/platformConfigService");
jest.mock("../../../service/sepayService");
jest.mock("../../../service/subscriptionService");
jest.mock("../../../service/push/payment", () => ({
  deliverOpened: jest.fn(async () => undefined),
  deliverReceived: jest.fn(async () => undefined),
  deliverConfirmed: jest.fn(async () => undefined),
  deliverRefunded: jest.fn(async () => undefined),
}));

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "t1",
  riderUid: "rider1",
  payeeId: "payee1",
  amount: 100000,
  currency: "VND",
  method: "CASH",
  status: "HELD",
  qrRef: null,
  ipnRef: null,
  commissionRate: 10,
  commissionAmount: 10000,
  payoutAmount: 90000,
  confirmedBy: null,
  confirmedAt: null,
  receiptUrl: null,
  refundAmount: null,
  refundedAt: null,
  refundedBy: null,
  payoutRef: null,
  payoutAt: null,
  payoutBy: null,
  payoutBatchId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...patch,
} as paymentRepository.Payment);

const config = (refundPolicy: string) => ({
  refundPolicy,
  paymentMethodsEnabled: ["CASH", "SEPAY"],
  commissionRate: {TOW: 15, WALK_IN: 10, MECHANIC: 10, SOS: 10},
} as never);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(platformConfigService.getConfig)
    .mockResolvedValue(config("FULL"));
  jest.mocked(paymentRepository.updateStatus).mockImplementation(
    async (id, status, fields) =>
      payment({id, status, ...fields}) as never);
  jest.mocked(sepayService.cancelOrder)
    .mockResolvedValue({ok: true, missing: false});
});

describe("createPaymentForTicket", () => {
  beforeEach(() => {
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
    jest.mocked(paymentRepository.createGuarded).mockResolvedValue({
      payment: payment({status: "PENDING"}),
      reused: false,
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      operatorUid: "payee1",
    } as never);
    jest.mocked(platformConfigService.getCommissionRate)
      .mockResolvedValue(15);
  });

  it("allows a TOW rider-cancel partial", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "TOW",
      status: "5",
      cancelledBy: "rider1",
      assignedShopId: "tow1",
      towFare: {final: 20000, estimate: 200000, waitingFee: 0},
    } as never);
    await createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    });
    expect(paymentRepository.createGuarded).toHaveBeenCalledWith(
      expect.objectContaining({amount: 20000}),
    );
  });

  it("allows prior tower travel after a tower cancels the tow", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "TOW",
      status: "5",
      cancelledBy: "towerop1",
      assignedShopId: "tow1",
      towFare: {final: null, estimate: 200000, waitingFee: 0},
      towFeeHistory: [{shopId: "old", amount: 50000}],
    } as never);
    await createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "SEPAY",
    });
    expect(paymentRepository.createGuarded).toHaveBeenCalledWith(
      expect.objectContaining({amount: 50000, method: "SEPAY"}),
    );
  });

  it("does not charge a normal re-match partial on rider cancel", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "TOW",
      status: "5",
      cancelledBy: "rider1",
      assignedShopId: null,
      towFare: {final: 20000, estimate: 200000, partial: true, waitingFee: 0},
    } as never);
    await expect(createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    })).rejects.toMatchObject({statusCode: 400});
    expect(paymentRepository.createGuarded).not.toHaveBeenCalled();
  });

  it("refuses a cancelled walk-in", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "WALK_IN",
      status: "5",
      cancelledBy: "rider1",
      shopQuotedAmount: 500000,
    } as never);
    await expect(createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("bills prior mobile call-outs with the current fix", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "SOS",
      status: "7",
      assignedShopId: "mobile1",
      mobileCallOutFee: 50000,
      mobileTravelFee: 15000,
      finalAmount: 120000,
      mobileFeeHistory: [
        {shopId: "mobile0", callOutFee: 30000, travelFee: 5000},
      ],
    } as never);
    await createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    });
    expect(paymentRepository.createGuarded).toHaveBeenCalledWith(
      expect.objectContaining({amount: 220000}),
    );
  });

  it("bills a breakdown tow partial with the replacement fare", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "TOW",
      status: "4",
      assignedShopId: "tow1",
      towFare: {final: 200000, estimate: 400000, waitingFee: 0},
      towFeeHistory: [{shopId: "tow0", amount: 50000}],
    } as never);
    await createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    });
    expect(paymentRepository.createGuarded).toHaveBeenCalledWith(
      expect.objectContaining({amount: 250000}),
    );
  });

  it("refuses a zero-amount waived SOS", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "SOS",
      status: "15",
      assignedShopId: "tow1",
      mobileCallOutFee: 0,
      mobileTravelFee: 5000,
    } as never);
    await expect(createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    })).rejects.toMatchObject({statusCode: 400});
  });
});

describe("refund", () => {
  it("allows one partial refund and accumulates the total", async () => {
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({refundAmount: 40000}) as never);
    const result = await refund({
      paymentId: "pay1",
      amount: 60000,
      by: "admin1",
    });
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "pay1",
      "REFUNDED",
      expect.objectContaining({refundAmount: 100000, refundedBy: "admin1"}),
    );
    expect(paymentRepository.clearGuard).toHaveBeenCalledWith("t1", "pay1");
    expect(result?.status).toBe("REFUNDED");
  });

  it("rejects refunds beyond the remaining amount", async () => {
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({refundAmount: 40000}) as never);
    await expect(refund({paymentId: "pay1", amount: 70000}))
      .rejects.toThrow("Invalid refund amount");
  });

  it("honours the disabled and partial-only policies", async () => {
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({}) as never);
    jest.mocked(platformConfigService.getConfig)
      .mockResolvedValue(config("NONE"));
    await expect(refund({paymentId: "pay1"})).rejects.toThrow(
      "Refunds are disabled");
    jest.mocked(platformConfigService.getConfig)
      .mockResolvedValue(config("PARTIAL"));
    await expect(refund({paymentId: "pay1", amount: 50000}))
      .resolves.toBeTruthy();
    await expect(refund({paymentId: "pay1", full: true}))
      .rejects.toThrow("Full refunds are disabled");
  });

  it("rejects fully refunded and unrefundable payments", async () => {
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({status: "REFUNDED"}) as never);
    await expect(refund({paymentId: "pay1"}))
      .rejects.toThrow("Payment cannot be refunded");
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({status: "PENDING"}) as never);
    await expect(refund({paymentId: "pay1"}))
      .rejects.toThrow("Payment cannot be refunded");
  });
});

describe("confirmCash", () => {
  it("confirms only the payment payee", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(
      {id: "payee1", role: "2"} as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue(
      [payment({status: "PENDING", method: "CASH"})] as never);
    await expect(confirmCash({userId: "other", ticketId: "t1"}))
      .rejects.toThrow(ForbiddenError);
    expect(paymentRepository.updateStatusWhen).not.toHaveBeenCalled();
  });

  it("confirms transactionally and surfaces a lost race", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(
      {id: "payee1", role: "2"} as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue(
      [payment({status: "PENDING", method: "CASH"})] as never);
    jest.mocked(paymentRepository.updateStatusWhen).mockResolvedValue(
      payment({status: "CONFIRMED"}) as never);
    const confirmed = await confirmCash({userId: "payee1", ticketId: "t1"});
    expect(paymentRepository.updateStatusWhen).toHaveBeenCalledWith(
      "pay1",
      "PENDING",
      "CONFIRMED",
      expect.objectContaining({confirmedBy: "payee1"}),
    );
    expect(confirmed?.status).toBe("CONFIRMED");
  });

  it("rejects when another caller won the race", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(
      {id: "admin1", role: "1"} as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue(
      [payment({status: "PENDING", method: "CASH"})] as never);
    jest.mocked(paymentRepository.updateStatusWhen).mockResolvedValue(null);
    await expect(confirmCash({userId: "admin1", ticketId: "t1"}))
      .rejects.toThrow("Pending cash payment not found");
  });
});

describe("cancelPendingPayments", () => {
  it("cancels only pending charges and clears their guard", async () => {
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      payment({id: "p1", status: "PENDING", method: "SEPAY"}),
      payment({id: "p2", status: "CONFIRMED"}),
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue(
      payment({id: "p1", status: "CANCELLED"}) as never);
    await cancelPendingPayments("t1");
    expect(paymentRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "p1",
      "CANCELLED",
    );
    expect(paymentRepository.clearGuard).toHaveBeenCalledWith("t1", "p1");
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      {checkoutUrl: null, qrUrl: null},
    );
  });
});

describe("auditLedger", () => {
  it("reports ticket stamp drift without writing", async () => {
    jest.mocked(paymentRepository.findAll).mockResolvedValue([
      payment({id: "p2", status: "CONFIRMED",
        createdAt: "2026-10-02T00:00:00.000Z"}),
      payment({id: "p1", status: "PENDING",
        createdAt: "2026-10-01T00:00:00.000Z"}),
    ] as never);
    jest.mocked(dispatchRepository.findById).mockImplementation(
      async (id) => (id === "t1" ?
        ({paymentStatus: "PENDING"} as never) :
        null));
    const result = await auditLedger({});
    expect(result.scanned).toBe(2);
    expect(result.tickets).toBe(1);
    expect(result.drift).toEqual([{
      ticketId: "t1",
      paymentId: "p2",
      expected: "CONFIRMED",
      actual: "PENDING",
    }]);
  });
});

describe("subscription payments", () => {
  it("routes a planId request to the subscription service", async () => {
    jest.mocked(subscriptionService.createSubscriptionPayment)
      .mockResolvedValue({
        ...payment({purpose: "SUBSCRIPTION"}),
        checkout: {qrUrl: "https://bridge/checkout/pay1"},
        reused: false,
      } as never);
    await createPaymentForTicket({
      userId: "u1",
      planId: "MONTHLY",
      method: "SEPAY",
    });
    expect(subscriptionService.createSubscriptionPayment).toHaveBeenCalledWith({
      userId: "u1",
      planId: "MONTHLY",
      method: "SEPAY",
    });
    expect(dispatchRepository.findById).not.toHaveBeenCalled();
  });

  it("activates a subscription from a paid SePay IPN", async () => {
    const pending = payment({
      id: "sub1",
      ticketId: "SUB-u1-MONTHLY",
      method: "SEPAY",
      status: "PENDING",
      amount: 200000,
      qrRef: "RASUB1",
      purpose: "SUBSCRIPTION",
      subscriptionUid: "u1",
      subscriptionPlanId: "MONTHLY",
    });
    const held = {
      ...pending,
      status: "HELD",
      ipnRef: "tx1",
    };
    jest.mocked(paymentRepository.findByQrRef).mockResolvedValue(pending);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue(held);
    await handleSepayIpn({
      order: {
        order_invoice_number: "RASUB1",
        order_amount: "200000",
      },
      transaction: {
        transaction_amount: "200000",
        transaction_id: "tx1",
      },
    });
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "sub1",
      "HELD",
      {ipnRef: "tx1"},
    );
    expect(subscriptionService.activateFromPayment)
      .toHaveBeenCalledWith(held);
  });

  it("keeps subscription charges out of the ticket ledger audit", async () => {
    jest.mocked(paymentRepository.findAll).mockResolvedValue([
      payment({id: "sub1", ticketId: "SUB-u1-MONTHLY",
        purpose: "SUBSCRIPTION"}),
      payment({
        id: "p1",
        ticketId: "t1",
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
    ] as never);
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      {paymentStatus: "HELD"} as never);
    const result = await auditLedger({});
    expect(result.scanned).toBe(1);
    expect(result.tickets).toBe(1);
  });
});

describe("payment method switching", () => {
  const ticket = {
    id: "t1",
    userId: "rider1",
    ticketType: "WALK_IN",
    status: "6",
    shopQuotedAmount: 100000,
    assignedUid: "payee1",
  };

  it("switches pending SePay to cash", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "SEPAY", status: "PENDING", qrRef: "QR1"}),
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue(
      payment({method: "SEPAY", status: "CANCELLED", qrRef: "QR1"}) as never);
    jest.mocked(paymentRepository.createGuarded).mockResolvedValue({
      payment: payment({method: "CASH", status: "PENDING"}),
      reused: false,
    } as never);
    const result = await createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    });
    expect(sepayService.cancelOrder).toHaveBeenCalledWith("QR1");
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "pay1",
      "CANCELLED",
    );
    expect(paymentRepository.clearGuard).toHaveBeenCalledWith("t1", "pay1");
    expect(paymentRepository.createGuarded).toHaveBeenCalledWith(
      expect.objectContaining({method: "CASH"}),
    );
    expect(result.method).toBe("CASH");
  });

  it("does not switch when SePay is already captured", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "SEPAY", status: "PENDING", qrRef: "QR1"}),
    ] as never);
    jest.mocked(sepayService.cancelOrder).mockResolvedValue({
      ok: false,
      missing: false,
      message: "order already captured",
    });
    await expect(createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    })).rejects.toThrow("order already captured");
    expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
    expect(paymentRepository.createGuarded).not.toHaveBeenCalled();
  });

  it("does not switch a held charge", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "SEPAY", status: "HELD", qrRef: "QR1"}),
    ] as never);
    await expect(createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "CASH",
    })).rejects.toThrow("refund required");
    expect(sepayService.cancelOrder).not.toHaveBeenCalled();
    expect(paymentRepository.createGuarded).not.toHaveBeenCalled();
  });

  it("switches a pending cash charge to SePay", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "CASH", status: "PENDING"}),
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue(
      payment({method: "CASH", status: "CANCELLED"}) as never);
    jest.mocked(paymentRepository.createGuarded).mockResolvedValue({
      payment: payment({method: "SEPAY", status: "PENDING"}),
      reused: false,
    } as never);
    await expect(createPaymentForTicket({
      userId: "rider1",
      ticketId: "t1",
      method: "SEPAY",
    })).resolves.toMatchObject({method: "SEPAY", status: "PENDING"});
    expect(sepayService.cancelOrder).not.toHaveBeenCalled();
    expect(paymentRepository.createGuarded).toHaveBeenCalled();
  });
});

describe("cancelPendingPayment", () => {
  const ticket = {
    id: "t1",
    userId: "rider1",
    ticketType: "WALK_IN",
    status: "6",
    shopQuotedAmount: 100000,
  };

  it("cancels a pending SePay charge and clears its guard", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "SEPAY", status: "PENDING", qrRef: "QR1"}),
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue(
      payment({method: "SEPAY", status: "CANCELLED"}) as never);
    await expect(cancelPendingPayment({userId: "rider1", ticketId: "t1"}))
      .resolves.toEqual({cancelled: true, method: "SEPAY"});
    expect(sepayService.cancelOrder).toHaveBeenCalledWith("QR1");
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "pay1",
      "CANCELLED",
    );
    expect(paymentRepository.clearGuard).toHaveBeenCalledWith("t1", "pay1");
  });

  it("cancels a pending cash charge without calling SePay", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "CASH", status: "PENDING"}),
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue(
      payment({method: "CASH", status: "CANCELLED"}) as never);
    await expect(cancelPendingPayment({userId: "rider1", ticketId: "t1"}))
      .resolves.toEqual({cancelled: true, method: "CASH"});
    expect(sepayService.cancelOrder).not.toHaveBeenCalled();
  });

  it("returns false when there is no active charge", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({status: "CANCELLED"}),
    ] as never);
    await expect(cancelPendingPayment({userId: "rider1", ticketId: "t1"}))
      .resolves.toEqual({cancelled: false, method: null});
  });

  it("refuses to cancel a held charge", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([
      payment({method: "SEPAY", status: "HELD"}),
    ] as never);
    await expect(cancelPendingPayment({userId: "rider1", ticketId: "t1"}))
      .rejects.toThrow("refund required");
    expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses another rider", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
    await expect(cancelPendingPayment({userId: "other", ticketId: "t1"}))
      .rejects.toMatchObject({statusCode: 403});
  });
});
