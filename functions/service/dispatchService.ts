import * as dispatchRepository from "../repository/dispatchRepository";
import * as userRepository from "../repository/userRepository";
import * as providerRepository from "../repository/providerRepository";
import * as alleySegmentRepository from
  "../repository/alleySegmentRepository";
import * as volunteerLocationRepository from
  "../repository/volunteerLocationRepository";
import * as providerLocationRepository from
  "../repository/providerLocationRepository";
import * as fcmTokenRepository from "../repository/fcmTokenRepository";
import {nearProviders} from "./providerService";
import {enqueueDispatchPush} from "./taskQueueService";
import {messaging} from "../config/firebase";
import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  haversineMeters,
} from "../utils/geo";
import {
  HELPER_KIND,
  NEAR_SHOPS_MAX,
  PROVIDER_FRESH_MS,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  SERVICE_ROLE,
  STATUS_DISPATCH,
  VOLUNTEER_CAPABILITY,
  VOLUNTEER_DEFAULT_RADIUS,
  VOLUNTEER_FRESH_MS,
} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";
import {fcmEnabled} from "./pushService";
import {isCarVehicle} from "../utils/valhalla";

import {ForbiddenError, NotFoundError, ValidationError} from
  "../utils/errors";
import * as cacheManager from "../utils/cacheManager";

const VALID_STATUSES: string[] = Object.values(STATUS_DISPATCH);
const NS = "dispatch";
const SEND_CHUNK = 500;
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const resolveAccessWidth = async (
  alleySegmentId: string | undefined,
  accessWidthMeters: number | undefined,
): Promise<number | undefined> => {
  if (accessWidthMeters !== undefined) return accessWidthMeters;
  if (!alleySegmentId) return undefined;
  const segment = await alleySegmentRepository.findById(alleySegmentId);
  if (!segment) throw new NotFoundError("Alley segment not found");
  const width = segment.baseWidth as number | null;
  return typeof width === "number" ? width : undefined;
};

const resolveDestination = async (
  destinationShopId: string | undefined,
  destinationPoint:
    | {lat: number; lng: number; label?: string}
    | undefined,
  ticketType?: string,
): Promise<Record<string, unknown> | undefined> => {
  if (destinationShopId) {
    const shop = await providerRepository.findById(destinationShopId);
    if (!shop) throw new NotFoundError("Destination provider not found");
    if (shop.status !== PROVIDER_STATUS.ACTIVE ||
      (shop as {suspended?: boolean}).suspended === true) {
      throw new ValidationError("Destination provider is not available");
    }
    if (shop.kind !== PROVIDER_KIND.SHOP) {
      throw new ValidationError("Destination must be a repair shop");
    }
    if (ticketType && ticketType !== "TOW" && ticketType !== "MECHANIC") {
      throw new ValidationError("This ticket type takes no shop destination");
    }
    return {
      id: shop.id,
      name: shop.name,
      lat: shop.lat,
      lng: shop.lng,
      kind: shop.kind,
    };
  }
  if (destinationPoint) {
    return {
      lat: destinationPoint.lat,
      lng: destinationPoint.lng,
      label: destinationPoint.label ?? null,
      source: "point",
    };
  }
  return undefined;
};

const providerKindForTicket = (ticketType: unknown): string | null => {
  if (ticketType === "TOW") return PROVIDER_KIND.TOW;
  if (ticketType === "MECHANIC") return PROVIDER_KIND.SHOP;
  return null;
};

const requireProviderForTicket = (
  shop: {status?: unknown; kind?: unknown; suspended?: unknown},
  ticketType: unknown,
): void => {
  if (shop.status !== PROVIDER_STATUS.ACTIVE || shop.suspended === true) {
    throw new ForbiddenError("Provider is not available");
  }
  const expected = providerKindForTicket(ticketType);
  if (!expected) {
    throw new ForbiddenError("Tickets of this type are volunteer-only");
  }
  if (shop.kind !== expected) {
    throw new ValidationError(`Ticket needs a ${expected} provider`);
  }
};

const volunteerFitsTicket = (
  capability: unknown,
  vehicleType: string | undefined,
): boolean => {
  if (!isCarVehicle(vehicleType)) return true;
  return capability === VOLUNTEER_CAPABILITY.CAR;
};

const findCandidates = async ({
  lat,
  lng,
  radiusMeters = VOLUNTEER_DEFAULT_RADIUS,
  vehicleType,
}: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  vehicleType?: string;
}): Promise<string[]> => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const cells = cellsCoveringBounds(bounds, 6);
  const locations =
    await volunteerLocationRepository.findByGeohashPrefixes(cells);
  const cutoff = Date.now() - VOLUNTEER_FRESH_MS;
  const fresh = locations.filter((loc) => {
    if (Date.parse(loc.lastSeen) < cutoff) return false;
    return haversineMeters(lat, lng, loc.lat, loc.lng) <= radiusMeters;
  });
  if (fresh.length === 0) return [];
  const users = await userRepository.findByIds(
    fresh.map((loc) => loc.uid),
  );
  const eligible: string[] = [];
  for (const loc of fresh) {
    const user = users.get(loc.uid);
    if (!user) continue;
    if (user.volunteerAvailable !== true) continue;
    if (user.status && user.status !== "1") continue;
    if (!volunteerFitsTicket(user.capability, vehicleType)) continue;
    eligible.push(loc.uid);
  }
  const free: string[] = [];
  for (const uid of eligible) {
    const active = await dispatchRepository.findActiveForUid(uid);
    if (active.length === 0) free.push(uid);
  }
  return free;
};

const createDispatch = async ({
  userId,
  ticketType,
  lat,
  lng,
  diagnosticId,
  alleySegmentId,
  accessWidthMeters,
  note,
  destinationShopId,
  destinationPoint,
  vehicleType,
  vehicleWidth,
}: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
  alleySegmentId?: string;
  accessWidthMeters?: number;
  note?: string;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
  vehicleType?: string;
  vehicleWidth?: number;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (ticketType === "MECHANIC" && isCarVehicle(vehicleType)) {
    throw new ValidationError("Walk-in repair isn't available for cars");
  }
  if (ticketType === "TOW" && !destinationShopId && !destinationPoint) {
    throw new ValidationError("Tow tickets need a destination");
  }
  const width = await resolveAccessWidth(
    alleySegmentId,
    accessWidthMeters,
  );
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticketType,
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
    destinationShopId,
    destinationSnapshot,
    destinationPoint,
    vehicleType,
    vehicleWidth,
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
  cacheManager.del(NS);
  return ticket;
};

const getMyTicketsInner = async (userId: string) => {
  return dispatchRepository.findByUserId(userId);
};

const getMyTicketsCached = cacheManager.wrap(getMyTicketsInner, {
  namespace: NS,
  keyFn: (userId: string) => userId,
});

const getMyTickets = async (userId: string) => getMyTicketsCached(userId);

const getDispatch = async (id: string, userId: string) => {
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
        const held = Array.isArray(caller.services) ? caller.services : [];
        const operated =
          (await providerRepository.findByOperator(userId)) ?? [];
        const operates = held.includes(SERVICE_ROLE.VOLUNTEER) ?
          true :
          operated.some(
            (p) => p.status === PROVIDER_STATUS.ACTIVE,
          );
        if (!operates) {
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

const updateDispatchStatus = async ({
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
  let operator = false;
  if (
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await providerRepository.findById(ticket.assignedShopId);
    operator = !!shop && shop.operatorUid === userId;
  }
  if (
    ticket.userId !== userId &&
    ticket.assignedUid !== userId &&
    !operator &&
    caller.role !== ROLE_ADMIN
  ) {
    throw new ForbiddenError("Only the rider, helper, or operator updates");
  }
  await dispatchRepository.updateStatus(id, status);
  cacheManager.del(NS);
  if (
    status === STATUS_DISPATCH.MATCHED ||
    status === STATUS_DISPATCH.ARRIVED ||
    status === STATUS_DISPATCH.RESOLVED
  ) {
    await enqueueDispatchPush(id, `-status-${status}`);
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
  return {updated: 1};
};

const nearDispatchInner = async ({
  userId,
  lat,
  lng,
  radiusMeters = VOLUNTEER_DEFAULT_RADIUS,
  ticketType,
  limit = 50,
}: {
  userId?: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  ticketType?: string;
  limit?: number;
}) => {
  let capability: unknown;
  if (userId) {
    const me = await userRepository.findById(userId);
    if (!me) return [];
    if (me.volunteerAvailable === true) {
      capability = me.capability;
    } else {
      const operated =
        (await providerRepository.findByOperator(me.id)) ?? [];
      const activeTow = operated.some(
        (p) => p.kind === PROVIDER_KIND.TOW &&
          p.status === PROVIDER_STATUS.ACTIVE,
      );
      if (!activeTow) return [];
      capability = me.capability;
    }
  }
  const tickets = await dispatchRepository.findByStatus(
    STATUS_DISPATCH.PENDING,
  );
  return tickets
    .filter((t) => !ticketType || t.ticketType === ticketType)
    .filter((t) =>
      t.ticketType !== "SOS" ||
      volunteerFitsTicket(
        capability,
        t.vehicleType as string | undefined,
      ),
    )
    .map((t) => ({
      ...t,
      distance: haversineMeters(lat, lng, t.lat, t.lng),
    }))
    .filter((t) => (t.distance as number) <= radiusMeters)
    .sort((a, b) => (a.distance as number) - (b.distance as number))
    .slice(0, limit);
};

const nearDispatchCached = cacheManager.wrap(nearDispatchInner, {
  namespace: NS,
  keyFn: ({
    userId,
    lat,
    lng,
    radiusMeters = VOLUNTEER_DEFAULT_RADIUS,
    ticketType,
    limit = 50,
  }: {
    userId?: string;
    lat: number;
    lng: number;
    radiusMeters?: number;
    ticketType?: string;
    limit?: number;
  }) =>
    `${userId ?? "-"},${lat.toFixed(3)},${lng.toFixed(3)},` +
    `${radiusMeters},${ticketType ?? "-"},${limit}`,
});

const nearDispatch = async ({
  userId,
  lat,
  lng,
  radiusMeters = VOLUNTEER_DEFAULT_RADIUS,
  ticketType,
  limit = 50,
}: {
  userId?: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  ticketType?: string;
  limit?: number;
}) =>
  nearDispatchCached({userId, lat, lng, radiusMeters, ticketType, limit});

const dispatchOffers = async ({
  lat,
  lng,
  radiusMeters = VOLUNTEER_DEFAULT_RADIUS,
  kind,
  limit = NEAR_SHOPS_MAX,
  accessWidthMeters,
}: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  kind?: string;
  limit?: number;
  accessWidthMeters?: number;
}) => {
  const shops = await nearProviders({
    lat,
    lng,
    kind,
    radiusMeters,
    acceptingOnly: true,
    openOnly: false,
    limit,
  });
  const liveById = shops.length > 0 ?
    await providerLocationRepository.findByIds(shops.map((s) => s.id)) :
    new Map();
  const cutoff = Date.now() - PROVIDER_FRESH_MS;
  const withLive = shops.map((shop) => {
    const loc = liveById.get(shop.id);
    let plat = shop.lat as number;
    let plng = shop.lng as number;
    let live = false;
    if (shop.kind === PROVIDER_KIND.TOW && loc &&
      typeof loc.lat === "number" && typeof loc.lng === "number" &&
      Date.parse(loc.lastSeen) >= cutoff) {
      plat = loc.lat;
      plng = loc.lng;
      live = true;
    }
    const distance = live ?
      haversineMeters(lat, lng, plat, plng) :
      (shop.distance as number);
    return {...shop, lat: plat, lng: plng, distance, live};
  })
    .filter((s) => (s.distance as number) <= radiusMeters);
  withLive.sort((a, b) => (a.distance as number) - (b.distance as number));
  return withLive.slice(0, limit).map((shop) => {
    const towWidth = shop.vehicleWidth as number | null;
    const fitsAlley =
      shop.kind === PROVIDER_KIND.TOW &&
      typeof towWidth === "number" &&
      accessWidthMeters !== undefined ?
        towWidth <= accessWidthMeters :
        null;
    return {...shop, fitsAlley};
  });
};

const selectDispatch = async ({
  userId,
  ticketId,
  shopId,
}: {
  userId: string;
  ticketId: string;
  shopId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider selects a provider");
  }
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  if (shop.accepting === false) {
    throw new ValidationError("Provider is not accepting requests");
  }
  requireProviderForTicket(shop, ticket.ticketType);
  await dispatchRepository.update(ticketId, {
    suggestedShopId: shopId,
    suggestedTs: new Date().toISOString(),
  });
  cacheManager.del(NS);
  return {selected: shopId};
};

const acceptAsShop = async (
  userId: string,
  ticketId: string,
  shopId: string,
) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  const operator = shop.operatorUid as string | null;
  if (operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator accepts for this provider");
  }
  if (shop.accepting === false) {
    throw new ValidationError("Provider is not accepting requests");
  }
  requireProviderForTicket(shop, ticket.ticketType);
  if (shop.kind === PROVIDER_KIND.TOW &&
    (typeof shop.plate !== "string" ||
      shop.plate === "")) {
    throw new ForbiddenError("Approved tow provider required");
  }
  const claimed = await dispatchRepository.claimForAssignment(ticketId, {
    assignedShopId: shopId,
    assignedKind: HELPER_KIND.SHOP,
    status: STATUS_DISPATCH.MATCHED,
  });
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  if (shop.kind === PROVIDER_KIND.TOW) {
    await providerRepository.update(shopId, {accepting: false});
  }
  cacheManager.del(NS);
  cacheManager.del("shop");
  cacheManager.del("provider");
  return {matched: true, kind: HELPER_KIND.SHOP};
};

const acceptAsVolunteer = async (userId: string, ticketId: string) => {
  const me = await userRepository.findById(userId);
  if (!me) throw new NotFoundError("User not found");
  if (me.role !== ROLE_ADMIN) {
    const held = Array.isArray(me.services) ? me.services : [];
    if (!held.includes(SERVICE_ROLE.VOLUNTEER)) {
      throw new ForbiddenError("Volunteer license required");
    }
  }
  if (me.volunteerAvailable !== true) {
    throw new ForbiddenError("Volunteer mode is off");
  }
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (
    !volunteerFitsTicket(
      me.capability,
      ticket.vehicleType as string | undefined,
    )
  ) {
    throw new ForbiddenError("Ticket needs a car-capable volunteer");
  }
  const active = await dispatchRepository.findActiveForUid(userId);
  if (active.length > 0) {
    throw new ValidationError("Volunteer is already on a ticket");
  }
  const claimed = await dispatchRepository.claimForAssignment(ticketId, {
    assignedUid: userId,
    assignedKind: HELPER_KIND.VOLUNTEER,
    status: STATUS_DISPATCH.MATCHED,
  });
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  cacheManager.del(NS);
  return {matched: true, kind: HELPER_KIND.VOLUNTEER};
};

const acceptDispatch = async ({
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
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  if (shopId) return acceptAsShop(userId, ticketId, shopId);
  return acceptAsVolunteer(userId, ticketId);
};

const updateDispatchDestination = async ({
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
  const destinationSnapshot = await resolveDestination(
    destinationShopId,
    destinationPoint,
    ticket.ticketType as string,
  );
  await dispatchRepository.update(ticketId, {
    destinationShopId: destinationShopId ?? null,
    destinationPoint: destinationPoint ?? null,
    destinationSnapshot: destinationSnapshot ?? null,
  });
  cacheManager.del(NS);
  return dispatchRepository.findById(ticketId);
};

const STATUS_PUSH_BODY: Record<string, string> = {
  [STATUS_DISPATCH.MATCHED]: "A helper accepted your request — tap to view",
  [STATUS_DISPATCH.ARRIVED]: "Your helper has arrived",
  [STATUS_DISPATCH.RESOLVED]: "Your request was resolved",
};

const deliverStatusPush = async (
  ticket: Record<string, unknown> & {id: string},
): Promise<{delivered: number; skipped: boolean}> => {
  const body = STATUS_PUSH_BODY[ticket.status as string];
  if (!body || typeof ticket.userId !== "string") {
    return {delivered: 0, skipped: true};
  }
  const record = await fcmTokenRepository.findByUserId(ticket.userId);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  let delivered = 0;
  for (let i = 0; i < tokens.length; i += SEND_CHUNK) {
    const chunk = tokens.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((token) => ({
        token,
        notification: {
          title: "SOS update",
          body,
        },
        data: {
          ticketId: ticket.id,
          status: ticket.status as string,
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead: string[] = [];
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const token = chunk[idx];
        if (token !== undefined) dead.push(token);
      }
    });
    if (dead.length > 0 && typeof ticket.userId === "string") {
      await fcmTokenRepository.removeTokens(ticket.userId, dead);
    }
  }
  return {delivered, skipped: false};
};

const deliverDispatchPush = async (
  ticketId: string,
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {delivered: 0, skipped: true};
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    return deliverStatusPush(ticket);
  }
  let candidates = (ticket.candidates as string[] | undefined) ?? [];
  if (candidates.length === 0 && ticket.ticketType === "SOS") {
    candidates = await findCandidates({
      lat: ticket.lat,
      lng: ticket.lng,
      vehicleType: ticket.vehicleType as string | undefined,
    });
  }
  const targets: Array<{userId: string; token: string}> = [];
  for (const userId of candidates) {
    const record = await fcmTokenRepository.findByUserId(userId);
    for (const token of (record?.tokens as string[] | undefined) ?? []) {
      targets.push({userId, token});
    }
  }
  let delivered = 0;
  for (let i = 0; i < targets.length; i += SEND_CHUNK) {
    const chunk = targets.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map(({token}) => ({
        token,
        notification: {
          title: "SOS request near you",
          body: `${ticket.ticketType} help needed — tap to view`,
        },
        data: {
          ticketId: ticket.id,
          ticketType: ticket.ticketType,
          lat: String(ticket.lat),
          lng: String(ticket.lng),
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead = new Map<string, string[]>();
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const {userId, token} = chunk[idx];
        dead.set(userId, [...(dead.get(userId) ?? []), token]);
      }
    });
    for (const [userId, tokens] of dead) {
      await fcmTokenRepository.removeTokens(userId, tokens);
    }
  }
  return {delivered, skipped: false};
};

export {
  createDispatch,
  getMyTickets,
  getDispatch,
  updateDispatchStatus,
  nearDispatch,
  dispatchOffers,
  selectDispatch,
  acceptDispatch,
  updateDispatchDestination,
  findCandidates,
  deliverDispatchPush,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
