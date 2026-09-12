import * as routingCacheRepository from
  "../../../../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../../../../repository/activeRouteRepository";
import * as closureService from "../../../../service/closureService";
import * as userRepository from "../../../../repository/userRepository";
import * as alleySegmentRepository from
  "../../../../repository/alleySegmentRepository";
import {getRoute} from "../../../../service/routingService";
import {postRoutes} from "../../../../utils/valhalla";

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

describe("routingService width gate", () => {
  it("409s when the route crosses a narrower alley segment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 2450, durationSeconds: 512},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {
        id: "s1",
        lat: 10.77,
        lng: 106.68,
        baseWidth: 0.5,
        tier: "TIER2",
      },
    ] as never);
    await expect(getRoute({...base, width: 0.9})).rejects.toMatchObject({
      statusCode: 409,
      message: "Route is impassable for this vehicle width",
      errors: [{segmentId: "s1", baseWidth: 0.5, distanceMeters: 0}],
    });
    expect(activeRouteRepository.touch).not.toHaveBeenCalled();
    expect(mockPostRoutes).toHaveBeenCalledTimes(3);
  });

  it("includes width-block polygons in the detour request", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const direct: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const around: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.69, 10.79],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes
      .mockResolvedValueOnce([
        {geometry: direct, distanceMeters: 2450, durationSeconds: 512},
      ])
      .mockResolvedValue([
        {geometry: around, distanceMeters: 2600, durationSeconds: 560},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {
        id: "s1",
        lat: 10.77,
        lng: 106.68,
        baseWidth: 0.5,
        tier: "TIER2",
      },
    ] as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute({...base, width: 0.9});
    expect(res).toMatchObject({routes: [{source: "detour", geometry: around}]});
    expect(mockPostRoutes).toHaveBeenCalledTimes(2);
    const polygons = mockPostRoutes.mock.calls[1][1] ?? [];
    expect(polygons).toHaveLength(1);
    expect(polygons[0][0][0]).toBeCloseTo(106.68, 6);
    expect(polygons[0][0][1]).toBeCloseTo(10.77 + 20 / 111320, 6);
  });

  it("passes compatible or unknown-width segments", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 2450, durationSeconds: 512},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {id: "wide", lat: 10.77, lng: 106.68, baseWidth: 1.2, tier: "TIER2"},
      {id: "unknown", lat: 10.77, lng: 106.68, tier: "TIER2"},
      {id: "far", lat: 11.5, lng: 107.5, baseWidth: 0.4, tier: "TIER2"},
    ] as never);
    await expect(getRoute({...base, width: 0.9})).resolves.toMatchObject({
      routes: [{source: "valhalla"}],
    });
  });

  it("surfaces passable-but-tight segments as WIDTH warnings", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes.mockResolvedValue([
      {geometry, distanceMeters: 2450, durationSeconds: 512},
    ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {id: "snug", lat: 10.77, lng: 106.68, baseWidth: 1.0, tier: "TIER2"},
    ] as never);
    const res = await getRoute({...base, width: 0.9});
    expect(res).toMatchObject({routes: [{source: "valhalla"}]});
    expect(res.routes[0].warnings).toMatchObject([
      {
        flagId: "tight:snug",
        type: "WIDTH",
        lat: 10.77,
        lng: 106.68,
        note: "1 m",
      },
    ]);
  });

  it("treats hazards and width blocks as one clearance queue", async () => {
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
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {id: "s1", lat: 10.77, lng: 106.68, baseWidth: 0.4, tier: "TIER2"},
    ] as never);
    await expect(getRoute({...base, width: 0.9})).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(alleySegmentRepository.findByGeohashPrefixes).toHaveBeenCalled();
  });
});
