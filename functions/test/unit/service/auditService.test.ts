import * as auditRepository from "../../../repository/auditRepository";
import * as userRepository from "../../../repository/userRepository";
import {list, record} from "../../../service/auditService";

jest.mock("../../../repository/auditRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(auditRepository.create).mockResolvedValue(undefined);
  jest.mocked(auditRepository.findAll).mockResolvedValue([]);
});

describe("auditService.record", () => {
  it("snapshots the actor and writes the audit fields", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin1",
      role: "1",
      displayName: "Admin One",
      email: "admin@example.com",
    } as never);
    await record({
      adminUid: "admin1",
      action: "REPORT_DECIDED",
      category: "CASE",
      targetType: "REPORT",
      targetId: "report1",
      targetLabel: "RIDER rider1",
      before: {status: "OPEN"},
      after: {status: "RESOLVED"},
      note: "Harassment upheld",
    });
    expect(auditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUid: "admin1",
        actorName: "Admin One",
        actorEmail: "admin@example.com",
        action: "REPORT_DECIDED",
        category: "CASE",
        targetType: "REPORT",
        targetId: "report1",
        targetLabel: "RIDER rider1",
        before: {status: "OPEN"},
        after: {status: "RESOLVED"},
        note: "Harassment upheld",
      }),
    );
  });

  it("retries failed audit writes", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin1",
      role: "1",
    } as never);
    jest.mocked(auditRepository.create)
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    await record({
      adminUid: "admin1",
      action: "USER_ROLE_CHANGED",
      targetType: "USER",
      targetId: "u1",
    });
    expect(auditRepository.create).toHaveBeenCalledTimes(2);
  });
});

describe("auditService.list", () => {
  it("rejects a non-admin caller", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    await expect(list({adminUid: "u1"})).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("passes pagination and date filters through", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin1",
      role: "1",
    } as never);
    await list({
      adminUid: "admin1",
      limit: 500,
      before: "2026-11-01T00:00:00.000Z",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-31T23:59:59.999Z",
    });
    expect(auditRepository.findAll).toHaveBeenCalledWith({
      limit: 200,
      before: "2026-11-01T00:00:00.000Z",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-31T23:59:59.999Z",
    });
  });
});
