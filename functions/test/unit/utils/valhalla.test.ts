import {haversineMeters} from "../../../utils/geo";
import {
  circleToRing,
  decodePolyline6,
  postRoute,
  postRoutes,
  ServiceError,
} from "../../../utils/valhalla";

const SHAPE_A = "ou{oSou_mjEomMote@oiJwwi@";
const COORDS_A: Array<[number, number]> = [
  [106.6602, 10.7626],
  [106.68, 10.77],
  [106.7019, 10.7758],
];
const SHAPE_B = "_svoS_i_mjE_ry@_ry@~oR_pR";

const tripBody = (
  shapes: string[],
  length = 2.45,
  time = 512,
): Record<string, unknown> => ({
  trip: {
    legs: shapes.map((shape) => ({shape})),
    summary: {length, time},
  },
});

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as Response;

describe("decodePolyline6", () => {
  it("decodes an empty string to no coordinates", () => {
    expect(decodePolyline6("")).toEqual([]);
  });

  it("decodes a multi-point shape", () => {
    const coords = decodePolyline6(SHAPE_A);
    expect(coords).toHaveLength(COORDS_A.length);
    for (let i = 0; i < COORDS_A.length; i++) {
      expect(coords[i][0]).toBeCloseTo(COORDS_A[i][0], 6);
      expect(coords[i][1]).toBeCloseTo(COORDS_A[i][1], 6);
    }
  });

  it("decodes delta-encoded segments", () => {
    const coords = decodePolyline6(SHAPE_B);
    expect(coords).toHaveLength(3);
    expect(coords[0][0]).toBeCloseTo(106.66, 6);
    expect(coords[2][1]).toBeCloseTo(10.78, 6);
  });
});

describe("circleToRing", () => {
  it("returns a closed ring with steps + 1 points", () => {
    const ring = circleToRing(10.77, 106.68, 200);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("approximates the requested radius", () => {
    const ring = circleToRing(10.77, 106.68, 200);
    for (const [lng, lat] of ring) {
      expect(haversineMeters(10.77, 106.68, lat, lng)).toBeCloseTo(200, -1);
    }
  });

  it("returns no ring for invalid input", () => {
    expect(circleToRing(NaN, 106.68, 200)).toEqual([]);
    expect(circleToRing(10.77, 106.68, 0)).toEqual([]);
    expect(circleToRing(10.77, 106.68, -5)).toEqual([]);
  });
});

describe("postRoute", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("normalizes a single-leg trip", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(okResponse(tripBody([SHAPE_A], 2.45, 512)));
    const res = await postRoute([
      {lat: 10.7626, lng: 106.6602},
      {lat: 10.7758, lng: 106.7019},
    ]);
    expect(res.geometry.type).toBe("LineString");
    expect(res.geometry.coordinates).toHaveLength(3);
    expect(res.geometry.coordinates[0][0]).toBeCloseTo(106.6602, 6);
    expect(res.distanceMeters).toBeCloseTo(2450, 6);
    expect(res.durationSeconds).toBe(512);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/route");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.costing).toBe("motor_scooter");
    expect(sent.locations).toEqual([
      {lat: 10.7626, lon: 106.6602},
      {lat: 10.7758, lon: 106.7019},
    ]);
    expect(sent.exclude_polygons).toBeUndefined();
  });

  it("merges legs without duplicating the junction", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        okResponse(tripBody([SHAPE_A, "onupSwcqojEoeGgjb@"], 4.9, 900)),
      );
    const res = await postRoute([
      {lat: 10.7626, lng: 106.6602},
      {lat: 10.77, lng: 106.68},
      {lat: 10.7758, lng: 106.7019},
    ]);
    expect(res.geometry.coordinates).toHaveLength(4);
    expect(res.geometry.coordinates[3][0]).toBeCloseTo(106.72, 6);
    expect(res.distanceMeters).toBeCloseTo(4900, 6);
  });

  it("sends exclusion rings when provided", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(okResponse(tripBody([SHAPE_A])));
    const ring = circleToRing(10.77, 106.68, 200);
    await postRoute([{lat: 10.7626, lng: 106.6602}], [ring]);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.exclude_polygons).toEqual([ring]);
  });

  it("throws 404 when no path exists", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error_code: 442,
        error: "No path could be found for input",
      }),
    } as unknown as Response);
    await expect(
      postRoute([{lat: 10.7626, lng: 106.6602}]),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("throws 500 with the engine status otherwise", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    const err = await postRoute([{lat: 10.7626, lng: 106.6602}]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ServiceError);
    expect(err).toMatchObject({statusCode: 500});
  });

  it("throws 404 when the trip has no legs", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(okResponse({trip: {legs: []}}));
    await expect(
      postRoute([{lat: 10.7626, lng: 106.6602}]),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("retries once when the connection drops", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse(tripBody([SHAPE_A])));
    const res = await postRoute([{lat: 10.7626, lng: 106.6602}]);
    expect(res.geometry.coordinates).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws 500 when the engine stays unreachable", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new TypeError("down"));
    await expect(
      postRoute([{lat: 10.7626, lng: 106.6602}]),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: "Routing service unreachable",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("postRoutes", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("requests and parses up to 3 routes for two locations", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      okResponse({
        ...tripBody([SHAPE_A], 2.45, 512),
        alternates: [
          {trip: tripBody([SHAPE_B], 2.6, 560).trip},
          {trip: tripBody([SHAPE_B], 2.8, 610).trip},
        ],
      }),
    );
    const res = await postRoutes(
      [
        {lat: 10.7626, lng: 106.6602},
        {lat: 10.7758, lng: 106.7019},
      ],
      [],
      3,
    );
    expect(res).toHaveLength(3);
    expect(res[0].distanceMeters).toBeCloseTo(2450, 6);
    expect(res[1].distanceMeters).toBeCloseTo(2600, 6);
    expect(res[2].durationSeconds).toBe(610);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.alternates).toBe(2);
  });

  it("omits alternates for multi-point requests", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(okResponse(tripBody([SHAPE_A])));
    const res = await postRoutes(
      [
        {lat: 10.7626, lng: 106.6602},
        {lat: 10.77, lng: 106.68},
        {lat: 10.7758, lng: 106.7019},
      ],
      [],
      3,
    );
    expect(res).toHaveLength(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.alternates).toBeUndefined();
  });

  it("skips alternates without a usable shape", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      okResponse({
        ...tripBody([SHAPE_A], 2.45, 512),
        alternates: [{trip: {legs: [], summary: {length: 1, time: 1}}}],
      }),
    );
    const res = await postRoutes(
      [
        {lat: 10.7626, lng: 106.6602},
        {lat: 10.7758, lng: 106.7019},
      ],
      [],
      3,
    );
    expect(res).toHaveLength(1);
  });
});
