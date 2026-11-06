import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as payoutRepository from "../repository/payoutRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import * as flagRepository from "../repository/flagRepository";
import * as commissionRepository from "../repository/commissionRepository";
import {
  PAYMENT_RECEIVED_STATUSES,
  PAYOUT_LIST_MAX,
} from "../constants/payments";
import {
  STATUS_DISPATCH,
  STATUS_USER,
} from "../constants/status";
import {NotFoundError} from "../utils/errors";

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const acceptMinutes = (
  ticket: dispatchRepository.DispatchTicket,
): number | null => {
  const created = Date.parse(str(ticket.createdAt));
  if (!Number.isFinite(created)) return null;
  const history = Array.isArray(ticket.statusHistory) ?
    ticket.statusHistory :
    [];
  for (const entry of history) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (str(row.status) !== STATUS_DISPATCH.MATCHED) continue;
    const at = Date.parse(str(row.at));
    if (!Number.isFinite(at)) continue;
    return Math.max(0, Math.round((at - created) / 60000));
  }
  return null;
};

const dashboard = async ({days}: {days?: number}) => {
  const window = typeof days === "number" ? days : 30;
  const from = isoDaysAgo(window);
  const [users, providers, payments, payouts, tickets, flags, owed] =
    await Promise.all([
      userRepository.findAll(),
      providerRepository.findAll(),
      paymentRepository.findAll(5000),
      payoutRepository.findBetween(from, new Date().toISOString(), 1000),
      dispatchRepository.findAll(2000),
      flagRepository.findAll(),
      commissionRepository.findAllOwed(),
    ]);
  const periodPayments = payments.filter((row) =>
    str(row.createdAt) >= from);
  const periodTickets = tickets.filter((row) =>
    str(row.createdAt) >= from);
  let gross = 0;
  let commission = 0;
  let refunded = 0;
  let net = 0;
  const paymentsByMethod: Record<string, number> = {};
  const paymentsByStatus: Record<string, number> = {};
  for (const payment of periodPayments) {
    bump(paymentsByMethod, str(payment.method) || "UNKNOWN");
    bump(paymentsByStatus, str(payment.status) || "UNKNOWN");
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    gross += num(payment.amount);
    commission += num(payment.commissionAmount);
    refunded += num(payment.refundAmount);
    net += Math.max(0, num(payment.amount) - num(payment.commissionAmount) -
      num(payment.refundAmount));
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
  return {
    windowDays: window,
    from,
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
    money: {
      gross,
      commission,
      refunded,
      net,
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
    str(ticket.status) === STATUS_DISPATCH.RESOLVED);
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

export {dashboard, providerStats, myStats};
