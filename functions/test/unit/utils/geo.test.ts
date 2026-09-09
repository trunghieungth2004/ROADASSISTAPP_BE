import {
  encodeGeohash,
  decodeGeohash,
  haversineMeters,
  boundsForRadiusMeters,
  isWithinRadiusMeters,
} from "../../../utils/geo";

describe("encodeGeohash / decodeGeohash", () => {
  it("produces a deterministic string of the requested precision", () => {
    const a = encodeGeohash(10.7626, 106.6602, 9);
    expect(a).toHaveLength(9);
    expect(encodeGeohash(10.7626, 106.6602, 9)).toBe(a);
    expect(encodeGeohash(10.7626, 106.6602, 5)).toBe(a.slice(0, 5));
  });

  it("round-trips within the cell tolerance", () => {
    const lat = 10.7626;
    const lng = 106.6602;
    const decoded = decodeGeohash(encodeGeohash(lat, lng, 9));
    expect(Math.abs(decoded.latitude - lat)).toBeLessThan(0.001);
    expect(Math.abs(decoded.longitude - lng)).toBeLessThan(0.001);
  });

  it("throws on invalid characters", () => {
    expect(() => decodeGeohash("zzz!")).toThrow();
  });
});

describe("haversineMeters", () => {
  it("returns zero for identical points", () => {
    expect(haversineMeters(10.7, 106.6, 10.7, 106.6)).toBe(0);
  });

  it("matches one equatorial degree of longitude", () => {
    expect(haversineMeters(0, 0, 0, 1)).toBeCloseTo(111195, 0);
  });
});

describe("boundsForRadiusMeters", () => {
  it("returns a symmetric box around the center", () => {
    const bounds = boundsForRadiusMeters(10.7626, 106.6602, 2000);
    expect(bounds.minLat).toBeLessThan(10.7626);
    expect(bounds.maxLat).toBeGreaterThan(10.7626);
    expect(bounds.minLng).toBeLessThan(106.6602);
    expect(bounds.maxLng).toBeGreaterThan(106.6602);
    expect(10.7626 - bounds.minLat).toBeCloseTo(
      bounds.maxLat - 10.7626, 10
    );
  });
});

describe("isWithinRadiusMeters", () => {
  it("accepts the center and the boundary, rejects far points", () => {
    expect(isWithinRadiusMeters(10.7, 106.6, 10.7, 106.6, 100)).toBe(true);
    expect(isWithinRadiusMeters(11.7, 106.6, 10.7, 106.6, 100)).toBe(false);
  });
});
