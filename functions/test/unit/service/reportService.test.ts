import * as paymentRepository from "../../../repository/paymentRepository";
import * as payoutRepository from "../../../repository/payoutRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  payeesCsv,
  payeesReport,
  revenueCsv,
  revenueReport,
} from "../../../service/reportService";
import {ValidationError} from "../../../utils/errors";

jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/payoutRepository");
jest.mock("../../../repository/userRepository");

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "p1",
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
  createdAt: "2026-10-02T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  ...patch,
} as paymentRepository.Payment);

const payments = () => [
  payment({}),
  payment({
    id: "p2",
    payeeId: "payee2",
    amount: 50000,
    method: "SEPAY",
    status: "PARTIAL",
    commissionAmount: 5000,
    payoutAmount: 45000,
    refundAmount: 20000,
    payoutAt: "2026-10-05T10:00:00.000Z",
    payoutBatchId: "b1",
    createdAt: "2026-10-03T10:00:00.000Z",
  }),
  payment({
    id: "p3",
    amount: 30000,
    status: "PENDING",
    createdAt: "2026-10-04T10:00:00.000Z",
  }),
];

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(paymentRepository.findBetween).mockResolvedValue(payments());
});

describe("revenue report", () => {
  it("sums paid charges, refunds, and refund-adjusted commission", async () => {
    const report = await revenueReport({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(report.from).toBe("2026-10-01T00:00:00.000Z");
    expect(report.to).toBe("2026-10-31T23:59:59.999Z");
    expect(report.gross).toBe(150000);
    expect(report.refunds).toBe(20000);
    expect(report.commission).toBe(13000);
    expect(report.net).toBe(117000);
    expect(report.count).toBe(2);
    expect(report.byMethod.CASH).toMatchObject({
      gross: 100000,
      commission: 10000,
      net: 90000,
      count: 1,
    });
    expect(report.byMethod.SEPAY).toMatchObject({
      gross: 50000,
      refunds: 20000,
      commission: 3000,
      net: 27000,
    });
    expect(report.byDay.map((day) => day.date)).toEqual([
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("emits a day-level CSV with totals", async () => {
    const report = await revenueReport({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const lines = revenueCsv(report).split("\n");
    expect(lines[0]).toBe("date,gross,refunds,commission,net,count");
    expect(lines[1]).toBe("2026-10-02,100000,0,10000,90000,1");
    expect(lines[2]).toBe("2026-10-03,50000,20000,3000,27000,1");
    expect(lines[3]).toBe("TOTAL,150000,20000,13000,117000,2");
  });

  it("rejects an inverted range", async () => {
    await expect(revenueReport({
      from: "2026-10-31",
      to: "2026-10-01",
    })).rejects.toThrow(ValidationError);
  });
});

describe("payee report", () => {
  it("splits earned, paid, and pending payout totals", async () => {
    jest.mocked(payoutRepository.findBetween).mockResolvedValue([
      {
        id: "b1",
        payeeId: "payee2",
        payeeName: "Shop, Two",
        net: 45000,
        createdAt: "2026-10-05T10:00:00.000Z",
      } as payoutRepository.Payout,
    ]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
      ["payee1", {id: "payee1", role: "2", displayName: "Volunteer One"}],
    ]));
    const report = await payeesReport({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({
      payeeId: "payee1",
      payeeName: "Volunteer One",
      gross: 100000,
      commission: 10000,
      net: 90000,
      pending: 90000,
      paid: 0,
    });
    expect(report.rows[1]).toMatchObject({
      payeeId: "payee2",
      payeeName: "Shop, Two",
      gross: 50000,
      refunds: 20000,
      commission: 3000,
      net: 27000,
      pending: 0,
      paid: 45000,
      count: 1,
    });
    const lines = payeesCsv(report).split("\n");
    expect(lines[0]).toBe(
      "payeeId,payeeName,gross,refunds,commission,net,paid,pending,count",
    );
    expect(lines[2]).toBe(
      "payee2,\"Shop, Two\",50000,20000,3000,27000,45000,0,1",
    );
  });
});
