import * as bookingRepository from "../repository/bookingRepository";
import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {PAYMENT_RECEIVED_STATUSES} from "../constants/payments";
import {STATUS_DISPATCH} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";
import {ForbiddenError, NotFoundError, ValidationError} from "../utils/errors";

type Row = Record<string, unknown>;

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const parseDay = (value: string): {from: string; to: string} => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("date must be YYYY-MM-DD");
  }
  const at = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime()) ||
    at.toISOString().slice(0, 10) !== value) {
    throw new ValidationError("date must be YYYY-MM-DD");
  }
  return {
    from: `${value}T00:00:00.000Z`,
    to: `${value}T23:59:59.999Z`,
  };
};

const within = (value: unknown, from: string, to: string): boolean => {
  const text = str(value);
  return text !== "" && text >= from && text <= to;
};

const ticketAmount = (ticket: Row): number | null => {
  if (typeof ticket.finalAmount === "number") return ticket.finalAmount;
  if (typeof ticket.shopQuotedAmount === "number") {
    return ticket.shopQuotedAmount;
  }
  const fare = ticket.towFare && typeof ticket.towFare === "object" ?
    ticket.towFare as Row :
    null;
  if (fare && typeof fare.final === "number") return fare.final;
  if (fare && typeof fare.estimate === "number") return fare.estimate;
  return null;
};

const bookingServices = (booking: Row): string[] => {
  const snapshot = Array.isArray(booking.serviceSnapshot) ?
    booking.serviceSnapshot as Row[] :
    [];
  if (snapshot.length > 0) {
    return snapshot.map((item) => str(item.name) || str(item.code))
      .filter((name) => name !== "");
  }
  const codes = Array.isArray(booking.serviceCodes) ?
    booking.serviceCodes as unknown[] :
    [];
  return codes.map((code) => str(code)).filter((code) => code !== "");
};

const paymentTotals = (payments: Row[]) => {
  let gross = 0;
  let commission = 0;
  for (const payment of payments) {
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    gross += num(payment.amount);
    commission += num(payment.commissionAmount);
  }
  return {gross, commission};
};

const ticketCompleted = (ticket: Row): boolean => {
  const status = str(ticket.status);
  return status === STATUS_DISPATCH.RESOLVED ||
    status === STATUS_DISPATCH.RESOLVED_UNFIXABLE;
};

const ticketSummary = (
  ticket: Row,
  providers: Map<string, unknown>,
  users: Map<string, unknown>,
): Record<string, unknown> => {
  const providerId = [
    ticket.assignedShopId,
    ticket.providerId,
    ticket.destinationShopId,
  ].find((id): id is string => typeof id === "string" && id !== "") ?? null;
  const provider = providerId === null ?
    undefined :
    providers.get(providerId) as Row | undefined;
  const rider = users.get(str(ticket.userId)) as Row | undefined;
  return {
    id: str(ticket.id),
    ticketType: str(ticket.ticketType),
    status: str(ticket.status),
    createdAt: str(ticket.createdAt) || null,
    riderId: str(ticket.userId),
    riderName: rider?.displayName ?? rider?.email ?? null,
    providerId,
    providerName: provider?.name ?? null,
    providerKind: provider?.kind ?? null,
    paymentStatus: str(ticket.paymentStatus) || null,
    amount: ticketAmount(ticket),
    description: str(ticket.description) || null,
    symptom: str(ticket.symptom) || null,
  };
};

const bookingSummary = (booking: Row): Record<string, unknown> => ({
  id: str(booking.id),
  status: str(booking.status),
  scheduledAt: str(booking.scheduledAt) || null,
  providerId: str(booking.providerId),
  providerName: str(booking.providerName) || null,
  serviceNames: bookingServices(booking),
  depositAmount: num(booking.depositAmount),
  note: str(booking.note) || null,
});

const paymentSummary = (payment: Row): Record<string, unknown> => ({
  id: str(payment.id),
  ticketId: str(payment.ticketId),
  amount: num(payment.amount),
  commissionAmount: num(payment.commissionAmount),
  status: str(payment.status),
  method: str(payment.method),
  createdAt: str(payment.createdAt) || null,
  confirmedAt: str(payment.confirmedAt) || null,
});

const buildTotals = (
  tickets: Row[],
  bookings: Row[],
  payments: Row[],
) => {
  const money = paymentTotals(payments);
  return {
    tickets: tickets.length,
    completed: tickets.filter(ticketCompleted).length,
    bookings: bookings.length,
    gross: money.gross,
    commission: money.commission,
  };
};

const identityMaps = async (tickets: Row[]) => {
  const riderIds = [...new Set(tickets.map((ticket) => str(ticket.userId))
    .filter((id) => id !== ""))];
  const providerIds = [...new Set(tickets.flatMap((ticket) =>
    [ticket.assignedShopId, ticket.providerId, ticket.destinationShopId]
      .map((id) => str(id))
      .filter((id) => id !== "")))];
  const [users, providers] = await Promise.all([
    userRepository.findByIds(riderIds),
    providerRepository.findByIds(providerIds),
  ]);
  return {users, providers};
};

const adminDayDetail = async ({
  adminUid,
  date,
}: {
  adminUid: string;
  date: string;
}) => {
  const caller = await userRepository.findById(adminUid);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) throw new ForbiddenError("Admin only");
  const bounds = parseDay(date);
  const [ticketRows, bookingRows, paymentRows] = await Promise.all([
    dispatchRepository.findAll(5000),
    bookingRepository.findAll(5000),
    paymentRepository.findAll(5000),
  ]);
  const tickets = ticketRows.filter((ticket) =>
    within(ticket.createdAt, bounds.from, bounds.to)) as unknown as Row[];
  const bookings = bookingRows.filter((booking) =>
    within(booking.scheduledAt, bounds.from, bounds.to)) as unknown as Row[];
  const payments = paymentRows.filter((payment) =>
    within(payment.createdAt, bounds.from, bounds.to)) as unknown as Row[];
  const maps = await identityMaps(tickets);
  return {
    date,
    totals: buildTotals(tickets, bookings, payments),
    tickets: tickets.map((ticket) =>
      ticketSummary(ticket, maps.providers, maps.users)),
    bookings: bookings.map(bookingSummary),
    payments: payments.map(paymentSummary),
  };
};

const myDayDetail = async ({
  userId,
  date,
  mode,
}: {
  userId: string;
  date: string;
  mode?: string;
}) => {
  const bounds = parseDay(date);
  const providers = await providerRepository.findByOperator(userId);
  const providerIds = providers.map((provider) => provider.id);
  const providerMode = mode === "PROVIDER";
  let ticketRows: Row[] = [];
  let bookingRows: Row[] = [];
  let paymentRows: Row[] = [];
  if (providerMode) {
    const batches = await Promise.all(providerIds.map((id) =>
      dispatchRepository.findRecentForShop(id, 1000)));
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const ticket of batch) {
        if (seen.has(ticket.id)) continue;
        seen.add(ticket.id);
        ticketRows.push(ticket as unknown as Row);
      }
    }
    const bookingBatches = await Promise.all(providerIds.map((id) =>
      bookingRepository.findByShop(id, 1000)));
    bookingRows = bookingBatches.flat() as unknown as Row[];
    paymentRows = await paymentRepository.findByPayeeAll(userId) as
      unknown as Row[];
  } else {
    ticketRows = await dispatchRepository.findByUserId(userId, 1000) as
      unknown as Row[];
    bookingRows = await bookingRepository.findByRider(userId, 1000) as
      unknown as Row[];
    paymentRows = await paymentRepository.findByRiderAll(userId) as
      unknown as Row[];
  }
  const tickets = ticketRows.filter((ticket) =>
    within(ticket.createdAt, bounds.from, bounds.to));
  const bookings = bookingRows.filter((booking) =>
    within(booking.scheduledAt, bounds.from, bounds.to));
  const payments = paymentRows.filter((payment) =>
    within(payment.createdAt, bounds.from, bounds.to));
  const maps = await identityMaps(tickets);
  return {
    date,
    mode: providerMode ? "PROVIDER" : "RIDER",
    totals: buildTotals(tickets, bookings, payments),
    tickets: tickets.map((ticket) =>
      ticketSummary(ticket, maps.providers, maps.users)),
    bookings: bookings.map(bookingSummary),
    payments: payments.map(paymentSummary),
  };
};

export {adminDayDetail, myDayDetail};
