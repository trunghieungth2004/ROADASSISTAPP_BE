import {PAYMENT_RECEIVED_STATUSES} from "../constants/payments";

type Row = Record<string, unknown>;

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const dayOf = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, 10) : "";

const dayKeys = (window: number): string[] => {
  const keys: string[] = [];
  for (let i = window - 1; i >= 0; i -= 1) {
    keys.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10));
  }
  return keys;
};

const acceptMinutes = (ticket: Row): number | null => {
  const created = Date.parse(str(ticket.createdAt));
  if (!Number.isFinite(created)) return null;
  const history = Array.isArray(ticket.statusHistory) ?
    ticket.statusHistory :
    [];
  for (const entry of history) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Row;
    if (str(row.status) !== "2") continue;
    const at = Date.parse(str(row.at));
    if (!Number.isFinite(at)) return null;
    return Math.max(0, Math.round((at - created) / 60000));
  }
  return null;
};

const buildDaily = (input: {
  window: number;
  payments: Row[];
  tickets: Row[];
  users: Row[];
  providers: Row[];
}) => {
  const keys = dayKeys(input.window);
  const map = new Map(keys.map((date) => [date, {
    date,
    gross: 0,
    commission: 0,
    net: 0,
    refunds: 0,
    payments: 0,
    tickets: 0,
    users: 0,
    providers: 0,
    cases: 0,
    matchSamples: 0,
    acceptMinutes: 0,
  }]));
  for (const payment of input.payments) {
    const bucket = map.get(dayOf(payment.createdAt));
    if (!bucket) continue;
    bucket.payments += 1;
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    bucket.gross += num(payment.amount);
    bucket.commission += num(payment.commissionAmount);
    bucket.refunds += num(payment.refundAmount);
    bucket.net += Math.max(0, num(payment.amount) -
      num(payment.commissionAmount) - num(payment.refundAmount));
  }
  for (const ticket of input.tickets) {
    const bucket = map.get(dayOf(ticket.createdAt));
    if (!bucket) continue;
    bucket.tickets += 1;
    const minutes = acceptMinutes(ticket);
    if (minutes === null) continue;
    bucket.matchSamples += 1;
    bucket.acceptMinutes += minutes;
  }
  for (const user of input.users) {
    const bucket = map.get(dayOf(user.createdAt));
    if (bucket) bucket.users += 1;
  }
  for (const provider of input.providers) {
    const bucket = map.get(dayOf(provider.createdAt));
    if (bucket) bucket.providers += 1;
  }
  return map;
};

const buildCases = (input: {
  window: number;
  reports: Row[];
  disputes: Row[];
  appeals: Row[];
}) => {
  const rows = dayKeys(input.window).map((date) => ({
    date,
    reports: 0,
    disputes: 0,
    appeals: 0,
    ratingReviews: 0,
  }));
  const map = new Map(rows.map((row) => [row.date, row]));
  for (const report of input.reports) {
    const bucket = map.get(dayOf(report.createdAt));
    if (bucket) bucket.reports += 1;
  }
  for (const dispute of input.disputes) {
    const bucket = map.get(dayOf(dispute.createdAt));
    if (bucket) bucket.disputes += 1;
  }
  for (const appeal of input.appeals) {
    const bucket = map.get(dayOf(appeal.createdAt));
    if (!bucket) continue;
    bucket.appeals += 1;
    if (appeal.subjectKind === "RATING") bucket.ratingReviews += 1;
  }
  return rows;
};

const buildTopProviders = (input: {
  payments: Row[];
  providers: Row[];
}) => {
  const providerMap = new Map(input.providers.map((row) => [str(row.id), row]));
  const top = new Map<string, {
    id: string;
    name: string;
    kind: string;
    gross: number;
    net: number;
    jobs: Set<string>;
    ratingAvg: number;
    ratingCount: number;
  }>();
  for (const payment of input.payments) {
    if (!PAYMENT_RECEIVED_STATUSES.includes(str(payment.status))) continue;
    const payeeId = str(payment.payeeId);
    const provider = providerMap.get(payeeId);
    if (!provider) continue;
    const row = top.get(payeeId) ?? {
      id: payeeId,
      name: str(provider.name) || payeeId,
      kind: str(provider.kind),
      gross: 0,
      net: 0,
      jobs: new Set<string>(),
      ratingAvg: num(provider.ratingAvg),
      ratingCount: num(provider.ratingCount),
    };
    row.gross += num(payment.amount);
    row.net += Math.max(0, num(payment.amount) -
      num(payment.commissionAmount) - num(payment.refundAmount));
    row.jobs.add(str(payment.ticketId));
    top.set(payeeId, row);
  }
  return [...top.values()]
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      gross: row.gross,
      net: row.net,
      jobs: row.jobs.size,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
    }));
};

const buildDashboardSeries = (input: {
  window: number;
  payments: Row[];
  tickets: Row[];
  users: Row[];
  providers: Row[];
  flags: Row[];
  reports: Row[];
  disputes: Row[];
  appeals: Row[];
  paymentsByStatus: Record<string, number>;
  paymentsByMethod: Record<string, number>;
  ticketsByStatus: Record<string, number>;
  ticketsByType: Record<string, number>;
  flagsByStatus: Record<string, number>;
}) => {
  const dailyMap = buildDaily(input);
  const cases = buildCases(input);
  for (const bucket of dailyMap.values()) {
    const day = cases.find((row) => row.date === bucket.date);
    bucket.cases = (day?.reports ?? 0) +
      (day?.disputes ?? 0) +
      (day?.appeals ?? 0);
  }
  const casesByKind: Record<string, number> = {
    REPORT: input.reports.length,
    DISPUTE: input.disputes.length,
    APPEAL: input.appeals.length,
    RATING_REVIEW: input.appeals
      .filter((row) => row.subjectKind === "RATING")
      .length,
  };
  const casesByStatus: Record<string, number> = {};
  for (const row of [...input.reports, ...input.disputes, ...input.appeals]) {
    const status = str(row.status) || "UNKNOWN";
    casesByStatus[status] = (casesByStatus[status] ?? 0) + 1;
  }
  const flagsByType: Record<string, number> = {};
  for (const flag of input.flags) {
    const type = str(flag.type) || "UNKNOWN";
    flagsByType[type] = (flagsByType[type] ?? 0) + 1;
  }
  return {
    daily: [...dailyMap.values()].map((row) => ({
      date: row.date,
      gross: row.gross,
      commission: row.commission,
      net: row.net,
      refunds: row.refunds,
      payments: row.payments,
      tickets: row.tickets,
      users: row.users,
      providers: row.providers,
      cases: row.cases,
    })),
    sla: [...dailyMap.values()].map((row) => ({
      date: row.date,
      matchRate: row.tickets > 0 ? row.matchSamples / row.tickets : 0,
      avgAcceptMinutes: row.matchSamples > 0 ?
        row.acceptMinutes / row.matchSamples :
        0,
    })),
    cases,
    paymentsByStatus: input.paymentsByStatus,
    paymentsByMethod: input.paymentsByMethod,
    ticketsByStatus: input.ticketsByStatus,
    ticketsByType: input.ticketsByType,
    casesByKind,
    casesByStatus,
    flagsByStatus: input.flagsByStatus,
    flagsByType,
    topProviders: buildTopProviders(input),
  };
};

export {buildDashboardSeries};
