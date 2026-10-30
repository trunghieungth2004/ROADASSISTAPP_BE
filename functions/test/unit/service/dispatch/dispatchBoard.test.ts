import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";

import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";


import {
  nearDispatch,
  dispatchOffers,
  selectDispatch,
  findTowOperators,
} from "../../../../service/dispatchService";


jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../repository/providerRepository");
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
  delete process.env.FCM_ENABLED;
  jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
});


describe("dispatchService.selectDispatch", () => {
  const ticket = {
    id: "t1",
    userId: "rider1",
    status: "1",
    ticketType: "MECHANIC",
  };

  it("rejects selection by strangers with 403", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    await expect(
      selectDispatch({
        userId: "stranger",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects selection on matched tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...ticket,
      status: "2",
    } as never);
    await expect(
      selectDispatch({
        userId: "rider1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects shops that stopped accepting", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      accepting: false,
    } as never);
    await expect(
      selectDispatch({
        userId: "rider1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("records the rider selection", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
    } as never);
    await expect(
      selectDispatch({
        userId: "rider1",
        ticketId: "t1",
        shopId: "shop1",
      }),
    ).resolves.toEqual({selected: "shop1"});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({suggestedShopId: "shop1"}),
    );
  });
});


describe("dispatchService.nearDispatch", () => {
  it("filters pending tow tickets by radius and sorts", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "near", lat: 10.7626, lng: 106.6602, ticketType: "TOW"},
      {id: "nearer", lat: 10.7627, lng: 106.6603, ticketType: "TOW"},
      {id: "far", lat: 11.7626, lng: 107.6602, ticketType: "TOW"},
    ] as never);
    const result = await nearDispatch({lat: 10.7626, lng: 106.6602});
    expect(result.map((t) => (t as {id: string}).id)).toEqual([
      "near",
      "nearer",
    ]);
  });

  it("hides pending tickets from users without a provider role", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "near", lat: 10.7626, lng: 106.6602, ticketType: "SOS"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue(
      [] as never,
    );
    const result = await nearDispatch({
      userId: "rider1",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(result).toEqual([]);
    expect(dispatchRepository.findByStatusForTypes).not.toHaveBeenCalled();
  });

  it("shows SOS tickets that match the mobile shop vehicle class", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "car", lat: 10.7626, lng: 106.6602, ticketType: "SOS",
        vehicleType: "CAR"},
      {id: "bike", lat: 10.7626, lng: 106.6602, ticketType: "SOS",
        vehicleType: "SCOOTER"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shopop",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {
        id: "mobile1",
        kind: "MOBILE_SHOP",
        status: "ACTIVE",
        accepting: true,
        vehicleClasses: ["SOLO_BIKE"],
      },
    ] as never);
    const result = await nearDispatch({
      userId: "shopop",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(result.map((t) => (t as {id: string}).id)).toEqual(["bike"]);
  });

  it("shows car tow tickets to operators without a capability", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "tow", lat: 10.7626, lng: 106.6602, ticketType: "TOW",
        vehicleType: "CAR"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE"},
    ] as never);
    const result = await nearDispatch({
      userId: "op1",
      lat: 10.7626,
      lng: 106.6602,
      ticketType: "TOW",
    });
    expect(result.map((t) => (t as {id: string}).id)).toEqual(["tow"]);
  });

  it("leaves rider identities off nearby tickets", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "a", lat: 10.7626, lng: 106.6602, ticketType: "TOW",
        userId: "rider1"},
      {id: "b", lat: 10.7626, lng: 106.6602, ticketType: "TOW",
        userId: "rider2"},
      {id: "c", lat: 10.7626, lng: 106.6602, ticketType: "TOW"},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "30A12345", kind: "TOW", status: "ACTIVE"},
    ] as never);
    jest.mocked(userRepository.findByIds).mockResolvedValue(
      new Map([["rider1", {
        id: "rider1",
        role: "2",
        displayName: "Rider One",
      }]]),
    );
    const result = await nearDispatch({
      userId: "op1",
      lat: 10.7626,
      lng: 106.6602,
      ticketType: "TOW",
    });
    const byId = new Map(
      result.map((t) => [(t as {id: string}).id, t]),
    );
    expect(
      (byId.get("a") as unknown as {riderName: unknown}).riderName,
    ).toBeUndefined();
    expect(
      (byId.get("b") as unknown as {riderName: unknown}).riderName,
    ).toBeUndefined();
    expect(
      (byId.get("c") as unknown as {riderName: unknown}).riderName,
    ).toBeUndefined();
  });

  it("strips tow photo paths from mobile shops", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "a", lat: 10.9, lng: 106.9, ticketType: "TOW",
        userId: "rider1", photoUrls: ["dispatch/a/1.jpg"]},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shopop",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {
        id: "mobile1",
        kind: "MOBILE_SHOP",
        status: "ACTIVE",
        accepting: true,
        vehicleClasses: ["SOLO_BIKE"],
      },
    ] as never);
    const result = await nearDispatch({
      userId: "shopop",
      lat: 10.9,
      lng: 106.9,
      ticketType: "TOW",
    });
    expect(result.map((t) => (t as {id: string}).id)).toEqual(["a"]);
    expect(
      (result[0] as unknown as {photoUrls?: unknown}).photoUrls,
    ).toBeUndefined();
  });

  it("keeps SOS photo paths for active mobile shops", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "sos", lat: 10.7626, lng: 106.6602, ticketType: "SOS",
        vehicleType: "SCOOTER", photoUrls: ["dispatch/sos/1.jpg"]},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "shopop",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {
        id: "mobile1",
        kind: "MOBILE_SHOP",
        status: "ACTIVE",
        accepting: true,
        vehicleClasses: ["SOLO_BIKE"],
      },
    ] as never);
    const result = await nearDispatch({
      userId: "shopop",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(
      (result[0] as unknown as {photoUrls?: unknown}).photoUrls,
    ).toEqual(["dispatch/sos/1.jpg"]);
  });

  it("hides SOS tickets from tow operators", async () => {
    jest.mocked(dispatchRepository.findByStatusForTypes).mockResolvedValue([
      {id: "sos", lat: 10.7626, lng: 106.6602, ticketType: "SOS",
        vehicleType: "CAR", photoUrls: ["dispatch/sos/1.jpg"]},
    ] as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "towop",
      services: ["RIDER"],
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      {id: "tow1", kind: "TOW", status: "ACTIVE"},
    ] as never);
    const result = await nearDispatch({
      userId: "towop",
      lat: 10.7626,
      lng: 106.6602,
    });
    expect(result).toEqual([]);
  });
});


describe("dispatchService.dispatchOffers", () => {
  it("lists accepting providers nearest first", async () => {
    jest.mocked(providerRepository.findByGeohashPrefixes).mockResolvedValue(
      [
        {id: "near", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: true},
        {id: "off", lat: 10.7626, lng: 106.6602, kind: "TOW",
          status: "ACTIVE", accepting: false},
      ] as never,
    );
    const result = await dispatchOffers({
      lat: 10.7626,
      lng: 106.6602,
      kind: "TOW",
    });
    expect(result.map((s) => (s as {id: string}).id)).toEqual(["near"]);
  });
});


describe("dispatchService.findTowOperators", () => {
  const tow = (overrides: Record<string, unknown>) => ({
    id: "tow1",
    kind: "TOW",
    status: "ACTIVE",
    accepting: true,
    plate: "51A12345",
    operatorUid: "towop",
    vehicleClasses: ["SOLO_BIKE", "CAR"],
    ...overrides,
  });
  const loc = (overrides: Record<string, unknown>) => ({
    providerId: "tow1",
    lat: 10.7626,
    lng: 106.6602,
    geoCell: "w3gv",
    lastSeen: new Date().toISOString(),
    ...overrides,
  });
  it("matches fresh accepting plated towers", async () => {
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([loc({})] as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      tow({}) as never,
    );
    await expect(
      findTowOperators({lat: 10.7626, lng: 106.6602}),
    ).resolves.toEqual(["towop"]);
  });
  it("filters stale, busy, plateless, and mismatched towers", async () => {
    jest.mocked(
      providerLocationRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      loc({providerId: "stale", lastSeen: "2020-01-01T00:00:00.000Z"}),
      loc({providerId: "busy"}),
      loc({providerId: "noplate"}),
      loc({providerId: "shop"}),
    ] as never);
    jest.mocked(providerRepository.findById).mockImplementation(
      (async (id: string) => {
        if (id === "stale") return tow({id, operatorUid: "a"}) as never;
        if (id === "busy") {
          return tow({id, accepting: false, operatorUid: "b"}) as never;
        }
        if (id === "noplate") {
          return tow({id, plate: "", operatorUid: "c"}) as never;
        }
        return {id, kind: "SHOP", status: "ACTIVE"} as never;
      }) as never,
    );
    await expect(
      findTowOperators({lat: 10.7626, lng: 106.6602}),
    ).resolves.toEqual([]);
  });
});
