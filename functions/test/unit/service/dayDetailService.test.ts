import * as bookingRepository from "../../../repository/bookingRepository";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {adminDayDetail} from "../../../service/dayDetailService";

jest.mock("../../../repository/bookingRepository", () => ({
  findAll: jest.fn(async () => []),
}));
jest.mock("../../../repository/dispatchRepository", () => ({
  findAll: jest.fn(async () => []),
}));
jest.mock("../../../repository/paymentRepository", () => ({
  findAll: jest.fn(async () => []),
}));
jest.mock("../../../repository/providerRepository", () => ({
  findByIds: jest.fn(async () => new Map()),
}));
jest.mock("../../../repository/userRepository", () => ({
  findById: jest.fn(),
  findByIds: jest.fn(async () => new Map()),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "admin",
    role: "1",
  } as never);
  jest.mocked(userRepository.findByIds).mockResolvedValue(new Map([
    ["u1", {id: "u1", displayName: "Rider", email: "r@example.com"}],
  ]) as never);
  jest.mocked(providerRepository.findByIds).mockResolvedValue(new Map([
    ["p1", {id: "p1", name: "Fix Shop", kind: "SHOP"}],
  ]) as never);
});

test("admin day detail filters tickets, bookings and payments to one date", async () => {
  jest.mocked(dispatchRepository.findAll).mockResolvedValue([
    {
      id: "t1", userId: "u1", ticketType: "TOW", status: "4",
      assignedShopId: "p1", createdAt: "2026-11-18T08:00:00.000Z",
      finalAmount: 250000, paymentStatus: "CONFIRMED",
    },
    {
      id: "t2", userId: "u1", ticketType: "SOS", status: "1",
      createdAt: "2026-11-17T08:00:00.000Z",
    },
  ] as never);
  jest.mocked(bookingRepository.findAll).mockResolvedValue([
    {
      id: "b1", status: "CONFIRMED", providerId: "p1",
      providerName: "Fix Shop", scheduledAt: "2026-11-18T10:00:00.000Z",
      serviceSnapshot: [{code: "OIL", name: "Oil change", price: 80000}],
      depositAmount: 20000,
    },
    {
      id: "b2", status: "CONFIRMED", providerId: "p1",
      scheduledAt: "2026-11-19T10:00:00.000Z",
    },
  ] as never);
  jest.mocked(paymentRepository.findAll).mockResolvedValue([
    {
      id: "pay1", ticketId: "t1", amount: 250000, commissionAmount: 25000,
      status: "CONFIRMED", method: "CASH",
      createdAt: "2026-11-18T09:00:00.000Z",
    },
    {
      id: "pay2", ticketId: "t2", amount: 50000, commissionAmount: 5000,
      status: "CONFIRMED", method: "CASH",
      createdAt: "2026-11-17T09:00:00.000Z",
    },
  ] as never);

  const result = await adminDayDetail({adminUid: "admin", date: "2026-11-18"});
  expect(result.totals).toEqual({
    tickets: 1,
    completed: 1,
    bookings: 1,
    gross: 250000,
    commission: 25000,
  });
  expect(result.tickets[0]).toMatchObject({
    id: "t1",
    riderName: "Rider",
    providerName: "Fix Shop",
    amount: 250000,
  });
  expect(result.bookings[0]).toMatchObject({
    id: "b1",
    serviceNames: ["Oil change"],
  });
  expect(result.payments[0]).toMatchObject({id: "pay1", amount: 250000});
});

test("admin day detail rejects non-admins and malformed dates", async () => {
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "u1",
    role: "2",
  } as never);
  await expect(adminDayDetail({adminUid: "u1", date: "2026-11-18"}))
    .rejects.toMatchObject({statusCode: 403});
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "admin",
    role: "1",
  } as never);
  await expect(adminDayDetail({adminUid: "admin", date: "18/11/2026"}))
    .rejects.toMatchObject({statusCode: 400});
});
