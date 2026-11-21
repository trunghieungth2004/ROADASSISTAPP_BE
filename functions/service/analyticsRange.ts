import {ValidationError} from "../utils/errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ANALYTICS_DAYS = 365;
const DEFAULT_ANALYTICS_DAYS = 30;

type AnalyticsRange = {
  startDate: string;
  endDate: string;
  from: string;
  to: string;
  days: number;
};

const dayKey = (value: Date): string => value.toISOString().slice(0, 10);

const parseDay = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(date) === value ? date : null;
};

const addDays = (date: Date, amount: number): Date =>
  new Date(date.getTime() + amount * DAY_MS);

const resolveAnalyticsRange = ({
  days,
  startDate,
  endDate,
}: {
  days?: number;
  startDate?: string;
  endDate?: string;
}): AnalyticsRange => {
  const today = new Date();
  const todayKey = dayKey(today);
  const requestedEnd = endDate ?? todayKey;
  const end = parseDay(requestedEnd);
  if (!end) throw new ValidationError("endDate must be YYYY-MM-DD");
  let requestedStart = startDate;
  if (requestedStart === undefined || requestedStart === "") {
    const span = typeof days === "number" ? days : DEFAULT_ANALYTICS_DAYS;
    if (!Number.isInteger(span) || span < 1 || span > MAX_ANALYTICS_DAYS) {
      throw new ValidationError("days must be between 1 and 365");
    }
    requestedStart = dayKey(addDays(end, -(span - 1)));
  }
  const start = parseDay(requestedStart);
  if (!start) throw new ValidationError("startDate must be YYYY-MM-DD");
  const span = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (span < 1) {
    throw new ValidationError("startDate must be on or before endDate");
  }
  if (span > MAX_ANALYTICS_DAYS) {
    throw new ValidationError("Date range cannot exceed 365 days");
  }
  return {
    startDate: requestedStart,
    endDate: requestedEnd,
    from: `${requestedStart}T00:00:00.000Z`,
    to: `${requestedEnd}T23:59:59.999Z`,
    days: span,
  };
};

const dayKeysBetween = (startDate: string, endDate: string): string[] => {
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  if (!start || !end) return [];
  const keys: string[] = [];
  for (let index = 0; index <= MAX_ANALYTICS_DAYS; index += 1) {
    const date = addDays(start, index);
    if (date.getTime() > end.getTime()) break;
    keys.push(dayKey(date));
  }
  return keys;
};

const previousRange = (range: AnalyticsRange): AnalyticsRange => {
  const start = parseDay(range.startDate);
  if (!start) return range;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(range.days - 1));
  return {
    startDate: dayKey(previousStart),
    endDate: dayKey(previousEnd),
    from: `${dayKey(previousStart)}T00:00:00.000Z`,
    to: `${dayKey(previousEnd)}T23:59:59.999Z`,
    days: range.days,
  };
};

export {
  DAY_MS,
  MAX_ANALYTICS_DAYS,
  DEFAULT_ANALYTICS_DAYS,
  resolveAnalyticsRange,
  dayKeysBetween,
  previousRange,
};
export type {AnalyticsRange};
