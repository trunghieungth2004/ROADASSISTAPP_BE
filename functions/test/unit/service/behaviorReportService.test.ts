import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as reportRepository from "../../../repository/reportRepository";
import * as userRepository from "../../../repository/userRepository";
import {fileReport} from "../../../service/behaviorReportService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/reportRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/push/admin", () => ({
  deliverAdminPush: jest.fn(async () => undefined),
}));
jest.mock("../../../service/standing", () => ({
  applyStanding: jest.fn(),
  clearRestriction: jest.fn(),
  flagConduct: jest.fn(),
  resetStanding: jest.fn(),
  standingOf: jest.fn(),
}));
jest.mock("../../../service/provider/admin", () => ({
  suspendProvider: jest.fn(),
}));
jest.mock("../../../service/userService", () => ({}));

const RIDER = "rider1";
const OPERATOR = "op1";
const SHOP = "shop1";

const provider = {id: SHOP, name: "Shop", operatorUid: OPERATOR};

const ticket = {
  id: "t1",
  userId: RIDER,
  ticketType: "TOW",
  status: "4",
  assignedShopId: SHOP,
  assignedUid: OPERATOR,
  providerId: null,
  destinationShopId: null,
  statusHistory: [],
  createdAt: "2026-11-01T00:00:00.000Z",
};

const report = (patch: Record<string, unknown> = {}) => ({
  id: "r1",
  targetKind: "PROVIDER",
  targetId: SHOP,
  targetUid: OPERATOR,
  reportedBy: RIDER,
  ticketId: "t1",
  reason: "LATE",
  note: null,
  photoUrls: [],
  status: "OPEN",
  action: "NONE",
  actionNote: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
  jest.mocked(providerRepository.findById).mockResolvedValue(provider as never);
  jest.mocked(providerRepository.findByIds).mockResolvedValue(
    new Map([[SHOP, provider]]) as never,
  );
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: RIDER,
    role: "2",
    status: "1",
    displayName: "Rider",
  } as never);
  jest.mocked(reportRepository.findOpenDuplicate).mockResolvedValue(null);
  jest.mocked(reportRepository.create).mockResolvedValue(report() as never);
});

describe("behaviorReportService.fileReport", () => {
  it("rejects no-show on a resolved ticket", async () => {
    await expect(fileReport({
      reportedBy: RIDER,
      targetKind: "PROVIDER",
      targetId: SHOP,
      ticketId: "t1",
      reason: "NO_SHOW",
    })).rejects.toMatchObject({statusCode: 400});
    expect(reportRepository.create).not.toHaveBeenCalled();
  });

  it("allows late on a resolved ticket", async () => {
    const result = await fileReport({
      reportedBy: RIDER,
      targetKind: "PROVIDER",
      targetId: SHOP,
      ticketId: "t1",
      reason: "LATE",
    });
    expect(result.reason).toBe("LATE");
    expect(reportRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "t1",
        reason: "LATE",
      }),
    );
  });

  it("rejects reports on a pending ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      status: "1",
    } as never);
    await expect(fileReport({
      reportedBy: RIDER,
      targetKind: "PROVIDER",
      targetId: SHOP,
      ticketId: "t1",
      reason: "LATE",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a provider that is not on the ticket", async () => {
    await expect(fileReport({
      reportedBy: RIDER,
      targetKind: "PROVIDER",
      targetId: "other-shop",
      ticketId: "t1",
      reason: "LATE",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects a reporter who is not a ticket participant", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
      status: "1",
      displayName: "Stranger",
    } as never);
    await expect(fileReport({
      reportedBy: "stranger",
      targetKind: "PROVIDER",
      targetId: SHOP,
      ticketId: "t1",
      reason: "LATE",
    })).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects ticket behavior reasons without a ticket", async () => {
    await expect(fileReport({
      reportedBy: RIDER,
      targetKind: "PROVIDER",
      targetId: SHOP,
      reason: "NO_SHOW",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("allows payment refusal after resolution", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: OPERATOR,
      role: "2",
      status: "1",
      displayName: "Operator",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: RIDER,
      name: "Rider",
      operatorUid: null,
    } as never);
    jest.mocked(userRepository.findById).mockImplementation(async (id) => ({
      id,
      role: "2",
      status: "1",
      displayName: id === RIDER ? "Rider" : "Operator",
    }) as never);
    jest.mocked(reportRepository.create).mockResolvedValue(
      report({
        targetKind: "RIDER",
        targetId: RIDER,
        reportedBy: OPERATOR,
        reason: "PAYMENT_REFUSED",
      }) as never,
    );
    const result = await fileReport({
      reportedBy: OPERATOR,
      targetKind: "RIDER",
      targetId: RIDER,
      ticketId: "t1",
      reason: "PAYMENT_REFUSED",
    });
    expect(result.reason).toBe("PAYMENT_REFUSED");
  });
});
