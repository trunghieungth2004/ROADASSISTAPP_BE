import * as dispatchRepository from "../repository/dispatchRepository";
import * as paymentRepository from "../repository/paymentRepository";
import * as providerRepository from "../repository/providerRepository";
import * as userRepository from "../repository/userRepository";
import {
  BILL_ITEM_KIND,
  BILL_ITEM_STATUS,
  BILL_LIST_LIMIT,
  BILL_LIST_MAX,
  BILL_STATUS,
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from "../constants/payments";
import {ROLE_ADMIN} from "../constants/roles";
import {STATUS_DISPATCH} from "../constants/status";
import {
  billableAmountFor,
  isOperatorOfTicket,
  resolvePayeeId,
  type TicketLike,
} from "./paymentService";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";

const MAX_JOURNEY_DEPTH = 4;
const BILL_SCAN_LIMIT = 100;

type BillItem = {
  kind: string;
  ticketId: string;
  ticketType: string;
  ticketStatus: string;
  amount: number;
  waitingFee: number;
  status: string;
  payeeId: string | null;
  payeeName: string | null;
  qrUrl: string | null;
  payment: {
    id: string;
    method: string;
    status: string;
    amount: number;
    refundAmount: number | null;
  } | null;
};

type Bill = {
  billId: string;
  ticketId: string;
  ticketType: string;
  ticketStatus: string;
  createdAt: string | null;
  currency: string;
  total: number;
  paid: number;
  due: number;
  status: string;
  items: BillItem[];
};

const UNPAYABLE_STATUSES: Set<string> = new Set([
  STATUS_DISPATCH.CANCELLED,
  STATUS_DISPATCH.DECLINED,
  STATUS_DISPATCH.RESOLVED_UNFIXABLE,
  STATUS_DISPATCH.UNFIXABLE,
]);

const SETTLED_STATUSES: Set<string> = new Set([
  PAYMENT_STATUS.HELD,
  PAYMENT_STATUS.CONFIRMED,
]);

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const linkIdsOf = (ticket: {linkedTicketIds?: unknown}): string[] =>
  Array.isArray(ticket.linkedTicketIds) ?
    ticket.linkedTicketIds.filter(
      (value): value is string => typeof value === "string" && value !== "",
    ) :
    [];

const asBillable = (ticket: dispatchRepository.DispatchTicket): TicketLike =>
  ({
    id: ticket.id,
    userId: String(ticket.userId ?? ""),
    ticketType: String(ticket.ticketType ?? ""),
    status: String(ticket.status ?? ""),
    assignedShopId: ticket.assignedShopId,
    destinationShopId: ticket.destinationShopId,
    providerId: ticket.providerId,
    assignedUid: ticket.assignedUid,
    shopQuotedAmount: ticket.shopQuotedAmount,
    finalAmount: ticket.finalAmount,
    towFare: ticket.towFare,
  }) as TicketLike;

const linkedTowFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<dispatchRepository.DispatchTicket | null> => {
  for (const id of linkIdsOf(ticket)) {
    if (id === ticket.id) continue;
    const linked = await dispatchRepository.findById(id);
    if (linked && linked.ticketType === "TOW") return linked;
  }
  return null;
};

const journeyRootId = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<string> => {
  let current = ticket;
  const seen = new Set<string>([ticket.id]);
  for (let depth = 0; depth < MAX_JOURNEY_DEPTH; depth += 1) {
    const parent = await linkedTowFor(current);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
};

const journeyTickets = async (
  root: dispatchRepository.DispatchTicket,
): Promise<dispatchRepository.DispatchTicket[]> => {
  const tickets = [root];
  if (root.ticketType !== "TOW") return tickets;
  for (const id of linkIdsOf(root)) {
    if (id === root.id) continue;
    const linked = await dispatchRepository.findById(id);
    if (!linked) continue;
    if (linked.ticketType !== "WALK_IN" && linked.ticketType !== "MECHANIC") {
      continue;
    }
    tickets.push(linked);
  }
  return tickets;
};

const payeeNameFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<string | null> => {
  const ids = [
    ticket.assignedShopId,
    ticket.providerId,
    ticket.destinationShopId,
  ].filter(nonEmpty);
  for (const id of ids) {
    const provider = await providerRepository.findById(id);
    if (provider && nonEmpty(provider.name)) return provider.name;
  }
  return null;
};

const payeeUidFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<string | null> => {
  try {
    return await resolvePayeeId(asBillable(ticket));
  } catch {
    return null;
  }
};

const buildItem = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<BillItem | null> => {
  const billable = billableAmountFor(asBillable(ticket));
  if (!billable || billable.amount <= 0) return null;
  const payments = await paymentRepository.findByTicketId(ticket.id);
  const payment = payments[0] ?? null;
  const paymentStatus = payment ? String(payment.status) : null;
  const voided = UNPAYABLE_STATUSES.has(String(ticket.status ?? ""));
  let status: string;
  if (paymentStatus !== null && SETTLED_STATUSES.has(paymentStatus)) {
    status = BILL_ITEM_STATUS.PAID;
  } else if (paymentStatus === PAYMENT_STATUS.REFUNDED) {
    status = BILL_ITEM_STATUS.REFUNDED;
  } else if (paymentStatus === PAYMENT_STATUS.PARTIAL) {
    status = BILL_ITEM_STATUS.PARTIAL;
  } else if (voided) {
    status = BILL_ITEM_STATUS.VOID;
  } else if (paymentStatus === PAYMENT_STATUS.PENDING) {
    status = BILL_ITEM_STATUS.PENDING;
  } else {
    status = BILL_ITEM_STATUS.UNPAID;
  }
  return {
    kind: ticket.ticketType === "TOW" ?
      BILL_ITEM_KIND.TOW_FARE :
      BILL_ITEM_KIND.REPAIR,
    ticketId: ticket.id,
    ticketType: String(ticket.ticketType ?? ""),
    ticketStatus: String(ticket.status ?? ""),
    amount: billable.amount,
    waitingFee: billable.waitingFee,
    status,
    payeeId: await payeeUidFor(ticket),
    payeeName: await payeeNameFor(ticket),
    qrUrl: nonEmpty(ticket.checkoutUrl) ? ticket.checkoutUrl : null,
    payment: payment ? {
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      refundAmount: payment.refundAmount,
    } : null,
  };
};

const buildBill = async (rootId: string): Promise<Bill> => {
  const root = await dispatchRepository.findById(rootId);
  if (!root) throw new NotFoundError("Dispatch ticket not found");
  const tickets = await journeyTickets(root);
  const items: BillItem[] = [];
  for (const ticket of tickets) {
    const item = await buildItem(ticket);
    if (item) items.push(item);
  }
  let total = 0;
  let paid = 0;
  let due = 0;
  for (const item of items) {
    total += item.amount;
    if (item.status === BILL_ITEM_STATUS.PAID) paid += item.amount;
    if (item.status === BILL_ITEM_STATUS.UNPAID ||
      item.status === BILL_ITEM_STATUS.PENDING) {
      due += item.amount;
    }
  }
  const status = due > 0 ?
    (paid > 0 ? BILL_STATUS.PARTIAL : BILL_STATUS.UNPAID) :
    (paid > 0 ? BILL_STATUS.PAID : BILL_STATUS.VOID);
  return {
    billId: root.id,
    ticketId: root.id,
    ticketType: String(root.ticketType ?? ""),
    ticketStatus: String(root.status ?? ""),
    createdAt: typeof root.createdAt === "string" ? root.createdAt : null,
    currency: PAYMENT_CURRENCY,
    total,
    paid,
    due,
    status,
    items,
  };
};

const authorizeBill = async (
  root: dispatchRepository.DispatchTicket,
  userId: string,
): Promise<void> => {
  if (root.userId === userId) return;
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  const tickets = await journeyTickets(root);
  for (const ticket of tickets) {
    if (ticket.userId === userId) return;
    if (await isOperatorOfTicket(asBillable(ticket), userId)) return;
  }
  throw new ForbiddenError("Not allowed to view this bill");
};

const listBills = async ({
  userId,
  limit,
}: {
  userId: string;
  limit?: number;
}): Promise<Bill[]> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const capped = typeof limit === "number" ?
    Math.min(limit, BILL_LIST_MAX) :
    BILL_LIST_LIMIT;
  const tickets = await dispatchRepository.findByUserId(
    userId,
    BILL_SCAN_LIMIT,
  );
  const bills: Bill[] = [];
  for (const ticket of tickets) {
    if (ticket.ticketType === "TOW") {
      const bill = await buildBill(ticket.id);
      if (bill.total > 0) bills.push(bill);
      continue;
    }
    if (ticket.ticketType !== "WALK_IN" && ticket.ticketType !== "MECHANIC") {
      continue;
    }
    if (await linkedTowFor(ticket)) continue;
    const bill = await buildBill(ticket.id);
    if (bill.total > 0) bills.push(bill);
  }
  bills.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
  return bills.slice(0, capped);
};

const getBill = async ({
  userId,
  ticketId,
  billId,
}: {
  userId: string;
  ticketId?: string;
  billId?: string;
}): Promise<Bill> => {
  const seedId = nonEmpty(ticketId) ? ticketId : billId;
  if (!nonEmpty(seedId)) {
    throw new ValidationError("ticketId or billId is required");
  }
  const seed = await dispatchRepository.findById(seedId);
  if (!seed) throw new NotFoundError("Dispatch ticket not found");
  const rootId = await journeyRootId(seed);
  const root = await dispatchRepository.findById(rootId);
  if (!root) throw new NotFoundError("Dispatch ticket not found");
  await authorizeBill(root, userId);
  return buildBill(rootId);
};

export {Bill, BillItem, getBill, listBills};
