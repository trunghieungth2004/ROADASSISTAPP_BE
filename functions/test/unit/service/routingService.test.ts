import * as routingCacheRepository from
  "../../../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../../../repository/activeRouteRepository";
import * as closureService from "../../../service/closureService";
import * as userRepository from "../../../repository/userRepository";
import * as alleySegmentRepository from
  "../../../repository/alleySegmentRepository";
import {getRoute, widthToBucket} from "../../../service/routingService";
import {postRoute, ServiceError} from "../../../utils/valhalla";

jest.mock("../../../repository/routingCacheRepository");
jest.mock("../../../repository/activeRouteRepository");
jest.mock("../../../service/closureService");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/alleySegmentRepository");
jest.mock("../../../utils/valhalla", () => {
  const actual = jest.requireActual("../../../utils/valhalla") as Record<
    string,
    unknown
  >;
  return {...actual, postRoute: jest.fn()};
});

const mockPostRoute = jest.mocked(postRoute);

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
  mockPostRoute.mockResolvedValue({
    geometry: {type: "LineString", coordinates: []},
    distanceMeters: 100,
    durationSeconds: 50,
  });
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
      distanceMeters: 2450,
      durationSeconds: 512,
      geometry,
      source: "cache",
      warnings: [],
    });
    expect(mockPostRoute).not.toHaveBeenCalled();
  });

  it("calls Valhalla on a miss and persists the result", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await expect(getRoute(base)).resolves.toEqual({
      cached: false,
      distanceMeters: 100,
      durationSeconds: 50,
      geometry,
      source: "valhalla",
      warnings: [],
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
    expect(mockPostRoute).toHaveBeenCalledWith(
      [originStop, destStop],
      [],
    );
    expect(routingCacheRepository.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        widthBucket: "MEDIUM",
        geometry,
        distanceMeters: 100,
        durationSeconds: 50,
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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
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
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
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
    expect(mockPostRoute).not.toHaveBeenCalled();
  });

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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 2450,
        durationSeconds: 512,
      })
      .mockResolvedValueOnce({
        geometry: around,
        distanceMeters: 2600,
        durationSeconds: 560,
      });
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
      source: "detour",
      hazards: zones,
      warnings: [],
      distanceMeters: 2600,
      durationSeconds: 560,
      geometry: around,
    });
    expect(res.via).toBeUndefined();
    expect(closureService.analyzeRoute).toHaveBeenCalledWith(
      direct,
      "u1",
    );
    expect(closureService.findBlocking).toHaveBeenCalledWith(
      around,
      "u1",
    );
    expect(closureService.findWarnings).toHaveBeenCalledWith(
      around,
      "u1",
    );
    expect(mockPostRoute).toHaveBeenCalledTimes(2);
    expect(mockPostRoute.mock.calls[0][1]).toEqual([]);
    const polygons = mockPostRoute.mock.calls[1][1] ?? [];
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

  it("retries the detour with wider polygons when still blocked", async () => {
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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 2450,
        durationSeconds: 512,
      })
      .mockResolvedValueOnce({
        geometry: mid,
        distanceMeters: 2550,
        durationSeconds: 540,
      })
      .mockResolvedValueOnce({
        geometry: around,
        distanceMeters: 2600,
        durationSeconds: 560,
      });
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
      source: "detour",
      hazards: zones,
      distanceMeters: 2600,
      geometry: around,
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(3);
    const ringLat = (n: number): number => {
      const polys = mockPostRoute.mock.calls[n][1] as
        | Array<Array<[number, number]>>
        | undefined;
      return polys?.[0]?.[0]?.[1] ?? NaN;
    };
    expect(ringLat(2)).toBeGreaterThan(ringLat(1));
  });

  it("throws 409 after detour attempts stay blocked", async () => {
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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 2450,
      durationSeconds: 512,
    });
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
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(3);
  });

  it("propagates a 500 when the engine is unreachable", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    mockPostRoute.mockRejectedValue(
      new ServiceError("Routing service unreachable"),
    );
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 500,
      message: "Routing service unreachable",
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
  });

  it("propagates a 404 when the engine finds no route", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    mockPostRoute.mockRejectedValue(new ServiceError("No route found", 404));
    await expect(getRoute(base)).rejects.toMatchObject({statusCode: 404});
  });

  it("sends no exclusions on a clean route", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await getRoute({...base, width: 0.9});
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
    expect(mockPostRoute).toHaveBeenCalledWith([originStop, destStop], []);
  });

  it("keeps width buckets out of the engine request", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await getRoute({...base, width: 0.5});
    await getRoute({...base, width: 1.5});
    expect(mockPostRoute).toHaveBeenCalledTimes(2);
    expect(mockPostRoute.mock.calls[0][1]).toEqual([]);
    expect(mockPostRoute.mock.calls[1][1]).toEqual([]);
  });

  it("sends stops in order as locations", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    const stops = [{lat: 10.77, lng: 106.68}];
    await expect(getRoute({...base, stops})).resolves.toMatchObject({
      source: "valhalla",
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
    expect(mockPostRoute).toHaveBeenCalledWith(
      [originStop, stops[0], destStop],
      [],
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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 2450,
        durationSeconds: 512,
      })
      .mockResolvedValue({
        geometry: around,
        distanceMeters: 2600,
        durationSeconds: 560,
      });
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
      source: "detour",
      hazards: zones,
      warnings: [],
      geometry: around,
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(2);
    expect(mockPostRoute.mock.calls[0][0]).toEqual([
      originStop,
      stop,
      destStop,
    ]);
    expect(mockPostRoute.mock.calls[1][0]).toEqual([
      originStop,
      stop,
      destStop,
    ]);
  });

  it("409s when a stop sits inside a blocking zone", async () => {
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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 2450,
      durationSeconds: 512,
    });
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
    await expect(
      getRoute({...base, stops: [{lat: 10.77, lng: 106.68}]}),
    ).rejects.toMatchObject({statusCode: 409, errors: zones});
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
  });

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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 2450,
      durationSeconds: 512,
    });
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
    expect(mockPostRoute).toHaveBeenCalledTimes(3);
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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 2450,
        durationSeconds: 512,
      })
      .mockResolvedValue({
        geometry: around,
        distanceMeters: 2600,
        durationSeconds: 560,
      });
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
    expect(res).toMatchObject({source: "detour", geometry: around});
    expect(mockPostRoute).toHaveBeenCalledTimes(2);
    const polygons = mockPostRoute.mock.calls[1][1] ?? [];
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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 2450,
      durationSeconds: 512,
    });
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
      source: "valhalla",
    });
  });

  it("skips the width gate without a width", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.analyzeRoute).mockResolvedValue({
      blocking: [],
      warnings: [],
    });
    await expect(getRoute(base)).resolves.toMatchObject({
      source: "valhalla",
    });
    expect(
      alleySegmentRepository.findByGeohashPrefixes,
    ).not.toHaveBeenCalled();
  });

  it("treats hazards and width blocks as one clearance queue", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
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
    expect(
      alleySegmentRepository.findByGeohashPrefixes,
    ).toHaveBeenCalled();
  });

  it("warns about others' suggested flags without detouring", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry: Line = {type: "LineString", coordinates: [[1, 2]]};
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
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
    expect(res).toMatchObject({source: "valhalla", warnings});
    expect(res.hazards).toBeUndefined();
    expect(mockPostRoute).toHaveBeenCalledTimes(1);
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
    mockPostRoute.mockResolvedValue({
      geometry,
      distanceMeters: 100,
      durationSeconds: 50,
    });
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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 2450,
        durationSeconds: 512,
      })
      .mockResolvedValue({
        geometry: around2,
        distanceMeters: 2600,
        durationSeconds: 560,
      });
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
      source: "detour",
      hazards: [z1, z2],
      geometry: around2,
    });
    expect(mockPostRoute).toHaveBeenCalledTimes(2);
    expect(mockPostRoute.mock.calls[1][1]).toHaveLength(2);
    expect(closureService.findBlocking).toHaveBeenCalledTimes(1);
  });

  it("409s when the detour exceeds the extra-distance cap", async () => {
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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 100,
        durationSeconds: 50,
      })
      .mockResolvedValue({
        geometry: around,
        distanceMeters: 100000,
        durationSeconds: 9000,
      });
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
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(closureService.findWarnings).not.toHaveBeenCalled();
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
    mockPostRoute
      .mockResolvedValueOnce({
        geometry: direct,
        distanceMeters: 2450,
        durationSeconds: 512,
      })
      .mockResolvedValue({
        geometry: around,
        distanceMeters: 2600,
        durationSeconds: 560,
      });
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
    expect(res).toMatchObject({source: "detour", geometry: around});
    expect(
      alleySegmentRepository.findByGeohashPrefixes,
    ).toHaveBeenCalled();
  });
});
