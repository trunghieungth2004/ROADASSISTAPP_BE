import * as flagRepository from "../../../repository/flagRepository";
import {findBlocking} from "../../../service/closureService";

jest.mock("../../../repository/flagRepository");

const line = {
  type: "LineString",
  coordinates: [
    [106.66, 10.76],
    [106.7, 10.78],
  ],
};

const flood = (overrides: Record<string, unknown> = {}) => ({
  id: "flood-1",
  type: "FLOOD",
  status: "2",
  lat: 10.77,
  lng: 106.68,
  radiusMeters: null,
  note: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("closureService.findBlocking", () => {
  it("returns [] without touching the repo for empty geometry", async () => {
    await expect(findBlocking(null)).resolves.toEqual([]);
    await expect(
      findBlocking({type: "LineString", coordinates: []}),
    ).resolves.toEqual([]);
    expect(flagRepository.findByGeohashPrefixes).not.toHaveBeenCalled();
  });

  it("reports a confirmed flood on the route", async () => {
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      flood(),
    ] as never);
    const zones = await findBlocking(line);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      flagId: "flood-1",
      type: "FLOOD",
      radiusMeters: 200,
    });
  });

  it("honors per-flag radiusMeters over the default", async () => {
    const off = {lat: 10.775, lng: 106.68};
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      flood({id: "narrow", ...off, radiusMeters: 100}),
      flood({id: "wide", ...off, radiusMeters: 1000}),
    ] as never);
    const zones = await findBlocking(line);
    expect(zones.map((z) => z.flagId)).toEqual(["wide"]);
  });

  it("blocks obstruction/accident flags with 100 m defaults", async () => {
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      flood({id: "obstruction-1", type: "OBSTRUCTION"}),
      flood({id: "accident-1", type: "ACCIDENT"}),
    ] as never);
    const zones = await findBlocking(line);
    expect(zones.map((z) => z.flagId).sort()).toEqual([
      "accident-1",
      "obstruction-1",
    ]);
    for (const zone of zones) {
      expect(zone.radiusMeters).toBe(100);
    }
  });

  it("reports locked flags as blocking", async () => {
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      flood({id: "locked", status: "3"}),
    ] as never);
    const zones = await findBlocking(line);
    expect(zones.map((z) => z.flagId)).toEqual(["locked"]);
  });

  it("ignores non-blocking flags", async () => {
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      flood({id: "suggested", status: "1"}),
      flood({id: "expired", status: "4"}),
      flood({id: "rejected", status: "5"}),
      flood({id: "far", lat: 11.7, lng: 107.6}),
    ] as never);
    await expect(findBlocking(line)).resolves.toEqual([]);
  });

  it("sorts multiple hits by distance", async () => {
    jest.mocked(flagRepository.findByGeohashPrefixes).mockResolvedValue([
      flood({id: "edge", lat: 10.761, lng: 106.661, radiusMeters: 500}),
      flood({id: "center", lat: 10.77, lng: 106.68}),
    ] as never);
    const zones = await findBlocking(line);
    expect(zones.map((z) => z.flagId)).toEqual(["center", "edge"]);
  });
});
