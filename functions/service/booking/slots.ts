import {
  BOOKING_DEFAULTS,
  BOOKING_TIMEZONE_OFFSET_MINUTES,
} from "../../constants/booking";
import {parseScheduleRanges} from "../provider/schedule";

const OFFSET_MS = BOOKING_TIMEZONE_OFFSET_MINUTES * 60 * 1000;
const DOW_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MINUTES_IN_DAY = 24 * 60;

type BookingSettings = {
  bookingEnabled: boolean;
  slotMinutes: number;
  capacity: number;
  leadMinutes: number;
  horizonDays: number;
  alwaysOpen: boolean;
  hours: string | null;
};

type Range = {open: number; close: number};

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const bookingSettings = (
  provider: Record<string, unknown>,
): BookingSettings => ({
  bookingEnabled: provider.bookingEnabled === true,
  slotMinutes: num(
    provider.bookingSlotMinutes,
    BOOKING_DEFAULTS.slotMinutes,
  ),
  capacity: num(provider.bookingCapacity, BOOKING_DEFAULTS.capacity),
  leadMinutes: num(
    provider.bookingLeadMinutes,
    BOOKING_DEFAULTS.leadMinutes,
  ),
  horizonDays: num(
    provider.bookingHorizonDays,
    BOOKING_DEFAULTS.horizonDays,
  ),
  alwaysOpen: provider.bookingAlwaysOpen === true,
  hours: typeof provider.bookingHours === "string" &&
    provider.bookingHours.trim() !== "" ?
    provider.bookingHours :
    typeof provider.openHours === "string" ? provider.openHours : null,
});

const shifted = (at: Date): Date =>
  new Date(at.getTime() + OFFSET_MS);

const dateKeyOf = (at: Date): string =>
  shifted(at).toISOString().slice(0, 10);

const minutesOfDay = (at: Date): number => {
  const local = shifted(at);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

const slotKeyOf = (at: Date): string => {
  const minutes = minutesOfDay(at);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const slotKeyForMinutes = (minutes: number): string => {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const isoForLocal = (date: string, minutes: number): string =>
  new Date(
    Date.parse(`${date}T00:00:00Z`) + minutes * 60 * 1000 - OFFSET_MS,
  ).toISOString();

const dayBounds = (date: string): {start: string; end: string} => ({
  start: isoForLocal(date, 0),
  end: isoForLocal(date, MINUTES_IN_DAY),
});

const rangesForDate = (
  hours: string | null,
  date: string,
): Range[] => {
  if (!hours) return [];
  const dayIdx = new Date(`${date}T12:00:00Z`).getUTCDay();
  const day = DOW_KEYS[dayIdx] ?? "";
  const parsed = parseScheduleRanges(hours);
  const out: Range[] = [];
  for (const entry of parsed) {
    if (entry.day !== day) continue;
    const close = entry.open < entry.close ?
      Math.min(entry.close, MINUTES_IN_DAY) :
      MINUTES_IN_DAY;
    out.push({open: entry.open, close});
  }
  return out.sort((a, b) => a.open - b.open);
};

const withinRanges = (minutes: number, ranges: Range[]): boolean =>
  ranges.some((range) => minutes >= range.open && minutes < range.close);

const buildSlots = (input: {
  date: string;
  settings: BookingSettings;
  confirmedBySlot: Map<string, number>;
  now: Date;
}): Array<{
  at: string;
  slot: string;
  outsideHours: boolean;
  remaining: number;
}> => {
  const {date, settings, confirmedBySlot, now} = input;
  const ranges = settings.alwaysOpen ?
    [{open: 0, close: MINUTES_IN_DAY}] :
    rangesForDate(settings.hours, date);
  const slots = [];
  const earliest = now.getTime() + settings.leadMinutes * 60 * 1000;
  for (const range of ranges) {
    for (let m = range.open; m < range.close; m += settings.slotMinutes) {
      const at = isoForLocal(date, m);
      if (Date.parse(at) < earliest) continue;
      const slot = slotKeyForMinutes(m);
      const taken = confirmedBySlot.get(slot) ?? 0;
      const remaining = Math.max(0, settings.capacity - taken);
      slots.push({at, slot, outsideHours: false, remaining});
    }
  }
  return slots;
};

export {
  bookingSettings,
  dateKeyOf,
  minutesOfDay,
  slotKeyOf,
  isoForLocal,
  dayBounds,
  rangesForDate,
  withinRanges,
  buildSlots,
};
export type {BookingSettings, Range};
