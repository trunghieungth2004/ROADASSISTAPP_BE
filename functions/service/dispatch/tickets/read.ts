import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {currentWaitingFee} from "../waiting";
import {NS} from "../constants";


import {
  linkedSummaryFor,
  mobileTowAvailabilityFor,
  sosCallOutTotalFor,
} from "../summary";


import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";

import {ForbiddenError, NotFoundError} from "../../../utils/errors";

import * as cacheManager from "../../../utils/cacheManager";


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
        const destId = typeof ticket.destinationShopId === "string" &&
          ticket.destinationShopId !== "" ?
          ticket.destinationShopId :
          "";
        if (destId !== "") {
          const dest = await providerRepository.findById(destId);
          operator = !!dest && dest.operatorUid === userId;
        }
      }
      if (!operator) {
        const former = Array.isArray(ticket.formerAssignedShopIds) ?
          ticket.formerAssignedShopIds.filter(
            (id): id is string => typeof id === "string" && id !== "",
          ) :
          [];
        if (former.length > 0) {
          const operated = (await providerRepository.findByOperator(
            userId,
          )) ?? [];
          operator = operated.some((provider) => former.includes(provider.id));
        }
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
  let canSeeLinked = ticket.userId === userId ||
    ticket.assignedUid === userId;
  if (!canSeeLinked) {
    const caller = await userRepository.findById(userId);
    if (caller?.role === ROLE_ADMIN) {
      canSeeLinked = true;
    } else if (typeof ticket.assignedShopId === "string" &&
      ticket.assignedShopId !== "") {
      const shop = await providerRepository.findById(ticket.assignedShopId);
      canSeeLinked = !!shop && shop.operatorUid === userId;
    }
  }
  let out: Record<string, unknown> = {...ticket};
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
      out = {...out, towPlate: shop.plate};
    }
  }
  try {
    const fee = await currentWaitingFee({
      id: ticket.id,
      lat: ticket.lat,
      lng: ticket.lng,
      assignedShopId: ticket.assignedShopId,
      waiting: ticket.waiting,
    });
    if (fee !== null) {
      const towFare =
        (out.towFare as Record<string, unknown> | null | undefined) ??
        (ticket.towFare as Record<string, unknown> | null | undefined);
      if (towFare && typeof towFare === "object") {
        out = {...out, towFare: {...towFare, waitingFee: fee}};
      } else if (fee !== null) {
        out = {...out, towFare: {waitingFee: fee}};
      }
    }
  } catch {
    return out;
  }
  try {
    if (canSeeLinked) {
      const summary = await linkedSummaryFor(ticket);
      if (summary !== null) out = {...out, linkedSummary: summary};
    }
    if (ticket.ticketType === "SOS" &&
      ticket.status === STATUS_DISPATCH.UNFIXABLE &&
      !ticket.continuationTicketId) {
      const availability = await mobileTowAvailabilityFor(ticket);
      out = {
        ...out,
        mobileTowAvailable: availability.available,
        mobileTowMode: availability.mode,
        mobileTowState: availability.state,
      };
    }
    if (ticket.ticketType === "SOS") {
      out = {...out, sosCallOutTotal: await sosCallOutTotalFor(ticket)};
    }
  } catch {
    void 0;
  }
  if (ticket.userId !== userId) {
    const caller = await userRepository.findById(userId);
    if (caller?.role !== ROLE_ADMIN) {
      const former = Array.isArray(ticket.formerAssignedShopIds) ?
        ticket.formerAssignedShopIds.filter(
          (id): id is string => typeof id === "string" && id !== "",
        ) :
        [];
      const operated = former.length > 0 ?
        (await providerRepository.findByOperator(userId)) ?? [] :
        [];
      const isFormer = operated.some((provider) =>
        former.includes(provider.id));
      if (!isFormer) {
        delete out.towCancelHistory;
        delete out.destinationDecline;
        delete out.chatHistory;
      }
    }
  }
  return out;
};
