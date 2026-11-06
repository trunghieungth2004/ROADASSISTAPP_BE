import * as bookingRepository from "../../repository/bookingRepository";
import * as providerRepository from "../../repository/providerRepository";
import {sendBookingPush} from "../push/booking";
import {
  BOOKING_REMINDER_FALLBACK_MINUTES,
  BOOKING_REMINDER_SWEEP_BUFFER_MINUTES,
  BOOKING_STATUS,
} from "../../constants/booking";
import {postRoute} from "../../utils/valhalla";
import {haversineMeters} from "../../utils/geo";

const FALLBACK_SPEED_KMH = 25;

type BookingLike = {
  scheduledAt: string;
  arrivalMode?: string;
  origin?: {lat: number; lng: number} | null;
  reminder?: {
    bufferMinutes?: number;
  } | null;
};

const originOf = (
  booking: BookingLike,
): {lat: number; lng: number} | null => {
  const origin = booking.origin;
  if (!origin || typeof origin.lat !== "number" ||
    typeof origin.lng !== "number") {
    return null;
  }
  return origin;
};

const travelMinutes = async (
  booking: BookingLike,
  origin: {lat: number; lng: number},
  shop: {lat: number; lng: number},
): Promise<number> => {
  const costing = booking.arrivalMode === "TOW" ?
    "auto" :
    "motor_scooter";
  try {
    const route = await postRoute(
      [{lat: origin.lat, lng: origin.lng}, shop],
      [],
      costing,
    );
    return Math.max(1, Math.ceil(route.durationSeconds / 60));
  } catch {
    const km = haversineMeters(origin.lat, origin.lng, shop.lat, shop.lng) /
      1000;
    return Math.max(1, Math.ceil(km / FALLBACK_SPEED_KMH * 60));
  }
};

const reminderAtFor = async (
  booking: BookingLike,
  shop: {lat: number; lng: number},
): Promise<string> => {
  const at = Date.parse(booking.scheduledAt);
  if (!Number.isFinite(at)) {
    return new Date(Date.now() + 60 * 1000).toISOString();
  }
  const buffer = typeof booking.reminder?.bufferMinutes === "number" ?
    booking.reminder.bufferMinutes :
    BOOKING_REMINDER_FALLBACK_MINUTES;
  const origin = originOf(booking);
  const travel = origin === null ?
    BOOKING_REMINDER_FALLBACK_MINUTES :
    await travelMinutes(booking, origin, shop);
  const leaveAt = at - (travel + buffer) * 60 * 1000;
  const fireAt = leaveAt - BOOKING_REMINDER_SWEEP_BUFFER_MINUTES * 60 * 1000;
  return new Date(fireAt).toISOString();
};

export type {BookingLike};

const sendReminderForBooking = async (
  booking: {
    id: string;
    riderUid: string;
    providerId: string;
    providerName: string;
    scheduledAt: string;
    arrivalMode: string;
    origin?: {lat: number; lng: number} | null;
    reminder?: {
      mode?: string;
      bufferMinutes?: number;
      reminderAt?: string | null;
      sentAt?: string | null;
    } | null;
  },
): Promise<boolean> => {
  if (booking.reminder?.sentAt !== null &&
    booking.reminder?.sentAt !== undefined) {
    return false;
  }
  const provider = await providerRepository.findById(booking.providerId);
  const shop = provider ? {
    lat: typeof provider.lat === "number" ? provider.lat : 0,
    lng: typeof provider.lng === "number" ? provider.lng : 0,
  } : null;
  const origin = originOf(booking);
  const when = new Date(booking.scheduledAt).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  let title = "Booking reminder";
  let body = `${booking.providerName} · ${when}`;
  if (booking.arrivalMode === "TOW") {
    title = "Time to file your tow";
    body = `Tow to ${booking.providerName} for your ${when} booking`;
  } else if (origin !== null && shop !== null) {
    const eta = await travelMinutes(booking, origin, shop)
      .catch(() => null);
    if (eta !== null) {
      const left = Date.parse(booking.scheduledAt) - Date.now();
      const late = eta * 60 * 1000 >= left;
      title = late ? "Leave now" : "Time to leave";
      body = late ?
        `Ride to ${booking.providerName} now — about ${eta} min` :
        `Leave for ${booking.providerName} — about ${eta} min`;
    }
  }
  await sendBookingPush(booking.riderUid, {
    title,
    body,
    event: "BOOKING_REMINDER",
    bookingId: booking.id,
  }).catch(() => undefined);
  if (provider && typeof provider.operatorUid === "string") {
    await sendBookingPush(provider.operatorUid, {
      title: "Booking reminder",
      body: booking.scheduledAt,
      event: "BOOKING_REMINDER",
      bookingId: booking.id,
    }).catch(() => undefined);
  }
  const sentAt = new Date().toISOString();
  await bookingRepository.update(booking.id, {
    reminderSentAt: sentAt,
    reminder: {...booking.reminder, sentAt},
  });
  return true;
};

export {reminderAtFor, travelMinutes, originOf, sendReminderForBooking};

const deliverBookingReminder = async (
  bookingId: string,
): Promise<{sent: boolean}> => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) throw new Error("Booking not found");
  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    return {sent: false};
  }
  return {sent: await sendReminderForBooking(booking)};
};

export {deliverBookingReminder};
