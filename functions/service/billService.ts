import * as dispatchRepository from "../repository/dispatchRepository";
import {billStatusFor, depositInfoFor} from "./bill/deposit";
import {partyDetailsFor, type PartyCache} from "./bill/party";
import {breakdownFor, includedKmFor} from "./bill/breakdown";
import * as paymentRepository from "../repository/paymentRepository";
import * as providerRepository from "../repository/providerRepository";
import * as refundRepository from "../repository/refundRepository";
import * as disputeRepository from "../repository/disputeRepository";
import {
  disputeHistoryFrom,
  disputeSummaryFrom,
  type BillDispute,
  type BillDisputeHistoryRow,
} from "./bill/disputes";
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
} from "../constants/payments";
import * as platformConfigService from "./platformConfigService";
import {ROLE_ADMIN} from "../constants/roles";
import {TOW_FARE_NIGHT_MULT} from "../constants/dispatch";
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
  disputeId: string | null;
  disputedAt: string | null;
  disputeHold: boolean;
  disputeResolvedAt: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
};

type BillItem = {
  kind: string;
  ticketId: string;
  ticketType: string;
  ticketStatus: string;
  amount: number;
  waitingFee: number;
  distanceKm: number | null;
  totalDistanceKm: number | null;
  deadheadKm: number | null;
  loadedQuotedKm: number | null;
  baseFee: number | null;
  perKmFee: number | null;
  includedKm: number | null;
  billableKm: number | null;
  ceiling: number | null;
  night: boolean | null;
  nightMultiplier: number | null;
  vehicleClass: string | null;
  pickup: {lat: number; lng: number} | null;
  destination: {
    lat: number;
    lng: number;
    shopId: string | null;
    name: string | null;
    label: string | null;
  } | null;
  warrantyUntil: string | null;
  breakdown: Array<{
    code: string;
    label: string;
    amount: number;
    detail: string | null;
  }>;
  items: Array<{
    lineId?: string;
    kind?: string;
    serviceCode?: string;
    category?: string;
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    priceMode?: string;
    listPrice?: number;
    warrantyDays?: number;
    warrantyUntil?: string | null;
    note?: string;
    legacy?: boolean;
  }>;
  services: Array<{
    lineId?: string;
    serviceCode?: string;
    category?: string;
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    priceMode?: string;
    warrantyUntil?: string | null;
  }>;
  extras: Array<{
    lineId?: string;
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    note?: string;
  }>;
  status: string;
  serviceType: "TOW" | "REPAIR" | "SOS";
  rider: {uid: string; name: string; phone: string | null} | null;
  provider: {
    id: string;
    name: string;
    kind: string;
    phone: string | null;
    label: string | null;
  } | null;
  vehicleLabel: string | null;
  vehiclePlate: string | null;
  mobileTravelKm: number | null;
  mobileTravelRate: number | null;
  amountDue: number;
  deposit: {
    amount: number;
    status: string;
    method: string | null;
    paidAt: string | null;
  } | null;
  payeeId: string | null;
  ratingTargetId: string | null;
  payeeName: string | null;
  qrUrl: string | null;
  refundRequest: {
    id: string;
    status: string;
    amount: number;
    transferRef: string | null;
    requestedAt: string;
  } | null;
  dispute: BillDispute | null;
  disputes: BillDisputeHistoryRow[];
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

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

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
    depositAmount: ticket.depositAmount,
    depositStatus: ticket.depositStatus,
    warrantyOfTicketId: ticket.warrantyOfTicketId,
    warrantyClaimId: ticket.warrantyClaimId,
  }) as TicketLike;

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

const lineGroupsFor = (
  ticket: dispatchRepository.DispatchTicket,
) => {
  const source = Array.isArray(ticket.invoiceItems) &&
    ticket.invoiceItems.length > 0 ?
    ticket.invoiceItems :
    Array.isArray(ticket.quoteItems) ? ticket.quoteItems : [];
  return {
    items: source,
    services: source.filter((item) =>
      (item as {kind?: string}).kind === "SERVICE"),
    extras: source.filter((item) =>
      (item as {kind?: string}).kind !== "SERVICE"),
  };
};

const refundSummaryFor = async (
  payment: paymentRepository.Payment | null,
): Promise<BillItem["refundRequest"]> => {
  if (!payment) return null;
  const rows = await refundRepository.findByPaymentId(payment.id);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    amount: row.amount,
    transferRef: row.transferRef,
    requestedAt: row.requestedAt,
  };
};

type FareParts = {
  baseFee: number | null;
  deadheadKm: number | null;
  perKmFee: number | null;
  includedKm: number | null;
  billableKm: number | null;
  ceiling: number | null;
  night: boolean | null;
  nightMultiplier: number | null;
  vehicleClass: string | null;
};

const farePartsFor = (
  ticket: dispatchRepository.DispatchTicket,
): FareParts => {
  const empty = {
    baseFee: null,
    deadheadKm: null,
    perKmFee: null,
    includedKm: null,
    billableKm: null,
    ceiling: null,
    night: null,
    nightMultiplier: null,
    vehicleClass: null,
  };
  if (ticket.ticketType !== "TOW") return empty;
  const fare = ticket.towFare;
  if (fare === null || typeof fare !== "object") return empty;
  const row = fare as Record<string, unknown>;
  const actual = ticket.towActual !== null &&
    typeof ticket.towActual === "object" ?
    ticket.towActual as Record<string, unknown> : null;
  const vehicleClass = typeof row.vehicleClass === "string" ?
    row.vehicleClass :
    typeof ticket.vehicleClass === "string" ? ticket.vehicleClass : null;
  const includedKm = includedKmFor(
    vehicleClass,
    typeof row.includedKm === "number" ? row.includedKm : null,
  );
  const night = typeof row.night === "boolean" ? row.night : null;
  return {
    baseFee: typeof row.baseFee === "number" ? row.baseFee : null,
    deadheadKm: typeof row.deadheadKm === "number" ? row.deadheadKm : null,
    perKmFee: typeof row.perKmFee === "number" ? row.perKmFee : null,
    includedKm,
    billableKm: typeof row.billableKm === "number" ?
      row.billableKm :
      typeof actual?.actualKm === "number" && includedKm !== null ?
        Math.max(0, Math.round((actual.actualKm - includedKm) * 100) / 100) :
        null,
    ceiling: typeof row.ceiling === "number" ? row.ceiling : null,
    night,
    nightMultiplier: typeof row.nightMultiplier === "number" ?
      row.nightMultiplier :
      night === true ? TOW_FARE_NIGHT_MULT : null,
    vehicleClass,
  };
};

type DestinationInfo = {
  lat: number;
  lng: number;
  shopId: string | null;
  name: string | null;
  label: string | null;
};

const providerIn = async (
  cache: PartyCache,
  id: string,
): Promise<Record<string, unknown> | null> => {
  const known = cache.providers.get(id);
  if (known !== undefined) return known;
  const provider = await providerRepository.findById(id) as unknown as
    Record<string, unknown> | null;
  cache.providers.set(id, provider);
  return provider;
};

const destinationFor = async (
  ticket: dispatchRepository.DispatchTicket,
  cache: PartyCache,
): Promise<DestinationInfo | null> => {
  const coords = (value: unknown): {lat: number; lng: number} | null => {
    if (typeof value !== "object" || value === null) return null;
    const row = value as {lat?: unknown; lng?: unknown};
    return typeof row.lat === "number" && typeof row.lng === "number" ?
      {lat: row.lat, lng: row.lng} :
      null;
  };
  const snapshot = ticket.destinationSnapshot;
  if (snapshot && typeof snapshot === "object") {
    const row = snapshot as Record<string, unknown>;
    const point = coords(row);
    if (point !== null) {
      const shopId = typeof row.id === "string" && row.id !== "" ?
        row.id : null;
      let name = typeof row.name === "string" ? row.name : null;
      let label = typeof row.label === "string" ? row.label : null;
      if (shopId !== null) {
        const shop = await providerIn(cache, shopId);
        if (typeof shop?.name === "string" && shop.name !== "") {
          name = shop.name;
        }
        if (typeof shop?.label === "string" && shop.label !== "") {
          label = shop.label;
        }
      }
      return {...point, shopId, name, label};
    }
  }
  const direct = coords(ticket.destinationPoint);
  if (direct !== null) {
    const row = ticket.destinationPoint as Record<string, unknown>;
    return {
      ...direct,
      shopId: null,
      name: null,
      label: typeof row.label === "string" ? row.label : null,
    };
  }
  const shopId = typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" ? ticket.destinationShopId : null;
  if (shopId === null) return null;
  const shop = await providerIn(cache, shopId);
  const point = coords(shop);
  if (point === null) return null;
  return {
    ...point,
    shopId,
    name: typeof shop?.name === "string" ? shop.name : null,
    label: typeof shop?.label === "string" ? shop.label : null,
  };
};

const distanceTotalsFor = (
  ticket: dispatchRepository.DispatchTicket,
  deadheadKm: number | null,
  distanceKm: number | null,
): {loadedQuotedKm: number | null; totalDistanceKm: number | null} => {
  const actual = ticket.towActual;
  const loadedQuotedKm = actual !== null && typeof actual === "object" &&
    typeof actual.quotedKm === "number" ? actual.quotedKm : distanceKm;
  return {
    loadedQuotedKm,
    totalDistanceKm: deadheadKm !== null && loadedQuotedKm !== null ?
      Math.round((deadheadKm + loadedQuotedKm) * 100) / 100 : null,
  };
};

const billPaymentView = (
  payment: paymentRepository.Payment,
  admin: boolean,
  viewerUid: string,
): BillPayment => ({
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
  disputeId: typeof payment.disputeId === "string" ? payment.disputeId : null,
  disputedAt: typeof payment.disputedAt === "string" ?
    payment.disputedAt :
    null,
  disputeHold: payment.disputeHold === true,
  disputeResolvedAt: typeof payment.disputeResolvedAt === "string" ?
    payment.disputeResolvedAt :
    null,
  createdAt: payment.createdAt ?? null,
  confirmedAt: payment.confirmedAt ?? null,
});

const buildItem = async (
  ticket: dispatchRepository.DispatchTicket,
  viewerUid: string,
  admin: boolean,
  partyCache: PartyCache,
): Promise<BillItem | null> => {
  const billable = billableAmountFor(asBillable(ticket));
  if (!billable || billable.amount <= 0) return null;
  const payments = await paymentRepository.findByTicketId(ticket.id);
  const payment = payments.find((row) =>
    row.purpose !== "DEPOSIT") ?? payments[0] ?? null;
  const paymentStatus = payment ? String(payment.status) : null;
  const deposit = depositInfoFor(ticket);
  const amountDue = Math.max(0, billable.amount - deposit.credit);
  const riderCancelled = ticket.status === STATUS_DISPATCH.CANCELLED &&
    ticket.cancelledBy === ticket.userId;
  const priorTowCharge = ticket.ticketType === "TOW" &&
    ticket.status === STATUS_DISPATCH.CANCELLED &&
    Array.isArray(ticket.towFeeHistory) &&
    ticket.towFeeHistory.some((entry) =>
      typeof entry.amount === "number" && entry.amount > 0);
  const voided = UNPAYABLE_STATUSES.has(String(ticket.status ?? "")) &&
    ticket.ticketType !== "SOS" &&
    !(ticket.ticketType === "TOW" && (riderCancelled || priorTowCharge));
  const status = billStatusFor({
    paymentStatus,
    paymentMissing: payment === null,
    depositPayment: payment?.purpose === "DEPOSIT",
    depositCredit: deposit.credit,
    amountDue,
    voided,
  });
  const detail = breakdownFor(ticket, billable.amount);
  const fareParts = farePartsFor(ticket);
  const distanceTotals = distanceTotalsFor(
    ticket, fareParts.deadheadKm, detail.distanceKm,
  );
  const parties = await partyDetailsFor(ticket, partyCache);
  const destination = await destinationFor(ticket, partyCache);
  const refundRequest = await refundSummaryFor(payment);
  const disputeRows = await disputeRepository.findByTicketId(ticket.id);
  const dispute = disputeSummaryFrom(disputeRows);
  const lines = lineGroupsFor(ticket);
  return {
    kind: ticket.ticketType === "TOW" ?
      BILL_ITEM_KIND.TOW_FARE :
      BILL_ITEM_KIND.REPAIR,
    ticketId: ticket.id,
    ticketType: String(ticket.ticketType ?? ""),
    ticketStatus: String(ticket.status ?? ""),
    amount: billable.amount,
    amountDue,
    deposit: deposit.view,
    waitingFee: billable.waitingFee,
    distanceKm: detail.distanceKm,
    totalDistanceKm: distanceTotals.totalDistanceKm,
    deadheadKm: fareParts.deadheadKm,
    loadedQuotedKm: distanceTotals.loadedQuotedKm,
    baseFee: fareParts.baseFee,
    perKmFee: fareParts.perKmFee,
    includedKm: fareParts.includedKm,
    billableKm: fareParts.billableKm,
    ceiling: fareParts.ceiling,
    night: fareParts.night,
    nightMultiplier: fareParts.nightMultiplier,
    vehicleClass: fareParts.vehicleClass,
    pickup: typeof ticket.lat === "number" && typeof ticket.lng === "number" ?
      {lat: ticket.lat, lng: ticket.lng} : null,
    destination,
    warrantyUntil: typeof ticket.warrantyUntil === "string" ?
      ticket.warrantyUntil :
      null,
    breakdown: detail.breakdown,
    items: lines.items,
    services: lines.services,
    extras: lines.extras,
    status,
    serviceType: ticket.ticketType === "TOW" ?
      "TOW" :
      ticket.ticketType === "SOS" ? "SOS" : "REPAIR",
    rider: parties.rider,
    provider: parties.provider,
    vehicleLabel: typeof ticket.vehicleLabel === "string" ?
      ticket.vehicleLabel :
      null,
    vehiclePlate: typeof ticket.vehiclePlate === "string" ?
      ticket.vehiclePlate :
      null,
    mobileTravelKm: typeof ticket.mobileTravelKm === "number" ?
      ticket.mobileTravelKm :
      null,
    mobileTravelRate: typeof ticket.mobileTravelRate === "number" ?
      ticket.mobileTravelRate :
      null,
    payeeId: await payeeUidFor(ticket),
    ratingTargetId: ratingTargetIdFor(ticket),
    payeeName: await payeeNameFor(ticket),
    qrUrl: nonEmpty(ticket.checkoutUrl) ? ticket.checkoutUrl : null,
    refundRequest,
    dispute,
    disputes: disputeHistoryFrom(disputeRows),
    payment: payment ?
      billPaymentView(payment, admin, viewerUid) :
      null,
  };
};

const buildBill = async (
  ticketId: string,
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
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const config = await platformConfigService.getConfig().catch(() => null);
  const partyCache: PartyCache = {
    mask: config?.features?.phoneMasking === true,
    users: new Map(),
    providers: new Map(),
  };
  const item = await buildItem(
    ticket,
    viewerUid,
    viewer === "ADMIN",
    partyCache,
  );
  const items = item !== null &&
    (payeeId === undefined || item.payeeId === payeeId) ? [item] : [];
  let total = 0;
  let paid = 0;
  let due = 0;
  for (const row of items) {
    total += row.amount;
    const credit = row.deposit &&
      (row.deposit.status === "COLLECTED" ||
        row.deposit.status === "CONFIRMED" ||
        row.deposit.status === "APPLIED") ?
      row.deposit.amount :
      0;
    if (row.status === BILL_ITEM_STATUS.PAID) {
      paid += row.amount;
    } else if (row.status === BILL_ITEM_STATUS.UNPAID ||
      row.status === BILL_ITEM_STATUS.PENDING) {
      paid += Math.min(credit, row.amount);
      due += Math.max(0, row.amount - credit);
    }
  }
  const status = due > 0 ?
    (paid > 0 ? BILL_STATUS.PARTIAL : BILL_STATUS.UNPAID) :
    (paid > 0 ? BILL_STATUS.PAID : BILL_STATUS.VOID);
  return {
    billId: ticket.id,
    ticketId: ticket.id,
    ticketType: String(ticket.ticketType ?? ""),
    ticketStatus: String(ticket.status ?? ""),
    createdAt: typeof ticket.createdAt === "string" ?
      ticket.createdAt :
      null,
    currency: PAYMENT_CURRENCY,
    total,
    paid,
    due,
    status,
    viewer,
    canPay: viewer === "RIDER" && ticket.disputeHold !== true,
    items,
  };
};

const viewerOfBill = async (
  ticket: dispatchRepository.DispatchTicket,
  userId: string,
): Promise<BillViewer> => {
  if (ticket.userId === userId) return "RIDER";
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return "ADMIN";
  if (await payeeUidFor(ticket) === userId) return "PAYEE";
  if (await isOperatorOfTicket(asBillable(ticket), userId)) {
    return "OPERATOR";
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
    if (ticket.ticketType !== "TOW" && ticket.ticketType !== "SOS" &&
      ticket.ticketType !== "WALK_IN" && ticket.ticketType !== "MECHANIC") {
      continue;
    }
    const bill = await buildBill(ticket.id, {
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
  const seen = new Set<string>();
  const bills: Bill[] = [];
  for (const ticket of candidates) {
    if (seen.has(ticket.id)) continue;
    seen.add(ticket.id);
    const bill = await buildBill(ticket.id, {
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
  const ticket = await dispatchRepository.findById(seedId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const viewer = await viewerOfBill(ticket, userId);
  if (scope === "payee") {
    if (viewer !== "PAYEE") {
      throw new ForbiddenError("Only the payee views a payee bill");
    }
    return buildBill(ticket.id, {
      viewer,
      viewerUid: userId,
      payeeId: userId,
    });
  }
  return buildBill(ticket.id, {viewer, viewerUid: userId});
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
