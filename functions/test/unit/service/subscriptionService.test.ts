import * as paymentRepository from "../../../repository/paymentRepository";
import * as platformConfigService from
  "../../../service/platformConfigService";
import * as sepayService from "../../../service/sepayService";
import {
  activateFromPayment,
  createSubscriptionPayment,
  listPlans,
  normalizeSubscription,
} from "../../../service/subscriptionService";

jest.mock("../../../repository/paymentRepository");
jest.mock("../../../service/platformConfigService");
jest.mock("../../../service/sepayService");

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "SUB-u1-MONTHLY",
  riderUid: "u1",
  payeeId: "PLATFORM",
  amount: 200000,
  currency: "VND",
  method: "SEPAY",
  status: "PENDING",
  qrRef: "RAU1M1",
  ipnRef: null,
  commissionRate: 0,
  commissionAmount: 0,
  payoutAmount: 0,
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
  purpose: "SUBSCRIPTION",
  subscriptionUid: "u1",
  subscriptionPlanId: "MONTHLY",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...patch,
} as paymentRepository.Payment);

const checkout = {
  action: "https://sepay",
  method: "POST",
  fields: {order_amount: "200000"},
  qrUrl: "https://bridge/checkout/pay1",
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(platformConfigService.getConfig).mockResolvedValue({
    refundPolicy: "FULL",
    paymentMethodsEnabled: ["CASH", "SEPAY"],
    commissionRate: {},
  } as never);
  jest.mocked(sepayService.buildCheckoutFields).mockReturnValue(checkout);
});

describe("subscriptionService.normalizeSubscription", () => {
  it("returns null for missing or malformed data", () => {
    expect(normalizeSubscription(null)).toBeNull();
    expect(normalizeSubscription({planId: "MONTHLY"})).toBeNull();
    expect(normalizeSubscription({expiresAt: "soon"})).toBeNull();
  });

  it("reports an active subscription", () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    expect(normalizeSubscription({
      planId: "MONTHLY",
      startedAt: "2026-11-01T00:00:00.000Z",
      expiresAt,
      lastPaymentId: "pay1",
    })).toMatchObject({
      planId: "MONTHLY",
      status: "ACTIVE",
      expiresAt,
      lastPaymentId: "pay1",
    });
  });

  it("reports an expired subscription", () => {
    const expiresAt = new Date(Date.now() - 86400000).toISOString();
    expect(normalizeSubscription({
      planId: "WEEKLY",
      expiresAt,
    })).toMatchObject({status: "EXPIRED"});
  });
});

describe("subscriptionService.listPlans", () => {
  it("returns the server-authoritative catalog", () => {
    expect(listPlans()).toEqual([
      {id: "WEEKLY", amount: 40000, days: 7},
      {id: "MONTHLY", amount: 200000, days: 30},
      {id: "YEARLY", amount: 1500000, days: 365},
    ]);
  });
});

describe("subscriptionService.createSubscriptionPayment", () => {
  it("creates a SePay charge from the plan amount", async () => {
    jest.mocked(paymentRepository.createGuarded).mockResolvedValue({
      payment: payment(),
      reused: false,
    });
    const result = await createSubscriptionPayment({
      userId: "u1",
      planId: "MONTHLY",
      method: "SEPAY",
    });
    expect(paymentRepository.createGuarded).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "SUB-u1-MONTHLY",
        amount: 200000,
        method: "SEPAY",
        purpose: "SUBSCRIPTION",
        subscriptionUid: "u1",
        subscriptionPlanId: "MONTHLY",
        commissionAmount: 0,
        payoutAmount: 0,
      }),
    );
    expect(result.checkout).toEqual(checkout);
    expect(result.reused).toBe(false);
  });

  it("rejects cash subscriptions", async () => {
    await expect(createSubscriptionPayment({
      userId: "u1",
      planId: "MONTHLY",
      method: "CASH",
    })).rejects.toMatchObject({message: "Subscriptions require SePay"});
  });

  it("rejects an unknown plan", async () => {
    await expect(createSubscriptionPayment({
      userId: "u1",
      planId: "LIFETIME",
      method: "SEPAY",
    })).rejects.toMatchObject({message: "Unknown subscription plan"});
  });

  it("rejects a disabled payment method", async () => {
    jest.mocked(platformConfigService.getConfig).mockResolvedValue({
      refundPolicy: "FULL",
      paymentMethodsEnabled: ["CASH"],
      commissionRate: {},
    } as never);
    await expect(createSubscriptionPayment({
      userId: "u1",
      planId: "MONTHLY",
      method: "SEPAY",
    })).rejects.toMatchObject({message: "Payment method is disabled"});
  });

  it("refreshes the checkout for a reused pending charge", async () => {
    jest.mocked(paymentRepository.createGuarded).mockResolvedValue({
      payment: payment(),
      reused: true,
    });
    const result = await createSubscriptionPayment({
      userId: "u1",
      planId: "MONTHLY",
      method: "SEPAY",
    });
    expect(result.reused).toBe(true);
    expect(result.checkout).toEqual(checkout);
  });

  it("does not reopen an already held charge", async () => {
    jest.mocked(paymentRepository.createGuarded).mockResolvedValue({
      payment: payment({status: "HELD"}),
      reused: true,
    });
    const result = await createSubscriptionPayment({
      userId: "u1",
      planId: "MONTHLY",
      method: "SEPAY",
    });
    expect(result.reused).toBe(true);
    expect(result.checkout).toBeUndefined();
  });
});

describe("subscriptionService.activateFromPayment", () => {
  it("ignores ticket payments", async () => {
    await expect(activateFromPayment(payment({purpose: "TICKET"})))
      .resolves.toBeNull();
  });
});
