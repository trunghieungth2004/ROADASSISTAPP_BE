import {
  buildBypassPoint,
  DETOUR_MARGINS_METERS,
} from "../../../utils/detour";
import {haversineMeters} from "../../../utils/geo";

const line = {
  type: "LineString",
  coordinates: [
    [106.66, 10.76],
    [106.7, 10.78],
  ],
};
const zone = {lat: 10.77, lng: 106.68, radiusMeters: 200};
const origin = {lat: 10.76, lng: 106.66};
const dest = {lat: 10.78, lng: 106.7};

describe("DETOUR_MARGINS_METERS", () => {
  it("escalates across three attempts", () => {
    expect(DETOUR_MARGINS_METERS).toEqual([20, 60, 120]);
  });
});

describe("buildBypassPoint", () => {
  it("builds a bypass outside the zone", () => {
    const via = buildBypassPoint(line, zone, 20, origin, dest);
    expect(via).not.toBeNull();
    expect(
      haversineMeters(via!.lat, via!.lng, zone.lat, zone.lng),
    ).toBeGreaterThan(zone.radiusMeters);
  });

  it("pushes the bypass farther as the margin grows", () => {
    const near = buildBypassPoint(line, zone, 20, origin, dest);
    const far = buildBypassPoint(line, zone, 120, origin, dest);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(
      haversineMeters(far!.lat, far!.lng, zone.lat, zone.lng),
    ).toBeGreaterThan(
      haversineMeters(near!.lat, near!.lng, zone.lat, zone.lng),
    );
  });

  it("returns null when an endpoint sits inside the zone", () => {
    expect(
      buildBypassPoint(line, zone, 20, {lat: 10.77, lng: 106.68}, dest),
    ).toBeNull();
    expect(
      buildBypassPoint(line, zone, 20, origin, {lat: 10.77, lng: 106.68}),
    ).toBeNull();
  });

  it("returns null for degenerate geometry", () => {
    const point = {type: "LineString", coordinates: [[106.68, 10.77]]};
    expect(buildBypassPoint(point, zone, 20, origin, dest)).toBeNull();
    expect(
      buildBypassPoint({type: "LineString", coordinates: []}, zone, 20,
        origin, dest),
    ).toBeNull();
    expect(buildBypassPoint(null, zone, 20, origin, dest)).toBeNull();
  });

  it("returns null for an invalid zone or margin", () => {
    expect(
      buildBypassPoint(line, {...zone, radiusMeters: 0}, 20, origin, dest),
    ).toBeNull();
    expect(buildBypassPoint(line, zone, -1, origin, dest)).toBeNull();
  });
});
