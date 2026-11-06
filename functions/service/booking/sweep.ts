import * as bookingRepository from "../../repository/bookingRepository";

import {
  BOOKING_ARRIVAL_AUTOCOMPLETE_HOURS,
  BOOKING_NO_SHOW_GRACE_MINUTES,
  BOOKING_STATUS,
} from "../../constants/booking";
import {sendBookingPush} from "../push/booking";
import {sendReminderForBooking} from "./reminders";
import {dateKeyOf} from "./slots";

const sweepBookings = async (): Promise<{
  reminders: number;
  noShows: number;
  completed: number;
}> => {
  const now = new Date();
  const reminders = await bookingRepository.findReminderDueV2(
    now.toISOString(),
  );
  let reminded = 0;
  for (const booking of reminders) {
    if (await sendReminderForBooking(booking)) reminded += 1;
  }
  const noShowBefore = new Date(
    now.getTime() - BOOKING_NO_SHOW_GRACE_MINUTES * 60 * 1000,
  );
  const due = await bookingRepository.findNoShowDue(
    noShowBefore.toISOString(),
  );
  let noShows = 0;
  for (const booking of due) {
    if (booking.arrivedAt !== null) continue;
    const at = new Date(booking.scheduledAt);
    await bookingRepository.releaseSlot(
      booking.providerId,
      dateKeyOf(at),
      booking.slotKey,
    );
    await bookingRepository.update(booking.id, {
      status: BOOKING_STATUS.NO_SHOW,
      noShowAt: new Date().toISOString(),
    });
    await sendBookingPush(booking.riderUid, {
      title: "Booking marked as no-show",
      body: `${booking.providerName} waited, but check-in never happened`,
      event: "BOOKING_NO_SHOW",
      bookingId: booking.id,
    }).catch(() => undefined);
    noShows += 1;
  }
  const arrivedBefore = new Date(
    now.getTime() - BOOKING_ARRIVAL_AUTOCOMPLETE_HOURS * 60 * 60 * 1000,
  );
  const arrived = await bookingRepository.findArrivedBefore(
    arrivedBefore.toISOString(),
  );
  for (const booking of arrived) {
    await bookingRepository.update(booking.id, {
      status: BOOKING_STATUS.COMPLETED,
      completedAt: new Date().toISOString(),
    });
  }
  return {reminders: reminded, noShows, completed: arrived.length};
};

export {sweepBookings};
