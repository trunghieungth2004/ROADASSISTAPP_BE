import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import {estimateTowEta} from "../../../service/dispatch/helpers";
import {refreshTowEta} from "../../../service/dispatchService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/providerLocationRepository", () => ({
  findByIds: jest.fn(async () => new Map()),
  findByGeohashPrefixes: jest.fn(async () => []),
}));
jest.mock("../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../utils/valhalla"),
  postRoute: jest.fn(),
}));
jest.mock("../../../service/taskQueueService");

const routes = () => jest.requireMock("../../../utils/valhalla") as {
  postRoute: jest.Mock;
};

const freshFix = {
  providerId: "tow1",
  lat: 10.69,
  lng: 106.59,
  geoHash: "w3gv",
  geoCell: "w3gv",
  lastSeen: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
    new Map([["tow1", freshFix]] as never),
  );
});

describe("estimateTowEta rounding", () => {
  it("rounds short totals to the minute", async () => {
    routes().postRoute.mockResolvedValue({durationSeconds: 120});
    const eta = await estimateTowEta({
      towerLat: 10.69,
      towerLng: 106.59,
      ticketLat: 10.7,
      ticketLng: 106.6,
      vehicleType: "SCOOTER",
    });
    expect(eta).toEqual({pickupSeconds: 720, dropoffSeconds: null});
  });

  it("keeps five-minute blocks past fifteen", async () => {
    routes().postRoute.mockResolvedValue({durationSeconds: 1800});
    const eta = await estimateTowEta({
      towerLat: 10.69,
      towerLng: 106.59,
      ticketLat: 10.7,
      ticketLng: 106.6,
      vehicleType: "SCOOTER",
    });
    expect(eta?.pickupSeconds).toBe(2400);
  });

  it("chains the loaded leg onto the pickup total", async () => {
    routes().postRoute
      .mockResolvedValueOnce({durationSeconds: 120})
      .mockResolvedValueOnce({durationSeconds: 600});
    const eta = await estimateTowEta({
      towerLat: 10.69,
      towerLng: 106.59,
      ticketLat: 10.7,
      ticketLng: 106.6,
      destLat: 10.8,
      destLng: 106.7,
      vehicleType: "SCOOTER",
    });
    expect(eta).toEqual({pickupSeconds: 720, dropoffSeconds: 1500});
  });

  it("returns null when routing fails", async () => {
    routes().postRoute.mockRejectedValue(new Error("boom"));
    await expect(estimateTowEta({
      towerLat: 10.69,
      towerLng: 106.59,
      ticketLat: 10.7,
      ticketLng: 106.6,
    })).resolves.toBeNull();
  });
});

describe("refreshTowEta", () => {
  it("restamps ETAs on engaged tows", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      lat: 10.71,
      lng: 106.61,
      assignedShopId: "tow1",
      destinationPoint: {lat: 10.8, lng: 106.7},
    } as never);
    routes().postRoute.mockResolvedValue({durationSeconds: 120});
    await expect(
      refreshTowEta({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({updated: 1});
    const stamped = jest.mocked(dispatchRepository.update).mock.calls.find(
      (call) => call[0] === "t1" &&
        typeof (call[1] as Record<string, unknown>).etaPickupAt === "string",
    );
    expect(stamped).toBeDefined();
  });

  it("refuses strangers with 403", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    await expect(
      refreshTowEta({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("refuses disengaged tickets with 400", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "TOW",
    } as never);
    await expect(
      refreshTowEta({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });
});
