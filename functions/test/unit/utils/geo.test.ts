import {
  encodeGeohash,
  decodeGeohash,
  haversineMeters,
  boundsForRadiusMeters,
  isWithinRadiusMeters,
  pointToSegmentMeters,
  lineStringHitsCircles,
  cellsForBounds,
  cellsCoveringBounds,
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

describe("pointToSegmentMeters", () => {
  it("returns zero for a point on the segment", () => {
    expect(pointToSegmentMeters(10.7, 106.65, 10.7, 106.6, 10.7, 106.7))
      .toBeCloseTo(0, 6);
  });

  it("measures the perpendicular offset", () => {
    expect(pointToSegmentMeters(10.701, 106.65, 10.7, 106.6, 10.7, 106.7))
      .toBeCloseTo(110.6, 0);
  });

  it("clamps to the nearer endpoint past the ends", () => {
    const atEnd = haversineMeters(10.7, 106.701, 10.7, 106.7);
    expect(pointToSegmentMeters(10.7, 106.701, 10.7, 106.6, 10.7, 106.7))
      .toBeCloseTo(atEnd, 0);
  });

  it("falls back to point distance for a degenerate segment", () => {
    expect(pointToSegmentMeters(10.7, 106.602, 10.7, 106.6, 10.7, 106.6))
      .toBeCloseTo(haversineMeters(10.7, 106.6, 10.7, 106.602), 0);
  });
});

describe("lineStringHitsCircles", () => {
  const line = {
    type: "LineString",
    coordinates: [
      [106.6, 10.7],
      [106.7, 10.7],
    ],
  };

  it("hits a zone centered on the line", () => {
    const hits = lineStringHitsCircles(line, [
      {flagId: "f1", lat: 10.7, lng: 106.65, radiusMeters: 200},
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].flagId).toBe("f1");
    expect(hits[0].distanceMeters).toBeCloseTo(0, 6);
  });

  it("misses a zone far from the line", () => {
    const hits = lineStringHitsCircles(line, [
      {flagId: "f1", lat: 11.7, lng: 106.65, radiusMeters: 200},
    ]);
    expect(hits).toEqual([]);
  });

  it("respects the boundary and sorts by distance", () => {
    const hits = lineStringHitsCircles(line, [
      {flagId: "far", lat: 10.702, lng: 106.65, radiusMeters: 300},
      {flagId: "near", lat: 10.7, lng: 106.66, radiusMeters: 200},
      {flagId: "out", lat: 10.71, lng: 106.65, radiusMeters: 200},
    ]);
    expect(hits.map((h) => h.flagId)).toEqual(["near", "far"]);
  });

  it("hits a route fully contained in a zone", () => {
    const inside = {
      type: "LineString",
      coordinates: [
        [106.65, 10.7],
        [106.651, 10.7005],
      ],
    };
    const hits = lineStringHitsCircles(inside, [
      {flagId: "f1", lat: 10.7002, lng: 106.6505, radiusMeters: 500},
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].flagId).toBe("f1");
  });

  it("ignores malformed coordinates and zones", () => {
    expect(
      lineStringHitsCircles(
        {type: "LineString", coordinates: [["a", "b"], [null, {}]]},
        [{flagId: "f1", lat: 10.7, lng: 106.65, radiusMeters: 200}],
      ),
    ).toEqual([]);
    expect(
      lineStringHitsCircles(line, [
        {flagId: "f1", lat: 10.7, lng: 106.65, radiusMeters: "x"},
      ] as never),
    ).toEqual([]);
  });

  it("handles single-point and malformed geometry", () => {
    const zone = {flagId: "f1", lat: 10.7, lng: 106.65, radiusMeters: 200};
    const point = {type: "LineString", coordinates: [[106.65, 10.7]]};
    expect(lineStringHitsCircles(point, [zone])).toHaveLength(1);
    expect(lineStringHitsCircles({type: "LineString", coordinates: []}, [zone]))
      .toEqual([]);
    expect(lineStringHitsCircles(null, [zone])).toEqual([]);
    expect(lineStringHitsCircles(line, [])).toEqual([]);
  });
});

describe("cellsForBounds", () => {
  it("returns unique 5-char cells covering the bounds", () => {
    const cells = cellsForBounds({
      minLat: 10.75,
      maxLat: 10.78,
      minLng: 106.69,
      maxLng: 106.71,
    });
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(9);
    for (const cell of cells) expect(cell).toHaveLength(5);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("covers the center cell of a point", () => {
    const cells = cellsForBounds({
      minLat: 10.7626,
      maxLat: 10.7626,
      minLng: 106.6602,
      maxLng: 106.6602,
    });
    expect(cells).toContain(
      encodeGeohash(10.7626, 106.6602, 5),
    );
  });
});

describe("cellsCoveringBounds", () => {
  it("contains the cells of the bounds corners and center", () => {
    const bounds = {
      minLat: 10.7,
      maxLat: 10.9,
      minLng: 106.6,
      maxLng: 106.8,
    };
    const cells = cellsCoveringBounds(bounds);
    const probes: Array<[number, number]> = [
      [bounds.minLat, bounds.minLng],
      [bounds.minLat, bounds.maxLng],
      [bounds.maxLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng],
      [
        (bounds.minLat + bounds.maxLat) / 2,
        (bounds.minLng + bounds.maxLng) / 2,
      ],
      // interleave between old 9-sample gaps
      [10.75, 106.68],
      [10.83, 106.74],
    ];
    for (const [lat, lng] of probes) {
      expect(cells).toContain(encodeGeohash(lat, lng, 5));
    }
  });

  it("returns unique 5-char cells", () => {
    const cells = cellsCoveringBounds({
      minLat: 10.75,
      maxLat: 10.78,
      minLng: 106.69,
      maxLng: 106.71,
    });
    for (const cell of cells) expect(cell).toHaveLength(5);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("covers a degenerate point", () => {
    const cells = cellsCoveringBounds({
      minLat: 10.7626,
      maxLat: 10.7626,
      minLng: 106.6602,
      maxLng: 106.6602,
    });
    expect(cells).toContain(encodeGeohash(10.7626, 106.6602, 5));
  });

  it("coarsens precision for giant bounds within a sane query count", () => {
    const cells = cellsCoveringBounds(
      {minLat: -60, maxLat: 60, minLng: -120, maxLng: 120},
      5,
      200,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(600);
    for (const cell of cells) {
      expect(cell.length).toBeLessThanOrEqual(5);
    }
  });

  it("covers cells along a long route that 9-sample lookup can miss", () => {
    const bounds = {
      minLat: 10.65,
      maxLat: 10.75,
      minLng: 106.55,
      maxLng: 106.95,
    };
    const legacy = new Set(cellsForBounds(bounds));
    const full = new Set(cellsCoveringBounds(bounds));
    const misses: string[] = [];
    for (let lng = 106.56; lng <= 106.94; lng += 0.005) {
      const cell = encodeGeohash(10.7, lng, 5);
      if (!legacy.has(cell)) misses.push(cell);
    }
    expect(misses.length).toBeGreaterThan(0);
    for (const cell of misses) {
      expect(full.has(cell)).toBe(true);
    }
  });
});
