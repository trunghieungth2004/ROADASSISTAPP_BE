import * as ratingRepository from
  "../../../repository/ratingRepository";
import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as shopRepository from "../../../repository/shopRepository";
import * as userRepository from "../../../repository/userRepository";
import * as cacheManager from "../../../utils/cacheManager";
import {submitRating} from "../../../service/ratingService";

jest.mock("../../../repository/ratingRepository");
jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/shopRepository");
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
    });
    expect(ratingRepository.updateScore).toHaveBeenCalledWith(
      "rate1",
      3,
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
    expect(shopRepository.updateRating).toHaveBeenCalledWith(
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
    jest.mocked(shopRepository.findById).mockResolvedValue({
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
