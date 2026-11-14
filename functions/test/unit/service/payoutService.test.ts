import * as paymentRepository from "../../../repository/paymentRepository";
import * as payoutRepository from "../../../repository/payoutRepository";
import * as userRepository from "../../../repository/userRepository";
import * as commissionRepository from
  "../../../repository/commissionRepository";
import {
  listBatches,
  myPayouts,
  pendingSettlements,
  settleBatch,
} from "../../../service/payoutService";
import {ValidationError} from "../../../utils/errors";

jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/payoutRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/commissionRepository");

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "t1",
  riderUid: "rider1",
  payeeId: "shop1",
  amount: 100000,
  currency: "VND",
  method: "SEPAY",
  status: "CONFIRMED",
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

const batch = (patch: Record<string, unknown> = {}) => ({
  id: "batch1",
  payeeId: "shop1",
  payeeName: "Fix Shop",
  gross: 150000,
  commission: 15000,
  refunded: 0,
  net: 135000,
  itemCount: 2,
  paymentIds: ["pay1", "pay2"],
  ticketIds: ["t1", "t2"],
  status: "PAID",
  payoutRef: "PO1",
  payoutMethod: "MANUAL",
  note: null,
  batchedUid: "admin1",
  batchedAt: "2026-10-05T00:00:00.000Z",
  createdAt: "2026-10-05T00:00:00.000Z",
  ...patch,
} as payoutRepository.Payout);

beforeEach(() => {
  jest.resetAllMocks();
  (commissionRepository.owedTotalByPayee as jest.Mock).mockResolvedValue(0);
  (commissionRepository.findAllOwed as jest.Mock).mockResolvedValue([]);
  (payoutRepository.newId as jest.Mock).mockReturnValue("batch1");
  (payoutRepository.applySettlement as jest.Mock).mockResolvedValue(
    batch({id: "batch1"}));
  (commissionRepository.planSettlement as jest.Mock).mockResolvedValue({
    updates: [],
    settled: 0,
  });
  (payoutRepository.countPendingRequests as jest.Mock).mockResolvedValue(0);
  (payoutRepository.findRequestsByPayee as jest.Mock).mockResolvedValue([]);
});

describe("pendingSettlements", () => {
  it("groups settleable payments per payee with derived net", async () => {
    jest.mocked(paymentRepository.findByReceived).mockResolvedValue([
      payment({id: "p1", payoutAmount: null, refundAmount: 20000}),
      payment({id: "p2", status: "HELD",
        createdAt: "2026-10-02T00:00:00.000Z"}),
      payment({id: "p3", status: "REFUNDED"}),
      payment({id: "p4", payoutAt: "2026-10-01T01:00:00.000Z"}),
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["shop1", {
        id: "shop1",
        displayName: "Fix Shop",
        payoutAccount: {
          bankCode: "VCB",
          bankName: "Vietcombank",
          accountNumber: "0123456789",
          holderName: "FIX SHOP",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      } as never]]));
    const groups = await pendingSettlements({});
    expect(paymentRepository.findByReceived).toHaveBeenCalled();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      payeeId: "shop1",
      payeeName: "Fix Shop",
      gross: 200000,
      commission: 20000,
      refunded: 20000,
      net: 160000,
      itemCount: 2,
      paymentIds: ["p2", "p1"],
      account: expect.objectContaining({
        bankName: "Vietcombank",
        accountNumber: "0123456789",
      }),
    });
  });

  it("keeps cash out of online payouts and lists commission-only payees", async () => {
    jest.mocked(paymentRepository.findByReceived).mockResolvedValue([
      payment({id: "cash1", method: "CASH", payeeId: "cashshop"}),
      payment({id: "sepay1", method: "SEPAY", payeeId: "shop1"}),
    ] as never);
    (commissionRepository.findAllOwed as jest.Mock).mockResolvedValue([
      {
        id: "ledger1",
        payeeId: "cashshop",
        amount: 30000,
        settledAmount: 0,
        reversedAmount: 0,
      },
    ]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
      ["shop1", {id: "shop1", displayName: "Fix Shop"}],
      ["cashshop", {id: "cashshop", displayName: "Cash Shop"}],
    ] as never));
    const groups = await pendingSettlements({});
    expect(groups).toHaveLength(2);
    const online = groups.find((group) => group.payeeId === "shop1");
    expect(online).toMatchObject({
      itemCount: 1,
      paymentIds: ["sepay1"],
      net: 90000,
    });
    const cash = groups.find((group) => group.payeeId === "cashshop");
    expect(cash).toMatchObject({
      itemCount: 0,
      gross: 0,
      net: 0,
      commissionOwed: 30000,
      available: 0,
    });
  });

  it("returns a commission-only payee with no online items", async () => {
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue(
      [] as never);
    (commissionRepository.owedTotalByPayee as jest.Mock)
      .mockResolvedValue(25000);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["shop1", {id: "shop1", displayName: "Fix Shop"} as never]]));
    const groups = await pendingSettlements({payeeId: "shop1"});
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      payeeId: "shop1",
      itemCount: 0,
      commissionOwed: 25000,
      available: 0,
    });
  });

  it("filters by payee and resolves the payee name", async () => {
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue([
      payment({id: "p1"}),
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["shop1", {id: "shop1", displayName: "Fix Shop"} as never]]));
    const groups = await pendingSettlements({payeeId: "shop1"});
    expect(paymentRepository.findByPayeeStatuses).toHaveBeenCalledWith(
      "shop1",
      expect.any(Array),
      expect.any(Number),
    );
    expect(paymentRepository.findByReceived).not.toHaveBeenCalled();
    expect(groups[0]).toMatchObject({payeeId: "shop1", net: 90000});
  });
});

describe("settleBatch", () => {
  it("settles every settleable payment and stamps the batch", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
      displayName: "Fix Shop",
    } as never);
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue([
      payment({id: "p1"}),
      payment({id: "p2", status: "HELD", ticketId: "t2"}),
    ] as never);
    const result = await settleBatch({adminUid: "admin1", payeeId: "shop1"});
    expect(result.settled).toBe(2);
    expect(result.batch.id).toBe("batch1");
    const apply = jest.mocked(payoutRepository.applySettlement);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch1",
        batch: expect.objectContaining({
          payeeId: "shop1",
          gross: 200000,
          net: 180000,
        }),
      }),
    );
    const stamps = apply.mock.calls[0][0].paymentStamps;
    expect(stamps.map((stamp) => stamp.id)).toEqual(["p1", "p2"]);
    expect(stamps[0].fields).toMatchObject({
      payoutBy: "admin1",
      payoutBatchId: "batch1",
    });
    expect(String(stamps[0].fields.payoutRef)).toMatch(/^PO/);
  });

  it("stores the payee account and payment proof", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
      displayName: "Fix Shop",
      payoutAccount: {
        bankCode: "VCB",
        bankName: "Vietcombank",
        accountNumber: "0123456789",
        holderName: "FIX SHOP",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    } as never);
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue([
      payment({id: "p1"}),
    ] as never);
    await settleBatch({
      adminUid: "admin1",
      payeeId: "shop1",
      proofUrl: "payouts/proof/p1.jpg",
    });
    expect(payoutRepository.applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        batch: expect.objectContaining({
          proofUrl: "payouts/proof/p1.jpg",
          payeeAccount: expect.objectContaining({
            bankName: "Vietcombank",
            accountNumber: "0123456789",
            holderName: "FIX SHOP",
          }),
        }),
      }),
    );
  });

  it("deducts outstanding cash commission from the batch", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
      displayName: "Fix Shop",
    } as never);
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue([
      payment({id: "p1"}),
    ] as never);
    (commissionRepository.owedTotalByPayee as jest.Mock)
      .mockResolvedValue(30000);
    (commissionRepository.planSettlement as jest.Mock).mockResolvedValue({
      updates: [{id: "ledger1", fields: {settledAmount: 30000}}],
      settled: 30000,
    });
    const result = await settleBatch({adminUid: "admin1", payeeId: "shop1"});
    expect(result.commissionDeducted).toBe(30000);
    expect(commissionRepository.planSettlement).toHaveBeenCalledWith(
      "shop1",
      30000,
      {batchId: "batch1", settledBy: "admin1"},
    );
    expect(payoutRepository.applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerStamps: [{id: "ledger1", fields: {settledAmount: 30000}}],
      }),
    );
  });

  it("rejects explicit payments from another payee", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
    } as never);
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({payeeId: "other"}) as never);
    await expect(settleBatch({
      adminUid: "admin1",
      payeeId: "shop1",
      paymentIds: ["pay1"],
    })).rejects.toThrow(ValidationError);
  });

  it("rejects cash payments as online payouts", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
    } as never);
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({method: "CASH"}) as never);
    await expect(settleBatch({
      adminUid: "admin1",
      payeeId: "shop1",
      paymentIds: ["pay1"],
    })).rejects.toThrow("Cash payments are not paid out");
    expect(payoutRepository.applySettlement).not.toHaveBeenCalled();
  });

  it("rejects payments that already settled", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
    } as never);
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({payoutAt: "2026-10-01T01:00:00.000Z"}) as never);
    await expect(settleBatch({
      adminUid: "admin1",
      payeeId: "shop1",
      paymentIds: ["pay1"],
    })).rejects.toThrow("not settleable");
  });

  it("rejects unknown payments and payees", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(settleBatch({
      adminUid: "admin1",
      payeeId: "ghost",
    })).rejects.toThrow("Payee not found");
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
    } as never);
    jest.mocked(paymentRepository.findById).mockResolvedValue(null);
    await expect(settleBatch({
      adminUid: "admin1",
      payeeId: "shop1",
      paymentIds: ["ghost"],
    })).rejects.toThrow("Payment not found");
  });

  it("rejects when the payee has nothing to settle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
    } as never);
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue(
      [] as never);
    await expect(settleBatch({adminUid: "admin1", payeeId: "shop1"}))
      .rejects.toThrow("No payments to settle");
  });
});

describe("myPayouts", () => {
  it("summarizes settled batches and outstanding candidates", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shop1",
    } as never);
    jest.mocked(payoutRepository.findByPayee).mockResolvedValue([
      batch({}),
    ] as never);
    jest.mocked(paymentRepository.findByPayeeStatuses).mockResolvedValue([
      payment({id: "p9", payoutAmount: 90000}),
    ] as never);
    const result = await myPayouts({userId: "shop1", limit: 5});
    expect(payoutRepository.findByPayee).toHaveBeenCalledWith("shop1", 5);
    expect(result.settled).toMatchObject({net: 135000, gross: 150000});
    expect(result.pending).toMatchObject({net: 90000, itemCount: 1});
  });
});

describe("listBatches", () => {
  it("routes between payee and all listings", async () => {
    jest.mocked(payoutRepository.findByPayee).mockResolvedValue([
      batch({}),
    ] as never);
    const mine = await listBatches({payeeId: "shop1", limit: 3});
    expect(payoutRepository.findByPayee).toHaveBeenCalledWith("shop1", 3);
    expect(mine).toHaveLength(1);
    jest.mocked(payoutRepository.findAll).mockResolvedValue([
      batch({}),
    ] as never);
    const all = await listBatches({});
    expect(payoutRepository.findAll).toHaveBeenCalled();
    expect(all).toHaveLength(1);
  });
});
