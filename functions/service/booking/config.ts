import {
  BOOKING_DEFAULTS,
  BOOKING_DEPOSIT_MAX,
  BOOKING_DEPOSIT_PERCENT_MAX,
  BOOKING_HORIZON_DAYS_MAX,
  BOOKING_LEAD_MINUTES_MAX,
} from "../../constants/booking";

const bookingConfigDefaults = {
  slotMinutes: BOOKING_DEFAULTS.slotMinutes,
  capacity: BOOKING_DEFAULTS.capacity,
  leadMinutes: BOOKING_DEFAULTS.leadMinutes,
  horizonDays: BOOKING_DEFAULTS.horizonDays,
  slotMinutesMin: 15,
  slotMinutesMax: 120,
  capacityMax: 10,
  leadMinutesMax: BOOKING_LEAD_MINUTES_MAX,
  horizonDaysMax: BOOKING_HORIZON_DAYS_MAX,
  depositPercentMax: BOOKING_DEPOSIT_PERCENT_MAX,
  depositMax: BOOKING_DEPOSIT_MAX,
};

export {bookingConfigDefaults};
