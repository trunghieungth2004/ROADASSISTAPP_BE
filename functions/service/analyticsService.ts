import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as payoutRepository from "../repository/payoutRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import * as flagRepository from "../repository/flagRepository";
import * as reportRepository from "../repository/reportRepository";
import * as disputeRepository from "../repository/disputeRepository";
import * as appealRepository from "../repository/appealRepository";
import * as commissionRepository from "../repository/commissionRepository";
import * as bookingRepository from "../repository/bookingRepository";
import {
  PAYMENT_RECEIVED_STATUSES,
  PAYOUT_LIST_MAX,
} from "../constants/payments";
import {
  STATUS_DISPATCH,
  STATUS_USER,
} from "../constants/status";
import {NotFoundError} from "../utils/errors";
import {buildDashboardSeries} from "./analyticsSeries";
import {dayKeysBetween, previousRange, resolveAnalyticsRange} from "./analyticsRange";
import {
  collectBookings,
  collectServiceMix,
  isCompletedTicket,
} from "./analyticsMix";

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const pctChange = (current: number, previous: number): number => {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const within = (value: unknown, from: string, to: string): boolean => {
  const text = str(value);
  return text !== "" && text >= from && text <= to;
};

const dayOf = (value: unknown): string => str(value).slice(0, 10);

type Row = Record<string, unknown>;

const acceptMinutes = (ticket: object): number | null => {
  const row = ticket as Row;
  const created = Date.parse(str(row.createdAt));
  if (!Number.isFinite(created)) return null;
  const history = Array.isArray(row.statusHistory) ?
    row.statusHistory :
    [];
  for (const entry of history) {
    if (typeof entry !== "object" || entry === null) continue;
    const entryRow = entry as Row;
    if (str(entryRow.status) !== STATUS_DISPATCH.MATCHED) continue;
    const at = Date.parse(str(entryRow.at));
    if (!Number.isFinite(at)) return null;
    return Math.max(0, Math.round((at - created) / 60000));
  }
  return null;
};

const paymentTotals = (rows: Row[]) => {
  let gross = 0;
  let commission = 0;
  let refunded = 0;
  let net = 0;
  let received = 0;
  for (const payment of rows) {
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    received += 1;
    gross += num(payment.amount);
    commission += num(payment.commissionAmount);
    refunded += num(payment.refundAmount);
    net += Math.max(0, num(payment.amount) - num(payment.commissionAmount) -
      num(payment.refundAmount));
  }
  return {
    count: rows.length,
    received,
    gross,
    commission,
    refunded,
    net,
  };
};

const ticketTotals = (rows: Row[]) => {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let active = 0;
  let completed = 0;
  for (const ticket of rows) {
    const status = str(ticket.status) || "UNKNOWN";
    bump(byType, str(ticket.ticketType) || "UNKNOWN");
    bump(byStatus, status);
    if (dispatchRepository.ACTIVE_TICKET_STATUSES.has(status)) active += 1;
    if (isCompletedTicket(ticket)) completed += 1;
  }
  return {
    total: rows.length,
    active,
    completed,
    byType,
    byStatus,
  };
};

const dashboard = async ({
  days,
  startDate,
  endDate,
}: {
  days?: number;
  startDate?: string;
  endDate?: string;
}) => {
  const range = resolveAnalyticsRange({days, startDate, endDate});
  const [
    users,
    providers,
    payments,
    payouts,
    tickets,
    bookings,
    flags,
    owed,
    reports,
    disputes,
    appeals,
  ] = await Promise.all([
    userRepository.findAll(),
    providerRepository.findAll(),
    paymentRepository.findAll(5000),
    payoutRepository.findBetween(range.from, range.to, 1000),
    dispatchRepository.findAll(2000),
    bookingRepository.findAll(5000),
    flagRepository.findAll(),
    commissionRepository.findAllOwed(),
    reportRepository.list({limit: 500}),
    disputeRepository.findAll(500),
    appealRepository.findAll(500),
  ]);
  const periodPayments = payments.filter((row) =>
    within(row.createdAt, range.from, range.to));
  const periodTickets = tickets.filter((row) =>
    within(row.createdAt, range.from, range.to));
  const periodBookings = bookings.filter((row) =>
    within(row.scheduledAt, range.from, range.to));
  const periodReports = reports.filter((row) =>
    within(row.createdAt, range.from, range.to));
  const periodDisputes = disputes.filter((row) =>
    within(row.createdAt, range.from, range.to));
  const periodAppeals = appeals.filter((row) =>
    within(row.createdAt, range.from, range.to));
  const money = paymentTotals(periodPayments);
  const priorRange = previousRange(range);
  const priorPayments = payments.filter((row) =>
    within(row.createdAt, priorRange.from, priorRange.to));
  const priorTickets = tickets.filter((row) =>
    within(row.createdAt, priorRange.from, priorRange.to));
  const priorBookings = bookings.filter((row) =>
    within(row.scheduledAt, priorRange.from, priorRange.to));
  const priorMoney = paymentTotals(priorPayments);
  const priorTicketTotals = ticketTotals(priorTickets);
  const currentBookings = collectBookings(periodBookings as unknown as Row[]);
  const priorBookingTotals = collectBookings(priorBookings as unknown as Row[]);
  const currentCompleted = periodTickets.filter((row) =>
    isCompletedTicket(row as unknown as Row)).length;
  const comparison = {
    startDate: priorRange.startDate,
    endDate: priorRange.endDate,
    current: {
      gross: money.gross,
      commission: money.commission,
      net: money.net,
      tickets: periodTickets.length,
      completed: currentCompleted,
      bookings: currentBookings.total,
      bookingsCompleted: currentBookings.completed,
    },
    previous: {
      gross: priorMoney.gross,
      commission: priorMoney.commission,
      net: priorMoney.net,
      tickets: priorTickets.length,
      completed: priorTicketTotals.completed,
      bookings: priorBookingTotals.total,
      bookingsCompleted: priorBookingTotals.completed,
    },
    change: {
      gross: pctChange(money.gross, priorMoney.gross),
      commission: pctChange(money.commission, priorMoney.commission),
      net: pctChange(money.net, priorMoney.net),
      tickets: pctChange(periodTickets.length, priorTickets.length),
      completed: pctChange(currentCompleted, priorTicketTotals.completed),
      bookings: pctChange(currentBookings.total, priorBookingTotals.total),
      bookingsCompleted: pctChange(
        currentBookings.completed,
        priorBookingTotals.completed,
      ),
    },
  };
  const paymentsByMethod: Record<string, number> = {};
  const paymentsByStatus: Record<string, number> = {};
  for (const payment of periodPayments) {
    bump(paymentsByMethod, str(payment.method) || "UNKNOWN");
    bump(paymentsByStatus, str(payment.status) || "UNKNOWN");
  }
  const payoutsNet = payouts.reduce(
    (sum, batch) => sum + num(batch.netPayout ?? batch.net),
    0,
  );
  const payoutsCommission = payouts.reduce(
    (sum, batch) => sum + num(batch.commissionDeducted),
    0,
  );
  const ticketsByType: Record<string, number> = {};
  const ticketsByStatus: Record<string, number> = {};
  let matched = 0;
  let acceptSamples = 0;
  let acceptTotal = 0;
  let active = 0;
  for (const ticket of periodTickets) {
    bump(ticketsByType, str(ticket.ticketType) || "UNKNOWN");
    bump(ticketsByStatus, str(ticket.status) || "UNKNOWN");
    if (dispatchRepository.ACTIVE_TICKET_STATUSES.has(str(ticket.status))) {
      active += 1;
    }
    const minutes = acceptMinutes(ticket);
    if (minutes !== null) {
      matched += 1;
      acceptSamples += 1;
      acceptTotal += minutes;
    }
  }
  const providersByKind: Record<string, Record<string, number>> = {};
  let suspended = 0;
  let ratingTotal = 0;
  let ratingSamples = 0;
  for (const provider of providers) {
    const kind = str(provider.kind) || "UNKNOWN";
    const bucket = providersByKind[kind] ?? {};
    bump(bucket, str(provider.status) || "UNKNOWN");
    providersByKind[kind] = bucket;
    if (provider.suspended === true) suspended += 1;
    const rating = num(provider.ratingAvg);
    const count = num(provider.ratingCount);
    if (count > 0) {
      ratingTotal += rating * count;
      ratingSamples += count;
    }
  }
  const flagsByStatus: Record<string, number> = {};
  let recentFlags = 0;
  for (const flag of flags) {
    bump(flagsByStatus, str(flag.status) || "UNKNOWN");
    if (str(flag.createdAt) >= isoDaysAgo(7)) recentFlags += 1;
  }
  const owedByPayee = new Map<string, number>();
  let commissionOwed = 0;
  for (const entry of owed) {
    const open = Math.max(
      0,
      num(entry.amount) - num(entry.settledAmount) - num(entry.reversedAmount),
    );
    if (open <= 0) continue;
    commissionOwed += open;
    owedByPayee.set(
      entry.payeeId,
      (owedByPayee.get(entry.payeeId) ?? 0) + open,
    );
  }
  const series = buildDashboardSeries({
    startDate: range.startDate,
    endDate: range.endDate,
    payments: periodPayments as unknown as Row[],
    tickets: periodTickets as unknown as Row[],
    bookings: periodBookings as unknown as Row[],
    users,
    providers,
    flags,
    reports: periodReports as unknown as Row[],
    disputes: periodDisputes as unknown as Row[],
    appeals: periodAppeals as unknown as Row[],
    paymentsByStatus,
    paymentsByMethod,
    ticketsByStatus,
    ticketsByType,
    flagsByStatus,
  });
  return {
    windowDays: range.days,
    days: range.days,
    startDate: range.startDate,
    endDate: range.endDate,
    from: range.from,
    to: range.to,
    generatedAt: new Date().toISOString(),
    comparison,
    users: {
      total: users.length,
      active: users.filter((row) =>
        str(row.status) === STATUS_USER.ACTIVE).length,
      admins: users.filter((row) => str(row.role) === "1").length,
    },
    providers: {
      total: providers.length,
      suspended,
      byKind: providersByKind,
      ratingAvg: ratingSamples > 0 ? ratingTotal / ratingSamples : 0,
      ratingCount: ratingSamples,
    },
    tickets: {
      total: periodTickets.length,
      active,
      completed: currentCompleted,
      matched,
      matchRate: periodTickets.length > 0 ?
        matched / periodTickets.length :
        0,
      avgAcceptMinutes: acceptSamples > 0 ?
        acceptTotal / acceptSamples :
        null,
      byType: ticketsByType,
      byStatus: ticketsByStatus,
    },
    bookings: currentBookings,
    services: collectServiceMix({
      tickets: periodTickets as unknown as Row[],
      bookings: periodBookings as unknown as Row[],
    }),
    series,
    money: {
      gross: money.gross,
      commission: money.commission,
      refunded: money.refunded,
      net: money.net,
      payments: money.count,
      payoutsNet,
      payoutsCommissionDeducted: payoutsCommission,
      payoutsCount: payouts.length,
      commissionOwed,
      payeesOwingCommission: owedByPayee.size,
      byMethod: paymentsByMethod,
      byStatus: paymentsByStatus,
    },
    flags: {
      total: flags.length,
      recent7d: recentFlags,
      byStatus: flagsByStatus,
    },
  };
};

const providerStats = async ({
  providerId,
}: {
  providerId: string;
}) => {
  const provider = await providerRepository.findById(providerId);
  if (!provider) throw new NotFoundError("Provider not found");
  const operatorUid = str(provider.operatorUid);
  const [completed, recent, payouts, commissionOwed] = await Promise.all([
    dispatchRepository.countFulfilled(providerId),
    dispatchRepository.findRecentForShop(providerId, 50),
    operatorUid === "" ?
      Promise.resolve([]) :
      payoutRepository.findByPayee(operatorUid, PAYOUT_LIST_MAX),
    operatorUid === "" ?
      Promise.resolve(0) :
      commissionRepository.owedTotalByPayee(operatorUid),
  ]);
  const completedRows = recent.filter((ticket) =>
    isCompletedTicket(ticket as unknown as Row));
  const gross = payouts.reduce((sum, batch) => sum + num(batch.gross), 0);
  const net = payouts.reduce(
    (sum, batch) => sum + num(batch.netPayout ?? batch.net),
    0,
  );
  return {
    provider: {
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      status: provider.status,
      suspended: provider.suspended === true,
      accepting: provider.accepting === true,
      ratingAvg: num(provider.ratingAvg),
      ratingCount: num(provider.ratingCount),
      services: Array.isArray(provider.services) ? provider.services : [],
    },
    completedJobs: completed,
    recentResolved: completedRows.length,
    payouts: {
      batches: payouts.length,
      gross,
      net,
      commissionOwed,
    },
  };
};

const myStats = async ({userId}: {userId: string}) => {
  const providers = await providerRepository.findByOperator(userId);
  const payouts = await payoutRepository.findByPayee(userId, PAYOUT_LIST_MAX);
  const commissionOwed = await commissionRepository.owedTotalByPayee(userId);
  const rows = [];
  for (const provider of providers) {
    const completed = await dispatchRepository.countFulfilled(provider.id);
    rows.push({
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      status: provider.status,
      accepting: provider.accepting === true,
      suspended: provider.suspended === true,
      ratingAvg: num(provider.ratingAvg),
      ratingCount: num(provider.ratingCount),
      completedJobs: completed,
    });
  }
  return {
    providers: rows,
    payouts: {
      batches: payouts.length,
      gross: payouts.reduce((sum, batch) => sum + num(batch.gross), 0),
      net: payouts.reduce(
        (sum, batch) => sum + num(batch.netPayout ?? batch.net),
        0,
      ),
      commissionOwed,
    },
  };
};

const ticketBelongsTo = (ticket: Row, providerId: string): boolean => {
  if (str(ticket.assignedShopId) === providerId) return true;
  if (str(ticket.destinationShopId) === providerId) return true;
  const former = Array.isArray(ticket.formerAssignedShopIds) ?
    ticket.formerAssignedShopIds as unknown[] :
    [];
  return former.some((id) => str(id) === providerId);
};

const providerTookTicket = (ticket: Row, providerId: string): boolean => {
  if (str(ticket.assignedShopId) === providerId) return true;
  if (str(ticket.providerId) === providerId) return true;
  const former = Array.isArray(ticket.formerAssignedShopIds) ?
    ticket.formerAssignedShopIds as unknown[] :
    [];
  return former.some((id) => str(id) === providerId);
};

const buildActivitySeries = ({
  keys,
  riderTickets,
  riderPayments,
  riderBookings,
  providerTickets,
  providerPayments,
  providerBookings,
}: {
  keys: string[];
  riderTickets: Row[];
  riderPayments: Row[];
  riderBookings: Row[];
  providerTickets: Row[];
  providerPayments: Row[];
  providerBookings: Row[];
}) => {
  const rider = new Map(keys.map((date) => [date, {
    date,
    tickets: 0,
    completed: 0,
    spend: 0,
    bookings: 0,
  }]));
  const provider = new Map(keys.map((date) => [date, {
    date,
    jobs: 0,
    completed: 0,
    earnings: 0,
    bookings: 0,
  }]));
  for (const ticket of riderTickets) {
    const bucket = rider.get(dayOf(ticket.createdAt));
    if (!bucket) continue;
    bucket.tickets += 1;
    if (isCompletedTicket(ticket)) bucket.completed += 1;
  }
  for (const payment of riderPayments) {
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    const bucket = rider.get(dayOf(payment.createdAt));
    if (bucket) bucket.spend += num(payment.amount);
  }
  for (const booking of riderBookings) {
    const bucket = rider.get(dayOf(booking.scheduledAt));
    if (bucket) bucket.bookings += 1;
  }
  for (const ticket of providerTickets) {
    const bucket = provider.get(dayOf(ticket.createdAt));
    if (!bucket) continue;
    bucket.jobs += 1;
    if (isCompletedTicket(ticket)) bucket.completed += 1;
  }
  for (const payment of providerPayments) {
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    const bucket = provider.get(dayOf(payment.createdAt));
    if (bucket) {
      bucket.earnings += Math.max(0, num(payment.amount) -
        num(payment.commissionAmount) - num(payment.refundAmount));
    }
  }
  for (const booking of providerBookings) {
    const bucket = provider.get(dayOf(booking.scheduledAt));
    if (bucket) bucket.bookings += 1;
  }
  return {
    rider: [...rider.values()],
    provider: [...provider.values()],
  };
};

const myAnalytics = async ({
  userId,
  days,
  startDate,
  endDate,
}: {
  userId: string;
  days?: number;
  startDate?: string;
  endDate?: string;
}) => {
  const range = resolveAnalyticsRange({days, startDate, endDate});
  const providers = await providerRepository.findByOperator(userId);
  const providerIds = providers.map((provider) => provider.id);
  const [
    riderTicketRows,
    riderPaymentRows,
    riderBookingRows,
    providerTicketBatches,
    providerBookingBatches,
    payoutRows,
    lifetimeRows,
    commissionOwed,
  ] = await Promise.all([
    dispatchRepository.findByUserId(userId, 1000),
    paymentRepository.findByRiderAll(userId),
    bookingRepository.findByRider(userId, 1000),
    Promise.all(providerIds.map((id) =>
      dispatchRepository.findRecentForShop(id, 1000))),
    Promise.all(providerIds.map((id) =>
      bookingRepository.findByShop(id, 1000))),
    payoutRepository.findBetween(range.from, range.to, 1000),
    Promise.all(providerIds.map((id) =>
      dispatchRepository.countFulfilled(id))),
    commissionRepository.owedTotalByPayee(userId),
  ]);
  const providerTicketRows: Row[] = [];
  const seenTickets = new Set<string>();
  for (const batch of providerTicketBatches) {
    for (const ticket of batch) {
      if (seenTickets.has(ticket.id)) continue;
      seenTickets.add(ticket.id);
      providerTicketRows.push(ticket as unknown as Row);
    }
  }
  const providerBookingRows = providerBookingBatches.flat() as unknown as Row[];
  const riderTickets = riderTicketRows.filter((row) =>
    within(row.createdAt, range.from, range.to)) as unknown as Row[];
  const riderPayments = riderPaymentRows.filter((row) =>
    within(row.createdAt, range.from, range.to)) as unknown as Row[];
  const riderBookings = riderBookingRows.filter((row) =>
    within(row.scheduledAt, range.from, range.to)) as unknown as Row[];
  const providerTickets = providerTicketRows.filter((row) =>
    within(row.createdAt, range.from, range.to));
  const providerBookings = providerBookingRows.filter((row) =>
    within(row.scheduledAt, range.from, range.to));
  const providerPayments = await paymentRepository.findByPayeeAll(userId);
  const periodProviderPayments = providerPayments.filter((row) =>
    within(row.createdAt, range.from, range.to)) as unknown as Row[];
  const myPayouts = payoutRows.filter((row) => row.payeeId === userId);
  const keys = dayKeysBetween(range.startDate, range.endDate);
  const activity = buildActivitySeries({
    keys,
    riderTickets,
    riderPayments,
    riderBookings,
    providerTickets,
    providerPayments: periodProviderPayments,
    providerBookings,
  });
  const riderServices = collectServiceMix({
    tickets: riderTickets,
    bookings: riderBookings,
  });
  const providerServices = collectServiceMix({
    tickets: providerTickets,
    bookings: providerBookings,
  });
  let ratingTotal = 0;
  let ratingSamples = 0;
  const providerRows = providers.map((provider, index) => {
    const rows = providerTicketRows.filter((row) =>
      ticketBelongsTo(row, provider.id));
    const scoped = rows.filter((row) =>
      within(row.createdAt, range.from, range.to));
    const bookings = providerBookingRows.filter((row) =>
      str(row.providerId) === provider.id &&
      within(row.scheduledAt, range.from, range.to));
    const rating = num(provider.ratingAvg);
    const count = num(provider.ratingCount);
    if (count > 0) {
      ratingTotal += rating * count;
      ratingSamples += count;
    }
    return {
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      status: provider.status,
      accepting: provider.accepting === true,
      suspended: provider.suspended === true,
      ratingAvg: rating,
      ratingCount: count,
      completedJobs: scoped.filter((row) => isCompletedTicket(row)).length,
      takenJobs: scoped.filter((row) =>
        providerTookTicket(row, provider.id)).length,
      lifetimeCompletedJobs: lifetimeRows[index] ?? 0,
      bookings: bookings.length,
      services: collectServiceMix({
        tickets: scoped,
        bookings,
      }).services,
    };
  });
  const providerTotals = ticketTotals(providerTickets);
  const providerTaken = providerTickets.filter((row) =>
    providerIds.some((id) => providerTookTicket(row, id))).length;
  const riderTotals = ticketTotals(riderTickets);
  const earnings = paymentTotals(periodProviderPayments);
  const payoutsNet = myPayouts.reduce(
    (sum, row) => sum + num(row.netPayout ?? row.net),
    0,
  );
  const riderPaymentsTotals = paymentTotals(riderPayments);
  const riderBookingsSummary = collectBookings(riderBookings);
  const providerBookingsSummary = collectBookings(providerBookings);
  const priorRange = previousRange(range);
  const priorRiderTickets = riderTicketRows.filter((row) =>
    within(row.createdAt, priorRange.from, priorRange.to)) as unknown as Row[];
  const priorRiderPayments = riderPaymentRows.filter((row) =>
    within(row.createdAt, priorRange.from, priorRange.to)) as unknown as Row[];
  const priorRiderBookings = riderBookingRows.filter((row) =>
    within(row.scheduledAt, priorRange.from, priorRange.to)) as unknown as Row[];
  const priorProviderTickets = providerTicketRows.filter((row) =>
    within(row.createdAt, priorRange.from, priorRange.to));
  const priorProviderBookings = providerBookingRows.filter((row) =>
    within(row.scheduledAt, priorRange.from, priorRange.to));
  const priorProviderPayments = providerPayments.filter((row) =>
    within(row.createdAt, priorRange.from, priorRange.to)) as unknown as Row[];
  const priorRiderTotals = ticketTotals(priorRiderTickets);
  const priorProviderTotals = ticketTotals(priorProviderTickets);
  const priorRiderMoney = paymentTotals(priorRiderPayments);
  const priorProviderEarnings = paymentTotals(priorProviderPayments);
  const priorRiderBookingsSummary = collectBookings(priorRiderBookings);
  const priorProviderBookingsSummary = collectBookings(
    priorProviderBookings,
  );
  const comparison = {
    startDate: priorRange.startDate,
    endDate: priorRange.endDate,
    current: {
      rider: {
        spend: riderPaymentsTotals.gross,
        tickets: riderTotals.total,
        completed: riderTotals.completed,
        bookings: riderBookingsSummary.total,
      },
      provider: {
        gross: earnings.gross,
        net: earnings.net,
        taken: providerTaken,
        completed: providerTotals.completed,
        bookings: providerBookingsSummary.total,
      },
    },
    previous: {
      rider: {
        spend: priorRiderMoney.gross,
        tickets: priorRiderTotals.total,
        completed: priorRiderTotals.completed,
        bookings: priorRiderBookingsSummary.total,
      },
      provider: {
        gross: priorProviderEarnings.gross,
        net: priorProviderEarnings.net,
        taken: priorProviderTickets.filter((row) =>
          providerIds.some((id) => providerTookTicket(row, id))).length,
        completed: priorProviderTotals.completed,
        bookings: priorProviderBookingsSummary.total,
      },
    },
    change: {
      rider: {
        spend: pctChange(riderPaymentsTotals.gross, priorRiderMoney.gross),
        tickets: pctChange(riderTotals.total, priorRiderTotals.total),
        completed: pctChange(
          riderTotals.completed,
          priorRiderTotals.completed,
        ),
        bookings: pctChange(
          riderBookingsSummary.total,
          priorRiderBookingsSummary.total,
        ),
      },
      provider: {
        gross: pctChange(earnings.gross, priorProviderEarnings.gross),
        net: pctChange(earnings.net, priorProviderEarnings.net),
        taken: pctChange(providerTaken, priorProviderTickets.filter((row) =>
          providerIds.some((id) => providerTookTicket(row, id))).length),
        completed: pctChange(
          providerTotals.completed,
          priorProviderTotals.completed,
        ),
        bookings: pctChange(
          providerBookingsSummary.total,
          priorProviderBookingsSummary.total,
        ),
      },
    },
  };
  return {
    windowDays: range.days,
    days: range.days,
    startDate: range.startDate,
    endDate: range.endDate,
    generatedAt: new Date().toISOString(),
    comparison,
    rider: {
      tickets: riderTotals,
      payments: riderPaymentsTotals,
      bookings: riderBookingsSummary,
      services: riderServices,
      series: activity.rider,
    },
    provider: {
      providers: providerRows,
      tickets: {
        ...providerTotals,
        taken: providerTaken,
      },
      earnings: {
        ...earnings,
        commissionOwed,
      },
      payouts: {
        count: myPayouts.length,
        net: payoutsNet,
      },
      bookings: providerBookingsSummary,
      rating: {
        avg: ratingSamples > 0 ? ratingTotal / ratingSamples : 0,
        count: ratingSamples,
      },
      services: providerServices,
      series: activity.provider,
    },
  };
};

export {dashboard, providerStats, myStats, myAnalytics};
