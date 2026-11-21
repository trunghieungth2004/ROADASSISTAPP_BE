import {
  resolveAnalyticsRange,
  dayKeysBetween,
  previousRange,
  MAX_ANALYTICS_DAYS,
  DEFAULT_ANALYTICS_DAYS,
} from "../../../service/analyticsRange";

test("explicit ranges resolve inclusive dates and spans", () => {
  const range = resolveAnalyticsRange({
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });
  expect(range.startDate).toBe("2026-10-01");
  expect(range.endDate).toBe("2026-10-31");
  expect(range.from).toBe("2026-10-01T00:00:00.000Z");
  expect(range.to).toBe("2026-10-31T23:59:59.999Z");
  expect(range.days).toBe(31);
});

test("omitted start uses days or the 30-day default", () => {
  const today = new Date().toISOString().slice(0, 10);
  expect(resolveAnalyticsRange({endDate: today}).days).toBe(DEFAULT_ANALYTICS_DAYS);
  expect(resolveAnalyticsRange({endDate: today, days: 7}).days).toBe(7);
});

test("rejects reversed, malformed, oversized and out-of-bounds ranges", () => {
  expect(() => resolveAnalyticsRange({
    startDate: "2026-10-02",
    endDate: "2026-10-01",
  })).toThrow("startDate must be on or before endDate");
  expect(() => resolveAnalyticsRange({
    startDate: "2026-02-30",
    endDate: "2026-03-01",
  })).toThrow("startDate must be YYYY-MM-DD");
  expect(() => resolveAnalyticsRange({
    startDate: "2025-01-01",
    endDate: "2026-01-02",
  })).toThrow("Date range cannot exceed 365 days");
  expect(() => resolveAnalyticsRange({endDate: "2026-01-01", days: 0}))
    .toThrow("days must be between 1 and 365");
  expect(() => resolveAnalyticsRange({endDate: "2026-01-01", days: 366}))
    .toThrow("days must be between 1 and 365");
});

test("day keys are inclusive and cap at the maximum window", () => {
  expect(dayKeysBetween("2026-10-30", "2026-11-02")).toEqual([
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
  ]);
  expect(dayKeysBetween("2026-01-01", "2026-12-31")).toHaveLength(MAX_ANALYTICS_DAYS);
});

test("previous ranges end the day before and keep the same span", () => {
  const range = resolveAnalyticsRange({
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });
  expect(previousRange(range)).toMatchObject({
    startDate: "2026-08-31",
    endDate: "2026-09-30",
    days: 31,
    from: "2026-08-31T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
  });
});
