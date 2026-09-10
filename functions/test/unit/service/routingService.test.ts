import * as routingCacheRepository from
  "../../../repository/routingCacheRepository";
import * as activeRouteRepository from
  "../../../repository/activeRouteRepository";
import * as closureService from "../../../service/closureService";
import * as userRepository from "../../../repository/userRepository";
import * as alleySegmentRepository from
  "../../../repository/alleySegmentRepository";
import {getRoute, widthToBucket} from "../../../service/routingService";

jest.mock("../../../repository/routingCacheRepository");
jest.mock("../../../repository/activeRouteRepository");
jest.mock("../../../service/closureService");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/alleySegmentRepository");

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

  it("short-circuits on a cache hit without fetching", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const geometry = {type: "LineString", coordinates: []};
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue({
      geometry: JSON.stringify(geometry),
      distanceMeters: 2450,
      durationSeconds: 512,
    } as never);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    const fetchSpy = jest.spyOn(global, "fetch");
    await expect(getRoute(base)).resolves.toEqual({
      cached: true,
      distanceMeters: 2450,
      durationSeconds: 512,
      geometry,
      source: "cache",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls OSRM on a miss and persists the result", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    await expect(getRoute(base)).resolves.toEqual({
      cached: false,
      distanceMeters: 100,
      durationSeconds: 50,
      geometry,
      source: "osrm",
    });
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
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const zones = [{flagId: "flood-1", distanceMeters: 0}];
    jest.mocked(closureService.findBlocking).mockResolvedValue(zones as never);
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(routingCacheRepository.save).toHaveBeenCalled();
    expect(activeRouteRepository.touch).not.toHaveBeenCalled();
  });

  it("throws 409 with zones on a cache hit crossing a flood", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue({
      geometry: JSON.stringify(geometry),
    } as never);
    const zones = [{flagId: "flood-1", distanceMeters: 10}];
    jest.mocked(closureService.findBlocking).mockResolvedValue(zones as never);
    const fetchSpy = jest.spyOn(global, "fetch");
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("detours around a blocked route with source detour", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const direct = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const around = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.69, 10.79],
        [106.7, 10.78],
      ],
    };
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 2450, duration: 512, geometry: direct}],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 2600, duration: 560, geometry: around}],
        }),
      } as unknown as Response);
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
    jest.mocked(closureService.findBlocking)
      .mockResolvedValueOnce(zones as never)
      .mockResolvedValueOnce([]);
    const res = await getRoute(base);
    expect(res).toMatchObject({
      cached: false,
      source: "detour",
      hazards: zones,
      distanceMeters: 2600,
      durationSeconds: 560,
      geometry: around,
    });
    expect(res.via).toMatchObject({
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
    expect(routingCacheRepository.save).toHaveBeenCalledTimes(1);
    expect(activeRouteRepository.touch).toHaveBeenCalledWith(
      expect.any(String),
      "u1",
      around,
    );
  });

  it("throws 409 after detour attempts stay blocked", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 2450, duration: 512, geometry}],
      }),
    } as unknown as Response);
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
    jest.mocked(closureService.findBlocking).mockResolvedValue(zones as never);
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 409,
      errors: zones,
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("retries once when the engine connection drops", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 100, duration: 50, geometry}],
        }),
      } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    await expect(getRoute(base)).resolves.toMatchObject({source: "osrm"});
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws 500 when the engine stays unreachable", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("down"));
    await expect(getRoute(base)).rejects.toMatchObject({
      statusCode: 500,
      message: "Routing service unreachable",
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws 500 when OSRM is down", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    await expect(getRoute(base)).rejects.toMatchObject({statusCode: 500});
  });

  it("throws 404 when OSRM finds no route", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({code: "NoRoute", routes: []}),
    } as unknown as Response);
    await expect(getRoute(base)).rejects.toMatchObject({statusCode: 404});
  });

  it("adds exclude=narrowonly for the MEDIUM bucket", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    await getRoute({...base, width: 0.9});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("exclude=narrowonly");
  });

  it("omits exclude for NARROW and combines both for WIDE", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    await getRoute({...base, width: 0.5});
    await getRoute({...base, width: 1.5});
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).not.toContain("exclude=");
    expect(fetchSpy.mock.calls[1][0]).toContain(
      "exclude=narrowonly,mediumonly",
    );
  });

  it("sends stops in order in the OSRM coordinates", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    const stops = [{lat: 10.77, lng: 106.68}];
    await expect(getRoute({...base, stops})).resolves.toMatchObject({
      source: "osrm",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain(
      "106.6602,10.7626;106.68,10.77;106.7019,10.7758",
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
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
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
    const direct = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
        [106.7, 10.78],
      ],
    };
    const around = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.68, 10.77],
        [106.69, 10.79],
        [106.7, 10.78],
      ],
    };
    const fetchSpy = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 2450, duration: 512, geometry: direct}],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 2600, duration: 560, geometry: around}],
        }),
      } as unknown as Response);
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
    jest.mocked(closureService.findBlocking)
      .mockResolvedValueOnce(zones as never)
      .mockResolvedValueOnce([]);
    const res = await getRoute({
      ...base,
      stops: [{lat: 10.77, lng: 106.68}],
    });
    expect(res).toMatchObject({source: "detour", hazards: zones});
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const resolvecoords = String(fetchSpy.mock.calls[1][0]).split("?")[0];
    const points = resolvecoords.split("/").pop()?.split(";") ?? [];
    expect(points).toHaveLength(4);
    expect(points[0]).toBe("106.6602,10.7626");
    expect(points[1]).toBe("106.68,10.77");
    expect(points[3]).toBe("106.7019,10.7758");
  });

  it("409s when a stop cannot be located for the detour", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 2450, duration: 512, geometry}],
      }),
    } as unknown as Response);
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
    jest.mocked(closureService.findBlocking).mockResolvedValue(zones as never);
    await expect(
      getRoute({...base, stops: [{lat: 50, lng: 50}]}),
    ).rejects.toMatchObject({statusCode: 409, errors: zones});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("409s when the route crosses a narrower alley segment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 2450, duration: 512, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
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
  });

  it("passes compatible or unknown-width segments", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 2450, duration: 512, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    jest.mocked(
      alleySegmentRepository.findByGeohashPrefixes,
    ).mockResolvedValue([
      {id: "wide", lat: 10.77, lng: 106.68, baseWidth: 1.2, tier: "TIER2"},
      {id: "unknown", lat: 10.77, lng: 106.68, tier: "TIER2"},
      {id: "far", lat: 11.5, lng: 107.5, baseWidth: 0.4, tier: "TIER2"},
    ] as never);
    await expect(getRoute({...base, width: 0.9})).resolves.toMatchObject({
      source: "osrm",
    });
  });

  it("skips the width gate without a width", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    jest.mocked(closureService.findBlocking).mockResolvedValue([]);
    await expect(getRoute(base)).resolves.toMatchObject({source: "osrm"});
    expect(
      alleySegmentRepository.findByGeohashPrefixes,
    ).not.toHaveBeenCalled();
  });

  it("prefers the hazard block over the width gate", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(routingCacheRepository.findExisting).mockResolvedValue(null);
    const geometry = {type: "LineString", coordinates: [[1, 2]]};
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 100, duration: 50, geometry}],
      }),
    } as unknown as Response);
    jest.mocked(routingCacheRepository.save).mockResolvedValue(undefined);
    const zones = [{flagId: "flood-1", distanceMeters: 0}];
    jest.mocked(closureService.findBlocking).mockResolvedValue(zones as never);
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
    ).not.toHaveBeenCalled();
  });
});
