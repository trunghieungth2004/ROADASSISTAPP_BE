import * as ratingRepository from
  "../../../repository/ratingRepository";
import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as cacheManager from "../../../utils/cacheManager";
import {
  submitRating,
  replyToRating,
  providerRatings,
  ratingsByTicket,
  userRatings,
} from "../../../service/ratingService";

jest.mock("../../../repository/ratingRepository");
jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(cacheManager, "del").mockImplementation(() => undefined);
});

const resolvedVolunteerTicket = {
  id: "t1",
  userId: "rider1",
  status: "4",
  assignedUid: "vol1",
  assignedShopId: null,
  destinationShopId: null,
};

describe("ratingService.submitRating", () => {
  it("rejects unknown target kinds with 400", async () => {
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "vol1",
        targetKind: "ALIEN",
        ticketId: "t1",
        score: 5,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects out-of-range scores with 400", async () => {
    for (const score of [0, 6]) {
      await expect(
        submitRating({
          byUserId: "rider1",
          targetId: "vol1",
          targetKind: "VOLUNTEER",
          ticketId: "t1",
          score,
        }),
      ).rejects.toMatchObject({statusCode: 400});
    }
  });

  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "vol1",
        targetKind: "VOLUNTEER",
        ticketId: "ghost",
        score: 5,
      }),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("rejects ratings on unresolved tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...resolvedVolunteerTicket,
      status: "2",
    } as never);
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "vol1",
        targetKind: "VOLUNTEER",
        ticketId: "t1",
        score: 5,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("records a rider to volunteer rating", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      resolvedVolunteerTicket as never,
    );
    jest.mocked(ratingRepository.findExisting).mockResolvedValue(null);
    jest.mocked(ratingRepository.create).mockResolvedValue({
      id: "rate1",
    } as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 5,
      count: 1,
    });
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "vol1",
        targetKind: "VOLUNTEER",
        ticketId: "t1",
        score: 5,
      }),
    ).resolves.toEqual({avg: 5, count: 1, updated: 1});
    expect(ratingRepository.create).toHaveBeenCalledWith({
      targetId: "vol1",
      targetKind: "VOLUNTEER",
      byUserId: "rider1",
      ticketId: "t1",
      score: 5,
    });
    expect(userRepository.updateRating).toHaveBeenCalledWith(
      "vol1",
      5,
      1,
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith("t1", {
      helperRating: 5,
    });
  });

  it("updates an existing rating instead of duplicating", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      resolvedVolunteerTicket as never,
    );
    jest.mocked(ratingRepository.findExisting).mockResolvedValue({
      id: "rate1",
    } as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 4,
      count: 2,
    });
    await submitRating({
      byUserId: "rider1",
      targetId: "vol1",
      targetKind: "VOLUNTEER",
      ticketId: "t1",
      score: 3,
      text: "Slow but solid",
    });
    expect(ratingRepository.updateScore).toHaveBeenCalledWith(
      "rate1",
      3,
      "Slow but solid",
    );
    expect(ratingRepository.create).not.toHaveBeenCalled();
  });

  it("rejects helpers not on the ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      resolvedVolunteerTicket as never,
    );
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "stranger",
        targetKind: "VOLUNTEER",
        ticketId: "t1",
        score: 5,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("records a rider to destination shop rating", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...resolvedVolunteerTicket,
      destinationShopId: "shop9",
      fulfilledByShopId: "shop9",
    } as never);
    jest.mocked(ratingRepository.findExisting).mockResolvedValue(null);
    jest.mocked(ratingRepository.create).mockResolvedValue({
      id: "rate2",
    } as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 4.5,
      count: 2,
    });
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "shop9",
        targetKind: "SHOP",
        ticketId: "t1",
        score: 4,
      }),
    ).resolves.toEqual({avg: 4.5, count: 2, updated: 1});
    expect(providerRepository.updateRating).toHaveBeenCalledWith(
      "shop9",
      4.5,
      2,
    );
  });

  it("records a volunteer to rider rating", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      resolvedVolunteerTicket as never,
    );
    jest.mocked(ratingRepository.findExisting).mockResolvedValue(null);
    jest.mocked(ratingRepository.create).mockResolvedValue({
      id: "rate3",
    } as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 3,
      count: 1,
    });
    await expect(
      submitRating({
        byUserId: "vol1",
        targetId: "rider1",
        targetKind: "RIDER",
        ticketId: "t1",
        score: 3,
      }),
    ).resolves.toEqual({avg: 3, count: 1, updated: 1});
    expect(userRepository.updateRating).toHaveBeenCalledWith(
      "rider1",
      3,
      1,
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith("t1", {
      riderRating: 3,
    });
  });

  it("lets a shop operator rate the rider", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t2",
      userId: "rider1",
      status: "4",
      assignedUid: null,
      assignedShopId: "shop1",
      destinationShopId: null,
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      operatorUid: "op1",
    } as never);
    jest.mocked(ratingRepository.findExisting).mockResolvedValue(null);
    jest.mocked(ratingRepository.create).mockResolvedValue({
      id: "rate4",
    } as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 5,
      count: 1,
    });
    await expect(
      submitRating({
        byUserId: "op1",
        targetId: "rider1",
        targetKind: "RIDER",
        ticketId: "t2",
        score: 5,
      }),
    ).resolves.toEqual({avg: 5, count: 1, updated: 1});
  });

  it("rejects strangers rating the rider", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      resolvedVolunteerTicket as never,
    );
    await expect(
      submitRating({
        byUserId: "stranger",
        targetId: "rider1",
        targetKind: "RIDER",
        ticketId: "t1",
        score: 1,
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });
});

describe("ratingService fulfilment gate", () => {
  it("rejects rating a home-destination shop", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "4",
      assignedUid: "vol1",
      destinationShopId: "shop9",
      fulfilledByShopId: null,
    } as never);
    await expect(
      submitRating({
        byUserId: "rider1",
        targetId: "shop9",
        targetKind: "SHOP",
        ticketId: "t1",
        score: 5,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
});

describe("ratingService.replyToRating", () => {
  it("lets the shop operator reply", async () => {
    jest.mocked(ratingRepository.findById).mockResolvedValue({
      id: "r1",
      targetId: "shop9",
      targetKind: "SHOP",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
    } as never);
    await expect(
      replyToRating({userId: "op1", ratingId: "r1", reply: "Thanks!"}),
    ).resolves.toEqual({replied: true});
    expect(ratingRepository.updateReply).toHaveBeenCalledWith(
      "r1",
      "Thanks!",
      "op1",
    );
  });
  it("rejects replies from strangers", async () => {
    jest.mocked(ratingRepository.findById).mockResolvedValue({
      id: "r1",
      targetId: "shop9",
      targetKind: "SHOP",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
    } as never);
    await expect(
      replyToRating({userId: "stranger", ratingId: "r1", reply: "Hi"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("lets a rated user reply to their own rating", async () => {
    jest.mocked(ratingRepository.findById).mockResolvedValue({
      id: "r1",
      targetId: "vol1",
      targetKind: "VOLUNTEER",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      role: "2",
    } as never);
    await expect(
      replyToRating({userId: "vol1", ratingId: "r1", reply: "Noted"}),
    ).resolves.toEqual({replied: true});
  });
  it("throws 404 for an unknown rating", async () => {
    jest.mocked(ratingRepository.findById).mockResolvedValue(null);
    await expect(
      replyToRating({userId: "op1", ratingId: "ghost", reply: "Hi"}),
    ).rejects.toMatchObject({statusCode: 404});
  });
});

describe("ratingService.providerRatings", () => {
  it("returns the distribution with average and count", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
    } as never);
    jest.mocked(ratingRepository.listByTarget).mockResolvedValue([
      {id: "r1", score: 5, createdAt: "2026-01-01"},
      {id: "r2", score: 3, reply: "Sorry", repliedAt: "2026-01-02",
        createdAt: "2026-01-02"},
    ] as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 4,
      count: 2,
    });
    jest.mocked(dispatchRepository.countFulfilled).mockResolvedValue(7);
    await expect(providerRatings("shop9")).resolves.toEqual({
      ratings: [
        {id: "r1", score: 5, text: null, byUserName: null,
          reply: null, repliedAt: null, createdAt: "2026-01-01"},
        {id: "r2", score: 3, text: null, byUserName: null,
          reply: "Sorry", repliedAt: "2026-01-02",
          createdAt: "2026-01-02"},
      ],
      avg: 4,
      count: 2,
      completedJobs: 7,
    });
  });
  it("throws 404 for an unknown provider", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(null);
    await expect(providerRatings("ghost")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("ratingService.ratingsByTicket", () => {
  it("returns ratings for the rider", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(ratingRepository.listByTicket).mockResolvedValue([
      {id: "r1", targetId: "vol1", targetKind: "VOLUNTEER", score: 5,
        createdAt: "2026-01-01"},
    ] as never);
    await expect(
      ratingsByTicket({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual([
      {id: "r1", targetId: "vol1", targetKind: "VOLUNTEER", score: 5,
        text: null, byUserName: null, repliedByName: null, reply: null,
        repliedAt: null, createdAt: "2026-01-01"},
    ]);
  });

  it("returns ratings for the shop operator", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      operatorUid: "op1",
    } as never);
    jest.mocked(ratingRepository.listByTicket).mockResolvedValue([
      {id: "r1", byUserId: "rider1", score: 5, createdAt: "2026-01-01"},
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        ["rider1", {id: "rider1", displayName: "Rider One", role: "2"}],
      ]),
    );
    await expect(
      ratingsByTicket({userId: "op1", ticketId: "t1"}),
    ).resolves.toEqual([
      {
        id: "r1",
        targetId: undefined,
        targetKind: undefined,
        byUserId: "rider1",
        byUserName: "Rider One",
        score: 5,
        text: null,
        reply: null,
        repliedByName: null,
        repliedAt: null,
        createdAt: "2026-01-01",
      },
    ]);
  });

  it("rejects strangers with 403", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      assignedUid: "vol1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      ratingsByTicket({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(ratingRepository.listByTicket).not.toHaveBeenCalled();
  });

  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(
      ratingsByTicket({userId: "rider1", ticketId: "ghost"}),
    ).rejects.toMatchObject({statusCode: 404});
  });
});

describe("ratingService.userRatings", () => {
  const ticket = {
    id: "t1",
    userId: "rider1",
    assignedUid: "vol1",
  };
  it("returns a co-worker's ratings to a participant", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(ratingRepository.listByTarget).mockResolvedValue([
      {id: "r1", score: 5, ticketId: "t1", createdAt: "2026-01-01"},
    ] as never);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 5,
      count: 1,
    });
    await expect(
      userRatings({
        callerId: "rider1",
        userId: "vol1",
        targetKind: "VOLUNTEER",
        ticketId: "t1",
      }),
    ).resolves.toEqual({
      ratings: [
        {id: "r1", score: 5, text: null, byUserName: null, ticketId: "t1",
          reply: null, repliedAt: null, createdAt: "2026-01-01"},
      ],
      avg: 5,
      count: 1,
    });
  });
  it("rejects readers with no shared ticket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(
      userRatings({
        callerId: "stranger",
        userId: "vol1",
        targetKind: "VOLUNTEER",
        ticketId: "t1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("rejects shop targets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      userRatings({
        callerId: "rider1",
        userId: "shop9",
        targetKind: "SHOP",
        ticketId: "t1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("lets admins read without a ticket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "admin",
      role: "1",
    } as never);
    jest.mocked(ratingRepository.listByTarget).mockResolvedValue([]);
    jest.mocked(ratingRepository.aggregate).mockResolvedValue({
      avg: 0,
      count: 0,
    });
    await expect(
      userRatings({
        callerId: "admin",
        userId: "vol1",
        targetKind: "VOLUNTEER",
      }),
    ).resolves.toEqual({ratings: [], avg: 0, count: 0});
    expect(dispatchRepository.findById).not.toHaveBeenCalled();
  });
});
