import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import {servesVehicleClass, vehicleClassOf, isOpenNow} from
  "../providerService";
import {enqueueDispatchPush} from "../taskQueueService";
import {
  NS,
  TERMINAL_STATUSES,
  VALID_STATUSES,
  WALK_IN_TTL_MS,
} from "./constants";
import {
  resolveAccessWidth,
  resolveDestination,
} from "./helpers";
import {findCandidates} from "./candidates";
import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {isCarVehicle} from "../../utils/valhalla";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";

export const createDispatch = async ({
  userId,
  ticketType,
  lat,
  lng,
  diagnosticId,
  alleySegmentId,
  accessWidthMeters,
  note,
  providerId,
  destinationShopId,
  destinationPoint,
  vehicleType,
  vehicleWidth,
  vehicleLabel,
  now,
}: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
  alleySegmentId?: string;
  accessWidthMeters?: number;
  note?: string;
  providerId?: string;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleType?: string;
  vehicleWidth?: number;
  vehicleLabel?: string;
  now?: Date;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (ticketType === "MECHANIC" && isCarVehicle(vehicleType)) {
    throw new ValidationError("Walk-in repair isn't available for cars");
  }
  if (ticketType === "WALK_IN" && isCarVehicle(vehicleType)) {
    throw new ValidationError("Walk-in repair isn't available for cars");
  }
  if (ticketType === "TOW" && !destinationShopId && !destinationPoint) {
    throw new ValidationError("Tow tickets need a destination");
  }
  let providerSnapshot: Record<string, unknown> | undefined;
  if (ticketType === "WALK_IN") {
    if (!providerId) {
      throw new ValidationError("Walk-in tickets need a shop");
    }
    const shop = await providerRepository.findById(providerId);
    if (!shop) throw new NotFoundError("Provider not found");
    if (shop.kind !== PROVIDER_KIND.SHOP) {
      throw new ValidationError("Walk-in tickets need a repair shop");
    }
    if (shop.status !== PROVIDER_STATUS.ACTIVE ||
      (shop as {suspended?: boolean}).suspended === true) {
      throw new ValidationError("Walk-in shop is not available");
    }
    if (!servesVehicleClass(shop, vehicleClassOf(vehicleType))) {
      throw new ValidationError(
        "Walk-in shop does not service this vehicle class",
      );
    }
    providerSnapshot = {
      id: shop.id,
      name: shop.name,
      lat: shop.lat,
      lng: shop.lng,
      kind: shop.kind,
      closed: isOpenNow(shop.openHours as string | null, now) === false,
    };
  }
  const width = await resolveAccessWidth(
    alleySegmentId,
    accessWidthMeters,
  );
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticketType,
    vehicleType,
  );
  const ticket = await dispatchRepository.create({
    userId,
    ticketType,
    lat,
    lng,
    diagnosticId,
    alleySegmentId,
    accessWidthMeters: width,
    note,
    providerId,
    providerSnapshot,
    destinationShopId,
    destinationSnapshot,
    destinationPoint,
    vehicleType,
    vehicleWidth,
    vehicleClass: vehicleClassOf(vehicleType),
    vehicleLabel: vehicleLabel ?? vehicleType,
    ...(ticketType === "WALK_IN" ?
      {expiresAt: new Date(Date.now() + WALK_IN_TTL_MS).toISOString()} :
      {}),
  });
  if (ticketType === "SOS") {
    const candidates = await findCandidates({lat, lng, vehicleType});
    if (candidates.length > 0) {
      await dispatchRepository.update(ticket.id, {
        candidates,
        candidateTs: new Date().toISOString(),
      });
      await enqueueDispatchPush(ticket.id);
      cacheManager.del(NS);
      const refreshed = await dispatchRepository.findById(ticket.id);
      return refreshed ?? ticket;
    }
  }
  if (ticketType === "WALK_IN") {
    await enqueueDispatchPush(ticket.id);
  }
  if (ticketType === "TOW") {
    await enqueueDispatchPush(ticket.id);
  }
  cacheManager.del(NS);
  return ticket;
};


export const getMyTicketsInner = async (userId: string) => {
  return dispatchRepository.findByUserId(userId);
};

export const getMyTicketsCached = cacheManager.wrap(getMyTicketsInner, {
  namespace: NS,
  keyFn: (userId: string) => userId,
});

export const getMyTickets = async (userId: string) =>
  getMyTicketsCached(userId);


export const getDispatch = async (id: string, userId: string) => {
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId && ticket.assignedUid !== userId) {
    const caller = await userRepository.findById(userId);
    if (!caller) throw new NotFoundError("User not found");
    if (caller.role !== ROLE_ADMIN) {
      let operator = false;
      if (
        typeof ticket.assignedShopId === "string" &&
        ticket.assignedShopId !== ""
      ) {
        const shop = await providerRepository.findById(ticket.assignedShopId);
        operator = !!shop && shop.operatorUid === userId;
      }
      if (!operator) {
        const offered = Array.isArray(ticket.candidates) &&
          (ticket.candidates as unknown[]).includes(userId);
        if (!offered) {
          throw new ForbiddenError(
            "Only ticket participants or providers view this",
          );
        }
      }
    }
  }
  if (
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await providerRepository.findById(ticket.assignedShopId);
    if (
      shop &&
      shop.kind === PROVIDER_KIND.TOW &&
      typeof shop.plate === "string" &&
      shop.plate !== ""
    ) {
      return {...ticket, towPlate: shop.plate};
    }
  }
  return ticket;
};


export const assertTransition = ({
  ticket,
  status,
  isRider,
  isOperator,
  isAdmin,
}: {
  ticket: {status: string; ticketType: string; shopQuotedAmount?: unknown};
  status: string;
  isRider: boolean;
  isOperator: boolean;
  isAdmin: boolean;
}): void => {
  if (isAdmin) return;
  const from = ticket.status;
  if (TERMINAL_STATUSES.has(from)) {
    throw new ValidationError("Ticket is already closed");
  }
  const shopFlow = isOperator;
  if (status === STATUS_DISPATCH.MATCHED) {
    throw new ValidationError("Use accept to match a ticket");
  }
  if (status === STATUS_DISPATCH.ARRIVED) {
    if (from === STATUS_DISPATCH.MATCHED && isRider) return;
    throw new ForbiddenError("Only the rider marks arrival");
  }
  if (status === STATUS_DISPATCH.QUOTED) {
    throw new ValidationError("Quotes are sent, not set");
  }
  if (status === STATUS_DISPATCH.IN_PROGRESS) {
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if (from === STATUS_DISPATCH.QUOTED) {
      throw new ForbiddenError("Quote needs rider approval");
    }
    const quoted = typeof ticket.shopQuotedAmount === "number";
    const arrived = from === STATUS_DISPATCH.MATCHED &&
      ticket.ticketType === "WALK_IN" && !quoted;
    if ((from === STATUS_DISPATCH.ARRIVED || arrived) && shopFlow) return;
    throw new ForbiddenError("Only the helper starts work");
  }
  if (status === STATUS_DISPATCH.READY) {
    if (ticket.ticketType === "SOS" || ticket.ticketType === "TOW") {
      throw new ForbiddenError("Work states are shop-ticket only");
    }
    if (from === STATUS_DISPATCH.IN_PROGRESS && shopFlow) return;
    throw new ForbiddenError("Only the helper marks work ready");
  }
  if (status === STATUS_DISPATCH.RESOLVED) {
    if ((from === STATUS_DISPATCH.ARRIVED ||
      from === STATUS_DISPATCH.READY) && isRider) {
      return;
    }
    throw new ForbiddenError("Only the rider resolves a ticket");
  }
  if (status === STATUS_DISPATCH.CANCELLED) {
    if (isRider && from !== STATUS_DISPATCH.IN_PROGRESS) return;
    throw new ForbiddenError(
      "Cannot cancel once work is underway",
    );
  }
  if (status === STATUS_DISPATCH.DECLINED) {
    if (from === STATUS_DISPATCH.PENDING &&
      ticket.ticketType === "WALK_IN" && isOperator) {
      return;
    }
    throw new ForbiddenError("Only the shop declines a walk-in");
  }
  throw new ValidationError("Invalid dispatch status");
};


export const updateDispatchStatus = async ({
  id,
  status,
  userId,
}: {
  id: string;
  status: string;
  userId: string;
}) => {
  if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError("Invalid dispatch status");
  }
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const isRider = ticket.userId === userId;
  const isAssignee = ticket.assignedUid === userId;
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
  const isAdmin = caller.role === ROLE_ADMIN;
  if (!isRider && !isAssignee && !isOperator && !isAdmin) {
    throw new ForbiddenError("Only the rider, helper, or operator updates");
  }
  assertTransition({
    ticket: {
      status: ticket.status,
      ticketType: ticket.ticketType,
      shopQuotedAmount: ticket.shopQuotedAmount,
    },
    status,
    isRider,
    isOperator,
    isAdmin,
  });
  await dispatchRepository.updateStatus(id, status, userId);
  if (status === STATUS_DISPATCH.READY) {
    await dispatchRepository.update(id, {
      fulfilledByShopId: ticket.assignedShopId ?? null,
    });
  }
  cacheManager.del(NS);
  if (
    status === STATUS_DISPATCH.MATCHED ||
    status === STATUS_DISPATCH.ARRIVED ||
    status === STATUS_DISPATCH.RESOLVED ||
    status === STATUS_DISPATCH.IN_PROGRESS ||
    status === STATUS_DISPATCH.READY ||
    status === STATUS_DISPATCH.DECLINED
  ) {
    await enqueueDispatchPush(id, `-status-${status}`);
  }
  if (status === STATUS_DISPATCH.CANCELLED) {
    await enqueueDispatchPush(id, "-cancelled-rider", {
      title: "Request cancelled",
      body: "Your request was cancelled",
    });
    if (ticket.status === STATUS_DISPATCH.PENDING &&
      ticket.ticketType === "TOW") {
      await enqueueDispatchPush(id, "-cancelled-towers", {
        audience: "tower-candidates",
        title: "Tow request withdrawn",
        body: "A tow request near you was cancelled",
      });
    }
    const shopIds = [ticket.assignedShopId, ticket.providerId].filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    if (shopIds.length > 0) {
      await enqueueDispatchPush(id, `-status-${status}-operator`, {
        audience: "operator",
        title: "Request cancelled",
        body: "The rider cancelled this ticket — tap to view",
      });
    }
  }
  if (
    (status === STATUS_DISPATCH.RESOLVED ||
      status === STATUS_DISPATCH.CANCELLED) &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await providerRepository.findById(
      ticket.assignedShopId as string,
    );
    if (shop && shop.kind === PROVIDER_KIND.TOW && shop.accepting === false) {
      await providerRepository.update(shop.id, {accepting: true});
      cacheManager.del("shop");
      cacheManager.del("provider");
    }
  }
  if (status === STATUS_DISPATCH.RESOLVED &&
    ticket.ticketType === "TOW" &&
    typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" &&
    !Array.isArray(ticket.linkedTicketIds)) {
    try {
      await spawnShopTicket(id, ticket, ticket.destinationShopId as string);
    } catch {
      return {updated: 1};
    }
  }
  return {updated: 1};
};

const spawnShopTicket = async (
  parentId: string,
  ticket: {
    userId: string;
    lat: number;
    lng: number;
    vehicleType?: unknown;
    vehicleWidth?: unknown;
    vehicleClass?: unknown;
    vehicleLabel?: unknown;
  },
  shopId: string,
): Promise<void> => {
  const shop = await providerRepository.findById(shopId);
  if (!shop || shop.status !== PROVIDER_STATUS.ACTIVE) return;
  const child = await createDispatch({
    userId: ticket.userId,
    ticketType: "WALK_IN",
    lat: typeof shop.lat === "number" ? shop.lat : ticket.lat,
    lng: typeof shop.lng === "number" ? shop.lng : ticket.lng,
    providerId: shopId,
    ...(typeof ticket.vehicleType === "string" ?
      {vehicleType: ticket.vehicleType} :
      {}),
    ...(typeof ticket.vehicleWidth === "number" ?
      {vehicleWidth: ticket.vehicleWidth} :
      {}),
    ...(typeof ticket.vehicleLabel === "string" ?
      {vehicleLabel: ticket.vehicleLabel} :
      {}),
  });
  await dispatchRepository.update(parentId, {linkedTicketIds: [child.id]});
  await dispatchRepository.update(child.id, {linkedTicketIds: [parentId]});
  cacheManager.del(NS);
};


export const updateDispatchDestination = async ({
  userId,
  ticketId,
  destinationShopId,
  destinationPoint,
}: {
  userId: string;
  ticketId: string;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider edits the destination");
  }
  if (
    ticket.status !== STATUS_DISPATCH.PENDING &&
    ticket.status !== STATUS_DISPATCH.MATCHED &&
    ticket.status !== STATUS_DISPATCH.ARRIVED
  ) {
    throw new ValidationError("Ticket is no longer editable");
  }
  if (!destinationShopId && !destinationPoint) {
    throw new ValidationError("A destination needs a shop or a point");
  }
  if (ticket.ticketType === "WALK_IN") {
    throw new ValidationError("Walk-in tickets have no editable destination");
  }
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticket.ticketType as string,
    ticket.vehicleType ?? undefined,
  );
  await dispatchRepository.update(ticketId, {
    destinationShopId: destinationShopId ?? null,
    destinationPoint: destinationPoint ?? null,
    destinationSnapshot: destinationSnapshot ?? null,
  });
  cacheManager.del(NS);
  if (typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== "") {
    const dest = destinationSnapshot as {name?: unknown} | null;
    const name = dest !== null && typeof dest.name === "string" ?
      dest.name :
      null;
    await enqueueDispatchPush(ticketId, "-destination-updated", {
      audience: "operator",
      title: "Drop-off updated",
      body: name !== null ?
        `The rider changed the drop-off to ${name}` :
        "The rider changed the drop-off — tap to view",
    });
  }
  return dispatchRepository.findById(ticketId);
};
