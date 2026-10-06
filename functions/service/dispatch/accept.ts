import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as providerRepository from
  "../../repository/providerRepository";
import {isOpenNow} from "../providerService";
import {enqueueDispatchPush} from "../taskQueueService";
import {NS} from "./constants";
import {requireProviderForTicket, volunteerFitsTicket} from "./helpers";
import {
  HELPER_KIND,
  PROVIDER_KIND,
  SERVICE_ROLE,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";
import * as cacheManager from "../../utils/cacheManager";

export const acceptAsShop = async (
  userId: string,
  ticketId: string,
  shopId: string,
  now?: Date,
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
  if (ticket.ticketType === "WALK_IN" &&
    isOpenNow(shop.openHours as string | null, now) === false) {
    throw new ValidationError("Shop is currently closed");
  }
  if (typeof ticket.providerId === "string" && ticket.providerId !== "" &&
    ticket.providerId !== shopId) {
    throw new ForbiddenError("Ticket is addressed to another provider");
  }
  if (shop.kind === PROVIDER_KIND.TOW &&
    (typeof shop.plate !== "string" ||
      shop.plate === "")) {
    throw new ForbiddenError("Approved tow provider required");
  }
  const claimed = await dispatchRepository.claimForAssignment(ticketId, {
    assignedShopId: shopId,
    assignedKind: HELPER_KIND.SHOP,
    status: STATUS_DISPATCH.MATCHED,
    ...(ticket.ticketType === "WALK_IN" &&
    typeof shop.serviceFee === "number" ?
      {priceEstimate: shop.serviceFee, priceCurrency: "VND"} :
      {}),
  }, userId);
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  if (shop.kind === PROVIDER_KIND.TOW) {
    await providerRepository.update(shopId, {accepting: false});
  }
  cacheManager.del(NS);
  cacheManager.del("shop");
  cacheManager.del("provider");
  await enqueueDispatchPush(ticketId);
  return {matched: true, kind: HELPER_KIND.SHOP};
};


export const acceptAsVolunteer = async (userId: string, ticketId: string) => {
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
  }, userId);
  if (!claimed) {
    throw new ValidationError("Ticket is no longer pending");
  }
  cacheManager.del(NS);
  await enqueueDispatchPush(ticketId);
  return {matched: true, kind: HELPER_KIND.VOLUNTEER};
};


export const acceptDispatch = async ({
  userId,
  ticketId,
  shopId,
  now,
}: {
  userId: string;
  ticketId: string;
  shopId?: string;
  now?: Date;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.status !== STATUS_DISPATCH.PENDING) {
    throw new ValidationError("Ticket is no longer pending");
  }
  if (shopId) return acceptAsShop(userId, ticketId, shopId, now);
  return acceptAsVolunteer(userId, ticketId);
};
