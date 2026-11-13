import * as paymentRepository from "../repository/paymentRepository";
import * as payoutRepository from "../repository/payoutRepository";
import * as userRepository from "../repository/userRepository";
import {
  PAYMENT_CURRENCY,
  PAYMENT_RECEIVED_STATUSES,
  PAYMENT_STATUS,
} from "../constants/payments";
import {
  REPORT_DEFAULT_DAYS,
  REPORT_LIST_MAX,
} from "../constants/reports";
import {ValidationError} from "../utils/errors";

type ReportInput = {from?: string; to?: string};

type Stats = {
  gross: number;
  refunds: number;
  commission: number;
  net: number;
  count: number;
};

type PayeeRow = Stats & {
  payeeId: string;
  payeeName: string | null;
  paid: number;
  pending: number;
};

const DAY_MS = 86400000;

const blank = (): Stats => ({
  gross: 0,
  refunds: 0,
  commission: 0,
  net: 0,
  count: 0,
});

const refundedOf = (payment: paymentRepository.Payment): number =>
  typeof payment.refundAmount === "number" ? payment.refundAmount : 0;

const commissionOf = (payment: paymentRepository.Payment): number => {
  const commission = typeof payment.commissionAmount === "number" ?
    payment.commissionAmount :
    0;
  if (payment.amount <= 0) return 0;
  const remaining = Math.max(payment.amount - refundedOf(payment), 0);
  return Math.round(commission * remaining / payment.amount);
};

const isPaid = (payment: paymentRepository.Payment): boolean =>
  PAYMENT_RECEIVED_STATUSES.includes(payment.status) ||
  payment.status === PAYMENT_STATUS.REFUNDED;

const addStats = (
  stats: Stats,
  payment: paymentRepository.Payment,
): void => {
  const refunds = refundedOf(payment);
  const commission = commissionOf(payment);
  stats.gross += payment.amount;
  stats.refunds += refunds;
  stats.commission += commission;
  stats.net += payment.amount - refunds - commission;
  stats.count += 1;
};

const endOf = (value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return parsed;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parsed + DAY_MS - 1 : parsed;
};

const resolveRange = (input: ReportInput): {from: string; to: string} => {
  const endMs = typeof input.to === "string" && input.to !== "" ?
    endOf(input.to) :
    Date.now();
  const startMs = typeof input.from === "string" && input.from !== "" ?
    Date.parse(input.from) :
    endMs - REPORT_DEFAULT_DAYS * DAY_MS;
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
    throw new ValidationError("Invalid report range");
  }
  return {
    from: new Date(startMs).toISOString(),
    to: new Date(endMs).toISOString(),
  };
};

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
};

const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(",");

const revenueReport = async (input: ReportInput) => {
  const range = resolveRange(input);
  const payments = (await paymentRepository.findBetween(
    range.from,
    range.to,
    REPORT_LIST_MAX,
  )).filter(isPaid);
  const total = blank();
  const methods = new Map<string, Stats>();
  const days = new Map<string, Stats>();
  for (const payment of payments) {
    addStats(total, payment);
    const method = String(payment.method);
    const methodStats = methods.get(method) ?? blank();
    addStats(methodStats, payment);
    methods.set(method, methodStats);
    const day = String(payment.createdAt).slice(0, 10);
    const dayStats = days.get(day) ?? blank();
    addStats(dayStats, payment);
    days.set(day, dayStats);
  }
  const byMethod: Record<string, Stats> = {};
  for (const [method, stats] of methods) byMethod[method] = stats;
  const byDay = Array.from(days.entries())
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([date, stats]) => ({date, ...stats}));
  return {
    ...range,
    currency: PAYMENT_CURRENCY,
    ...total,
    byMethod,
    byDay,
  };
};

const payeesReport = async (input: ReportInput) => {
  const range = resolveRange(input);
  const payments = (await paymentRepository.findBetween(
    range.from,
    range.to,
    REPORT_LIST_MAX,
  )).filter(isPaid);
  const batches = await payoutRepository.findBetween(
    range.from,
    range.to,
    REPORT_LIST_MAX,
  );
  const rows = new Map<string, PayeeRow>();
  const rowFor = (payeeId: string): PayeeRow => {
    const existing = rows.get(payeeId);
    if (existing !== undefined) return existing;
    const row: PayeeRow = {
      payeeId,
      payeeName: null,
      ...blank(),
      paid: 0,
      pending: 0,
    };
    rows.set(payeeId, row);
    return row;
  };
  for (const payment of payments) {
    const row = rowFor(payment.payeeId);
    addStats(row, payment);
    if (!payment.payoutAt) {
      row.pending += payment.amount - refundedOf(payment) -
        commissionOf(payment);
    }
  }
  for (const batch of batches) {
    const row = rowFor(batch.payeeId);
    row.paid += batch.net;
    if (typeof batch.payeeName === "string" && batch.payeeName !== "") {
      row.payeeName = batch.payeeName;
    }
  }
  const unnamed = Array.from(rows.values())
    .filter((row) => row.payeeName === null)
    .map((row) => row.payeeId);
  if (unnamed.length > 0) {
    const users = await userRepository.findByIds(unnamed);
    for (const row of rows.values()) {
      if (row.payeeName !== null) continue;
      const name = users.get(row.payeeId)?.displayName;
      if (typeof name === "string" && name !== "") row.payeeName = name;
    }
  }
  const list = Array.from(rows.values())
    .sort((left, right) => right.net - left.net);
  return {...range, currency: PAYMENT_CURRENCY, rows: list};
};

type RevenueReport = Awaited<ReturnType<typeof revenueReport>>;
type PayeesReport = Awaited<ReturnType<typeof payeesReport>>;

const revenueCsv = (report: RevenueReport): string => {
  const lines = [
    csvRow(["date", "gross", "refunds", "commission", "net", "count"]),
  ];
  for (const day of report.byDay) {
    lines.push(csvRow([
      day.date,
      day.gross,
      day.refunds,
      day.commission,
      day.net,
      day.count,
    ]));
  }
  lines.push(csvRow([
    "TOTAL",
    report.gross,
    report.refunds,
    report.commission,
    report.net,
    report.count,
  ]));
  return lines.join("\n");
};

const payeesCsv = (report: PayeesReport): string => {
  const lines = [
    csvRow([
      "payeeId",
      "payeeName",
      "gross",
      "refunds",
      "commission",
      "net",
      "paid",
      "pending",
      "count",
    ]),
  ];
  for (const row of report.rows) {
    lines.push(csvRow([
      row.payeeId,
      row.payeeName,
      row.gross,
      row.refunds,
      row.commission,
      row.net,
      row.paid,
      row.pending,
      row.count,
    ]));
  }
  return lines.join("\n");
};

export {
  revenueReport,
  payeesReport,
  revenueCsv,
  payeesCsv,
  RevenueReport,
  PayeesReport,
};
