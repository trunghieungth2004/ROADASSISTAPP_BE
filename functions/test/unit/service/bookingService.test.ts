import * as bookingRepository from "../../../repository/bookingRepository";
import * as providerRepository from "../../../repository/providerRepository";
import {createDispatch} from "../../../service/dispatch/tickets/create";
import {sendBookingPush} from "../../../service/push/booking";
import {
  arriveBooking,
  cancelBooking,
  createBooking,
  getAvailability,
  respondBooking,
  sweepBookings,
} from "../../../service/bookingService";

jest.mock("../../../repository/bookingRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/vehicleProfileRepository");
jest.mock("../../../service/dispatch/tickets/create");
jest.mock("../../../service/push/booking");

const provider = (overrides: Record<string, unknown> = {}): never => ({
  id: "p1",
  kind: "SHOP",
  operatorUid: "op1",
  name: "Fix It",
  lat: 10.7,
  lng: 106.6,
  status: "ACTIVE",
  openHours: "08:00-20:00",
  bookingEnabled: true,
  bookingSlotMinutes: 30,
  bookingCapacity: 1,
  bookingLeadMinutes: 60,
  bookingHorizonDays: 7,
  services: [{code: "OIL", name: "Oil", displayPrice: 100000}],
  ...overrides,
}) as never;

const booking = (overrides: Record<string, unknown> = {}): never => ({
  id: "b1",
  riderUid: "u1",
  providerId: "p1",
  providerName: "Fix It",
  scheduledAt: "2026-11-03T03:00:00.000Z",
  slotKey: "10:00",
  status: "REQUESTED",
  serviceCodes: [],
  serviceSnapshot: [],
  note: null,
  vehicleId: null,
  outsideHours: false,
  arrivalMode: "SELF",
  linkedTicketIds: [],
  reminder: {mode: "SELF", bufferMinutes: 30, reminderAt: null, sentAt: null},
  depositAmount: 0,
  depositStatus: "NONE",
  reminderSentAt: null,
  arrivedAt: null,
  ticketId: null,
  ...overrides,
}) as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(providerRepository.findById).mockResolvedValue(provider());
  jest.mocked(bookingRepository.findForDay).mockResolvedValue([]);
  jest.mocked(bookingRepository.findReminderDue).mockResolvedValue([]);
  jest.mocked(bookingRepository.findReminderDueV2).mockResolvedValue([]);
  jest.mocked(bookingRepository.findNoShowDue).mockResolvedValue([]);
  jest.mocked(bookingRepository.findArrivedBefore).mockResolvedValue([]);
  jest.mocked(bookingRepository.update).mockResolvedValue(undefined as never);
  jest.mocked(sendBookingPush).mockResolvedValue({
    delivered: 1,
    skipped: false,
  });
  jest.useFakeTimers().setSystemTime(new Date("2026-11-03T01:00:00.000Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("bookingService", () => {
  it("suggests slots from advisory hours", async () => {
    const result = await getAvailability({
      providerId: "p1",
      date: "2026-11-03",
    });
    expect(result.bookingEnabled).toBe(true);
    expect((result.slots as unknown[]).length).toBe(22);
  });

  it("marks a shop without hours as free-form", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      provider({openHours: null}),
    );
    const result = await getAvailability({
      providerId: "p1",
      date: "2026-11-03",
    });
    expect(result.freeForm).toBe(true);
    expect(result.slots).toEqual([]);
  });

  it("creates a booking outside hours with a note", async () => {
    jest.mocked(bookingRepository.create).mockImplementation(
      async (data: Record<string, unknown>) => ({id: "b1", ...data}) as never,
    );
    const result = await createBooking({
      userId: "u1",
      providerId: "p1",
      scheduledAt: "2026-11-03T15:00:00.000Z",
      note: "After work",
    });
    expect(result.outsideHours).toBe(true);
    expect(sendBookingPush).toHaveBeenCalledWith(
      "op1",
      expect.objectContaining({event: "BOOKING_REQUESTED"}),
    );
  });

  it("rejects an out-of-hours request without a note", async () => {
    await expect(createBooking({
      userId: "u1",
      providerId: "p1",
      scheduledAt: "2026-11-03T15:00:00.000Z",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("claims capacity when the shop accepts", async () => {
    jest.mocked(bookingRepository.findById)
      .mockResolvedValue(booking() as never);
    await respondBooking({userId: "op1", bookingId: "b1", accept: true});
    expect(bookingRepository.claimSlot).toHaveBeenCalledWith(
      "p1",
      "2026-11-03",
      "10:00",
      1,
    );
  });

  it("releases capacity when a confirmed booking is cancelled", async () => {
    jest.mocked(bookingRepository.findById)
      .mockResolvedValue(booking({status: "CONFIRMED"}) as never);
    await cancelBooking({userId: "u1", bookingId: "b1"});
    expect(bookingRepository.releaseSlot).toHaveBeenCalledWith(
      "p1",
      "2026-11-03",
      "10:00",
    );
  });

  it("checks the rider in with a linked walk-in ticket", async () => {
    jest.mocked(bookingRepository.findById)
      .mockResolvedValue(booking({status: "CONFIRMED"}) as never);
    jest.mocked(createDispatch).mockResolvedValue({id: "t1"} as never);
    const result = await arriveBooking({userId: "u1", bookingId: "b1"});
    expect(createDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketType: "WALK_IN",
        providerId: "p1",
        allowOffDutyShop: true,
      }),
    );
    expect(result.ticketId).toBe("t1");
  });

  it("rejects a service that is not bookable", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(provider({
      services: [{
        code: "OIL",
        name: "Oil",
        displayPrice: 100000,
        channels: ["ASSIST"],
      }],
    }));
    await expect(createBooking({
      userId: "u1",
      providerId: "p1",
      scheduledAt: "2026-11-03T03:00:00.000Z",
      serviceCodes: ["OIL"],
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("requires a pickup point for a tow booking", async () => {
    await expect(createBooking({
      userId: "u1",
      providerId: "p1",
      scheduledAt: "2026-11-03T03:00:00.000Z",
      arrivalMode: "TOW",
    })).rejects.toMatchObject({statusCode: 400});
  });

  it("stores the arrival plan and reminder", async () => {
    jest.mocked(bookingRepository.create).mockImplementation(
      async (data: Record<string, unknown>) => ({id: "b1", ...data}) as never,
    );
    const result = await createBooking({
      userId: "u1",
      providerId: "p1",
      scheduledAt: "2026-11-03T03:00:00.000Z",
      arrivalMode: "TOW",
      origin: {lat: 10.1, lng: 106.1, label: "Home"},
      bufferMinutes: 15,
    });
    expect(result.arrivalMode).toBe("TOW");
    expect(result.origin).toMatchObject({lat: 10.1, lng: 106.1});
    expect(bookingRepository.update).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        reminder: expect.objectContaining({bufferMinutes: 15}),
      }),
    );
  });

  it("sends a tow reminder when the booking is due", async () => {
    jest.mocked(bookingRepository.findReminderDueV2)
      .mockResolvedValue([booking({
        status: "CONFIRMED",
        arrivalMode: "TOW",
        origin: {lat: 10.1, lng: 106.1, label: "Home"},
        reminder: {
          mode: "TOW",
          bufferMinutes: 30,
          reminderAt: "2026-11-03T01:00:00.000Z",
          sentAt: null,
        },
      })]);
    await expect(sweepBookings()).resolves.toMatchObject({reminders: 1});
    expect(sendBookingPush).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({event: "BOOKING_REMINDER"}),
    );
  });

  it("marks an unarrived confirmed booking as no-show", async () => {
    jest.mocked(bookingRepository.findNoShowDue)
      .mockResolvedValue([booking({status: "CONFIRMED"})]);
    await expect(sweepBookings()).resolves.toMatchObject({noShows: 1});
    expect(bookingRepository.update).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({status: "NO_SHOW"}),
    );
  });
});
