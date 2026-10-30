import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";

import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";


import {
  getMyTickets,
  getDispatch,
  shopRequests,
  shopRecords,
  feedTickets,
} from "../../../../service/dispatchService";


jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/vehicleProfileRepository");
jest.mock("../../../../repository/providerLocationRepository", () => ({
  findByIds: jest.fn(async () => new Map()),
  findByGeohashPrefixes: jest.fn(async () => []),
}));
jest.mock("../../../../repository/fcmTokenRepository");
jest.mock("../../../../repository/paymentRepository");
jest.mock("../../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../../utils/valhalla"),
  postRoute: jest.fn(),
}));
jest.mock("../../../../service/taskQueueService");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
    id: "v1",
  } as never);
  delete process.env.FCM_ENABLED;
  jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
});


describe("dispatchService.getMyTickets", () => {
  it("returns the caller tickets newest-first", async () => {
    const tickets = [{id: "t2"}, {id: "t1"}];
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue(
      tickets as never,
    );
    await expect(getMyTickets("u1")).resolves.toBe(tickets);
    expect(dispatchRepository.findByUserId).toHaveBeenCalledWith("u1");
  });
});

describe("dispatchService.getDispatch", () => {
  it("throws 404 for an unknown ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(null);
    await expect(getDispatch("ghost", "u1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the ticket to its rider", async () => {
    const ticket = {id: "t1", userId: "u1"};
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(getDispatch("t1", "u1")).resolves.toEqual(ticket);
  });

  it("rejects unrelated users without a provider license", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(getDispatch("t1", "stranger")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("returns the ticket to notified candidates", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      candidates: ["shopop"],
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shopop",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(getDispatch("t1", "shopop")).resolves.toMatchObject({
      id: "t1",
    });
  });

  it("rejects non-candidates", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      candidates: [],
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
      services: ["RIDER"],
    } as never);
    await expect(getDispatch("t1", "stranger")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("attaches the tow plate on tow-assigned tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      plate: "30A12345",
      operatorUid: "op1",
    } as never);
    await expect(getDispatch("t1", "rider1")).resolves.toMatchObject({
      id: "t1",
      towPlate: "30A12345",
    });
  });

  it("returns the ticket to the destination shop operator", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "cshop",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "cshop",
    } as never);
    await expect(getDispatch("t1", "cshop")).resolves.toMatchObject({
      id: "t1",
    });
  });

  it("rejects shops outside the assignment and destination", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      destinationShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "other",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "cshop",
    } as never);
    await expect(getDispatch("t1", "other")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});


describe("dispatchService shop read models", () => {
  it("lists inbound walk-ins for the operator", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue(
      [{id: "t1"}] as never,
    );
    await expect(
      shopRequests({userId: "op1", shopId: "shop9"}),
    ).resolves.toEqual([{id: "t1"}]);
  });
  it("rejects shop reads from strangers", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      shopRequests({userId: "stranger", shopId: "shop9"}),
    ).rejects.toMatchObject({statusCode: 403});
    await expect(
      shopRecords({userId: "stranger", shopId: "shop9"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("lists recent engagements for the operator", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue(
      [{id: "t2"}] as never,
    );
    await expect(
      shopRecords({userId: "op1", shopId: "shop9", limit: 5}),
    ).resolves.toEqual([{id: "t2"}]);
    expect(dispatchRepository.findRecentForShop).toHaveBeenCalledWith(
      "shop9",
      5,
    );
  });
});


describe("dispatchService feedTickets", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      feedTickets({userId: "ghost"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("stamps own tickets out and provider tickets in", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "t1", userId: "op1", createdAt: "2026-01-02T00:00:00.000Z"},
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "shop9", kind: "SHOP", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([
      {id: "t2", userId: "rider1", createdAt: "2026-01-03T00:00:00.000Z"},
    ] as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        ["rider1", {id: "rider1", displayName: "Rider One", role: "2"}],
      ]),
    );
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      direction: string;
      otherParty: unknown;
    }>;
    expect(feed.map((t) => [t.id, t.direction])).toEqual([
      ["t2", "in"],
      ["t1", "out"],
    ]);
    expect(feed.find((t) => t.id === "t2")?.otherParty).toEqual({
      id: "rider1",
      name: "Rider One",
      kind: "RIDER",
    });
    expect(feed.find((t) => t.id === "t1")?.otherParty).toBeNull();
  });

  it("attaches a fresh tower fix on live tow rows only", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "live",
        userId: "rider1",
        ticketType: "TOW",
        status: "2",
        assignedShopId: "tow1",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "stale",
        userId: "rider1",
        ticketType: "TOW",
        status: "2",
        assignedShopId: "tow2",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "done",
        userId: "rider1",
        ticketType: "TOW",
        status: "4",
        assignedShopId: "tow1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "sos",
        userId: "rider1",
        ticketType: "SOS",
        status: "2",
        assignedUid: "vol1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([
        ["tow1", {
          providerId: "tow1",
          lat: 10.69,
          lng: 106.59,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: new Date().toISOString(),
        }],
        ["tow2", {
          providerId: "tow2",
          lat: 10.69,
          lng: 106.59,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: "2020-01-01T00:00:00.000Z",
        }],
      ]),
    );
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      towerFix: unknown;
    }>;
    expect(
      feed.find((t) => t.id === "live")?.towerFix,
    ).toMatchObject({lat: 10.69, lng: 106.59});
    expect(feed.find((t) => t.id === "stale")?.towerFix).toBeNull();
    expect(feed.find((t) => t.id === "done")?.towerFix).toBeNull();
    expect(feed.find((t) => t.id === "sos")?.towerFix).toBeNull();
    expect(providerLocationRepository.findByIds).toHaveBeenCalledWith(
      ["tow1", "tow2"],
    );
  });

  it("attaches a fresh mobile shop fix on live SOS rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "sos-live",
        userId: "rider1",
        ticketType: "SOS",
        status: "2",
        assignedShopId: "mobile1",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "sos-stale",
        userId: "rider1",
        ticketType: "SOS",
        status: "7",
        assignedShopId: "mobile2",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([
        ["mobile1", {
          providerId: "mobile1",
          lat: 10.68,
          lng: 106.58,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: new Date().toISOString(),
        }],
        ["mobile2", {
          providerId: "mobile2",
          lat: 10.68,
          lng: 106.58,
          geoHash: "w3gv",
          geoCell: "w3gv",
          lastSeen: "2020-01-01T00:00:00.000Z",
        }],
      ]),
    );
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      mobileShopFix: unknown;
    }>;
    expect(
      feed.find((t) => t.id === "sos-live")?.mobileShopFix,
    ).toMatchObject({lat: 10.68, lng: 106.58});
    expect(feed.find((t) => t.id === "sos-stale")?.mobileShopFix).toBeNull();
    expect(providerLocationRepository.findByIds).toHaveBeenCalledWith(
      ["mobile1", "mobile2"],
    );
  });

  it("preserves the mobile shop kind in feed parties", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "sos1",
        userId: "rider1",
        ticketType: "SOS",
        status: "2",
        assignedShopId: "mobile1",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      name: "Mobile One",
      kind: "MOBILE_SHOP",
      operatorUid: "op1",
      lat: 10.7,
      lng: 106.6,
      status: "ACTIVE",
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map(),
    );
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: {kind?: string} | null;
    }>;
    expect(feed.find((t) => t.id === "sos1")?.otherParty?.kind).toBe(
      "MOBILE_SHOP",
    );
  });

  it("names the assigned shop", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        assignedShopId: "shop9",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
      label: "12 Le Loi",
      openHours: null,
      ratingAvg: 4.5,
      ratingCount: 12,
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t1")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
      ratingAvg: 4.5,
      ratingCount: 12,
    });
  });

  it("names an assigned tower as a tower, not a shop", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        ticketType: "TOW",
        assignedShopId: "tow7",
        destinationShopId: "shop9",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockImplementation(
      async (id: string) => {
        if (id === "tow7") {
          return {
            id: "tow7",
            name: "Tow Seven",
            kind: "TOW",
            label: "Depot 7",
            openHours: null,
          } as never;
        }
        return {
          id: "shop9",
          name: "Fix Shop",
          kind: "SHOP",
          label: "12 Le Loi",
          openHours: null,
        } as never;
      },
    );
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
      destinationParty?: unknown;
    }>;
    expect(feed.find((t) => t.id === "t1")?.otherParty).toEqual({
      id: "tow7",
      name: "Tow Seven",
      kind: "TOW",
      label: "Depot 7",
    });
    expect(feed.find((t) => t.id === "t1")?.destinationParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
    });
  });

  it("leaves pending tow counterparty unassigned", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        ticketType: "TOW",
        status: "1",
        destinationShopId: "shop9",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
      openHours: null,
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
      destinationParty?: unknown;
    }>;
    expect(feed.find((t) => t.id === "t1")?.otherParty).toBeNull();
    expect(feed.find((t) => t.id === "t1")?.destinationParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
    });
  });

  it("attaches the full destination party on inbound rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow1", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([
      {
        id: "t8",
        userId: "rider1",
        ticketType: "TOW",
        status: "2",
        assignedShopId: "tow1",
        destinationShopId: "shop9",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockImplementation(
      (async (id: string) => {
        if (id === "shop9") {
          return {
            id: "shop9",
            name: "Fix Shop",
            kind: "SHOP",
            label: "12 Le Loi",
            openHours: null,
            ratingAvg: 5,
            ratingCount: 4,
          };
        }
        return null;
      }) as never,
    );
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
      ["rider1", {id: "rider1", displayName: "Rider One"}],
    ]) as never);
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      direction: string;
      otherParty: unknown;
      destinationParty?: unknown;
    }>;
    const row = feed.find((t) => t.id === "t8");
    expect(row?.direction).toBe("in");
    expect(row?.destinationParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      label: "12 Le Loi",
      ratingAvg: 5,
      ratingCount: 4,
    });
  });

  it("shares phones on live tickets only", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t6",
        userId: "rider1",
        assignedShopId: "shop9",
        status: "2",
        createdAt: "2026-01-06T00:00:00.000Z",
      },
      {
        id: "t7",
        userId: "rider1",
        assignedShopId: "shop9",
        status: "1",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["op1", {id: "op1", role: "2", phone: "+84111"}]]),
    );
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t6")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
      phone: "+84111",
    });
    expect(feed.find((t) => t.id === "t7")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
    });
  });

  it("shares the rider phone with the matched helper", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "vol1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {
        id: "t8",
        userId: "rider2",
        assignedUid: "vol1",
        status: "2",
        createdAt: "2026-01-06T00:00:00.000Z",
      },
      {
        id: "t9",
        userId: "rider3",
        assignedShopId: "shop9",
        status: "8",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([
        [
          "rider2",
          {
            id: "rider2",
            role: "2",
            displayName: "R2",
            phone: "+84222",
            ratingAvg: 4,
            ratingCount: 5,
          },
        ],
        [
          "rider3",
          {id: "rider3", role: "2", displayName: "R3", phone: "+84333"},
        ],
      ]),
    );
    const feed = await feedTickets({userId: "vol1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t8")?.otherParty).toEqual({
      id: "rider2",
      name: "R2",
      kind: "RIDER",
      phone: "+84222",
      ratingAvg: 4,
      ratingCount: 5,
    });
    expect(feed.find((t) => t.id === "t9")?.otherParty).toEqual({
      id: "rider3",
      name: "R3",
      kind: "RIDER",
    });
  });

  it("falls back to the addressed shop before assignment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {
        id: "t5",
        userId: "rider1",
        providerId: "shop9",
        status: "1",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      name: "Fix Shop",
    } as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "rider1"}) as Array<{
      id: string;
      otherParty: unknown;
    }>;
    expect(feed.find((t) => t.id === "t5")?.otherParty).toEqual({
      id: "shop9",
      name: "Fix Shop",
      kind: "SHOP",
    });
  });

  it("skips denied providers and dedupes assisted tickets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "shop9", kind: "SHOP", status: "DENIED"},
    ] as never);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {id: "t3", userId: "rider2", createdAt: "2026-01-04T00:00:00.000Z"},
      {id: "t3", userId: "rider2", createdAt: "2026-01-04T00:00:00.000Z"},
    ] as never);
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      direction: string;
    }>;
    expect(dispatchRepository.findPendingForShop).not.toHaveBeenCalled();
    expect(feed).toEqual([
      {
        id: "t3",
        userId: "rider2",
        createdAt: "2026-01-04T00:00:00.000Z",
        direction: "in",
        otherParty: null,
      },
    ]);
  });

  it("withholds rider photos from tow rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow9", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([
      {
        id: "t1",
        userId: "rider1",
        ticketType: "TOW",
        assignedShopId: "other-tow",
        assignedUid: "op1",
        photoUrls: ["dispatch/a/1.jpg"],
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "t1")?.photoUrls).toBeUndefined();
  });

  it("keeps rider photos for involved shops and rider rows", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([
      {id: "own", userId: "op1", photoUrls: ["dispatch/own/1.jpg"],
        createdAt: "2026-01-01T00:00:00.000Z"},
    ] as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "shop9", kind: "SHOP", status: "ACTIVE"},
    ] as never);
    jest.mocked(dispatchRepository.findPendingForShop).mockResolvedValue([
      {id: "t2", userId: "rider2", providerId: "shop9",
        photoUrls: ["dispatch/b/1.jpg"],
        createdAt: "2026-01-03T00:00:00.000Z"},
    ] as never);
    jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "own")?.photoUrls)
      .toEqual(["dispatch/own/1.jpg"]);
    expect(feed.find((t) => t.id === "t2")?.photoUrls)
      .toEqual(["dispatch/b/1.jpg"]);
  });

  it("strips rider photos from assisted rows without the role", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
    jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([
      {id: "t4", userId: "rider4", assignedUid: "op1",
        photoUrls: ["dispatch/d/1.jpg"],
        createdAt: "2026-01-05T00:00:00.000Z"},
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(new Map());
    const feed = await feedTickets({userId: "op1"}) as Array<{
      id: string;
      photoUrls?: string[];
    }>;
    expect(feed.find((t) => t.id === "t4")?.photoUrls).toBeUndefined();
  });
});
