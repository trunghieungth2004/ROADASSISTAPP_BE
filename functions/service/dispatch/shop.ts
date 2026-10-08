import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import {enqueueDispatchPush} from "../taskQueueService";
import {NS} from "./constants";
import {
  DECLINE_REASON,
  HELPER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {isOpenNow} from "../providerService";
import {reporterHandle} from "../../utils/points";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";

export const declineDispatch = async ({
  userId,
  ticketId,
  shopId,
  reason,
  note,
}: {
  userId: string;
  ticketId: string;
  shopId: string;
  reason: string;
  note?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "WALK_IN") {
    throw new ValidationError("Only walk-in tickets are declined");
  }
  if (!(Object.values(DECLINE_REASON) as string[]).includes(reason)) {
    throw new ValidationError("Unknown decline reason");
  }
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = shop.operatorUid as string | null;
  if (operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator declines for this provider");
  }
  if (ticket.providerId !== shopId) {
    throw new ForbiddenError("Ticket is addressed to another provider");
  }
  const claimed = await dispatchRepository.claimForAssignment(ticketId, {
    assignedShopId: shopId,
    assignedKind: HELPER_KIND.SHOP,
    status: STATUS_DISPATCH.DECLINED,
    declineReason: reason,
    declineNote: note ?? null,
  }, userId);
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.DECLINED}`);
  return {declined: true};
};


export const resolveShopOperator = async (
  userId: string,
  shopId: string,
): Promise<void> => {
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (shop.operatorUid !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator views this shop");
  }
};


export const sweepStaleWalkIns = async (): Promise<{cancelled: number}> => {
  const nowIso = new Date().toISOString();
  const stale = await dispatchRepository.findStaleWalkIns(nowIso);
  for (const ticket of stale) {
    await dispatchRepository.updateStatus(
      ticket.id,
      STATUS_DISPATCH.CANCELLED,
      "sweep",
    );
    await enqueueDispatchPush(
      ticket.id,
      `-status-${STATUS_DISPATCH.CANCELLED}`,
    );
  }
  if (stale.length > 0) cacheManager.del(NS);
  return {cancelled: stale.length};
};


export const shopRequests = async ({
  userId,
  shopId,
}: {
  userId: string;
  shopId: string;
}) => {
  await resolveShopOperator(userId, shopId);
  return dispatchRepository.findPendingForShop(shopId);
};


export const shopRecords = async ({
  userId,
  shopId,
  limit = 20,
}: {
  userId: string;
  shopId: string;
  limit?: number;
}) => {
  await resolveShopOperator(userId, shopId);
  return dispatchRepository.findRecentForShop(shopId, limit);
};


export const feedTickets = async ({
  userId,
  limit = 50,
}: {
  userId: string;
  limit?: number;
}) => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const out = await dispatchRepository.findByUserId(userId, limit);
  const inbound: Array<Record<string, unknown>> = [];
  const operated = await providerRepository.findByOperator(userId);
  for (const provider of operated) {
    if ((provider.status as string) === PROVIDER_STATUS.DENIED) continue;
    const [pending, recent] = await Promise.all([
      dispatchRepository.findPendingForShop(provider.id),
      dispatchRepository.findRecentForShop(provider.id, limit),
    ]);
    for (const ticket of [...pending, ...recent]) {
      if (ticket.userId !== userId) {
        inbound.push({...ticket, direction: "in"});
      }
    }
  }
  const assisted = await dispatchRepository.findByAssignee(userId, limit);
  for (const ticket of assisted) {
    if (ticket.userId !== userId) {
      inbound.push({...ticket, direction: "in"});
    }
  }
  const seen = new Set(out.map((t) => t.id));
  const merged: Array<Record<string, unknown>> = [
    ...out.map((t) => ({...t, direction: "out"})),
  ];
  for (const ticket of inbound) {
    const id = ticket.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(ticket);
  }
  merged.sort((a, b) =>
    String(b.createdAt ?? "") < String(a.createdAt ?? "") ? -1 : 1,
  );
  const rows = merged.slice(0, limit);
  await attachParties(rows);
  return rows;
};

type FeedRow = Record<string, unknown> & {
  userId?: unknown;
  assignedUid?: unknown;
  assignedShopId?: unknown;
  direction?: unknown;
  otherParty?: unknown;
};

const strOf = (value: unknown): string =>
  typeof value === "string" && value !== "" ? value : "";

const phoneSharingStatuses: Set<string> = new Set([
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.ARRIVED,
  STATUS_DISPATCH.RESOLVED,
  STATUS_DISPATCH.IN_PROGRESS,
  STATUS_DISPATCH.READY,
  STATUS_DISPATCH.QUOTED,
]);

const phoneOf = (user: {phone?: unknown} | undefined): string | null =>
  user && typeof user.phone === "string" && user.phone !== "" ?
    user.phone :
    null;

const attachParties = async (rows: FeedRow[]): Promise<void> => {
  const shopIds = new Set<string>();
  const riderIds = new Set<string>();
  for (const row of rows) {
    if (row.direction === "out") {
      const shopKeys = [
        "assignedShopId",
        "providerId",
        "destinationShopId",
      ] as const;
      for (const key of shopKeys) {
        const shopId = strOf(row[key]);
        if (shopId !== "") shopIds.add(shopId);
      }
    } else {
      const riderId = strOf(row.userId);
      if (riderId !== "") riderIds.add(riderId);
    }
  }
  const [shops, riders] = await Promise.all([
    Promise.all([...shopIds].map((id) => providerRepository.findById(id))),
    userRepository.findByIds([...riderIds]),
  ]);
  const operatorIds = new Set<string>();
  for (const shop of shops) {
    const uid = shop && typeof shop.operatorUid === "string" ?
      shop.operatorUid :
      "";
    if (uid !== "") operatorIds.add(uid);
  }
  const operators = await userRepository.findByIds([...operatorIds]);
  const shopDetails = new Map<string, {
    name: string;
    label: string | null;
    openNow: boolean | null;
    ratingAvg: number | null;
    ratingCount: number | null;
    phone: string | null;
  }>();
  for (const shop of shops) {
    if (shop && typeof shop.name === "string") {
      const label = typeof shop.label === "string" && shop.label !== "" ?
        shop.label :
        null;
      const operator = typeof shop.operatorUid === "string" ?
        operators.get(shop.operatorUid) :
        undefined;
      shopDetails.set(shop.id, {
        name: shop.name,
        label,
        openNow: isOpenNow(
          typeof shop.openHours === "string" ? shop.openHours : null,
        ),
        ratingAvg: typeof shop.ratingAvg === "number" ?
          shop.ratingAvg :
          null,
        ratingCount: typeof shop.ratingCount === "number" ?
          shop.ratingCount :
          null,
        phone: phoneOf(operator),
      });
    }
  }
  for (const row of rows) {
    if (row.direction === "out") {
      row.otherParty = outParty(row, shopDetails);
    } else {
      const riderId = strOf(row.userId);
      const rider = riders.get(riderId);
      const name = typeof rider?.displayName === "string" &&
        rider.displayName !== "" ?
        rider.displayName :
        null;
      if (!name) {
        row.otherParty = null;
        continue;
      }
      const party: Record<string, unknown> = {
        id: riderId,
        name,
        kind: "RIDER",
      };
      const shared = typeof row.status === "string" &&
        phoneSharingStatuses.has(row.status);
      const phone = shared ? phoneOf(rider) : null;
      if (phone !== null) party.phone = phone;
      const avg = rider?.ratingAvg;
      if (typeof avg === "number") party.ratingAvg = avg;
      const count = rider?.ratingCount;
      if (typeof count === "number") party.ratingCount = count;
      row.otherParty = party;
    }
  }
};

type ShopDetail = {
  name: string;
  label: string | null;
  openNow: boolean | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  phone: string | null;
};

const outParty = (
  row: FeedRow,
  shopDetails: Map<string, ShopDetail>,
): unknown => {
  const shopKeys = [
    "assignedShopId",
    "providerId",
    "destinationShopId",
  ] as const;
  for (const key of shopKeys) {
    const shopId = strOf(row[key]);
    const shop = shopId !== "" ? shopDetails.get(shopId) ?? null : null;
    if (shop) {
      const shared = typeof row.status === "string" &&
        phoneSharingStatuses.has(row.status);
      return {
        id: shopId,
        name: shop.name,
        kind: "SHOP",
        ...(shop.label !== null ? {label: shop.label} : {}),
        ...(shop.openNow !== null ? {openNow: shop.openNow} : {}),
        ...(shop.ratingAvg !== null ? {ratingAvg: shop.ratingAvg} : {}),
        ...(shop.ratingCount !== null ?
          {ratingCount: shop.ratingCount} :
          {}),
        ...(shared && shop.phone !== null ? {phone: shop.phone} : {}),
      };
    }
  }
  const uid = strOf(row.assignedUid);
  if (uid !== "") {
    return {id: uid, name: reporterHandle(uid), kind: "VOLUNTEER"};
  }
  return null;
};


export const updateWorkOrder = async ({
  userId,
  ticketId,
  workType,
  quotedAmount,
  finalAmount,
  invoiceRef,
}: {
  userId: string;
  ticketId: string;
  workType?: string;
  quotedAmount?: number;
  finalAmount?: number;
  invoiceRef?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  let isOperator = false;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      break;
    }
  }
  if (!isOperator && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates the work order");
  }
  if (ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED &&
    ticket.status !== STATUS_DISPATCH.IN_PROGRESS) {
    throw new ValidationError("Work order is no longer editable");
  }
  if (quotedAmount !== undefined &&
    typeof ticket.shopQuotedAmount === "number") {
    throw new ValidationError("Quote already sent");
  }
  if (finalAmount !== undefined &&
    typeof ticket.finalAmount === "number") {
    throw new ValidationError("Final amount already recorded");
  }
  await dispatchRepository.update(ticketId, {
    ...(workType !== undefined ? {workType} : {}),
    ...(quotedAmount !== undefined ? {shopQuotedAmount: quotedAmount} : {}),
    ...(finalAmount !== undefined ? {finalAmount} : {}),
    ...(invoiceRef !== undefined ? {invoiceRef} : {}),
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
  });
  if (quotedAmount !== undefined &&
    (ticket.status === STATUS_DISPATCH.MATCHED ||
      ticket.status === STATUS_DISPATCH.ARRIVED)) {
    const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    if (shopIds.length === 0) {
      throw new ValidationError("Quotes need a shop ticket");
    }
    await dispatchRepository.updateStatus(
      ticketId,
      STATUS_DISPATCH.QUOTED,
      userId,
    );
    await enqueueDispatchPush(
      ticketId,
      `-status-${STATUS_DISPATCH.QUOTED}`,
    );
  }
  cacheManager.del(NS);
  return {updated: 1};
};

type TicketActors = {
  assignedShopId?: unknown;
  providerId?: unknown;
  assignedUid?: unknown;
};

const resolveTicketOperator = async (
  ticket: TicketActors,
  userId: string,
): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  if (ticket.assignedUid === userId) return;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) return;
  }
  throw new ForbiddenError("Only the helper sends quotes");
};

export const sendQuote = async ({
  userId,
  ticketId,
  quotedAmount,
  workType,
}: {
  userId: string;
  ticketId: string;
  quotedAmount: number;
  workType?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  await resolveTicketOperator(ticket, userId);
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length === 0) {
    throw new ValidationError("Quotes need a shop ticket");
  }
  if (ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED) {
    throw new ValidationError("Quotes go out on active tickets");
  }
  if (typeof ticket.shopQuotedAmount === "number") {
    throw new ValidationError("Quote already sent");
  }
  if (!Number.isInteger(quotedAmount) || quotedAmount < 0) {
    throw new ValidationError("Quote must be a non-negative integer");
  }
  await dispatchRepository.update(ticketId, {
    shopQuotedAmount: quotedAmount,
    ...(workType !== undefined ? {workType} : {}),
    quotedBy: userId,
    quotedAt: new Date().toISOString(),
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.QUOTED,
    userId,
  );
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.QUOTED}`);
  return {quoted: true};
};

export const approveQuote = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider approves the quote");
  }
  const quoted = typeof ticket.shopQuotedAmount === "number";
  const pending = ticket.status === STATUS_DISPATCH.QUOTED;
  const legacy = (ticket.status === STATUS_DISPATCH.MATCHED ||
    ticket.status === STATUS_DISPATCH.ARRIVED) && quoted;
  if (!pending && !legacy) {
    throw new ValidationError("No quote awaiting approval");
  }
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length === 0) {
    throw new ValidationError("Quotes need a shop ticket");
  }
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.IN_PROGRESS,
    userId,
  );
  cacheManager.del(NS);
  await enqueueDispatchPush(
    ticketId,
    `-status-${STATUS_DISPATCH.IN_PROGRESS}-operator`,
    {
      audience: "operator",
      title: "Quote approved",
      body: "The rider approved your quote — tap to view",
    },
  );
  return {approved: true};
};
