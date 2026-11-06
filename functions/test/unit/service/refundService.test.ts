import * as paymentRepository from "../../../repository/paymentRepository";
import * as refundRepository from "../../../repository/refundRepository";
import * as userRepository from "../../../repository/userRepository";
import * as commissionRepository from
  "../../../repository/commissionRepository";
import * as paymentService from "../../../service/paymentService";
import * as platformConfigService from "../../../service/platformConfigService";
import {
  confirmRefund,
  decideRefund,
  failRefund,
  requestRefund,
} from "../../../service/refundService";

jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/refundRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/commissionRepository");
jest.mock("../../../service/paymentService");
jest.mock("../../../service/platformConfigService");

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "t1",
  riderUid: "rider1",
  payeeId: "shop1",
  amount: 100000,
  method: "SEPAY",
  status: "HELD",
  refundAmount: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...patch,
});

const refund = (patch: Record<string, unknown> = {}) => ({
  id: "rf1",
  paymentId: "pay1",
  ticketId: "t1",
  riderUid: "rider1",
  payeeId: "shop1",
  amount: 100000,
  originalAmount: 100000,
  status: "REQUESTED",
  reason: null,
  automatic: false,
  requestedBy: "rider1",
  requestedAt: "2026-10-01T00:00:00.000Z",
  bankCode: null,
  bankName: null,
  accountNumber: null,
  holderName: null,
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  sentAt: null,
  sentBy: null,
  transferRef: null,
  confirmedAt: null,
  confirmedBy: null,
  failureReason: null,
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(platformConfigService.getConfig).mockResolvedValue({
    refundPolicy: "FULL",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "rider1",
    role: "2",
    payoutAccount: {
      bankCode: "VCB",
      bankName: "Vietcombank",
      accountNumber: "0123456789",
      holderName: "NGUYEN VAN A",
    },
  } as never);
  jest.mocked(refundRepository.findOpenByPaymentId).mockResolvedValue(null);
});

describe("requestRefund", () => {
  it("creates a request with the rider bank snapshot", async () => {
    jest.mocked(paymentRepository.findById)
      .mockResolvedValue(payment() as never);
    jest.mocked(refundRepository.create).mockResolvedValue(refund() as never);
    const result = await requestRefund({
      paymentId: "pay1",
      requestedBy: "rider1",
      automatic: true,
      reason: "Unfixable",
    });
    expect(result.id).toBe("rf1");
    expect(refundRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "pay1",
        amount: 100000,
        automatic: true,
        bankCode: "VCB",
        accountNumber: "0123456789",
      }),
    );
  });

  it("returns the existing open request", async () => {
    jest.mocked(paymentRepository.findById)
      .mockResolvedValue(payment() as never);
    jest.mocked(refundRepository.findOpenByPaymentId)
      .mockResolvedValue(refund() as never);
    await expect(requestRefund({
      paymentId: "pay1",
      requestedBy: "rider1",
    })).resolves.toMatchObject({id: "rf1"});
    expect(refundRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a non-rider requester", async () => {
    jest.mocked(paymentRepository.findById)
      .mockResolvedValue(payment() as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "other",
      role: "2",
    } as never);
    await expect(requestRefund({
      paymentId: "pay1",
      requestedBy: "other",
    })).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects when refunds are disabled", async () => {
    jest.mocked(paymentRepository.findById)
      .mockResolvedValue(payment() as never);
    jest.mocked(platformConfigService.getConfig).mockResolvedValue({
      refundPolicy: "NONE",
    } as never);
    await expect(requestRefund({
      paymentId: "pay1",
      requestedBy: "rider1",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects an amount above the remaining balance", async () => {
    jest.mocked(paymentRepository.findById).mockResolvedValue(
      payment({refundAmount: 60000}) as never);
    await expect(requestRefund({
      paymentId: "pay1",
      requestedBy: "rider1",
      amount: 50000,
    })).rejects.toMatchObject({statusCode: 400});
  });
});

describe("decision flow", () => {
  it("approves a pending request", async () => {
    jest.mocked(refundRepository.findById)
      .mockResolvedValueOnce(refund() as never)
      .mockResolvedValueOnce(refund({status: "APPROVED"}) as never);
    const result = await decideRefund({
      adminUid: "admin1",
      refundId: "rf1",
      approve: true,
      note: "OK",
    });
    expect(result.status).toBe("APPROVED");
    expect(refundRepository.update).toHaveBeenCalledWith(
      "rf1",
      expect.objectContaining({status: "APPROVED", decidedBy: "admin1"}),
    );
  });

  it("rejects a pending request", async () => {
    jest.mocked(refundRepository.findById)
      .mockResolvedValueOnce(refund() as never)
      .mockResolvedValueOnce(refund({status: "REJECTED"}) as never);
    const result = await decideRefund({
      adminUid: "admin1",
      refundId: "rf1",
      approve: false,
    });
    expect(result.status).toBe("REJECTED");
  });
});

describe("confirmRefund", () => {
  it("refunds, reverses commission and closes the request", async () => {
    jest.mocked(refundRepository.findById)
      .mockResolvedValueOnce(refund({status: "SENT"}) as never)
      .mockResolvedValueOnce(refund({status: "CONFIRMED"}) as never);
    jest.mocked(paymentRepository.findById)
      .mockResolvedValue(payment() as never);
    jest.mocked(paymentService.refund).mockResolvedValue(
      payment({status: "REFUNDED", refundAmount: 100000}) as never);
    const result = await confirmRefund({
      adminUid: "admin1",
      refundId: "rf1",
      transferRef: "FT123",
    });
    expect(result.request.status).toBe("CONFIRMED");
    expect(paymentService.refund).toHaveBeenCalledWith({
      paymentId: "pay1",
      amount: 100000,
      by: "admin1",
    });
    expect(commissionRepository.reverseForRefund).toHaveBeenCalledWith({
      paymentId: "pay1",
      refundAmount: 100000,
      paymentAmount: 100000,
    });
  });

  it("refuses to confirm an undecided request", async () => {
    jest.mocked(refundRepository.findById).mockResolvedValue(refund() as never);
    await expect(confirmRefund({
      adminUid: "admin1",
      refundId: "rf1",
    })).rejects.toMatchObject({statusCode: 400});
  });
});

describe("failRefund", () => {
  it("marks a sent request failed", async () => {
    jest.mocked(refundRepository.findById)
      .mockResolvedValueOnce(refund({status: "SENT"}) as never)
      .mockResolvedValueOnce(refund({status: "FAILED"}) as never);
    const result = await failRefund({
      adminUid: "admin1",
      refundId: "rf1",
      reason: "Bank rejected",
    });
    expect(result.status).toBe("FAILED");
  });
});
