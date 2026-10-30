import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";


import {
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../../../constants/payments";
import {
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../../constants/status";


import {
  linkedSummaryFor,
  mobileTowAvailabilityFor,
  sosCallOutTotalFor,
} from "../summary";

import {isOpenNow} from "../../providerService";
import {NotFoundError} from "../../../utils/errors";


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
  const ownShopIds = new Set(
    operated
      .filter((provider) => provider.kind === PROVIDER_KIND.SHOP)
      .map((provider) => provider.id),
  );
  const ownTowIds = new Set(
    operated
      .filter((provider) => provider.kind === PROVIDER_KIND.TOW)
      .map((provider) => provider.id),
  );
  const ownMobileShopIds = new Set(
    operated
      .filter((provider) => provider.kind === PROVIDER_KIND.MOBILE_SHOP)
      .map((provider) => provider.id),
  );
  const canReadPhotos = (ticket: {
    ticketType?: unknown;
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
    if (typeof ticket.assignedShopId === "string" &&
      ownTowIds.has(ticket.assignedShopId)) return true;
    if (typeof ticket.providerId === "string" &&
      ownTowIds.has(ticket.providerId)) return true;
    if (typeof ticket.assignedShopId === "string" &&
      ownMobileShopIds.has(ticket.assignedShopId)) return true;
    if (typeof ticket.providerId === "string" &&
      ownMobileShopIds.has(ticket.providerId)) return true;
    return false;
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
  let pendingCash: paymentRepository.Payment[] = [];
  if (rows.some((row) => row.direction === "in")) {
    try {
      const found = await paymentRepository.findByPayee(
        userId,
        PAYMENT_STATUS.PENDING,
        PAYMENT_LIST_MAX,
      );
      if (Array.isArray(found)) pendingCash = found;
    } catch {
      pendingCash = [];
    }
  }
  const cashTicketIds = new Set(
    pendingCash
      .filter((payment) => payment.method === PAYMENT_METHOD.CASH)
      .map((payment) => payment.ticketId),
  );
  for (const row of rows) {
    if (row.direction === "in" && cashTicketIds.has(String(row.id))) {
      row.canConfirmCash = true;
    }
  }
  await attachParties(rows);
  for (const row of rows) {
    const ticket = row as unknown as dispatchRepository.DispatchTicket;
    try {
      const former = Array.isArray(ticket.formerAssignedShopIds) ?
        ticket.formerAssignedShopIds.filter(
          (id): id is string => typeof id === "string" && id !== "",
        ) :
        [];
      const assigned = typeof ticket.assignedShopId === "string" ?
        ticket.assignedShopId :
        "";
      if (row.direction === "in" &&
        former.some((id) => ownTowIds.has(id)) &&
        !ownTowIds.has(assigned)) {
        row.formerAssignment = true;
        const history = Array.isArray(ticket.towCancelHistory) ?
          ticket.towCancelHistory :
          [];
        const own = history
          .filter((entry) => entry !== null && typeof entry === "object" &&
            ownTowIds.has(String((entry as {shopId?: unknown}).shopId)))
          .sort((a, b) =>
            String((b as {at?: unknown}).at ?? "").localeCompare(
              String((a as {at?: unknown}).at ?? ""),
            ))[0] as {at?: unknown} | undefined;
        if (own && typeof own.at === "string") {
          row.formerAssignmentAt = own.at;
        }
      }
      if (row.direction === "in" && row.formerAssignment !== true) {
        delete row.towCancelHistory;
        delete row.destinationDecline;
        delete row.chatHistory;
      }
      const assignedMine =
        (typeof ticket.assignedShopId === "string" &&
          (ownShopIds.has(ticket.assignedShopId) ||
            ownTowIds.has(ticket.assignedShopId) ||
            ownMobileShopIds.has(ticket.assignedShopId))) ||
        ticket.assignedUid === userId;
      if (row.direction === "out" || assignedMine) {
        const summary = await linkedSummaryFor(ticket);
        if (summary !== null) row.linkedSummary = summary;
      }
      if (row.direction === "in" && ticket.ticketType === "SOS" &&
        ticket.status === STATUS_DISPATCH.UNFIXABLE &&
        !ticket.continuationTicketId) {
        const availability = await mobileTowAvailabilityFor(ticket);
        row.mobileTowAvailable = availability.available;
        row.mobileTowMode = availability.mode;
        row.mobileTowState = availability.state;
      }
      if (ticket.ticketType === "SOS") {
        row.sosCallOutTotal = await sosCallOutTotalFor(ticket);
      }
    } catch {
      void 0;
    }
  }
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
        kind: shop.kind === "TOW" ?
          "TOW" :
          shop.kind === "MOBILE_SHOP" ? "MOBILE_SHOP" : "SHOP",
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
  const mobileShopIds = [...new Set(
    rows
      .filter((row) => row.direction === "out" &&
        row.ticketType === "SOS" &&
        (row.status === STATUS_DISPATCH.MATCHED ||
          row.status === STATUS_DISPATCH.ARRIVED ||
          row.status === STATUS_DISPATCH.READY) &&
        strOf(row.assignedShopId) !== "")
      .map((row) => strOf(row.assignedShopId)),
  )];
  const providerIds = [...new Set([...towerIds, ...mobileShopIds])];
  const providerFixes = providerIds.length > 0 ?
    await providerLocationRepository.findByIds(providerIds) :
    new Map();
  const freshFix = (providerId: string): {
    lat: number;
    lng: number;
    at: string;
  } | null => {
    const fix = providerFixes.get(providerId);
    if (fix && typeof fix.lat === "number" &&
      typeof fix.lng === "number" &&
      typeof fix.lastSeen === "string" &&
      Date.now() - Date.parse(fix.lastSeen) < PROVIDER_FRESH_MS) {
      return {lat: fix.lat, lng: fix.lng, at: fix.lastSeen};
    }
    return null;
  };
  for (const row of rows) {
    if (row.direction === "out") {
      row.otherParty = outParty(row, shopDetails);
      const dest = destinationPartyOf(row, shopDetails);
      if (dest) row.destinationParty = dest;
      row.towerFix = null;
      row.mobileShopFix = null;
      if (row.ticketType === "TOW" &&
        (row.status === STATUS_DISPATCH.MATCHED ||
          row.status === STATUS_DISPATCH.ARRIVED)) {
        row.towerFix = freshFix(strOf(row.assignedShopId));
      }
      if (row.ticketType === "SOS" &&
        (row.status === STATUS_DISPATCH.MATCHED ||
          row.status === STATUS_DISPATCH.ARRIVED ||
          row.status === STATUS_DISPATCH.READY)) {
        row.mobileShopFix = freshFix(strOf(row.assignedShopId));
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
