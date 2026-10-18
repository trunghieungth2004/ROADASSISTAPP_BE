import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as paymentRepository from
  "../../repository/paymentRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import * as providerLocationRepository from
  "../../repository/providerLocationRepository";
import * as paymentService from "../paymentService";
import {db, FieldValue} from "../../config/firebase";
import {enqueueDispatchPush} from "../taskQueueService";
import {autoFile} from "../disputeService";
import {startWaiting, stopWaiting} from "./waiting";
import {
  DISPUTE_TYPE,
  ESTIMATE_TTL_MS,
  LATE_GRACE_MS,
  NS,
  SHOP_DECLINE_REASON,
  TERMINAL_STATUSES,
  TOW_ESTIMATE_TTL_MS,
} from "./constants";
import {ACCUSED_KIND} from "../../constants/payments";
import {
  DECLINE_REASON,
  HELPER_KIND,
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {freezeTowLeg} from "./helpers";
import {isOpenNow} from "../providerService";
import {reporterHandle} from "../../utils/points";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";
import {deleteObjects, validatePhotoPathsStructure} from "../../utils/media";

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
    await deleteObjects(ticket.photoUrls ?? []);
    await enqueueDispatchPush(
      ticket.id,
      `-status-${STATUS_DISPATCH.CANCELLED}`,
    );
    if (typeof ticket.providerId === "string" && ticket.providerId !== "") {
      await enqueueDispatchPush(ticket.id, "-expired-shop", {
        audience: "destination-shop",
        shopId: ticket.providerId as string,
        title: "Walk-in expired",
        body: "The rider's visit request expired",
      });
    }
  }
  if (stale.length > 0) cacheManager.del(NS);
  return {cancelled: stale.length};
};

export const sweepLateTows = async (): Promise<{notified: number}> => {
  const tickets = await dispatchRepository.findByStatusForTypes(
    STATUS_DISPATCH.MATCHED,
    ["TOW"],
  );
  const now = Date.now();
  let notified = 0;
  for (const ticket of tickets) {
    if (typeof ticket.etaPickupAt !== "string") continue;
    if (typeof ticket.etaNotifiedAt === "string") continue;
    if (Date.parse(ticket.etaPickupAt) + LATE_GRACE_MS > now) continue;
    await dispatchRepository.update(ticket.id, {
      etaNotifiedAt: new Date().toISOString(),
    });
    await enqueueDispatchPush(ticket.id, "-late-rider", {
      title: "Driver delayed",
      body: "Your tow is running late — tap to view",
    });
    await enqueueDispatchPush(ticket.id, "-late-operator", {
      audience: "operator",
      title: "Pickup running late",
      body: "This pickup is past its ETA — tap to view",
    });
    notified += 1;
  }
  if (notified > 0) cacheManager.del(NS);
  return {notified};
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
  const operated = await providerRepository.findByOperator(userId);
  const hasVolunteer = Array.isArray(caller.services) &&
    caller.services.includes("VOLUNTEER");
  const ownShopIds = new Set(
    operated
      .filter((provider) => provider.kind === PROVIDER_KIND.SHOP)
      .map((provider) => provider.id),
  );
  const canReadPhotos = (ticket: {
    assignedShopId?: string | null;
    providerId?: string | null;
    destinationShopId?: string | null;
    assignedUid?: string | null;
  }): boolean => {
    if (typeof ticket.assignedShopId === "string" &&
      ownShopIds.has(ticket.assignedShopId)) return true;
    if (typeof ticket.providerId === "string" &&
      ownShopIds.has(ticket.providerId)) return true;
    if (typeof ticket.destinationShopId === "string" &&
      ownShopIds.has(ticket.destinationShopId)) return true;
    return hasVolunteer &&
      typeof ticket.assignedUid === "string" &&
      ticket.assignedUid === userId;
  };
  const inbound: Array<Record<string, unknown>> = [];
  const inboundVisible = new Map<string, boolean>();
  const addInbound = <T extends {id: string; userId: string}>(
    ticket: T,
    visible: boolean,
  ): void => {
    const known = inboundVisible.get(ticket.id);
    if (known !== undefined && (known || !visible)) return;
    const row: Record<string, unknown> = {...ticket, direction: "in"};
    if (!visible) delete row.photoUrls;
    const at = inbound.findIndex((entry) => entry.id === ticket.id);
    if (at === -1) {
      inbound.push(row);
    } else {
      inbound[at] = row;
    }
    inboundVisible.set(ticket.id, visible);
  };
  for (const provider of operated) {
    if ((provider.status as string) === PROVIDER_STATUS.DENIED) continue;
    const [pending, recent] = await Promise.all([
      dispatchRepository.findPendingForShop(provider.id),
      dispatchRepository.findRecentForShop(provider.id, limit),
    ]);
    for (const ticket of [...pending, ...recent]) {
      if (ticket.userId !== userId) {
        addInbound(ticket, canReadPhotos(ticket));
      }
    }
  }
  const assisted = await dispatchRepository.findByAssignee(userId, limit);
  for (const ticket of assisted) {
    if (ticket.userId !== userId) {
      addInbound(ticket, canReadPhotos(ticket));
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
  merged.sort((a, b) => {
    const av = String(a.createdAt ?? "");
    const bv = String(b.createdAt ?? "");
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
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
  STATUS_DISPATCH.IN_SHOP,
  STATUS_DISPATCH.FINAL_QUOTED,
  STATUS_DISPATCH.ESTIMATED,
  STATUS_DISPATCH.EST_APPROVED,
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
      const destShopId = strOf(row.destinationShopId);
      if (destShopId !== "") shopIds.add(destShopId);
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
    kind: string;
    lat: number | null;
    lng: number | null;
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
        kind: shop.kind === "TOW" ? "TOW" : "SHOP",
        lat: typeof shop.lat === "number" ? shop.lat : null,
        lng: typeof shop.lng === "number" ? shop.lng : null,
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
  const towerIds = [...new Set(
    rows
      .filter((row) => row.direction === "out" &&
        row.ticketType === "TOW" &&
        (row.status === STATUS_DISPATCH.MATCHED ||
          row.status === STATUS_DISPATCH.ARRIVED) &&
        strOf(row.assignedShopId) !== "")
      .map((row) => strOf(row.assignedShopId)),
  )];
  const towerFixes = towerIds.length > 0 ?
    await providerLocationRepository.findByIds(towerIds) :
    new Map();
  for (const row of rows) {
    if (row.direction === "out") {
      row.otherParty = outParty(row, shopDetails);
      const dest = destinationPartyOf(row, shopDetails);
      if (dest) row.destinationParty = dest;
      row.towerFix = null;
      if (row.ticketType === "TOW" &&
        (row.status === STATUS_DISPATCH.MATCHED ||
          row.status === STATUS_DISPATCH.ARRIVED)) {
        const fix = towerFixes.get(strOf(row.assignedShopId));
        if (fix && typeof fix.lat === "number" &&
          typeof fix.lng === "number" &&
          typeof fix.lastSeen === "string" &&
          Date.now() - Date.parse(fix.lastSeen) < PROVIDER_FRESH_MS) {
          row.towerFix = {
            lat: fix.lat,
            lng: fix.lng,
            at: fix.lastSeen,
          };
        }
      }
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
      const dest = destinationPartyOf(row, shopDetails);
      if (dest) row.destinationParty = dest;
    }
  }
};

type ShopDetail = {
  name: string;
  kind: string;
  lat: number | null;
  lng: number | null;
  label: string | null;
  openNow: boolean | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  phone: string | null;
};

const buildShopParty = (
  shopId: string,
  shop: ShopDetail,
  shared: boolean,
): Record<string, unknown> => ({
  id: shopId,
  name: shop.name,
  kind: shop.kind,
  ...(shop.lat !== null && shop.lng !== null ?
    {lat: shop.lat, lng: shop.lng} :
    {}),
  ...(shop.label !== null ? {label: shop.label} : {}),
  ...(shop.openNow !== null ? {openNow: shop.openNow} : {}),
  ...(shop.ratingAvg !== null ? {ratingAvg: shop.ratingAvg} : {}),
  ...(shop.ratingCount !== null ?
    {ratingCount: shop.ratingCount} :
    {}),
  ...(shared && shop.phone !== null ? {phone: shop.phone} : {}),
});

const outParty = (
  row: FeedRow,
  shopDetails: Map<string, ShopDetail>,
): unknown => {
  const shopKeys = [
    "assignedShopId",
    "providerId",
  ] as const;
  for (const key of shopKeys) {
    const shopId = strOf(row[key]);
    const shop = shopId !== "" ? shopDetails.get(shopId) ?? null : null;
    if (shop) {
      const shared = typeof row.status === "string" &&
        phoneSharingStatuses.has(row.status);
      return buildShopParty(shopId, shop, shared);
    }
  }
  const uid = strOf(row.assignedUid);
  if (uid !== "") {
    return {id: uid, name: reporterHandle(uid), kind: "VOLUNTEER"};
  }
  return null;
};

const destinationPartyOf = (
  row: FeedRow,
  shopDetails: Map<string, ShopDetail>,
): unknown => {
  const shopId = strOf(row.destinationShopId);
  if (shopId === "") return null;
  const shop = shopDetails.get(shopId) ?? null;
  if (!shop || shop.kind !== PROVIDER_KIND.SHOP) return null;
  const shared = typeof row.status === "string" &&
    phoneSharingStatuses.has(row.status);
  return buildShopParty(shopId, shop, shared);
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
  let operatedKind: unknown = null;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      isOperator = true;
      operatedKind = shop.kind;
      break;
    }
  }
  if (!isOperator && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator updates the work order");
  }
  if (operatedKind !== PROVIDER_KIND.SHOP && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only shops update work orders");
  }
  const editable: Set<string> = new Set([
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_PROGRESS,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.QUOTED,
    STATUS_DISPATCH.FINAL_QUOTED,
    STATUS_DISPATCH.ESTIMATED,
    STATUS_DISPATCH.EST_APPROVED,
  ]);
  if (!editable.has(ticket.status)) {
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
    ...(quotedAmount !== undefined ? {
      quotedBy: userId,
      quotedAt: new Date().toISOString(),
    } : {}),
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
  destinationShopId?: unknown;
  ticketType?: unknown;
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

const requireShopOperator = async (
  ticket: TicketActors,
  userId: string,
): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  for (const shopId of shopIds) {
    const shop = await providerRepository.findById(shopId);
    if (shop && shop.operatorUid === userId) {
      if (shop.kind !== PROVIDER_KIND.SHOP) {
        throw new ForbiddenError("Only shops send quotes");
      }
      return;
    }
  }
  throw new ForbiddenError("Only shops send quotes");
};

const requireDestinationShopOperator = async (
  ticket: TicketActors,
  userId: string,
): Promise<void> => {
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return;
  const destShopId = typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" ?
    ticket.destinationShopId :
    "";
  if (destShopId === "") {
    throw new ForbiddenError(
      "Only the destination shop estimates for this tow",
    );
  }
  const shop = await providerRepository.findById(destShopId);
  if (!shop || shop.operatorUid !== userId ||
    shop.kind !== PROVIDER_KIND.SHOP) {
    throw new ForbiddenError(
      "Only the destination shop estimates for this tow",
    );
  }
};

export const sendEstimate = async ({
  userId,
  ticketId,
  estimateAmount,
  estimateNote,
  eta,
}: {
  userId: string;
  ticketId: string;
  estimateAmount: number;
  estimateNote?: string;
  eta?: number;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType === "TOW") {
    await requireDestinationShopOperator(ticket, userId);
    const towStates: Set<string> = new Set([
      STATUS_DISPATCH.PENDING,
      STATUS_DISPATCH.MATCHED,
      STATUS_DISPATCH.ARRIVED,
    ]);
    if (!towStates.has(ticket.status)) {
      throw new ValidationError("Estimates go out on active tows");
    }
    if (typeof ticket.estimateApprovedAt === "string" &&
      ticket.estimateApprovedAt !== "") {
      throw new ValidationError("Estimate already approved");
    }
    if (typeof ticket.estimateExpiresAt === "string" &&
      Date.parse(ticket.estimateExpiresAt) > Date.now()) {
      throw new ValidationError("Estimate already sent");
    }
    if (!Number.isInteger(estimateAmount) || estimateAmount < 0) {
      throw new ValidationError("Estimate must be a non-negative integer");
    }
    await dispatchRepository.update(ticketId, {
      estimateAmount,
      ...(estimateNote !== undefined ? {estimateNote} : {}),
      ...(eta !== undefined ? {estimateEta: eta} : {}),
      estimateExpiresAt: new Date(
        Date.now() + TOW_ESTIMATE_TTL_MS,
      ).toISOString(),
      estimateApprovedAt: null,
      estimateBy: userId,
      estimatedAt: new Date().toISOString(),
    });
    cacheManager.del(NS);
    await enqueueDispatchPush(ticketId, "-estimate-sent-rider", {
      audience: "rider",
      title: "Repair estimate ready",
      body: "The drop-off shop sent an estimate — tap to review",
    });
    return {estimated: true};
  }
  await resolveTicketOperator(ticket, userId);
  await requireShopOperator(ticket, userId);
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length === 0) {
    throw new ValidationError("Quotes need a shop ticket");
  }
  const allowed: Set<string> = new Set([
    STATUS_DISPATCH.PENDING,
    STATUS_DISPATCH.MATCHED,
    STATUS_DISPATCH.ARRIVED,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.QUOTED,
    STATUS_DISPATCH.ESTIMATED,
  ]);
  if (!allowed.has(ticket.status)) {
    throw new ValidationError("Estimates go out on active tickets");
  }
  if (ticket.status === STATUS_DISPATCH.ESTIMATED &&
    typeof ticket.estimateExpiresAt === "string" &&
    Date.parse(ticket.estimateExpiresAt) > Date.now()) {
    throw new ValidationError("Estimate already sent");
  }
  if (!Number.isInteger(estimateAmount) || estimateAmount < 0) {
    throw new ValidationError("Estimate must be a non-negative integer");
  }
  const nowIso = new Date().toISOString();
  await dispatchRepository.update(ticketId, {
    estimateAmount,
    ...(estimateNote !== undefined ? {estimateNote} : {}),
    ...(eta !== undefined ? {estimateEta: eta} : {}),
    estimateExpiresAt: new Date(Date.now() + ESTIMATE_TTL_MS).toISOString(),
    estimateBy: userId,
    estimatedAt: nowIso,
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.ESTIMATED,
    userId,
  );
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.ESTIMATED}`);
  return {estimated: true};
};

export const approveEstimate = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider approves the estimate");
  }
  if (ticket.ticketType === "TOW") {
    if (typeof ticket.estimateAmount !== "number") {
      throw new ValidationError("No estimate awaiting approval");
    }
    if (typeof ticket.estimateApprovedAt === "string" &&
      ticket.estimateApprovedAt !== "") {
      throw new ValidationError("Estimate already approved");
    }
    if (typeof ticket.estimateExpiresAt === "string" &&
      Date.parse(ticket.estimateExpiresAt) <= Date.now()) {
      throw new ValidationError("Estimate expired");
    }
    await dispatchRepository.update(ticketId, {
      estimateApprovedAt: new Date().toISOString(),
    });
    cacheManager.del(NS);
    await enqueueDispatchPush(
      ticketId,
      "-estimate-approved-destination",
      {
        audience: "destination-shop",
        title: "Estimate approved",
        body: "The rider approved your estimate — hold the bay",
      },
    );
    return {approved: true};
  }
  if (ticket.status !== STATUS_DISPATCH.ESTIMATED) {
    throw new ValidationError("No estimate awaiting approval");
  }
  if (typeof ticket.estimateExpiresAt === "string" &&
    Date.parse(ticket.estimateExpiresAt) <= Date.now()) {
    throw new ValidationError("Estimate expired");
  }
  await dispatchRepository.update(ticketId, {
    estimateApprovedAt: new Date().toISOString(),
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.EST_APPROVED,
    userId,
  );
  cacheManager.del(NS);
  await enqueueDispatchPush(
    ticketId,
    `-status-${STATUS_DISPATCH.EST_APPROVED}-operator`,
    {
      audience: "operator",
      title: "Estimate approved",
      body: "The rider authorized the tow and drop-off — tap to view",
    },
  );
  return {approved: true};
};

export const declineEstimate = async ({
  userId,
  ticketId,
  shopId,
}: {
  userId: string;
  ticketId: string;
  shopId?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider declines the estimate");
  }
  if (ticket.ticketType === "TOW") {
    if (typeof ticket.estimateAmount !== "number") {
      throw new ValidationError("No estimate awaiting decision");
    }
    let declinedId = typeof shopId === "string" && shopId !== "" ? shopId : "";
    if (declinedId === "") {
      if (typeof ticket.destinationShopId === "string" &&
        ticket.destinationShopId !== "") {
        declinedId = ticket.destinationShopId;
      } else if (typeof ticket.suggestedShopId === "string" &&
        ticket.suggestedShopId !== "") {
        declinedId = ticket.suggestedShopId;
      }
    }
    const patch: Record<string, unknown> = {
      estimateAmount: null,
      estimateNote: null,
      estimateExpiresAt: null,
      estimateApprovedAt: null,
    };
    if (declinedId !== "" && typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId === declinedId) {
      patch.destinationShopId = null;
      patch.destinationSnapshot = null;
      patch.destinationPoint = null;
      patch.needsNewDestination = true;
    }
    if (declinedId !== "") {
      const prior = Array.isArray(ticket.declinedShopIds) ?
        [...(ticket.declinedShopIds as string[])] :
        [];
      if (!prior.includes(declinedId)) prior.push(declinedId);
      patch.declinedShopIds = prior;
    }
    await dispatchRepository.update(ticketId, patch);
    cacheManager.del(NS);
    if (declinedId !== "") {
      await enqueueDispatchPush(ticketId, "-estimate-declined-destination", {
        audience: "destination-shop",
        shopId: declinedId,
        title: "Estimate declined",
        body: "The rider declined — pick another drop-off",
      });
    }
    return {declined: true};
  }
  if (ticket.status !== STATUS_DISPATCH.ESTIMATED) {
    throw new ValidationError("No estimate awaiting decision");
  }
  let declinedId = typeof shopId === "string" && shopId !== "" ? shopId : "";
  if (declinedId === "") {
    if (typeof ticket.suggestedShopId === "string" &&
      ticket.suggestedShopId !== "") {
      declinedId = ticket.suggestedShopId;
    } else if (typeof ticket.destinationShopId === "string" &&
      ticket.destinationShopId !== "") {
      declinedId = ticket.destinationShopId;
    } else if (typeof ticket.estimateBy === "string" &&
      ticket.estimateBy !== "") {
      declinedId = "";
    }
  }
  const patch: Record<string, unknown> = {
    status: STATUS_DISPATCH.PENDING,
    estimateExpiresAt: null,
  };
  if (declinedId !== "" && typeof ticket.suggestedShopId === "string" &&
    ticket.suggestedShopId === declinedId) {
    patch.suggestedShopId = null;
  }
  if (declinedId !== "" && typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId === declinedId) {
    patch.destinationShopId = null;
    patch.destinationSnapshot = null;
    patch.destinationPoint = null;
  }
  if (declinedId !== "") {
    const prior = Array.isArray(ticket.declinedShopIds) ?
      [...(ticket.declinedShopIds as string[])] :
      [];
    if (!prior.includes(declinedId)) prior.push(declinedId);
    patch.declinedShopIds = prior;
  }
  await dispatchRepository.update(ticketId, patch);
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.PENDING,
    userId,
  );
  cacheManager.del(NS);
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length > 0) {
    await enqueueDispatchPush(ticketId, "-estimate-declined-operator", {
      audience: "operator",
      title: "Estimate declined",
      body: "The rider declined the estimate — tap to view",
    });
  }
  return {declined: true};
};

export const sendQuote = async ({
  userId,
  ticketId,
  quotedAmount,
  finalAmount,
  workType,
  faultPhotos,
}: {
  userId: string;
  ticketId: string;
  quotedAmount?: number;
  finalAmount?: number;
  workType?: string;
  faultPhotos?: string[];
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
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    let shopKind: unknown = null;
    for (const shopId of shopIds) {
      const shop = await providerRepository.findById(shopId);
      if (shop && shop.operatorUid === userId) {
        shopKind = shop.kind;
        break;
      }
    }
    if (shopKind !== PROVIDER_KIND.SHOP) {
      throw new ForbiddenError("Only shops send quotes");
    }
  }
  const amount = finalAmount !== undefined ? finalAmount : quotedAmount;
  if (amount === undefined) {
    throw new ValidationError("Quote needs an amount");
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new ValidationError("Quote must be a non-negative integer");
  }
  const hasEstimate = typeof ticket.estimateAmount === "number";
  const finalStates: Set<string> = new Set([
    STATUS_DISPATCH.EST_APPROVED,
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.FINAL_QUOTED,
    STATUS_DISPATCH.ESTIMATED,
  ]);
  const useFinal = hasEstimate || finalStates.has(ticket.status) ||
    finalAmount !== undefined;
  if (useFinal) {
    if (!finalStates.has(ticket.status) &&
      ticket.status !== STATUS_DISPATCH.MATCHED &&
      ticket.status !== STATUS_DISPATCH.ARRIVED &&
      ticket.status !== STATUS_DISPATCH.QUOTED &&
      ticket.status !== STATUS_DISPATCH.IN_PROGRESS) {
      throw new ValidationError("Final quote goes out on active tickets");
    }
    if (typeof ticket.finalAmount === "number") {
      throw new ValidationError("Final quote already sent");
    }
    await dispatchRepository.update(ticketId, {
      finalAmount: amount,
      ...(typeof ticket.shopQuotedAmount !== "number" ?
        {shopQuotedAmount: amount} :
        {}),
      ...(workType !== undefined ? {workType} : {}),
      ...(faultPhotos !== undefined ? {faultPhotos} : {}),
      quotedBy: userId,
      quotedAt: new Date().toISOString(),
    });
    await dispatchRepository.updateStatus(
      ticketId,
      STATUS_DISPATCH.FINAL_QUOTED,
      userId,
    );
    cacheManager.del(NS);
    await enqueueDispatchPush(
      ticketId,
      `-status-${STATUS_DISPATCH.FINAL_QUOTED}`,
    );
    return {quoted: true};
  }
  if (ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED) {
    throw new ValidationError("Quotes go out on active tickets");
  }
  if (typeof ticket.shopQuotedAmount === "number") {
    throw new ValidationError("Quote already sent");
  }
  await dispatchRepository.update(ticketId, {
    shopQuotedAmount: amount,
    ...(workType !== undefined ? {workType} : {}),
    ...(faultPhotos !== undefined ? {faultPhotos} : {}),
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

export const declineDestination = async ({
  userId,
  ticketId,
  reasonCode,
}: {
  userId: string;
  ticketId: string;
  reasonCode?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (typeof ticket.destinationShopId !== "string" ||
    ticket.destinationShopId === "") {
    throw new ValidationError("Ticket has no shop destination");
  }
  if (TERMINAL_STATUSES.has(ticket.status)) {
    throw new ValidationError("Destination is no longer declinable");
  }
  const shop = await providerRepository.findById(
    ticket.destinationShopId as string,
  );
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (shop.operatorUid !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the destination shop declines");
  }
  if (typeof reasonCode !== "string" ||
    !(Object.values(SHOP_DECLINE_REASON) as string[]).includes(reasonCode)) {
    throw new ValidationError("Unknown decline reason");
  }
  const destShopId = ticket.destinationShopId as string;
  const legKm = await freezeTowLeg(ticketId, {
    towLegs: ticket.towLegs,
    towDistanceMeters: ticket.towDistanceMeters,
    assignedShopId: ticket.assignedShopId,
    lat: ticket.lat,
    lng: ticket.lng,
  }, destShopId);
  const declinedPrior = Array.isArray(ticket.declinedShopIds) ?
    [...(ticket.declinedShopIds as string[])] :
    [];
  if (!declinedPrior.includes(destShopId)) declinedPrior.push(destShopId);
  await dispatchRepository.update(ticketId, {
    destinationShopId: null,
    destinationSnapshot: null,
    destinationPoint: null,
    needsNewDestination: true,
    etaNotifiedAt: null,
    declinedShopIds: declinedPrior,
    estimateAmount: null,
    estimateNote: null,
    estimateExpiresAt: null,
    estimateApprovedAt: null,
  });
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    try {
      await startWaiting(ticketId);
    } catch {
      return {declined: true, legKm};
    }
  }
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, "-destination-declined", {
    audience: "rider",
    urgent: "true",
    title: "Destination declined",
    body: "The shop can't take your vehicle — pick another drop-off",
  });
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    await enqueueDispatchPush(ticketId, "-destination-declined-operator", {
      audience: "operator",
      title: "Drop-off declined",
      body: "The destination shop declined — await the rider's new drop-off",
    });
  }
  try {
    await autoFile({
      ticketId,
      reporterUid: ticket.userId,
      accusedKind: ACCUSED_KIND.SHOP,
      accusedId: destShopId,
      reasonCode,
      type: DISPUTE_TYPE.SHOP_DECLINE_DROPOFF,
    });
  } catch {
    return {declined: true, legKm};
  }
  try {
    await db.collection("providers").doc(destShopId).update({
      declineCount: FieldValue.increment(1),
    });
  } catch {
    try {
      await providerRepository.update(destShopId, {declineCount: 1});
    } catch {
      return {declined: true, legKm};
    }
  }
  return {declined: true, legKm};
};

const tryRefundPayment = async (
  ticketId: string,
  byUserId: string,
): Promise<void> => {
  try {
    const payments = await paymentRepository.findByTicket(ticketId);
    const refundable = payments.filter((p) =>
      p.method === "SEPAY" && p.status === "HELD");
    for (const payment of refundable) {
      try {
        await paymentService.refundPayment({
          paymentId: payment.id,
          adminUid: byUserId,
          amount: payment.amount,
        });
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
};

export const markUnfixable = async ({
  userId,
  ticketId,
  reason,
  photoUrls,
}: {
  userId: string;
  ticketId: string;
  reason: string;
  photoUrls: string[];
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
    throw new ForbiddenError("Only the operator marks unfixable");
  }
  const allowed: Set<string> = new Set([
    STATUS_DISPATCH.IN_SHOP,
    STATUS_DISPATCH.FINAL_QUOTED,
    STATUS_DISPATCH.QUOTED,
    STATUS_DISPATCH.ARRIVED,
  ]);
  if (!allowed.has(ticket.status)) {
    throw new ValidationError("Ticket is not in an unfixable state");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new ValidationError("Reason is required");
  }
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    throw new ValidationError("Evidence photos are required");
  }
  validatePhotoPathsStructure(photoUrls);
  const nowIso = new Date().toISOString();
  await dispatchRepository.update(ticketId, {
    unfixable: {
      reason,
      photoUrls,
      by: userId,
      at: nowIso,
    },
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.UNFIXABLE,
    userId,
  );
  try {
    await stopWaiting(ticketId);
  } catch {
    return {unfixable: true};
  }
  await tryRefundPayment(ticketId, userId);
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId, `-status-${STATUS_DISPATCH.UNFIXABLE}`, {
    audience: "rider",
    urgent: "true",
    title: "Marked unfixable",
    body: "The shop marked your vehicle unfixable — tap to view",
  });
  return {unfixable: true};
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
  const finalPending = ticket.status === STATUS_DISPATCH.FINAL_QUOTED &&
    typeof ticket.finalAmount === "number";
  const finalLegacy = (ticket.status === STATUS_DISPATCH.IN_SHOP ||
    ticket.status === STATUS_DISPATCH.EST_APPROVED ||
    ticket.status === STATUS_DISPATCH.QUOTED) &&
    typeof ticket.finalAmount === "number";
  if (!pending && !legacy && !finalPending && !finalLegacy) {
    throw new ValidationError("No quote awaiting approval");
  }
  const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  if (shopIds.length === 0) {
    throw new ValidationError("Quotes need a shop ticket");
  }
  const payments = await paymentRepository.findByTicket(ticketId);
  const funded = payments.some((p) =>
    (p.method === "CASH" && p.status === "PENDING") ||
    (p.method === "SEPAY" && p.status === "HELD"));
  if (!funded) {
    throw new ValidationError("Payment required before starting work");
  }
  await dispatchRepository.update(ticketId, {
    paymentArmed: true,
    quoteApprovedAt: new Date().toISOString(),
  });
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
