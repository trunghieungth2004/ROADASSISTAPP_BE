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
  PAYMENT_CASH_CONFIRMABLE_STATUSES,
  PAYMENT_CURRENCY,
  PAYMENT_RECEIVED_STATUSES,
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

type BillViewer = "RIDER" | "PAYEE" | "OPERATOR" | "ADMIN";
type BillPayoutStatus = "NONE" | "PENDING" | "PAID";

type BillPayment = {
  id: string;
  method: string;
  status: string;
  amount: number;
  refundAmount: number | null;
  commissionRate: number | null;
  commissionAmount: number | null;
  payoutAmount: number | null;
  payoutRef: string | null;
  payoutAt: string | null;
  payoutStatus: BillPayoutStatus;
  canConfirmCash: boolean;
};

type BillItem = {
  kind: string;
  ticketId: string;
  ticketType: string;
  ticketStatus: string;
  amount: number;
  waitingFee: number;
  items: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }>;
  status: string;
  payeeId: string | null;
  ratingTargetId: string | null;
  payeeName: string | null;
  qrUrl: string | null;
  payment: BillPayment | null;
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
  viewer: BillViewer;
  canPay: boolean;
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
    invoiceAmount: ticket.invoiceAmount,
    invoiceApproval: ticket.invoiceApproval,
    finalAmount: ticket.finalAmount,
    mobileCallOutFee: ticket.mobileCallOutFee,
    mobileTravelFee: ticket.mobileTravelFee,
    mobileFeeHistory: ticket.mobileFeeHistory,
    cancelledBy: ticket.cancelledBy,
    towFeeHistory: ticket.towFeeHistory,
    towFare: ticket.towFare,
  }) as TicketLike;

const parentIdOf = (
  ticket: dispatchRepository.DispatchTicket,
): string | null => {
  if (nonEmpty(ticket.sourceTicketId)) return ticket.sourceTicketId;
  if (nonEmpty(ticket.continuedFromTicketId)) {
    return ticket.continuedFromTicketId;
  }
  return null;
};

const parentTicketFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<dispatchRepository.DispatchTicket | null> => {
  const direct = parentIdOf(ticket);
  if (direct !== null) {
    const parent = await dispatchRepository.findById(direct);
    if (parent && parent.id !== ticket.id) return parent;
  }
  for (const id of linkIdsOf(ticket)) {
    if (id === ticket.id) continue;
    const linked = await dispatchRepository.findById(id);
    if (!linked) continue;
    if ((ticket.ticketType === "WALK_IN" ||
      ticket.ticketType === "MECHANIC") &&
      linked.ticketType === "TOW" &&
      linked.towKind !== "RETURN") {
      return linked;
    }
    if (ticket.ticketType === "TOW" && linked.ticketType === "SOS") {
      return linked;
    }
    if (ticket.ticketType === "TOW" &&
      ticket.towKind === "RETURN" &&
      (linked.ticketType === "WALK_IN" ||
        linked.ticketType === "MECHANIC")) {
      return linked;
    }
  }
  return null;
};

const journeyRootId = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<string> => {
  let current = ticket;
  const seen = new Set<string>([ticket.id]);
  for (let depth = 0; depth < MAX_JOURNEY_DEPTH; depth += 1) {
    const parent = await parentTicketFor(current);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
};

const childTicketsOf = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<dispatchRepository.DispatchTicket[]> => {
  const parentId = parentIdOf(ticket);
  const out: dispatchRepository.DispatchTicket[] = [];
  for (const id of linkIdsOf(ticket)) {
    if (id === ticket.id || id === parentId) continue;
    const linked = await dispatchRepository.findById(id);
    if (!linked) continue;
    if (ticket.ticketType === "SOS" &&
      (linked.ticketType === "TOW" || linked.ticketType === "SOS")) {
      out.push(linked);
    } else if (ticket.ticketType === "TOW" &&
      (linked.ticketType === "WALK_IN" ||
        linked.ticketType === "MECHANIC")) {
      out.push(linked);
    } else if ((ticket.ticketType === "WALK_IN" ||
      ticket.ticketType === "MECHANIC") &&
      linked.ticketType === "TOW" &&
      linked.towKind === "RETURN") {
      out.push(linked);
    }
  }
  return out;
};

const journeyTickets = async (
  root: dispatchRepository.DispatchTicket,
): Promise<dispatchRepository.DispatchTicket[]> => {
  const tickets: dispatchRepository.DispatchTicket[] = [];
  const seen = new Set<string>();
  const visit = async (ticket: dispatchRepository.DispatchTicket) => {
    if (seen.has(ticket.id)) return;
    seen.add(ticket.id);
    tickets.push(ticket);
    for (const child of await childTicketsOf(ticket)) {
      await visit(child);
    }
  };
  await visit(root);
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

const payoutStatusFor = (
  payment: paymentRepository.Payment,
): BillPayoutStatus => {
  if (nonEmpty(payment.payoutAt)) return "PAID";
  if (PAYMENT_RECEIVED_STATUSES.includes(payment.status)) return "PENDING";
  return "NONE";
};

const ratingTargetIdFor = (
  ticket: dispatchRepository.DispatchTicket,
): string | null => {
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    return ticket.assignedShopId;
  }
  if (typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "") {
    return ticket.destinationShopId;
  }
  return null;
};

const buildItem = async (
  ticket: dispatchRepository.DispatchTicket,
  viewerUid: string,
  admin: boolean,
): Promise<BillItem | null> => {
  const billable = billableAmountFor(asBillable(ticket));
  if (!billable || billable.amount <= 0) return null;
  const payments = await paymentRepository.findByTicketId(ticket.id);
  const payment = payments[0] ?? null;
  const paymentStatus = payment ? String(payment.status) : null;
  const riderCancelled = ticket.status === STATUS_DISPATCH.CANCELLED &&
    ticket.cancelledBy === ticket.userId;
  const voided = UNPAYABLE_STATUSES.has(String(ticket.status ?? "")) &&
    ticket.ticketType !== "SOS" &&
    !(ticket.ticketType === "TOW" && riderCancelled);
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
    items: Array.isArray(ticket.invoiceItems) &&
      ticket.invoiceItems.length > 0 ?
      ticket.invoiceItems :
      Array.isArray(ticket.quoteItems) ? ticket.quoteItems : [],
    status,
    payeeId: await payeeUidFor(ticket),
    ratingTargetId: ratingTargetIdFor(ticket),
    payeeName: await payeeNameFor(ticket),
    qrUrl: nonEmpty(ticket.checkoutUrl) ? ticket.checkoutUrl : null,
    payment: payment ? {
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      refundAmount: payment.refundAmount,
      commissionRate: payment.commissionRate,
      commissionAmount: payment.commissionAmount,
      payoutAmount: payment.payoutAmount,
      payoutRef: payment.payoutRef,
      payoutAt: payment.payoutAt,
      payoutStatus: payoutStatusFor(payment),
      canConfirmCash: payment.method === "CASH" &&
        PAYMENT_CASH_CONFIRMABLE_STATUSES.includes(payment.status) &&
        (admin || payment.payeeId === viewerUid),
    } : null,
  };
};

const buildBill = async (
  rootId: string,
  {
    viewer,
    viewerUid,
    payeeId,
  }: {
    viewer: BillViewer;
    viewerUid: string;
    payeeId?: string;
  },
): Promise<Bill> => {
  const root = await dispatchRepository.findById(rootId);
  if (!root) throw new NotFoundError("Dispatch ticket not found");
  const tickets = await journeyTickets(root);
  const items: BillItem[] = [];
  for (const ticket of tickets) {
    const item = await buildItem(ticket, viewerUid, viewer === "ADMIN");
    if (!item) continue;
    if (payeeId !== undefined && item.payeeId !== payeeId) continue;
    items.push(item);
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
    viewer,
    canPay: viewer === "RIDER",
    items,
  };
};

const viewerOfBill = async (
  root: dispatchRepository.DispatchTicket,
  userId: string,
): Promise<BillViewer> => {
  if (root.userId === userId) return "RIDER";
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return "ADMIN";
  const tickets = await journeyTickets(root);
  let operator = false;
  for (const ticket of tickets) {
    if (ticket.userId === userId) return "RIDER";
    if (await payeeUidFor(ticket) === userId) return "PAYEE";
    if (await isOperatorOfTicket(asBillable(ticket), userId)) {
      operator = true;
    }
  }
  if (operator) return "OPERATOR";
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
  const roots = new Set<string>();
  for (const ticket of tickets) {
    if (ticket.ticketType !== "TOW" && ticket.ticketType !== "SOS" &&
      ticket.ticketType !== "WALK_IN" && ticket.ticketType !== "MECHANIC") {
      continue;
    }
    const rootId = await journeyRootId(ticket);
    if (roots.has(rootId)) continue;
    roots.add(rootId);
    const root = ticket.id === rootId ?
      ticket :
      await dispatchRepository.findById(rootId);
    if (!root) continue;
    const bill = await buildBill(root.id, {
      viewer: "RIDER",
      viewerUid: userId,
    });
    if (bill.total > 0) bills.push(bill);
  }
  bills.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
  return bills.slice(0, capped);
};

const listPayeeBills = async ({
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
  const operated = await providerRepository.findByOperator(userId);
  const providerRows = await Promise.all(
    operated.map((provider) =>
      dispatchRepository.findRecentForShop(provider.id, BILL_SCAN_LIMIT),
    ),
  );
  const assisted = await dispatchRepository.findByAssignee(
    userId,
    BILL_SCAN_LIMIT,
  );
  const candidates = [
    ...providerRows.flat(),
    ...assisted,
  ];
  const roots = new Map<string, dispatchRepository.DispatchTicket>();
  for (const ticket of candidates) {
    const rootId = await journeyRootId(ticket);
    if (roots.has(rootId)) continue;
    const root = ticket.id === rootId ?
      ticket :
      await dispatchRepository.findById(rootId);
    if (root) roots.set(rootId, root);
  }
  const bills: Bill[] = [];
  for (const root of roots.values()) {
    const bill = await buildBill(root.id, {
      viewer: "PAYEE",
      viewerUid: userId,
      payeeId: userId,
    });
    if (bill.total > 0 && bill.items.length > 0) bills.push(bill);
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
  scope,
}: {
  userId: string;
  ticketId?: string;
  billId?: string;
  scope?: string;
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
  const viewer = await viewerOfBill(root, userId);
  if (scope === "payee") {
    if (viewer !== "PAYEE") {
      throw new ForbiddenError("Only the payee views a payee bill");
    }
    return buildBill(rootId, {
      viewer,
      viewerUid: userId,
      payeeId: userId,
    });
  }
  return buildBill(rootId, {viewer, viewerUid: userId});
};

export {
  Bill,
  BillItem,
  BillPayment,
  BillPayoutStatus,
  BillViewer,
  getBill,
  listBills,
  listPayeeBills,
};
