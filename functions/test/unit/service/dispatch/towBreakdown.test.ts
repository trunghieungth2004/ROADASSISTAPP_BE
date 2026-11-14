import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as userRepository from "../../../../repository/userRepository";
import {
  cancelTowerSearch,
  markTowLoaded,
} from "../../../../service/dispatchService";
import {
  DEFAULT_TOW_RATES,
  isNightFare,
  partialTowFare,
  stampTowFare,
} from "../../../../service/dispatch/fare";
import {postRoute} from "../../../../utils/valhalla";
import {findTowOperators} from "../../../../service/dispatch/candidates";
import {autoFile, bumpCancelCounters} from "../../../../service/disputeService";
import {stopWaiting} from "../../../../service/dispatch/waiting";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/providerLocationRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../service/dispatch/candidates", () => ({
  findTowOperators: jest.fn(async () => ["op2"]),
}));
jest.mock("../../../../service/disputeService", () => ({
  autoFile: jest.fn(async () => undefined),
  bumpCancelCounters: jest.fn(async () => undefined),
}));
jest.mock("../../../../service/platformConfigService", () => ({
  getTowRates: jest.fn(async () => ({
    SOLO_BIKE: {base: 100000, perKm: 10000, includedKm: 5},
    CAR: {base: 400000, perKm: 20000, includedKm: 10},
    nightMultiplier: 1.5,
    nightWindow: {start: 22, end: 6},
    ceilingMultiplier: 1.2,
    minimumFee: 300000,
    deadheadPayable: true,
  })),
}));
jest.mock("../../../../service/dispatch/waiting", () => ({
  accrue: jest.fn(async () => undefined),
  stopWaiting: jest.fn(async () => undefined),
}));
jest.mock("../../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));
jest.mock("../../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../../utils/valhalla"),
  postRoute: jest.fn(),
}));

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();

const tower = {
  id: "tow1",
  name: "Tow Co",
  kind: "TOW",
  operatorUid: "op1",
  status: "ACTIVE",
  accepting: true,
};

const towTicket = (patch: Record<string, unknown> = {}) => ({
  id: "tow1ticket",
  userId: "rider1",
  ticketType: "TOW",
  status: "3",
  assignedShopId: "tow1",
  assignedUid: "op1",
  assignedKind: "TOW",
  assignedAt: at(0),
  loadedAt: at(10),
  lat: 10.701,
  lng: 106.6,
  vehicleType: "CAR",
  destinationShopId: "shop1",
  towFare: {
    estimate: 500000,
    ceiling: 500000,
    final: null,
    partial: false,
    deadheadKm: 0,
    loadedKm: 0,
    night: false,
    vehicleClass: "CAR",
  },
  towLegs: [{actual: true, traveledKm: 2}],
  towDistanceMeters: 2000,
  jobTrack: [
    {lat: 10.7, lng: 106.6, at: at(1), shopId: "tow1"},
    {lat: 10.701, lng: 106.6, at: at(10), shopId: "tow1"},
    {lat: 10.704, lng: 106.6, at: at(20), shopId: "tow1"},
    {lat: 10.707, lng: 106.6, at: at(30), shopId: "tow1"},
  ],
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.update).mockResolvedValue(undefined);
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
  jest.mocked(providerRepository.findById).mockResolvedValue(tower as never);
  jest.mocked(providerRepository.update).mockResolvedValue(undefined);
  jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
    new Map([["tow1", {
      providerId: "tow1",
      lat: 10.7,
      lng: 106.6,
      lastSeen: new Date().toISOString(),
    }]]) as never,
  );
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
});

describe("markTowLoaded", () => {
  it("records the load time when the tower is at pickup", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket({loadedAt: null}) as never,
    );

    await expect(markTowLoaded({
      userId: "op1",
      ticketId: "tow1ticket",
    })).resolves.toEqual({loaded: true});

    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "tow1ticket",
      expect.objectContaining({loadedAt: expect.any(String)}),
    );
  });

  it("keeps the first load time on a repeat call", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket({loadedAt: "2026-01-01T00:00:10.000Z"}) as never,
    );

    await expect(markTowLoaded({
      userId: "op1",
      ticketId: "tow1ticket",
    })).resolves.toEqual({loaded: true});

    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("requires arrival before loading", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket({status: "2"}) as never,
    );

    await expect(markTowLoaded({
      userId: "op1",
      ticketId: "tow1ticket",
    })).rejects.toMatchObject({statusCode: 400});

    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("only lets the assigned tower mark loaded", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket() as never,
    );
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      ...tower,
      operatorUid: "someone-else",
    } as never);

    await expect(markTowLoaded({
      userId: "stranger",
      ticketId: "tow1ticket",
    })).rejects.toMatchObject({statusCode: 403});

    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });
});

describe("tow breakdown re-match", () => {
  it("pays deadhead plus loaded distance and caps the total", async () => {
    const ticket = towTicket();
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      ticket as never,
    );

    await expect(cancelTowerSearch({
      userId: "op1",
      ticketId: "tow1ticket",
      lat: 10.707,
      lng: 106.6,
      reasonCode: "TOWER_CANCEL_BREAKDOWN",
    })).resolves.toEqual({updated: 1, requeued: true});

    const update = jest.mocked(dispatchRepository.update).mock.calls.find(
      ([id, patch]) => id === "tow1ticket" &&
        typeof patch === "object" && patch !== null &&
        "towFeeHistory" in patch,
    );
    expect(update).toBeDefined();
    const patch = update?.[1] as Record<string, unknown>;
    const history = patch.towFeeHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      shopId: "tow1",
      shopName: "Tow Co",
      deadheadKm: 2,
      reasonCode: "TOWER_CANCEL_BREAKDOWN",
    });
    expect(history[0].loadedKm).toBeGreaterThan(0.6);
    expect(history[0].loadedKm).toBeLessThan(0.7);
    expect(patch.towFeeCap).toBe(500000);
    const fare = patch.towFare as Record<string, unknown>;
    expect(fare.partial).toBe(false);
    expect(fare.ceiling).toBe(500000 - (history[0].amount as number));
    expect((patch.towActual as Record<string, unknown>).breakdown).toBe(true);
    const assignment = jest.mocked(dispatchRepository.update).mock.calls.find(
      ([id, next]) => id === "tow1ticket" &&
        typeof next === "object" && next !== null &&
        "assignedShopId" in next,
    );
    expect(assignment?.[1]).toMatchObject({
      assignedShopId: null,
      loadedAt: null,
    });
    expect(autoFile).not.toHaveBeenCalled();
    expect(bumpCancelCounters).not.toHaveBeenCalled();
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "tow1ticket",
      "1",
      "op1",
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "tow1ticket",
      "-rematch-rider",
      expect.objectContaining({
        body: "The tower broke down — finding another tower",
      }),
    );
    expect(findTowOperators).toHaveBeenCalledWith(expect.objectContaining({
      lat: 10.707,
      lng: 106.6,
      excludeShopIds: ["tow1"],
      excludeOperatorUids: ["op1"],
    }));
    expect(stopWaiting).toHaveBeenCalledWith("tow1ticket");
    expect(providerRepository.update).toHaveBeenCalledWith("tow1", {
      accepting: false,
    });
    expect(patch.excludedShopIds).toEqual(["tow1"]);
    expect(patch.excludedOperatorUids).toEqual(["op1"]);
    expect(patch.loadedAt).toBeNull();
    expect(patch.cancelledBy).toBeNull();
  });

  it("pays deadhead only when a breakdown happens before loading", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket({loadedAt: null}) as never,
    );

    await cancelTowerSearch({
      userId: "op1",
      ticketId: "tow1ticket",
      lat: 10.701,
      lng: 106.6,
      reasonCode: "TOWER_CANCEL_BREAKDOWN",
    });

    const update = jest.mocked(dispatchRepository.update).mock.calls.find(
      ([id, patch]) => id === "tow1ticket" &&
        typeof patch === "object" && patch !== null &&
        "towFeeHistory" in patch,
    );
    expect(update).toBeDefined();
    const history = (update?.[1] as Record<string, unknown>)
      .towFeeHistory as Array<Record<string, unknown>>;
    expect(history[0]).toMatchObject({deadheadKm: 2, loadedKm: 0});
    expect(autoFile).not.toHaveBeenCalled();
    expect(bumpCancelCounters).not.toHaveBeenCalled();
  });

  it("preserves the original cap across repeated breakdowns", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket({
        towFeeCap: 500000,
        towFeeHistory: [{amount: 100000}],
        towFare: {
          estimate: 300000,
          ceiling: 400000,
          final: null,
          partial: false,
          deadheadKm: 0,
          loadedKm: 0,
          night: false,
          vehicleClass: "CAR",
        },
      }) as never,
    );

    await cancelTowerSearch({
      userId: "op1",
      ticketId: "tow1ticket",
      lat: 10.707,
      lng: 106.6,
      reasonCode: "TOWER_CANCEL_BREAKDOWN",
    });

    const update = jest.mocked(dispatchRepository.update).mock.calls.find(
      ([id, patch]) => id === "tow1ticket" &&
        typeof patch === "object" && patch !== null &&
        "towFeeHistory" in patch,
    );
    expect(update?.[1]).toMatchObject({towFeeCap: 500000});
  });

  it("keeps the dispute for a non-breakdown reason", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue(
      towTicket({loadedAt: null}) as never,
    );

    await cancelTowerSearch({
      userId: "op1",
      ticketId: "tow1ticket",
      lat: 10.701,
      lng: 106.6,
      reasonCode: "TOWER_CANCEL_UNREACHABLE",
    });

    expect(autoFile).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "TOWER_CANCEL_UNREACHABLE",
      type: "TOWER_CANCEL_MID",
    }));
    expect(bumpCancelCounters).toHaveBeenCalledWith({
      providerId: "tow1",
      userId: "op1",
    });
    const update = jest.mocked(dispatchRepository.update).mock.calls.find(
      ([id, patch]) => id === "tow1ticket" &&
        typeof patch === "object" && patch !== null &&
        "towFeeHistory" in patch,
    );
    expect(update).toBeDefined();
    const patch = update?.[1] as Record<string, unknown>;
    expect(patch.towFeeHistory).toEqual([
      expect.objectContaining({
        shopId: "tow1",
        reasonCode: "TOWER_CANCEL_UNREACHABLE",
      }),
    ]);
    expect(patch.excludedShopIds).toEqual(["tow1"]);
    expect(patch.excludedOperatorUids).toEqual(["op1"]);
    expect(providerRepository.update).toHaveBeenCalledWith("tow1", {
      accepting: false,
    });
  });
});

it("prices a breakdown partial from the per-km rate only", () => {
  const expected = partialTowFare({
    vehicleClass: "CAR",
    night: isNightFare(new Date(), DEFAULT_TOW_RATES.nightWindow),
    deadheadKm: 5,
    rates: DEFAULT_TOW_RATES,
  });
  expect(expected).toBeGreaterThan(0);
  expect(expected).toBeLessThan(DEFAULT_TOW_RATES.CAR.base);
});

describe("replacement tow fare cap", () => {
  it("caps the new estimate at the remaining ceiling", async () => {
    jest.mocked(postRoute)
      .mockResolvedValueOnce({
        distanceMeters: 1000,
        durationSeconds: 60,
        geometry: {
          type: "LineString",
          coordinates: [[106.6, 10.7], [106.61, 10.71]],
        },
      })
      .mockResolvedValueOnce({
        distanceMeters: 20000,
        durationSeconds: 900,
        geometry: {
          type: "LineString",
          coordinates: [[106.6, 10.7], [106.7, 10.8]],
        },
      });

    await stampTowFare("tow1ticket", {
      lat: 10.7,
      lng: 106.6,
      vehicleType: "CAR",
      destinationPoint: {lat: 10.8, lng: 106.7},
      towFeeCap: 500000,
      towFeeHistory: [{amount: 120000}],
      towFare: {ceiling: 380000},
    }, "tow1");

    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "tow1ticket",
      expect.objectContaining({
        towFare: expect.objectContaining({
          estimate: 380000,
          ceiling: 380000,
          final: null,
        }),
      }),
    );
  });
});
