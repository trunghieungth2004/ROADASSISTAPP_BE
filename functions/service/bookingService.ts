import * as bookingRepository from "../repository/bookingRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import * as vehicleProfileRepository from
  "../repository/vehicleProfileRepository";
import {createDispatch} from "./dispatch/tickets/create";
import {reminderAtFor, deliverBookingReminder} from "./booking/reminders";
import {bookingConfigDefaults} from "./booking/config";
import {getAvailability} from "./booking/availability";
import {sweepBookings} from "./booking/sweep";
import * as paymentService from "./paymentService";
import {sendBookingPush} from "./push/booking";
import {enqueueBookingReminder} from "./taskQueueService";
import {
  BOOKING_ARRIVAL_MODE,
  BOOKING_REMINDER_BUFFER_DEFAULT,
  BOOKING_DEPOSIT_MAX,
  BOOKING_DEPOSIT_POLICY,
  BOOKING_DEPOSIT_STATUS,
  BOOKING_ARRIVAL_GRACE_MINUTES,
  BOOKING_NOTE_MAX,
  BOOKING_SERVICE_MAX,
  BOOKING_STATUS,
} from "../constants/booking";
import {PROVIDER_STATUS, SERVICE_CHANNEL} from "../constants/status";
import {isCarVehicle} from "../utils/valhalla";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import {
  bookingSettings,
  dateKeyOf,
  dayBounds,
  isoForLocal,
  minutesOfDay,
  rangesForDate,
  slotKeyOf,
  withinRanges,
} from "./booking/slots";

const operatorOf = (provider: Record<string, unknown>): string | null =>
  typeof provider.operatorUid === "string" ? provider.operatorUid : null;

const requireProvider = async (
  providerId: string,
): Promise<Record<string, unknown>> => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  return provider as unknown as Record<string, unknown>;
};

const requireOperator = async (
  provider: Record<string, unknown>,
  userId: string,
): Promise<string> => {
  const operator = operatorOf(provider);
  if (operator === null || operator !== userId) {
    const user = await userRepository.findById(userId);
    if (!user || user.role !== "1") {
      throw new ForbiddenError("Only the shop handles its bookings");
    }
  }
  return operator ?? "";
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

const serviceSnapshot = (
  provider: Record<string, unknown>,
  codes: string[],
  vehicleClass?: string,
): Array<{code: string; name: string; price: number}> => {
  const services = Array.isArray(provider.services) ? provider.services : [];
  const out: Array<{code: string; name: string; price: number}> = [];
  for (const code of codes) {
    const match = services.find((item) =>
      typeof item === "object" && item !== null &&
      (item as {code?: unknown}).code === code);
    if (!match) throw new ValidationError(`Unknown service ${code}`);
    const row = match as {
      code: string;
      name: string;
      displayPrice: number;
      channels?: string[];
    };
    const channels = Array.isArray(row.channels) && row.channels.length > 0 ?
      row.channels :
      [SERVICE_CHANNEL.BOOKING, SERVICE_CHANNEL.ASSIST];
    if (!channels.includes(SERVICE_CHANNEL.BOOKING)) {
      throw new ValidationError(`${row.name} is not bookable`);
    }
    const rowClasses = (match as {vehicleClasses?: unknown}).vehicleClasses;
    if (vehicleClass !== undefined && Array.isArray(rowClasses) &&
      rowClasses.length > 0 && !rowClasses.includes(vehicleClass)) {
      throw new ValidationError(
        `${row.name} is not available for this vehicle`,
      );
    }
    out.push({
      code: row.code,
      name: row.name,
      price: row.displayPrice,
    });
  }
  return out;
};

const depositFor = (
  provider: Record<string, unknown>,
  services: Array<{price: number}>,
): {amount: number; status: string} => {
  const policy = typeof provider.depositPolicy === "string" ?
    provider.depositPolicy :
    BOOKING_DEPOSIT_POLICY.NONE;
  let amount = 0;
  if (policy === BOOKING_DEPOSIT_POLICY.FIXED) {
    amount = typeof provider.depositAmount === "number" ?
      provider.depositAmount :
      0;
  } else if (policy === BOOKING_DEPOSIT_POLICY.PERCENT) {
    const percent = typeof provider.depositPercent === "number" ?
      provider.depositPercent :
      0;
    const base = services.reduce((sum, row) => sum + row.price, 0);
    amount = Math.round(base * percent / 100);
  }
  amount = Math.max(0, Math.min(BOOKING_DEPOSIT_MAX, amount));
  return {
    amount,
    status: amount > 0 ?
      BOOKING_DEPOSIT_STATUS.DUE :
      BOOKING_DEPOSIT_STATUS.NONE,
  };
};

const updateBookingPlan = async (input: {
  userId: string;
  bookingId: string;
  arrivalMode?: string;
  origin?: {lat: number; lng: number; label?: string | null};
  bufferMinutes?: number;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  if (booking.riderUid !== input.userId) {
    throw new ForbiddenError("Only the rider updates this booking");
  }
  if (booking.status !== BOOKING_STATUS.REQUESTED &&
    booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new ValidationError("This booking can no longer be changed");
  }
  const provider = await requireProvider(booking.providerId);
  const arrivalMode = input.arrivalMode === "TOW" ? "TOW" : "SELF";
  const origin = input.origin === undefined ? booking.origin : {
    lat: input.origin.lat,
    lng: input.origin.lng,
    label: input.origin.label ?? null,
  };
  if (arrivalMode === "TOW" &&
    (!origin || typeof origin.lat !== "number" ||
      typeof origin.lng !== "number")) {
    throw new ValidationError("A tow booking needs a pickup point");
  }
  const bufferMinutes = typeof input.bufferMinutes === "number" &&
    input.bufferMinutes >= 0 && input.bufferMinutes <= 240 ?
    Math.round(input.bufferMinutes) :
    typeof booking.reminder === "object" && booking.reminder !== null &&
      typeof (booking.reminder as {bufferMinutes?: unknown}).bufferMinutes ===
        "number" ?
      (booking.reminder as {bufferMinutes: number}).bufferMinutes :
      BOOKING_REMINDER_BUFFER_DEFAULT;
  const reminderAt = await reminderAtFor({
    scheduledAt: booking.scheduledAt,
    arrivalMode,
    origin,
    reminder: {bufferMinutes},
  }, {
    lat: typeof provider.lat === "number" ? provider.lat : 0,
    lng: typeof provider.lng === "number" ? provider.lng : 0,
  }).catch(() => null);
  await bookingRepository.update(booking.id, {
    arrivalMode,
    origin,
    reminder: {
      mode: arrivalMode,
      bufferMinutes,
      reminderAt,
      sentAt: null,
    },
  });
  if (reminderAt !== null) {
    await enqueueBookingReminder(booking.id, reminderAt)
      .catch(() => undefined);
  }
  return {...booking, arrivalMode, origin};
};

const assertBookingVehicle = async (
  userId: string,
  vehicleId?: string,
): Promise<string | undefined> => {
  if (vehicleId === undefined) return undefined;
  const vehicle = await vehicleProfileRepository.findById(userId, vehicleId);
  if (!vehicle) throw new NotFoundError("Vehicle not found");
  return isCarVehicle(vehicle.type) ? "CAR" : "SOLO_BIKE";
};

const bookingCatalogFor = (
  provider: Record<string, unknown>,
  input: {serviceCodes?: string[]},
  vehicleClass?: string,
): {
  codes: string[];
  snapshot: Array<{code: string; name: string; price: number}>;
  deposit: {amount: number; status: string};
} => {
  const codes = Array.isArray(input.serviceCodes) ?
    input.serviceCodes.filter((code): code is string =>
      typeof code === "string" && code !== "") :
    [];
  if (codes.length > BOOKING_SERVICE_MAX) {
    throw new ValidationError("Too many services selected");
  }
  const snapshot = serviceSnapshot(provider, codes, vehicleClass);
  return {codes, snapshot, deposit: depositFor(provider, snapshot)};
};

const bookingPlanFor = (input: {
  arrivalMode?: string;
  origin?: {lat: number; lng: number; label?: string | null};
  bufferMinutes?: number;
}): {
  arrivalMode: string;
  origin: {lat: number; lng: number; label: string | null} | null;
  bufferMinutes: number;
} => {
  const arrivalMode = input.arrivalMode === BOOKING_ARRIVAL_MODE.TOW ?
    BOOKING_ARRIVAL_MODE.TOW :
    BOOKING_ARRIVAL_MODE.SELF;
  if (arrivalMode === BOOKING_ARRIVAL_MODE.TOW &&
    (input.origin === undefined ||
      typeof input.origin.lat !== "number" ||
      typeof input.origin.lng !== "number")) {
    throw new ValidationError("A tow booking needs a pickup point");
  }
  const origin = input.origin !== undefined &&
    typeof input.origin.lat === "number" &&
    typeof input.origin.lng === "number" ?
    {
      lat: input.origin.lat,
      lng: input.origin.lng,
      label: input.origin.label ?? null,
    } :
    null;
  const bufferMinutes = typeof input.bufferMinutes === "number" &&
    input.bufferMinutes >= 0 && input.bufferMinutes <= 240 ?
    Math.round(input.bufferMinutes) :
    BOOKING_REMINDER_BUFFER_DEFAULT;
  return {arrivalMode, origin, bufferMinutes};
};

const createBooking = async (input: {
  userId: string;
  providerId: string;
  scheduledAt: string;
  serviceCodes?: string[];
  note?: string;
  vehicleId?: string;
  arrivalMode?: string;
  origin?: {lat: number; lng: number; label?: string | null};
  bufferMinutes?: number;
}): Promise<Record<string, unknown>> => {
  const provider = await requireProvider(input.providerId);
  const settings = bookingSettings(provider);
  if (provider.status !== PROVIDER_STATUS.ACTIVE ||
    provider.suspended === true) {
    throw new ValidationError("This shop is not taking bookings");
  }
  if (!settings.bookingEnabled) {
    throw new ValidationError("This shop does not take bookings");
  }
  if (provider.kind !== "SHOP") {
    throw new ValidationError("Bookings are available at shops only");
  }
  const at = new Date(input.scheduledAt);
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError("Invalid booking time");
  }
  const now = Date.now();
  if (at.getTime() < now + settings.leadMinutes * 60 * 1000) {
    throw new ValidationError(
      `Book at least ${settings.leadMinutes} minutes ahead`,
    );
  }
  if (at.getTime() >
    now + settings.horizonDays * 24 * 60 * 60 * 1000) {
    throw new ValidationError("That date is too far ahead");
  }
  const date = dateKeyOf(at);
  const ranges = settings.alwaysOpen ?
    [{open: 0, close: 24 * 60}] :
    rangesForDate(settings.hours, date);
  const outsideHours = !settings.alwaysOpen &&
    !withinRanges(minutesOfDay(at), ranges);
  if (outsideHours && ranges.length > 0) {
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (note === "") {
      throw new ValidationError(
        "Add a note when requesting a time outside open hours",
      );
    }
  }
  if (typeof input.note === "string" && input.note.length > BOOKING_NOTE_MAX) {
    throw new ValidationError("Booking note is too long");
  }
  const vehicleClass = await assertBookingVehicle(
    input.userId,
    input.vehicleId,
  );
  const plan = bookingPlanFor(input);
  const {codes, snapshot, deposit} = bookingCatalogFor(
    provider,
    input,
    vehicleClass,
  );
  if (!outsideHours && ranges.length > 0) {
    const bounds = dayBounds(date);
    const confirmed = await confirmedMap(
      input.providerId,
      bounds.start,
      bounds.end,
    );
    const taken = confirmed.get(slotKeyOf(at)) ?? 0;
    if (taken >= settings.capacity) {
      throw new ConflictError("That time was just taken");
    }
  }
  const booking = await bookingRepository.create({
    riderUid: input.userId,
    providerId: input.providerId,
    providerName: typeof provider.name === "string" ? provider.name : "",
    providerSnapshot: {
      lat: provider.lat,
      lng: provider.lng,
      label: provider.label ?? null,
      openHours: provider.openHours ?? null,
    },
    serviceCodes: codes,
    serviceSnapshot: snapshot,
    scheduledAt: at.toISOString(),
    slotKey: slotKeyOf(at),
    note: input.note ?? null,
    vehicleId: input.vehicleId ?? null,
    arrivalMode: plan.arrivalMode,
    origin: plan.origin,
    reminder: {
      mode: plan.arrivalMode,
      bufferMinutes: plan.bufferMinutes,
      reminderAt: null,
    },
    outsideHours,
    depositAmount: deposit.amount,
    depositStatus: deposit.status,
  });
  const reminderAt = await reminderAtFor({
    scheduledAt: booking.scheduledAt,
    arrivalMode: plan.arrivalMode,
    origin: plan.origin,
    reminder: {bufferMinutes: plan.bufferMinutes},
  }, {
    lat: typeof provider.lat === "number" ? provider.lat : 0,
    lng: typeof provider.lng === "number" ? provider.lng : 0,
  }).catch(() => null);
  if (reminderAt !== null) {
    await bookingRepository.update(booking.id, {
      reminder: {
        mode: plan.arrivalMode,
        bufferMinutes: plan.bufferMinutes,
        reminderAt,
        sentAt: null,
      },
    });
    await enqueueBookingReminder(booking.id, reminderAt)
      .catch(() => undefined);
  }
  const operator = operatorOf(provider);
  if (operator) {
    await sendBookingPush(operator, {
      title: "New booking request",
      body: `${booking.providerName} · ${booking.scheduledAt}`,
      event: "BOOKING_REQUESTED",
      bookingId: booking.id,
    }).catch(() => undefined);
  }
  return booking;
};

const respondBooking = async (input: {
  userId: string;
  bookingId: string;
  accept: boolean;
  reason?: string;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  const provider = await requireProvider(booking.providerId);
  await requireOperator(provider, input.userId);
  if (booking.status !== BOOKING_STATUS.REQUESTED) {
    throw new ValidationError("This booking was already handled");
  }
  if (!input.accept) {
    const reason = typeof input.reason === "string" ?
      input.reason.trim() :
      "";
    await bookingRepository.update(booking.id, {
      status: BOOKING_STATUS.DECLINED,
      declinedAt: new Date().toISOString(),
      declineReason: reason === "" ? null : reason.slice(0, 200),
    });
    await sendBookingPush(booking.riderUid, {
      title: "Booking declined",
      body: `${booking.providerName} can't take that time`,
      event: "BOOKING_DECLINED",
      bookingId: booking.id,
    }).catch(() => undefined);
    return {...booking, status: BOOKING_STATUS.DECLINED};
  }
  const at = new Date(booking.scheduledAt);
  const date = dateKeyOf(at);
  const settings = bookingSettings(provider);
  await bookingRepository.claimSlot(
    booking.providerId,
    date,
    slotKeyOf(at),
    settings.capacity,
  );
  const confirmedAt = new Date().toISOString();
  await bookingRepository.update(booking.id, {
    status: BOOKING_STATUS.CONFIRMED,
    confirmedAt,
  });
  await sendBookingPush(booking.riderUid, {
    title: "Booking confirmed",
    body: `${booking.providerName} confirmed your booking`,
    event: "BOOKING_CONFIRMED",
    bookingId: booking.id,
  }).catch(() => undefined);
  return {...booking, status: BOOKING_STATUS.CONFIRMED, confirmedAt};
};

const cancelBooking = async (input: {
  userId: string;
  bookingId: string;
  reason?: string;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  const provider = await requireProvider(booking.providerId);
  const operator = operatorOf(provider);
  const isRider = booking.riderUid === input.userId;
  const isShop = operator === input.userId;
  if (!isRider && !isShop) {
    throw new ForbiddenError("Only the rider or shop cancels this booking");
  }
  if (booking.status !== BOOKING_STATUS.REQUESTED &&
    booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new ValidationError("This booking cannot be cancelled");
  }
  if (booking.status === BOOKING_STATUS.CONFIRMED) {
    const at = new Date(booking.scheduledAt);
    await bookingRepository.releaseSlot(
      booking.providerId,
      dateKeyOf(at),
      slotKeyOf(at),
    );
  }
  const reason = typeof input.reason === "string" ?
    input.reason.trim().slice(0, 200) :
    "";
  await bookingRepository.update(booking.id, {
    status: BOOKING_STATUS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    cancelledBy: input.userId,
    cancelReason: reason === "" ? null : reason,
  });
  const target = isRider ? operator : booking.riderUid;
  if (target) {
    await sendBookingPush(target, {
      title: "Booking cancelled",
      body: `${booking.providerName} · ${booking.scheduledAt}`,
      event: "BOOKING_CANCELLED",
      bookingId: booking.id,
    }).catch(() => undefined);
  }
  return {...booking, status: BOOKING_STATUS.CANCELLED};
};

const arriveBooking = async (input: {
  userId: string;
  bookingId: string;
}): Promise<{booking: Record<string, unknown>; ticketId: string}> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  if (booking.riderUid !== input.userId) {
    throw new ForbiddenError("Only the rider checks in");
  }
  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new ValidationError("This booking is not confirmed");
  }
  const at = Date.parse(booking.scheduledAt);
  const now = Date.now();
  if (now < at - BOOKING_ARRIVAL_GRACE_MINUTES * 60 * 1000) {
    throw new ValidationError("It is too early to check in");
  }
  if (now > at + BOOKING_ARRIVAL_GRACE_MINUTES * 60 * 1000) {
    throw new ValidationError("Check-in window has passed");
  }
  const provider = await requireProvider(booking.providerId);
  const lat = typeof provider.lat === "number" ? provider.lat : 0;
  const lng = typeof provider.lng === "number" ? provider.lng : 0;
  const ticket = await createDispatch({
    userId: input.userId,
    ticketType: "WALK_IN",
    lat,
    lng,
    providerId: booking.providerId,
    ...(booking.vehicleId !== null ?
      {vehicleId: booking.vehicleId} :
      {}),
    note: `Booking ${booking.id}`,
    bookingId: booking.id,
    allowOffDutyShop: true,
    allowMissingVehicle: booking.vehicleId === null,
  });
  const arrivedAt = new Date().toISOString();
  const links = Array.isArray(booking.linkedTicketIds) ?
    booking.linkedTicketIds as string[] :
    [];
  await bookingRepository.update(booking.id, {
    status: BOOKING_STATUS.ARRIVED,
    arrivedAt,
    ticketId: ticket.id,
    linkedTicketIds: [...new Set([...links, ticket.id])],
  });
  if (booking.depositAmount > 0) {
    await dispatchRepository.update(ticket.id, {
      depositAmount: booking.depositAmount,
      depositStatus: booking.depositStatus,
    });
  }
  return {
    booking: {...booking, status: BOOKING_STATUS.ARRIVED, ticketId: ticket.id},
    ticketId: ticket.id,
  };
};

const collectDeposit = async (input: {
  userId: string;
  bookingId: string;
  collected: boolean;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  const provider = await requireProvider(booking.providerId);
  await requireOperator(provider, input.userId);
  if (booking.depositAmount <= 0) {
    throw new ValidationError("This booking has no deposit");
  }
  if (booking.status !== BOOKING_STATUS.CONFIRMED &&
    booking.status !== BOOKING_STATUS.ARRIVED) {
    throw new ValidationError("This booking cannot update a deposit");
  }
  const now = new Date().toISOString();
  const status = input.collected ?
    BOOKING_DEPOSIT_STATUS.COLLECTED :
    BOOKING_DEPOSIT_STATUS.WAIVED;
  if (typeof booking.ticketId === "string" &&
    booking.ticketId !== "") {
    await dispatchRepository.update(booking.ticketId, {
      depositAmount: booking.depositAmount,
      depositStatus: status,
      ...(input.collected ? {
        depositMethod: "CASH",
        depositPaidAt: now,
        depositCollectedBy: input.userId,
      } : {}),
    });
  }
  await bookingRepository.update(booking.id, {
    depositStatus: status,
    depositCollectedAt: now,
    depositCollectedBy: input.userId,
  });
  return {...booking, depositStatus: status};
};

const createBookingTow = async (input: {
  userId: string;
  bookingId: string;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  if (booking.riderUid !== input.userId) {
    throw new ForbiddenError("Only the rider files this tow");
  }
  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new ValidationError("Confirm the booking before filing a tow");
  }
  if (booking.arrivalMode !== "TOW") {
    throw new ValidationError("This booking is a ride-in booking");
  }
  const origin = booking.origin;
  if (!origin || typeof origin.lat !== "number" ||
    typeof origin.lng !== "number") {
    throw new ValidationError("Add a pickup point to the booking first");
  }
  const at = Date.parse(booking.scheduledAt);
  if (!Number.isFinite(at) ||
    Date.now() < at - 6 * 60 * 60 * 1000 ||
    Date.now() > at + 2 * 60 * 60 * 1000) {
    throw new ValidationError("File the tow closer to the booking time");
  }
  const links = Array.isArray(booking.linkedTicketIds) ?
    booking.linkedTicketIds as string[] :
    [];
  for (const id of links) {
    const linked = await dispatchRepository.findById(id);
    if (linked && linked.ticketType === "TOW" &&
      linked.towKind !== "RETURN" &&
      linked.status !== "5" && linked.status !== "4") {
      return {ticket: linked};
    }
  }
  await requireProvider(booking.providerId);
  const vehicleId = typeof booking.vehicleId === "string" ?
    booking.vehicleId :
    null;
  const vehicle = vehicleId === null ?
    null :
    await vehicleProfileRepository.findById(input.userId, vehicleId);
  const ticket = await createDispatch({
    userId: input.userId,
    ticketType: "TOW",
    lat: origin.lat,
    lng: origin.lng,
    destinationShopId: booking.providerId,
    bookingId: booking.id,
    note: `Booking ${booking.id}`,
    ...(vehicleId !== null ? {vehicleId} : {}),
    ...(vehicle !== null && typeof vehicle.type === "string" ?
      {vehicleType: vehicle.type} :
      {}),
    allowMissingVehicle: vehicleId === null,
    allowVehicleOverlap: true,
  });
  await bookingRepository.update(booking.id, {
    linkedTicketIds: [...new Set([...links, ticket.id])],
    ...(booking.reminder !== null ? {
      reminder: {
        ...booking.reminder,
        sentAt: typeof booking.reminder.sentAt === "string" ?
          booking.reminder.sentAt :
          new Date().toISOString(),
      },
    } : {}),
  });
  return {ticket};
};

const getDepositCheckout = async (input: {
  userId: string;
  bookingId: string;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  if (booking.riderUid !== input.userId) {
    throw new ForbiddenError("Only the rider pays the deposit");
  }
  if (typeof booking.ticketId !== "string" || booking.ticketId === "") {
    throw new ValidationError("The work ticket is not open yet");
  }
  return paymentService.depositCheckout({
    userId: input.userId,
    ticketId: booking.ticketId,
  });
};

const requestDeposit = async (input: {
  userId: string;
  bookingId: string;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  const provider = await requireProvider(booking.providerId);
  await requireOperator(provider, input.userId);
  if (booking.depositAmount <= 0) {
    throw new ValidationError("This booking has no deposit");
  }
  if (booking.status !== BOOKING_STATUS.CONFIRMED &&
    booking.status !== BOOKING_STATUS.ARRIVED) {
    throw new ValidationError("This booking cannot request a deposit");
  }
  if (typeof booking.ticketId !== "string" || booking.ticketId === "") {
    throw new ValidationError("The work ticket is not open yet");
  }
  const payment = await paymentService.createDepositPayment({
    userId: booking.riderUid,
    ticketId: booking.ticketId,
    method: "SEPAY",
  });
  await bookingRepository.update(booking.id, {
    depositStatus: BOOKING_DEPOSIT_STATUS.REQUESTED,
  });
  return {booking, payment};
};

const completeBooking = async (input: {
  userId: string;
  bookingId: string;
}): Promise<Record<string, unknown>> => {
  const booking = await bookingRepository.findById(input.bookingId);
  if (!booking) throw new NotFoundError("Booking not found");
  const provider = await requireProvider(booking.providerId);
  await requireOperator(provider, input.userId);
  if (booking.status !== BOOKING_STATUS.ARRIVED &&
    booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new ValidationError("This booking cannot be completed");
  }
  const completedAt = new Date().toISOString();
  await bookingRepository.update(booking.id, {
    status: BOOKING_STATUS.COMPLETED,
    completedAt,
  });
  return {...booking, status: BOOKING_STATUS.COMPLETED, completedAt};
};

const myBookings = async (input: {
  userId: string;
}): Promise<Record<string, unknown>> => {
  const rows = await bookingRepository.findByRider(input.userId);
  return {bookings: rows, serverTime: new Date().toISOString()};
};

const shopBookings = async (input: {
  userId: string;
  providerId: string;
}): Promise<Record<string, unknown>> => {
  const provider = await requireProvider(input.providerId);
  await requireOperator(provider, input.userId);
  const rows = await bookingRepository.findByShop(input.providerId);
  return {bookings: rows, serverTime: new Date().toISOString()};
};


export {
  getAvailability,
  createBooking,
  updateBookingPlan,
  respondBooking,
  cancelBooking,
  arriveBooking,
  completeBooking,
  collectDeposit,
  requestDeposit,
  getDepositCheckout,
  createBookingTow,
  deliverBookingReminder,
  myBookings,
  shopBookings,
  sweepBookings,
  bookingConfigDefaults,
  isoForLocal,
};
