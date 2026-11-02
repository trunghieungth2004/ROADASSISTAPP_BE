import {trackedDeadheadKm} from "../../../../service/dispatch/helpers";

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();

describe("trackedDeadheadKm", () => {
  it("sums only the current assignment and stops at pickup", () => {
    const km = trackedDeadheadKm({
      lat: 10.7025,
      lng: 106.6,
      assignedAt: at(0),
      jobTrack: [
        {lat: 10.7, lng: 106.6, at: at(-10), shopId: "old"},
        {lat: 10.7, lng: 106.6, at: at(1), shopId: "tow1"},
        {lat: 10.701, lng: 106.6, at: at(10), shopId: "tow1"},
        {lat: 10.702, lng: 106.6, at: at(20), shopId: "tow1"},
        {lat: 10.703, lng: 106.6, at: at(30), shopId: "tow1"},
      ],
    }, "tow1");
    expect(km).not.toBeNull();
    expect(km).toBeGreaterThan(0.1);
    expect(km).toBeLessThan(0.3);
  });

  it("returns null when the track has no usable points", () => {
    expect(trackedDeadheadKm({
      lat: 10.7,
      lng: 106.6,
      assignedAt: at(0),
      jobTrack: [{lat: 10.7, lng: 106.6, at: at(1), shopId: "tow1"}],
    }, "tow1")).toBeNull();
  });
});
