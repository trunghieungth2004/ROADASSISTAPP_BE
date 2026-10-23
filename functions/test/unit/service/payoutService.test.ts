import * as paymentRepository from "../../../repository/paymentRepository";
import * as payoutRepository from "../../../repository/payoutRepository";
import * as userRepository from "../../../repository/userRepository";
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

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "t1",
  riderUid: "rider1",
  payeeId: "shop1",
  amount: 100000,
  currency: "VND",
  method: "CASH",
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
      new Map([["shop1", {id: "shop1", displayName: "Fix Shop"} as never]]));
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
    });
  });

  it("filters by payee and resolves the payee name", async () => {
    jest.mocked(paymentRepository.findByPayeeAll).mockResolvedValue([
      payment({id: "p1"}),
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["shop1", {id: "shop1", displayName: "Fix Shop"} as never]]));
    const groups = await pendingSettlements({payeeId: "shop1"});
    expect(paymentRepository.findByPayeeAll).toHaveBeenCalledWith("shop1");
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
    jest.mocked(paymentRepository.findByPayeeAll).mockResolvedValue([
      payment({id: "p1"}),
      payment({id: "p2", status: "HELD", ticketId: "t2"}),
    ] as never);
    jest.mocked(payoutRepository.create).mockResolvedValue(
      batch({id: "batch1", paymentIds: ["p1", "p2"]}));
    const result = await settleBatch({adminUid: "admin1", payeeId: "shop1"});
    expect(result.settled).toBe(2);
    expect(result.batch.id).toBe("batch1");
    expect(payoutRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({payeeId: "shop1", gross: 200000, net: 180000}));
    const call = jest.mocked(paymentRepository.update).mock.calls[0];
    expect(call[0]).toBe("p1");
    expect(call[1]).toMatchObject({
      payoutBy: "admin1",
      payoutBatchId: "batch1",
    });
    expect(call[1]?.payoutRef).toMatch(/^PO/);
    expect(jest.mocked(paymentRepository.update).mock.calls[1][0]).toBe("p2");
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
    jest.mocked(paymentRepository.findByPayeeAll).mockResolvedValue(
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
    jest.mocked(paymentRepository.findByPayeeAll).mockResolvedValue([
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
