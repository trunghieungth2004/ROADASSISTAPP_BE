import {
  steerThroughCorridor,
  STEER_MAX_CANDIDATES,
} from "../../../../service/routing/corridor";
import {postRoutes} from "../../../../utils/valhalla";

jest.mock("../../../../utils/valhalla", () => {
  const actual = jest.requireActual("../../../../utils/valhalla") as Record<
    string,
    unknown
  >;
  return {...actual, postRoutes: jest.fn()};
});

const mockPostRoutes = jest.mocked(postRoutes);

type Line = {type: "LineString"; coordinates: Array<[number, number]>};

const origin = {lat: 10, lng: 106};
const destination = {lat: 10, lng: 106.01};

const cluster = [
  {flagId: "mid", lat: 10, lng: 106.005, radiusMeters: 200},
];

const cleanCheck = () =>
  jest.fn().mockResolvedValue({hazards: [], widthBlocks: [], widthTight: []});

const routeFor = (
  lng: number,
  distanceMeters: number,
  durationSeconds: number,
) => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [106, 10],
      [lng, 10],
      [106.01, 10],
    ],
  } as Line,
  distanceMeters,
  durationSeconds,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("steerThroughCorridor", () => {
  it("adopts the shortest clean candidate", async () => {
    mockPostRoutes
      .mockResolvedValueOnce([routeFor(106.004, 3900, 300)])
      .mockResolvedValueOnce([routeFor(106.003, 3300, 240)])
      .mockResolvedValueOnce([routeFor(106.006, 3600, 270)]);
    const check = cleanCheck();
    const res = await steerThroughCorridor({
      origin,
      destination,
      costing: "motor_scooter",
      rings: [],
      cluster: cluster as never,
      check,
    });
    expect(res).toMatchObject({
      distanceMeters: 3300,
      durationSeconds: 240,
    });
    expect(res?.geometry).toEqual(routeFor(106.003, 3300, 240).geometry);
    expect(mockPostRoutes).toHaveBeenCalledTimes(STEER_MAX_CANDIDATES);
    const anchors = mockPostRoutes.mock.calls.map(
      (call) => (call[0] as Array<{lat: number; lng: number}>)[1],
    );
    for (const anchor of anchors) {
      expect(anchor).toBeDefined();
      expect(anchor).not.toEqual(origin);
      expect(anchor).not.toEqual(destination);
    }
    expect(new Set(anchors.map((a) => `${a.lat},${a.lng}`)).size).toBe(
      STEER_MAX_CANDIDATES,
    );
  });

  it("keeps every anchor clear of zones, controls and the axis", async () => {
    mockPostRoutes.mockResolvedValue([routeFor(106.003, 3300, 240)]);
    const res = await steerThroughCorridor({
      origin,
      destination,
      costing: "motor_scooter",
      rings: [],
      cluster: cluster as never,
      check: cleanCheck(),
    });
    expect(res).not.toBeNull();
    const cosLat = Math.cos((origin.lat * Math.PI) / 180);
    const vx = (destination.lng - origin.lng) * cosLat;
    const vy = destination.lat - origin.lat;
    const denom = vx * vx + vy * vy;
    for (const call of mockPostRoutes.mock.calls) {
      const anchor = (call[0] as Array<{lat: number; lng: number}>)[1];
      for (const zone of cluster) {
        const dy = (anchor.lat - zone.lat) * 111320;
        const dx = (anchor.lng - zone.lng) * 111320 * cosLat;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(zone.radiusMeters);
      }
      for (const control of [origin, destination]) {
        const dy = (anchor.lat - control.lat) * 111320;
        const dx = (anchor.lng - control.lng) * 111320 * cosLat;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(150);
      }
      const wx = (anchor.lng - origin.lng) * cosLat;
      const wy = anchor.lat - origin.lat;
      const progress = (wx * vx + wy * vy) / denom;
      expect(progress).toBeGreaterThan(0.15);
      expect(progress).toBeLessThan(0.85);
    }
  });

  it("returns null when every candidate stays dirty", async () => {
    mockPostRoutes.mockResolvedValue([routeFor(106.003, 3300, 240)]);
    const check = jest.fn().mockResolvedValue({
      hazards: cluster,
      widthBlocks: [],
      widthTight: [],
    });
    const res = await steerThroughCorridor({
      origin,
      destination,
      costing: "motor_scooter",
      rings: [],
      cluster: cluster as never,
      check,
    });
    expect(res).toBeNull();
    expect(mockPostRoutes).toHaveBeenCalledTimes(STEER_MAX_CANDIDATES);
  });

  it("returns null for an empty cluster", async () => {
    const res = await steerThroughCorridor({
      origin,
      destination,
      costing: "motor_scooter",
      rings: [],
      cluster: [],
      check: cleanCheck(),
    });
    expect(res).toBeNull();
    expect(mockPostRoutes).not.toHaveBeenCalled();
  });
});
