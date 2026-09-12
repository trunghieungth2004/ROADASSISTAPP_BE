import * as routingCacheRepository from
  "../../../../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../../../../repository/activeRouteRepository";
import * as closureService from "../../../../service/closureService";
import * as userRepository from "../../../../repository/userRepository";
import * as alleySegmentRepository from
  "../../../../repository/alleySegmentRepository";
import {getRoute, widthToBucket} from "../../../../service/routingService";
import {postRoutes, ServiceError} from "../../../../utils/valhalla";

jest.mock("../../../../repository/routingCacheRepository");
jest.mock("../../../../repository/activeRouteRepository");
jest.mock("../../../../service/closureService");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../repository/alleySegmentRepository");
jest.mock("../../../../utils/valhalla", () => {
  const actual = jest.requireActual("../../../../utils/valhalla") as Record<
    string,
    unknown
  >;
  return {...actual, postRoutes: jest.fn()};
});

const mockPostRoutes = jest.mocked(postRoutes);

type Line = {type: "LineString"; coordinates: Array<[number, number]>};

const base = {
  userId: "u1",
  originLat: 10.7626,
  originLng: 106.6602,
  destLat: 10.7758,
  destLng: 106.7019,
};

const originStop = {lat: 10.7626, lng: 106.6602};
const destStop = {lat: 10.7758, lng: 106.7019};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.mocked(activeRouteRepository.touch).mockResolvedValue(undefined);
  jest.mocked(
    alleySegmentRepository.findByGeohashPrefixes,
  ).mockResolvedValue([]);
  mockPostRoutes.mockResolvedValue([
    {
      geometry: {type: "LineString", coordinates: []},
      distanceMeters: 100,
      durationSeconds: 50,
    },
  ]);
});

describe("widthToBucket", () => {
  it.each([
    [undefined, "MEDIUM"],
    [0.5, "NARROW"],
    [0.8, "MEDIUM"],
    [1.0, "MEDIUM"],
    [1.5, "WIDE"],
  ])("maps %s to %s", (width, bucket) => {
    expect(widthToBucket(width as number | undefined)).toBe(bucket);
  });
});

describe("routingService.getRoute", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(getRoute(base)).rejects.toMatchObject({statusCode: 404});
  });

  it("short-circuits on a cache hit without calling the engine", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const geometry = {type: "LineString", coordinates: []};
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue({
      geometry: JSON.stringify(geometry),
      distanceMeters: 2450,
      durationSeconds: 512,
    } as never);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await expect(getRoute(base)).resolves.toEqual({
      cached: true,
      routes: [
        {
          distanceMeters: 2450,
          durationSeconds: 512,
          geometry,
          source: "cache",
          warnings: [],
        },
      ],
    });
    expect(mockPostRoutes).not.toHaveBeenCalled();
  });

  it("calls Valhalla on a miss and persists the result", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await expect(getRoute(base)).resolves.toEqual({
      cached: false,
      routes: [
        {
          distanceMeters: 100,
          durationSeconds: 50,
          geometry,
          source: "valhalla",
          warnings: [],
        },
      ],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
    expect(mockPostRoutes).toHaveBeenCalledWith([originStop, destStop], [], 3);
    expect(routingCacheRepository.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        widthBucket: "MEDIUM",
        routes: [{geometry, distanceMeters: 100, durationSeconds: 50}],
      }),
    );
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      geometry,
    );
  });

  it("throws 409 with zones when a fresh route crosses a flood", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const zones = [{flagId: "flood-1", distanceMeters: 0}];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(routingCacheRepository.save).toHaveBeenCalled();
    expect(activeRouteRepository.touch).not.toHaveBeenCalled();
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
  });

  it("throws 409 with zones on a cache hit crossing a flood", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue({
      geometry: JSON.stringify(geometry),
    } as never);
    const zones = [{flagId: "flood-1", distanceMeters: 10}];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(mockPostRoutes).not.toHaveBeenCalled();
  });

  it("propagates a 500 when the engine is unreachable", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    mockPostRoutes.mockRejectedValue(
      new ServiceError("Routing service unreachable"),
    );
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 500,
      message: "Routing service unreachable",
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
  });

  it("propagates a 404 when the engine finds no route", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    mockPostRoutes.mockRejectedValue(new ServiceError("No route found", 404));
    await expect(getRoute(base)).rejects.toMatchObject({statusCode: 404});
  });

  it("sends no exclusions on a clean route", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await getRoute({...base, width: 0.9});
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
    expect(mockPostRoutes).toHaveBeenCalledWith([originStop, destStop], [], 3);
  });

  it("keeps width buckets out of the engine request", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await getRoute({...base, width: 0.5});
    await getRoute({...base, width: 1.5});
    expect(mockPostRoutes).toHaveBeenCalledTimes(2);
    expect(mockPostRoutes.mock.calls[0][1]).toEqual([]);
    expect(mockPostRoutes.mock.calls[1][1]).toEqual([]);
  });

  it("sends stops in order as locations", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    const stops = [{lat: 10.77, lng: 106.68}];
    await expect(getRoute({...base, stops})).resolves.toMatchObject({
      routes: [{source: "valhalla"}],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
    expect(mockPostRoutes).toHaveBeenCalledWith(
      [originStop, stops[0], destStop],
      [],
      1,
    );
    expect(routingCacheRepository.save).toHaveBeenCalledWith(
      expect.stringContaining(";"),
      expect.objectContaining({stops}),
    );
  });

  it("keys stop-less routes without separators", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await getRoute(base);
    const key = jest.mocked(routingCacheRepository.save).mock.calls[0][0];
    expect(key).not.toContain(";");
    expect(key).toBe("10.76260,106.66020:10.77580,106.70190:MEDIUM");
  });

  it("skips the width gate without a width", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await expect(getRoute(base)).resolves.toMatchObject({
      routes: [{source: "valhalla"}],
    });
    expect(
      alleySegmentRepository.findByGeohashPrefixes,
    ).not.toHaveBeenCalled();
  });

  it("warns about others' suggested flags without detouring", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const warnings = [
      {
        flagId: "suggested-1",
        type: "FLOOD",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 5,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings,
    } as never);
    const res = await getRoute(base);
    expect(res).toMatchObject({routes: [{source: "valhalla", warnings}]});
    expect(res.routes[0].hazards).toBeUndefined();
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      geometry,
    );
  });

  it("threads the caller through the closure analysis", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 100, durationSeconds: 50},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await getRoute(base);
    expect(closureService.analyzeRoute).toHaveBeenCalledWith(
      geometry,
      "u1",
    );
  });
});
