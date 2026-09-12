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

const originStop = {lat: 10.7626, lng: 106.6602};
const destStop = {lat: 10.7758, lng: 106.7019};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue({id: "u1"} as never);
  jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
  jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
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

describe("routingService alternatives", () => {
  it("returns up to 3 routes on a clean two-point route", async () => {
    const primary: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const alt1: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.67, 10.79],
        [106.7, 10.78],
      ],
    };
    const alt2: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.65, 10.77],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes.mockResolvedValue([
      {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
      {geometry: alt1, distanceMeters: 2600, durationSeconds: 560},
      {geometry: alt2, distanceMeters: 2800, durationSeconds: 610},
    ]);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    const res = await getRoute(base);
    expect(res.cached).toBe(false);
    expect(res.routes).toHaveLength(3);
    expect(res.routes.map((r) => r.distanceMeters)).toEqual([
      2450, 2600, 2800,
    ]);
    expect(res.routes[0]).toMatchObject({
      source: "valhalla",
      geometry: primary,
      warnings: [],
    });
    expect(res.routes[1]).toMatchObject({source: "valhalla", geometry: alt1});
    expect(res.routes[2]).toMatchObject({source: "valhalla", geometry: alt2});
    expect(mockPostRoutes.mock.calls[0]).toEqual([
      [originStop, destStop],
      [],
      3,
    ]);
    expect(routingCacheRepository.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        routes: [
          {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
          {geometry: alt1, distanceMeters: 2600, durationSeconds: 560},
          {geometry: alt2, distanceMeters: 2800, durationSeconds: 610},
        ],
      }),
    );
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      primary,
    );
  });

  it("drops a hazard-blocked alternative and keeps the rest", async () => {
    const primary: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const alt1: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.67, 10.79],
        [106.7, 10.78],
      ],
    };
    const blocked: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.65, 10.77],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes.mockResolvedValue([
      {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
      {geometry: alt1, distanceMeters: 2600, durationSeconds: 560},
      {geometry: blocked, distanceMeters: 2800, durationSeconds: 610},
    ]);
    const zones = [{flagId: "flood-9", distanceMeters: 4}];
    jest.mocked(closureService.analyzeRoute).mockImplementation(
      async (geometry: unknown) => {
        if (geometry === blocked) {
          return {blocking: zones, warnings: []} as never;
        }
        return {blocking: [], warnings: []};
      },
    );
    const res = await getRoute(base);
    expect(res.routes).toHaveLength(2);
    expect(res.routes[0].geometry).toEqual(primary);
    expect(res.routes[1].geometry).toEqual(alt1);
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      primary,
    );
  });

  it("drops a width-blocked alternative and keeps the rest", async () => {
    const primary: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const pinched: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.62, 10.85],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes.mockResolvedValue([
      {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
      {geometry: pinched, distanceMeters: 2600, durationSeconds: 560},
    ]);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {
        id: "pinch",
        lat: 10.85,
        lng: 106.62,
        baseWidth: 0.5,
        tier: "TIER2",
      },
    ] as never);
    const res = await getRoute({...base, width: 0.9});
    expect(res.routes).toHaveLength(1);
    expect(res.routes[0].geometry).toEqual(primary);
  });

  it("falls back when the primary stays blocked", async () => {
    const primary: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const alt: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.67, 10.79],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes
      .mockResolvedValueOnce([
        {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
        {geometry: alt, distanceMeters: 2600, durationSeconds: 560},
      ])
      .mockResolvedValue([
        {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
      ]);
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockImplementation(
      async (geometry: unknown) => {
        if (geometry === primary) {
          return {blocking: zones, warnings: []} as never;
        }
        return {blocking: [], warnings: []};
      },
    );
    jest.mocked(closureService.findBlocking).mockResolvedValue(
      zones as never,
    );
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res.routes).toHaveLength(1);
    expect(res.routes[0]).toMatchObject({
      source: "valhalla",
      geometry: alt,
      distanceMeters: 2600,
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(3);
  });

  it("409s with the primary error when nothing is safe", async () => {
    const primary: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const alt: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.67, 10.79],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes
      .mockResolvedValueOnce([
        {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
        {geometry: alt, distanceMeters: 2600, durationSeconds: 560},
      ])
      .mockResolvedValue([
        {geometry: primary, distanceMeters: 2450, durationSeconds: 512},
      ]);
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    const altZones = [{flagId: "flood-2", distanceMeters: 3}];
    jest.mocked(closureService.analyzeRoute).mockImplementation(
      async (geometry: unknown) => {
        if (geometry === primary) {
          return {blocking: zones, warnings: []} as never;
        }
        return {blocking: altZones, warnings: []} as never;
      },
    );
    jest.mocked(closureService.findBlocking).mockResolvedValue(
      zones as never,
    );
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
  });

  it("caches all options and serves them without the engine", async () => {
    const first: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const second: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.67, 10.79],
        [106.7, 10.78],
      ],
    };
    const bases = [
      {geometry: first, distanceMeters: 2450, durationSeconds: 512},
      {geometry: second, distanceMeters: 2600, durationSeconds: 560},
    ];
    mockPostRoutes.mockResolvedValue(bases);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValueOnce(
      null,
    );
    const miss = await getRoute(base);
    expect(miss.cached).toBe(false);
    expect(miss.routes).toHaveLength(2);
    const saved = jest.mocked(routingCacheRepository.save).mock.calls[0][1];
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue({
      routes: JSON.stringify(saved.routes),
    } as never);
    const hit = await getRoute(base);
    expect(hit.cached).toBe(true);
    expect(hit.routes).toHaveLength(2);
    expect(hit.routes[0]).toMatchObject({
      source: "cache",
      geometry: first,
      distanceMeters: 2450,
    });
    expect(hit.routes[1]).toMatchObject({
      source: "cache",
      geometry: second,
      distanceMeters: 2600,
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
  });
});
