import * as dispatchRepository from "../../repository/dispatchRepository";
import * as paymentRepository from "../../repository/paymentRepository";
import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import * as disputeRepository from "../../repository/disputeRepository";
import {timelineFor, type TicketTimelineEntry} from "../ticket/timeline";

type AdminDisputeTicket = {
  id: string;
  ticketType: string;
  status: string;
  symptom: string | null;
  description: string | null;
  waitingFee: number | null;
  paymentStatus: string | null;
  photoUrls: string[];
  quoteAmount: number | null;
  finalAmount: number | null;
  assignedShopId: string | null;
  createdAt: string | null;
  statusHistory: TicketTimelineEntry[];
  destinationDecline: {
    shopId: string | null;
    reasonCode: string;
    by: string | null;
    at: string | null;
  } | null;
};

type AdminDisputeRider = {
  id: string;
  name: string | null;
  email: string | null;
  ratingAvg: number;
  ratingCount: number;
  trustScore: number;
};

type AdminDisputeProvider = {
  id: string;
  name: string;
  kind: string;
  status: string;
  suspended: boolean;
  ratingAvg: number;
  ratingCount: number;
  declineCount: number;
  operatorUid: string | null;
};

type AdminDisputePayment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  refundAmount: number | null;
  disputeHold: boolean;
  disputedAt: string | null;
};

type AdminDisputeHistoryRow = {
  id: string;
  status: string;
  type: string;
  reasonCode: string;
  outcome: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type AdminDisputeContext = {
  ticket: AdminDisputeTicket | null;
  rider: AdminDisputeRider | null;
  provider: AdminDisputeProvider | null;
  payments: AdminDisputePayment[];
  history: AdminDisputeHistoryRow[];
  filer: "RIDER" | "PROVIDER" | "ADMIN" | "SYSTEM" | null;
};

type AdminDispute = disputeRepository.Dispute & {
  context: AdminDisputeContext;
};

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const providerIdFor = (
  row: disputeRepository.Dispute,
  ticket: dispatchRepository.DispatchTicket | undefined,
): string => {
  const assigned = ticket ? String(ticket.assignedShopId ?? "") : "";
  if (row.accusedKind === "RIDER") return assigned;
  return row.accusedId ?? assigned;
};

const riderIdFor = (
  row: disputeRepository.Dispute,
  ticket: dispatchRepository.DispatchTicket | undefined,
): string => {
  if (row.accusedKind === "RIDER" && row.accusedId) {
    return row.accusedId;
  }
  return ticket ? ticket.userId : "";
};

const quoteFor = (
  ticket: dispatchRepository.DispatchTicket | null,
): {amount: number} | null => {
  if (!ticket || !Array.isArray(ticket.quotes)) return null;
  return ticket.quotes.find(
    (item) => item.shopId === ticket.assignedShopId,
  ) ?? ticket.quotes[ticket.quotes.length - 1] ?? null;
};

const ticketContext = (
  ticket: dispatchRepository.DispatchTicket | null,
): AdminDisputeTicket | null => {
  if (!ticket) return null;
  const quote = quoteFor(ticket);
  const decline = ticket.destinationDecline as
    Record<string, unknown> | null | undefined;
  return {
    id: ticket.id,
    ticketType: ticket.ticketType,
    status: ticket.status,
    symptom: ticket.symptom ?? null,
    description: ticket.description ?? null,
    waitingFee: typeof ticket.waiting?.fee === "number" ?
      ticket.waiting.fee :
      null,
    paymentStatus: ticket.paymentStatus ?? null,
    photoUrls: ticket.photoUrls ?? [],
    quoteAmount: quote ? quote.amount : null,
    finalAmount: typeof ticket.finalAmount === "number" ?
      ticket.finalAmount :
      null,
    assignedShopId: ticket.assignedShopId ?
      String(ticket.assignedShopId) :
      null,
    createdAt: stringOrNull(ticket.createdAt),
    statusHistory: timelineFor(ticket),
    destinationDecline: decline !== null &&
      decline !== undefined &&
      typeof decline.reasonCode === "string" ?
      {
        shopId: stringOrNull(decline.shopId),
        reasonCode: decline.reasonCode,
        by: stringOrNull(decline.by),
        at: stringOrNull(decline.at),
      } :
      null,
  };
};

const riderContext = (
  rider: Awaited<ReturnType<typeof userRepository.findById>>,
): AdminDisputeRider | null => {
  if (!rider) return null;
  return {
    id: rider.id,
    name: stringOrNull(rider.displayName),
    email: stringOrNull(rider.email),
    ratingAvg: numberOr(rider.ratingAvg, 0),
    ratingCount: numberOr(rider.ratingCount, 0),
    trustScore: numberOr(rider.trustScore, 0),
  };
};

const providerContext = (
  provider: Awaited<ReturnType<typeof providerRepository.findById>>,
): AdminDisputeProvider | null => {
  if (!provider) return null;
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    status: provider.status,
    suspended: provider.suspended === true,
    ratingAvg: numberOr(provider.ratingAvg, 0),
    ratingCount: numberOr(provider.ratingCount, 0),
    declineCount: numberOr(provider.declineCount, 0),
    operatorUid: stringOrNull(provider.operatorUid),
  };
};

const filerFor = (
  row: disputeRepository.Dispute,
  ticket: dispatchRepository.DispatchTicket | null,
  provider: AdminDisputeProvider | null,
): AdminDisputeContext["filer"] => {
  if (row.filedByRole === "SYSTEM") return "SYSTEM";
  if (row.filedByRole === "RIDER" ||
    row.filedByRole === "PROVIDER" ||
    row.filedByRole === "ADMIN") {
    return row.filedByRole;
  }
  if (!ticket) return null;
  if (row.filedBy === ticket.userId) return "RIDER";
  if (provider?.operatorUid === row.filedBy) return "PROVIDER";
  return "ADMIN";
};

const paymentSummary = (
  payment: paymentRepository.Payment,
): AdminDisputePayment => ({
  id: payment.id,
  amount: typeof payment.amount === "number" ? payment.amount : 0,
  method: String(payment.method ?? ""),
  status: String(payment.status ?? ""),
  refundAmount: typeof payment.refundAmount === "number" ?
    payment.refundAmount :
    null,
  disputeHold: payment.disputeHold === true,
  disputedAt: typeof payment.disputedAt === "string" ?
    payment.disputedAt :
    null,
});

const attachDisputeContext = async (
  rows: disputeRepository.Dispute[],
): Promise<AdminDispute[]> => {
  if (rows.length === 0) return [];
  const tickets = await dispatchRepository.findByIds(
    rows.map((row) => row.ticketId),
  );
  const ticketMap = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const providerIds = [
    ...new Set(
      rows
        .map((row) => providerIdFor(row, ticketMap.get(row.ticketId)))
        .filter((id) => id !== ""),
    ),
  ];
  const riderIds = [
    ...new Set(
      rows
        .map((row) => riderIdFor(row, ticketMap.get(row.ticketId)))
        .filter((id) => id !== ""),
    ),
  ];
  const ticketIds = [...new Set(rows.map((row) => row.ticketId))];
  const [users, providers, paymentRows, historyRows] = await Promise.all([
    userRepository.findByIds(riderIds),
    providerRepository.findByIds(providerIds),
    Promise.all(ticketIds.map((id) => paymentRepository.findByTicketId(id))),
    Promise.all(ticketIds.map((id) => disputeRepository.findByTicketId(id))),
  ]);
  const historyByTicket = new Map<string, AdminDisputeHistoryRow[]>();
  ticketIds.forEach((id, index) => {
    historyByTicket.set(
      id,
      (historyRows[index] ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        type: row.type,
        reasonCode: row.reasonCode,
        outcome: row.outcome ?? null,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt ?? null,
      })),
    );
  });
  const paymentsByTicket = new Map<string, AdminDisputePayment[]>();
  ticketIds.forEach((id, index) => {
    paymentsByTicket.set(
      id,
      (paymentRows[index] ?? []).map(paymentSummary),
    );
  });
  return rows.map((row) => {
    const ticket = ticketMap.get(row.ticketId) ?? null;
    const riderId = riderIdFor(row, ticket ?? undefined);
    const providerId = providerIdFor(row, ticket ?? undefined);
    const rider = riderContext(
      riderId === "" ? null : users.get(riderId) ?? null,
    );
    const provider = providerContext(
      providerId === "" ? null : providers.get(providerId) ?? null,
    );
    return {
      ...row,
      context: {
        ticket: ticketContext(ticket),
        rider,
        provider,
        payments: paymentsByTicket.get(row.ticketId) ?? [],
        history: historyByTicket.get(row.ticketId) ?? [],
        filer: filerFor(row, ticket, provider),
      },
    };
  });
};

export {
  attachDisputeContext,
  AdminDispute,
  AdminDisputeContext,
  AdminDisputeTicket,
  AdminDisputeRider,
  AdminDisputeProvider,
  AdminDisputePayment,
  AdminDisputeHistoryRow,
};
