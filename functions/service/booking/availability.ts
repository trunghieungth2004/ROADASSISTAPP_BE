import * as bookingRepository from "../../repository/bookingRepository";
import * as providerRepository from "../../repository/providerRepository";
import {
  BOOKING_HORIZON_DAYS_MAX,
} from "../../constants/booking";
import {NotFoundError, ValidationError} from "../../utils/errors";
import {
  bookingSettings,
  buildSlots,
  dateKeyOf,
  dayBounds,
  rangesForDate,
  slotKeyOf,
} from "./slots";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const requireProvider = async (
  providerId: string,
): Promise<Record<string, unknown>> => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  return provider as unknown as Record<string, unknown>;
};

const confirmedMap = async (
  providerId: string,
  start: string,
  end: string,
): Promise<Map<string, number>> => {
  const rows = await bookingRepository.findForDay(providerId, start, end);
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = slotKeyOf(new Date(row.scheduledAt));
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

const getAvailability = async (input: {
  providerId: string;
  date?: string;
}): Promise<Record<string, unknown>> => {
  const provider = await requireProvider(input.providerId);
  const settings = bookingSettings(provider);
  const date = input.date ?? dateKeyOf(new Date());
  if (!DATE_SHAPE.test(date)) {
    throw new ValidationError("Invalid booking date");
  }
  const limit = new Date();
  limit.setDate(limit.getDate() + BOOKING_HORIZON_DAYS_MAX);
  if (Date.parse(`${date}T00:00:00Z`) > limit.getTime()) {
    throw new ValidationError("Date is too far ahead");
  }
  const bounds = dayBounds(date);
  const confirmed = await confirmedMap(
    input.providerId,
    bounds.start,
    bounds.end,
  );
  const slots = settings.bookingEnabled ?
    buildSlots({date, settings, confirmedBySlot: confirmed, now: new Date()}) :
    [];
  const ranges = settings.alwaysOpen ?
    [{open: 0, close: 24 * 60}] :
    rangesForDate(settings.hours, date);
  return {
    providerId: input.providerId,
    date,
    bookingEnabled: settings.bookingEnabled,
    slotMinutes: settings.slotMinutes,
    capacity: settings.capacity,
    leadMinutes: settings.leadMinutes,
    horizonDays: settings.horizonDays,
    alwaysOpen: settings.alwaysOpen,
    freeForm: settings.bookingEnabled && ranges.length === 0,
    outsideHoursAllowed: true,
    depositPolicy: typeof provider.depositPolicy === "string" ?
      provider.depositPolicy :
      "NONE",
    depositAmount: typeof provider.depositAmount === "number" ?
      provider.depositAmount :
      0,
    depositPercent: typeof provider.depositPercent === "number" ?
      provider.depositPercent :
      0,
    slots,
  };
};

export {getAvailability};
