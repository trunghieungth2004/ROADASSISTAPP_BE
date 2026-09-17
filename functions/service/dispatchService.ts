import * as dispatchRepository from "../repository/dispatchRepository";
import * as userRepository from "../repository/userRepository";
import * as shopRepository from "../repository/shopRepository";
import * as alleySegmentRepository from
  "../repository/alleySegmentRepository";
import * as volunteerLocationRepository from
  "../repository/volunteerLocationRepository";
import * as fcmTokenRepository from "../repository/fcmTokenRepository";
import {nearShops} from "./shopService";
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

const VALID_STATUSES: string[] = Object.values(STATUS_DISPATCH);
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
): Promise<Record<string, unknown> | undefined> => {
  if (destinationShopId) {
    const shop = await shopRepository.findById(destinationShopId);
    if (!shop) throw new NotFoundError("Destination shop not found");
    return {
      id: shop.id,
      name: shop.name,
      lat: shop.lat,
      lng: shop.lng,
      type: shop.type,
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
      const refreshed = await dispatchRepository.findById(ticket.id);
      return refreshed ?? ticket;
    }
  }
  return ticket;
};

const getMyTickets = async (userId: string) => {
  return dispatchRepository.findByUserId(userId);
};

const getDispatch = async (id: string, userId: string) => {
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId === userId) return ticket;
  if (ticket.assignedUid === userId) return ticket;
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role === ROLE_ADMIN) return ticket;
  if (
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await shopRepository.findById(ticket.assignedShopId);
    if (shop && shop.operatorUid === userId) return ticket;
  }
  const held = Array.isArray(caller.services) ? caller.services : [];
  if (
    held.includes(SERVICE_ROLE.VOLUNTEER) ||
    held.includes(SERVICE_ROLE.SHOP)
  ) {
    return ticket;
  }
  throw new ForbiddenError("Only ticket participants or providers view this");
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
    const shop = await shopRepository.findById(ticket.assignedShopId);
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
  if (
    (status === STATUS_DISPATCH.RESOLVED ||
      status === STATUS_DISPATCH.CANCELLED) &&
    typeof ticket.assignedShopId === "string" &&
    ticket.assignedShopId !== ""
  ) {
    const shop = await shopRepository.findById(
      ticket.assignedShopId as string,
    );
    if (shop && shop.type === "TOW" && shop.accepting === false) {
      await shopRepository.update(shop.id, {accepting: true});
    }
  }
  return {updated: 1};
};

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
}) => {
  const pending = await dispatchRepository.findByStatus(
    STATUS_DISPATCH.PENDING,
  );
  let capability: unknown;
  if (userId) {
    const me = await userRepository.findById(userId);
    capability = me?.capability;
  }
  return pending
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
  const shops = await nearShops({
    lat,
    lng,
    type: kind,
    radiusMeters,
    acceptingOnly: true,
    openOnly: false,
    limit,
  });
  return shops.map((shop) => {
    const towWidth = shop.towVehicleWidth as number | null;
    const fitsAlley =
      shop.type === "TOW" &&
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
  const shop = await shopRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Shop not found");
  if (shop.accepting === false) {
    throw new ValidationError("Shop is not accepting requests");
  }
  await dispatchRepository.update(ticketId, {
    suggestedShopId: shopId,
    suggestedTs: new Date().toISOString(),
  });
  return {selected: shopId};
};

const acceptAsShop = async (
  userId: string,
  ticketId: string,
  shopId: string,
) => {
  const shop = await shopRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Shop not found");
  const caller = await userRepository.findById(userId);
  if (!caller) throw new NotFoundError("User not found");
  if (caller.role !== ROLE_ADMIN) {
    const held = Array.isArray(caller.services) ? caller.services : [];
    if (!held.includes(SERVICE_ROLE.SHOP)) {
      throw new ForbiddenError("Shop license required");
    }
  }
  const operator = shop.operatorUid as string | null;
  if (operator && operator !== userId && caller.role !== ROLE_ADMIN) {
    throw new ForbiddenError("Only the operator accepts for this shop");
  }
  if (shop.accepting === false) {
    throw new ValidationError("Shop is not accepting requests");
  }
  await dispatchRepository.update(ticketId, {
    assignedShopId: shopId,
    assignedKind: HELPER_KIND.SHOP,
    status: STATUS_DISPATCH.MATCHED,
  });
  if (shop.type === "TOW") {
    await shopRepository.update(shopId, {accepting: false});
  }
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
  await dispatchRepository.update(ticketId, {
    assignedUid: userId,
    assignedKind: HELPER_KIND.VOLUNTEER,
    status: STATUS_DISPATCH.MATCHED,
  });
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
  );
  await dispatchRepository.update(ticketId, {
    destinationShopId: destinationShopId ?? null,
    destinationPoint: destinationPoint ?? null,
    destinationSnapshot: destinationSnapshot ?? null,
  });
  return dispatchRepository.findById(ticketId);
};

const deliverDispatchPush = async (
  ticketId: string,
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {delivered: 0, skipped: true};
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    return {delivered: 0, skipped: true};
  }
  let candidates = (ticket.candidates as string[] | undefined) ?? [];
  if (candidates.length === 0) {
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
