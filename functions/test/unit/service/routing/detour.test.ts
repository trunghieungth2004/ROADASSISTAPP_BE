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

describe("routingService detours", () => {
  it("detours around a blocked route with source detour", async () => {
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
      .mockResolvedValueOnce([
        {geometry: around, distanceMeters: 2600, durationSeconds: 560},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      cached: false,
      routes: [
        {
          source: "detour",
          hazards: zones,
          warnings: [],
          distanceMeters: 2600,
          durationSeconds: 560,
          geometry: around,
        },
      ],
    });
    expect(res.routes[0].via).toBeUndefined();
    expect(closureService.analyzeRoute).toHaveBeenCalledWith(direct, "u1");
    expect(closureService.findBlocking).toHaveBeenCalledWith(around, "u1");
    expect(closureService.findWarnings).toHaveBeenCalledWith(around, "u1");
    expect(mockPostRoutes).toHaveBeenCalledTimes(2);
    expect(mockPostRoutes.mock.calls[0]).toEqual([
      [originStop, destStop],
      [],
      5,
      "motor_scooter",
    ]);
    const polygons = mockPostRoutes.mock.calls[1][1] ?? [];
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(33);
    expect(polygons[0][0]).toEqual(polygons[0][polygons[0].length - 1]);
    expect(polygons[0][0][0]).toBeCloseTo(106.68, 6);
    expect(polygons[0][0][1]).toBeCloseTo(10.77 + 200 / 111320, 6);
    expect(routingCacheRepository.save).toHaveBeenCalledTimes(1);
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      around,
    );
  });

  it("retries the detour with true radii when still blocked", async () => {
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
    const mid: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.685, 10.775],
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
      .mockResolvedValueOnce([
        {geometry: mid, distanceMeters: 2550, durationSeconds: 540},
      ])
      .mockResolvedValue([
        {geometry: around, distanceMeters: 2600, durationSeconds: 560},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking)
      .mockResolvedValueOnce(zones as never)
      .mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      routes: [
        {
          source: "detour",
          hazards: zones,
          distanceMeters: 2600,
          geometry: around,
        },
      ],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(3);
    const ringLat = (n: number): number => {
      const polys = mockPostRoutes.mock.calls[n][1] as
        | Array<Array<[number, number]>>
        | undefined;
      return polys?.[0]?.[0]?.[1] ?? NaN;
    };
    expect(ringLat(2)).toBeCloseTo(ringLat(1), 10);
    expect(ringLat(1)).toBeCloseTo(10.77 + 200 / 111320, 6);
  });

  it("chains zones found on the re-solve into the exclusion set", async () => {
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
    const mid: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
        [106.7, 10.78],
      ],
    };
    const around: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.685, 10.785],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes
      .mockResolvedValueOnce([
        {geometry: direct, distanceMeters: 2450, durationSeconds: 512},
      ])
      .mockResolvedValueOnce([
        {geometry: mid, distanceMeters: 2500, durationSeconds: 530},
      ])
      .mockResolvedValue([
        {geometry: around, distanceMeters: 2700, durationSeconds: 580},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const z1 = {
      flagId: "flood-1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    const z2 = {
      flagId: "obstruction-2",
      lat: 10.775,
      lng: 106.687,
      radiusMeters: 100,
      distanceMeters: 0,
    };
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [z1],
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking)
      .mockResolvedValueOnce([z1, z2] as never)
      .mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      routes: [
        {
          source: "detour",
          hazards: [z1],
          distanceMeters: 2700,
          geometry: around,
        },
      ],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(3);
    const polys = mockPostRoutes.mock.calls[2][1] as Array<
      Array<[number, number]>
    >;
    expect(polys).toHaveLength(2);
    const centers = polys.map((ring) => [ring[0][0], ring[0][1]]);
    expect(centers.map((c) => c[0])).toContainEqual(
      expect.closeTo(106.687, 6),
    );
    const z2ring = centers.find((c) => Math.abs(c[0] - 106.687) < 1e-6);
    expect(z2ring?.[1]).toBeCloseTo(10.775 + 100 / 111320, 6);
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      around,
    );
  });

  it("steers a cascading two-point detour", async () => {
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
    const mid: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
        [106.7, 10.78],
      ],
    };
    const steerSlow: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.67, 10.765],
        [106.7, 10.78],
      ],
    };
    const steerFast: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.675, 10.768],
        [106.7, 10.78],
      ],
    };
    const steerMid: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.672, 10.766],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes
      .mockResolvedValueOnce([
        {geometry: direct, distanceMeters: 2450, durationSeconds: 512},
      ])
      .mockResolvedValueOnce([
        {geometry: mid, distanceMeters: 2500, durationSeconds: 530},
      ])
      .mockResolvedValueOnce([
        {geometry: steerSlow, distanceMeters: 2600, durationSeconds: 300},
      ])
      .mockResolvedValueOnce([
        {geometry: steerFast, distanceMeters: 2400, durationSeconds: 250},
      ])
      .mockResolvedValue([
        {geometry: steerMid, distanceMeters: 2500, durationSeconds: 270},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const z1 = {
      flagId: "flood-1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    const z2 = {
      flagId: "obstruction-2",
      lat: 10.775,
      lng: 106.687,
      radiusMeters: 100,
      distanceMeters: 0,
    };
    const z3 = {
      flagId: "accident-3",
      lat: 10.772,
      lng: 106.683,
      radiusMeters: 150,
      distanceMeters: 0,
    };
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [z1],
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking)
      .mockResolvedValueOnce([z1, z2, z3] as never)
      .mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      routes: [
        {
          source: "detour",
          hazards: [z1],
          distanceMeters: 2400,
          durationSeconds: 250,
          geometry: steerFast,
        },
      ],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(5);
    const steeredCall = mockPostRoutes.mock.calls[2];
    expect(steeredCall[0]).toHaveLength(3);
    expect(steeredCall[0][0]).toEqual(originStop);
    expect(steeredCall[0][2]).toEqual(destStop);
    expect(steeredCall[1]).toHaveLength(1);
  });

  it("returns the blocked route with hazards on detour failure", async () => {
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
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue(
      zones as never,
    );
    const res = await getRoute(base);
    expect(res).toMatchObject({
      cached: false,
      routes: [
        {
          source: "valhalla",
          geometry,
          hazards: zones,
          distanceMeters: 2450,
        },
      ],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(5);
  });

  it("detours a multi-stop route through the blocked leg", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const direct: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
        [106.7, 10.78],
      ],
    };
    const around: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
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
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.775,
        lng: 106.69,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const stop = {lat: 10.772, lng: 106.685};
    const res = await getRoute({...base, stops: [stop]});
    expect(res).toMatchObject({
      routes: [
        {source: "detour", hazards: zones, warnings: [], geometry: around},
      ],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(2);
    expect(mockPostRoutes.mock.calls[0]).toEqual([
      [originStop, stop, destStop],
      [],
      1,
      "motor_scooter",
    ]);
    expect(mockPostRoutes.mock.calls[1][0]).toEqual([
      originStop,
      stop,
      destStop,
    ]);
  });

  it("collapses alternatives whose detours converge", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const directA: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
      ],
    };
    const directB: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.685, 10.775],
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
        {geometry: directA, distanceMeters: 2450, durationSeconds: 512},
        {geometry: directB, distanceMeters: 2500, durationSeconds: 530},
      ])
      .mockResolvedValue([
        {geometry: around, distanceMeters: 2600, durationSeconds: 560},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const z1 = {
      flagId: "flood-1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    const z2 = {
      flagId: "obstruction-2",
      lat: 10.775,
      lng: 106.69,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    jest.mocked(closureService.analyzeRoute).mockImplementation(
      async (geometry: unknown) => ({
        blocking: geometry === directA ? [z1] : [z2],
        warnings: [],
      }) as never,
    );
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res.routes).toHaveLength(1);
    expect(res).toMatchObject({
      routes: [{source: "detour", geometry: around}],
    });
  });

  it("rejects a stop sitting in a blocking zone", async () => {
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
    const zone = {
      flagId: "flood-1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [zone],
      warnings: [],
    } as never);
    await expect(
      getRoute({...base, stops: [{lat: 10.77, lng: 106.68}]}),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Stop 1 is inside an active road hazard zone",
      errors: {control: "stop 1", zone},
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(1);
  });

  it("rejects a destination sitting in a flag", async () => {
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
    const zone = {
      flagId: "acc-1",
      type: "ACCIDENT",
      lat: 10.7758,
      lng: 106.7019,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [zone],
      warnings: [],
    } as never);
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      message: "Destination is inside an active ACCIDENT zone",
      errors: {control: "destination", zone},
    });
  });

  it("returns hazards when the detour exceeds the distance cap", async () => {
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
        {geometry: direct, distanceMeters: 100, durationSeconds: 50},
      ])
      .mockResolvedValue([
        {geometry: around, distanceMeters: 100000, durationSeconds: 9000},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      routes: [{source: "valhalla", geometry: direct, hazards: zones}],
    });
    expect(closureService.findWarnings).not.toHaveBeenCalled();
  });

  it("clears two blocking zones in one request", async () => {
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
    const around2: Line = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.79],
        [106.7, 10.78],
      ],
    };
    mockPostRoutes
      .mockResolvedValueOnce([
        {geometry: direct, distanceMeters: 2450, durationSeconds: 512},
      ])
      .mockResolvedValue([
        {geometry: around2, distanceMeters: 2600, durationSeconds: 560},
      ]);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const z1 = {
      flagId: "z1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      distanceMeters: 0,
    };
    const z2 = {
      flagId: "z2",
      lat: 10.785,
      lng: 106.695,
      radiusMeters: 100,
      distanceMeters: 50,
    };
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [z1, z2],
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      routes: [{source: "detour", hazards: [z1, z2], geometry: around2}],
    });
    expect(mockPostRoutes).toHaveBeenCalledTimes(2);
    expect(mockPostRoutes.mock.calls[1][1]).toHaveLength(2);
    expect(closureService.findBlocking).toHaveBeenCalledTimes(1);
  });

  it("routes around a narrow alley met after a hazard detour", async () => {
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
    const zones = [
      {
        flagId: "flood-1",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        distanceMeters: 0,
      },
    ];
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: zones,
      warnings: [],
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(closureService.findWarnings).mockResolvedValue([]);
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
    const res = await getRoute({...base, width: 0.9});
    expect(res).toMatchObject({
      routes: [{source: "detour", geometry: around}],
    });
    expect(
      alleySegmentRepository.findByGeohashPrefixes,
    ).toHaveBeenCalled();
  });
});
