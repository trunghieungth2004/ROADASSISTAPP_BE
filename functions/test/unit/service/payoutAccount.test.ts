import * as payoutRepository from "../../../repository/payoutRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as commissionRepository from
  "../../../repository/commissionRepository";
import {
  getAccount,
  requestPayout,
  setAccount,
} from "../../../service/payoutService";

jest.mock("../../../repository/payoutRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/commissionRepository");

const user = (patch: Record<string, unknown> = {}) => ({
  id: "u1",
  role: "2",
  displayName: "Nguyen Van A",
  ...patch,
});

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "t1",
  payeeId: "u1",
  amount: 100000,
  status: "CONFIRMED",
  commissionAmount: 10000,
  payoutAmount: 90000,
  refundAmount: null,
  payoutAt: null,
  payoutBatchId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  (commissionRepository.owedTotalByPayee as jest.Mock).mockResolvedValue(0);
  (payoutRepository.countPendingRequests as jest.Mock).mockResolvedValue(0);
});

describe("setAccount", () => {
  it("rejects an unknown bank", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(user());
    await expect(setAccount({
      userId: "u1",
      bankCode: "NOPE",
      accountNumber: "0123456789",
      holderName: "NGUYEN VAN A",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a non-digit account number", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(user());
    await expect(setAccount({
      userId: "u1",
      bankCode: "VCB",
      accountNumber: "12ab",
      holderName: "NGUYEN VAN A",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("normalizes the holder name and stores the account", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(user());
    const account = await setAccount({
      userId: "u1",
      bankCode: "vcb",
      accountNumber: "0123456789",
      holderName: "  nguyen   van a ",
    });
    expect(account.bankCode).toBe("VCB");
    expect(account.bankName).toBe("Vietcombank");
    expect(account.holderName).toBe("NGUYEN VAN A");
    expect(userRepository.updatePayoutAccount).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({bankCode: "VCB", accountNumber: "0123456789"}),
    );
  });
});

describe("getAccount", () => {
  it("returns null when unset", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(user());
    await expect(getAccount("u1")).resolves.toBeNull();
  });
});

describe("requestPayout", () => {
  const withAccount = () => user({
    payoutAccount: {
      bankCode: "VCB",
      bankName: "Vietcombank",
      accountNumber: "0123456789",
      holderName: "NGUYEN VAN A",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  });

  it("requires a payout account", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(user());
    (paymentRepository.findByPayeeStatuses as jest.Mock)
      .mockResolvedValue([payment()]);
    await expect(requestPayout({userId: "u1", amount: 50000}))
      .rejects.toMatchObject({statusCode: 400});
  });

  it("refuses an amount above the available balance", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(withAccount());
    (paymentRepository.findByPayeeStatuses as jest.Mock)
      .mockResolvedValue([payment()]);
    await expect(requestPayout({userId: "u1", amount: 200000}))
      .rejects.toMatchObject({statusCode: 400});
  });

  it("refuses while another request is pending", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(withAccount());
    (paymentRepository.findByPayeeStatuses as jest.Mock)
      .mockResolvedValue([payment()]);
    (payoutRepository.countPendingRequests as jest.Mock)
      .mockResolvedValue(1);
    await expect(requestPayout({userId: "u1", amount: 10000}))
      .rejects.toMatchObject({statusCode: 400});
  });

  it("files a request with a bank snapshot", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(withAccount());
    (paymentRepository.findByPayeeStatuses as jest.Mock)
      .mockResolvedValue([payment()]);
    (payoutRepository.createRequest as jest.Mock).mockImplementation(
      async (data: Record<string, unknown>) => ({id: "req1", ...data}),
    );
    const request = await requestPayout({userId: "u1", amount: 80000});
    expect(request.id).toBe("req1");
    expect(payoutRepository.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        payeeId: "u1",
        amount: 80000,
        bankCode: "VCB",
        accountNumber: "0123456789",
      }),
    );
  });

  it("deducts outstanding commission from the available balance", async () => {
    (userRepository.findById as jest.Mock).mockResolvedValue(withAccount());
    (paymentRepository.findByPayeeStatuses as jest.Mock)
      .mockResolvedValue([payment()]);
    (commissionRepository.owedTotalByPayee as jest.Mock)
      .mockResolvedValue(80000);
    await expect(requestPayout({userId: "u1", amount: 20000}))
      .rejects.toMatchObject({statusCode: 400});
  });
});
