import {
  DISPATCH_STATUSES,
  PROVIDER_STATUSES,
  STATUS_DISPATCH,
  STATUS_GROUPS,
} from "../../../constants/status";

describe("status definitions", () => {
  it("defines every dispatch code including quoted", () => {
    expect(Object.keys(DISPATCH_STATUSES).sort()).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ]);
    expect(DISPATCH_STATUSES[STATUS_DISPATCH.QUOTED]).toMatchObject({
      domain: "dispatch",
      code: "9",
      name: "Quoted",
      order: 9,
    });
  });

  it("keeps dispatch copy helper-neutral", () => {
    const text = [
      DISPATCH_STATUSES[STATUS_DISPATCH.PENDING],
      DISPATCH_STATUSES[STATUS_DISPATCH.MATCHED],
      DISPATCH_STATUSES[STATUS_DISPATCH.ARRIVED],
    ].map((d) => d.description).join(" ");
    expect(text.toLowerCase()).not.toContain("mechanic");
  });

  it("exposes the providers domain", () => {
    expect(Object.keys(PROVIDER_STATUSES).sort()).toEqual([
      "ACTIVE", "DENIED", "PENDING",
    ]);
    expect(STATUS_GROUPS.providers).toBe(PROVIDER_STATUSES);
  });
});
