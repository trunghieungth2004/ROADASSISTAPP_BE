import * as appealRepository from "../../../repository/appealRepository";
import * as ratingRepository from "../../../repository/ratingRepository";
import * as reportRepository from "../../../repository/reportRepository";
import * as userRepository from "../../../repository/userRepository";
import * as ratingService from "../../../service/ratingService";
import * as standingService from "../../../service/standing";
import {restoreProvider} from "../../../service/provider/admin";
import {sendUserPush} from "../../../service/push/user";
import {fileAppeal, decideAppeal} from "../../../service/appealService";

jest.mock("../../../repository/appealRepository");
jest.mock("../../../repository/ratingRepository");
jest.mock("../../../repository/reportRepository");
jest.mock("../../../repository/disputeRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/ratingService", () => ({
  receivedRatings: jest.fn(),
  recomputeTargetRating: jest.fn(async () => ({avg: 5, count: 1})),
}));
jest.mock("../../../service/standing", () => ({
  overturnReportAction: jest.fn(async () => ({score: 100})),
}));
jest.mock("../../../service/provider/admin", () => ({
  restoreProvider: jest.fn(async () => ({restored: true})),
}));
jest.mock("../../../service/userService", () => ({
  updateStatus: jest.fn(async () => ({updated: 1})),
}));
jest.mock("../../../service/dispute/appealOutcome", () => ({
  applyAppealOutcome: jest.fn(async () => null),
}));
jest.mock("../../../service/push/admin", () => ({
  deliverAdminPush: jest.fn(async () => undefined),
}));
jest.mock("../../../service/push/user", () => ({
  sendUserPush: jest.fn(async () => undefined),
}));

const rating = (patch: Record<string, unknown> = {}) => ({
  id: "rate1",
  targetId: "rider1",
  targetKind: "RIDER",
  byUserId: "op1",
  ticketId: "t1",
  score: 2,
  text: "Late",
  excluded: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...patch,
});

const appeal = (patch: Record<string, unknown> = {}) => ({
  id: "ap1",
  subjectKind: "RATING",
  subjectId: "rate1",
  ticketId: "t1",
  filedBy: "rider1",
  reason: "RETALIATORY",
  note: "Retaliatory",
  photoUrls: [],
  snapshot: {},
  status: "OPEN",
  resolution: null,
  decisionNote: null,
  adjustedAmount: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: "2026-11-02T00:00:00.000Z",
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ratingRepository.findById).mockResolvedValue(rating() as never);
  jest.mocked(appealRepository.findOpen).mockResolvedValue(null);
  jest.mocked(appealRepository.countBySubject).mockResolvedValue(0);
  jest.mocked(appealRepository.create).mockResolvedValue(appeal() as never);
  jest.mocked(appealRepository.findById).mockResolvedValue(appeal() as never);
  jest.mocked(appealRepository.decide).mockResolvedValue(appeal({
    status: "RESOLVED",
    resolution: "REMOVE",
  }) as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "admin1",
    role: "1",
  } as never);
});

describe("appealService.fileAppeal", () => {
  it("files a rating appeal for the rated rider", async () => {
    const result = await fileAppeal({
      userId: "rider1",
      subjectKind: "RATING",
      subjectId: "rate1",
      reason: "RETALIATORY",
      note: "Retaliatory",
    });
    expect(result.id).toBe("ap1");
    expect(appealRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "RATING",
        subjectId: "rate1",
        filedBy: "rider1",
      }),
    );
  });

  it("rejects an unknown subject reason", async () => {
    await expect(fileAppeal({
      userId: "rider1",
      subjectKind: "RATING",
      subjectId: "rate1",
      reason: "NEW_EVIDENCE",
      note: "Nope",
    })).rejects.toMatchObject({statusCode: 400});
  });
});

describe("appealService.decideAppeal", () => {
  it("removes an upheld rating appeal", async () => {
    await decideAppeal({
      adminUid: "admin1",
      appealId: "ap1",
      resolution: "REMOVE",
      note: "Retaliatory",
    });
    expect(ratingRepository.exclude).toHaveBeenCalled();
    expect(ratingService.recomputeTargetRating).toHaveBeenCalledWith(
      "rider1",
      "RIDER",
    );
    expect(sendUserPush).toHaveBeenCalled();
  });

  it("overturns a report appeal and restores the provider", async () => {
    jest.mocked(appealRepository.findById).mockResolvedValue(appeal({
      subjectKind: "REPORT",
      subjectId: "rep1",
    }) as never);
    jest.mocked(reportRepository.findById).mockResolvedValue({
      id: "rep1",
      targetKind: "PROVIDER",
      targetId: "shop1",
      targetUid: "op1",
      action: "SUSPEND",
      reportedBy: "rider1",
    } as never);
    await decideAppeal({
      adminUid: "admin1",
      appealId: "ap1",
      resolution: "OVERTURN",
      note: "Not supported",
    });
    expect(standingService.overturnReportAction).toHaveBeenCalled();
    expect(restoreProvider).toHaveBeenCalledWith({
      adminUid: "admin1",
      providerId: "shop1",
    });
  });
});
