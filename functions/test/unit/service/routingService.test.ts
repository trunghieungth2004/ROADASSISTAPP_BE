import * as routingCacheRepository from
  "../../../repository/routingCacheRepository";
import * as userRepository from "../../../repository/userRepository";
import {getRoute, widthToBucket} from "../../../service/routingService";

jest.mock("../../../repository/routingCacheRepository");
jest.mock("../../../repository/userRepository");

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
});
