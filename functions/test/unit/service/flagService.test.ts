import * as flagRepository from "../../../repository/flagRepository";
import * as userRepository from "../../../repository/userRepository";
import * as taskQueueService from "../../../service/taskQueueService";
import {
  createFlag,
  confirmFlag,
  getNear,
  getMine,
  moderateFlag,
  unflagFlag,
  expireFlags,
} from "../../../service/flagService";

jest.mock("../../../repository/flagRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/taskQueueService", () => ({
  enqueueHazardPush: jest.fn(async () => ({enqueued: false})),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("flagService.createFlag", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createFlag({userId: "ghost", type: "FLOOD", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it.each([
    ["ACCIDENT", 60 * 60 * 1000],
    ["FLOOD", 6 * 60 * 60 * 1000],
    ["OBSTRUCTION", 3 * 60 * 60 * 1000],
    ["UNKNOWN", 3 * 60 * 60 * 1000],
  ])("assigns the %s TTL", async (type, ttlMs) => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      trustScore: 10,
    } as never);
    jest.mocked(flagRepository.create).mockResolvedValue({id: "f1"} as never);
    await createFlag({userId: "u1", type, lat: 1, lng: 2});
    expect(flagRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ttlMs, trustScore: 10, reporterUid: "u1"}),
    );
  });

  it("passes radiusMeters through to the repository", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      trustScore: 10,
    } as never);
    jest.mocked(flagRepository.create).mockResolvedValue({id: "f1"} as never);
    await createFlag({userId: "u1", type: "FLOOD", lat: 1, lng: 2,
      radiusMeters: 500});
    expect(flagRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({radiusMeters: 500}),
    );
  });
});

describe("flagService.confirmFlag", () => {
  it("returns null for an unknown flag", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue(null);
    await expect(confirmFlag("ghost", "u9")).resolves.toBeNull();
    expect(flagRepository.castVote).not.toHaveBeenCalled();
  });

  it("throws 403 when the reporter confirms their own flag", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      status: "1",
      voteCount: 0,
      reporterUid: "u1",
    } as never);
    await expect(confirmFlag("f1", "u1")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(flagRepository.castVote).not.toHaveBeenCalled();
  });

  it("short-circuits locked flags", async () => {
    const flag = {id: "f1", status: "3", voteCount: 5, reporterUid: "u1"};
    jest.mocked(flagRepository.findById).mockResolvedValue(flag as never);
    await expect(confirmFlag("f1", "u2")).resolves.toMatchObject({
      id: "f1",
      alreadyVoted: false,
    });
    expect(flagRepository.castVote).not.toHaveBeenCalled();
  });

  it("flips to CONFIRMED at the threshold", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      status: "1",
      voteCount: 2,
      reporterTrust: 0,
      reporterUid: "u1",
    } as never);
    jest.mocked(flagRepository.castVote).mockResolvedValue({
      flag: {
        id: "f1",
        status: "1",
        voteCount: 3,
        reporterTrust: 0,
        reporterUid: "u1",
      },
      duplicate: false,
    } as never);
    await expect(confirmFlag("f1", "u2")).resolves.toMatchObject({
      voteCount: 3,
      status: "2",
      alreadyVoted: false,
    });
    expect(flagRepository.castVote).toHaveBeenCalledWith("f1", "u2", 1);
    expect(flagRepository.updateStatus).toHaveBeenCalledWith("f1", "2");
  });

  it("weights trusted reporters at 1.5", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      status: "1",
      voteCount: 1,
      reporterTrust: 60,
      reporterUid: "u1",
    } as never);
    jest.mocked(flagRepository.castVote).mockResolvedValue({
      flag: {
        id: "f1",
        status: "1",
        voteCount: 2.5,
        reporterTrust: 60,
        reporterUid: "u1",
      },
      duplicate: false,
    } as never);
    await expect(confirmFlag("f1", "u2")).resolves.toMatchObject({
      voteCount: 2.5,
      status: "1",
    });
    expect(flagRepository.castVote).toHaveBeenCalledWith("f1", "u2", 1.5);
    expect(flagRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("enqueues a push when consensus flips a blocking type", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      type: "FLOOD",
      status: "1",
      voteCount: 2,
      reporterTrust: 0,
      reporterUid: "u1",
    } as never);
    jest.mocked(flagRepository.castVote).mockResolvedValue({
      flag: {
        id: "f1",
        type: "FLOOD",
        status: "1",
        voteCount: 3,
        reporterTrust: 0,
        reporterUid: "u1",
      },
      duplicate: false,
    } as never);
    await confirmFlag("f1", "u2");
    expect(taskQueueService.enqueueHazardPush).toHaveBeenCalledWith(
      "f1",
      "FLOOD",
      "2",
    );
  });

  it("skips the queue below the threshold", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      type: "FLOOD",
      status: "1",
      voteCount: 1,
      reporterTrust: 0,
      reporterUid: "u1",
    } as never);
    jest.mocked(flagRepository.castVote).mockResolvedValue({
      flag: {
        id: "f1",
        type: "FLOOD",
        status: "1",
        voteCount: 2,
        reporterTrust: 0,
        reporterUid: "u1",
      },
      duplicate: false,
    } as never);
    await confirmFlag("f1", "u2");
    expect(taskQueueService.enqueueHazardPush).not.toHaveBeenCalled();
  });

  it("returns idempotent alreadyVoted on a repeat vote", async () => {
    const flag = {
      id: "f1",
      status: "1",
      voteCount: 1,
      reporterTrust: 0,
      reporterUid: "u1",
      voters: ["u2"],
    };
    jest.mocked(flagRepository.findById).mockResolvedValue(flag as never);
    jest.mocked(flagRepository.castVote).mockResolvedValue({
      flag,
      duplicate: true,
    } as never);
    await expect(confirmFlag("f1", "u2")).resolves.toMatchObject({
      alreadyVoted: true,
      voteCount: 1,
    });
    expect(flagRepository.updateStatus).not.toHaveBeenCalled();
    expect(taskQueueService.enqueueHazardPush).not.toHaveBeenCalled();
  });

  it("records a fresh vote on a confirmed flag", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      type: "FLOOD",
      status: "2",
      voteCount: 3,
      reporterTrust: 0,
      reporterUid: "u1",
    } as never);
    jest.mocked(flagRepository.castVote).mockResolvedValue({
      flag: {
        id: "f1",
        type: "FLOOD",
        status: "2",
        voteCount: 4,
        reporterTrust: 0,
        reporterUid: "u1",
      },
      duplicate: false,
    } as never);
    await expect(confirmFlag("f1", "u4")).resolves.toMatchObject({
      voteCount: 4,
      status: "2",
      alreadyVoted: false,
    });
    expect(flagRepository.updateStatus).not.toHaveBeenCalled();
    expect(taskQueueService.enqueueHazardPush).not.toHaveBeenCalled();
  });
});

describe("flagService.getNear", () => {
  it("excludes expired and rejected flags", async () => {
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      {id: "a", status: "1"},
      {id: "b", status: "4"},
      {id: "c", status: "5"},
      {id: "d", status: "2"},
    ] as never);
    const result = await getNear({lat: 10.7, lng: 106.6});
    expect(result.map((f) => (f as {id: string}).id).sort()).toEqual([
      "a",
      "d",
    ]);
  });
});

describe("flagService.getMine", () => {
  it("returns only the reporter's active flags", async () => {
    jest.mocked(flagRepository.findByReporterUid).mockResolvedValue([
      {id: "a", status: "1"},
      {id: "b", status: "2"},
      {id: "c", status: "4"},
      {id: "d", status: "5"},
    ] as never);
    const result = await getMine("u1");
    expect(flagRepository.findByReporterUid).toHaveBeenCalledWith("u1");
    expect(result.map((f) => (f as {id: string}).id).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("flagService.moderateFlag", () => {
  it("throws 404 for an unknown flag", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue(null);
    await expect(
      moderateFlag({flagId: "ghost", status: "3"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("writes the status", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
    } as never);
    jest.mocked(flagRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      moderateFlag({flagId: "f1", status: "3"}),
    ).resolves.toEqual({updated: 1});
  });

  it("enqueues a push on admin confirm", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      type: "OBSTRUCTION",
    } as never);
    jest.mocked(flagRepository.updateStatus).mockResolvedValue(undefined);
    await moderateFlag({flagId: "f1", status: "2"});
    expect(taskQueueService.enqueueHazardPush).toHaveBeenCalledWith(
      "f1",
      "OBSTRUCTION",
      "2",
    );
  });

  it("skips the queue on reject", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      type: "OBSTRUCTION",
    } as never);
    jest.mocked(flagRepository.updateStatus).mockResolvedValue(undefined);
    await moderateFlag({flagId: "f1", status: "5"});
    expect(taskQueueService.enqueueHazardPush).not.toHaveBeenCalled();
  });
});

describe("flagService.unflagFlag", () => {
  it("returns null for an unknown flag", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue(null);
    await expect(
      unflagFlag({flagId: "ghost", userId: "u1"}),
    ).resolves.toBeNull();
    expect(flagRepository.deleteById).not.toHaveBeenCalled();
  });

  it.each([["4"], ["5"]])(
    "returns null for status %s without deleting",
    async (status) => {
      jest.mocked(flagRepository.findById).mockResolvedValue({
        id: "f1",
        status,
        reporterUid: "u1",
      } as never);
      await expect(
        unflagFlag({flagId: "f1", userId: "u1"}),
      ).resolves.toBeNull();
      expect(flagRepository.deleteById).not.toHaveBeenCalled();
    },
  );

  it("throws 400 for a locked flag", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      status: "3",
      reporterUid: "u1",
    } as never);
    await expect(
      unflagFlag({flagId: "f1", userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(flagRepository.deleteById).not.toHaveBeenCalled();
  });

  it("throws 403 for a non-reporter", async () => {
    jest.mocked(flagRepository.findById).mockResolvedValue({
      id: "f1",
      status: "1",
      reporterUid: "u1",
    } as never);
    await expect(
      unflagFlag({flagId: "f1", userId: "u2"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(flagRepository.deleteById).not.toHaveBeenCalled();
  });

  it.each([["1"], ["2"]])(
    "deletes the reporter's own flag with status %s",
    async (status) => {
      jest.mocked(flagRepository.findById).mockResolvedValue({
        id: "f1",
        status,
        reporterUid: "u1",
      } as never);
      jest.mocked(flagRepository.deleteById).mockResolvedValue(undefined);
      await expect(
        unflagFlag({flagId: "f1", userId: "u1"}),
      ).resolves.toEqual({unflagged: 1});
      expect(flagRepository.deleteById).toHaveBeenCalledWith("f1");
    },
  );
});

describe("flagService.expireFlags", () => {
  it("expires every lapsed flag and returns the count", async () => {
    jest.mocked(flagRepository.findExpired).mockResolvedValue([
      {id: "f1"},
      {id: "f2"},
    ] as never);
    jest.mocked(flagRepository.updateStatus).mockResolvedValue(undefined);
    await expect(expireFlags()).resolves.toBe(2);
    expect(flagRepository.updateStatus).toHaveBeenCalledWith("f1", "4");
    expect(flagRepository.updateStatus).toHaveBeenCalledWith("f2", "4");
  });

  it("returns zero when nothing lapsed", async () => {
    jest.mocked(flagRepository.findExpired).mockResolvedValue([]);
    await expect(expireFlags()).resolves.toBe(0);
    expect(flagRepository.updateStatus).not.toHaveBeenCalled();
  });
});
