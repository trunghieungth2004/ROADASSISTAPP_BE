import * as dispatchRepository from "../../../repository/dispatchRepository";

import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from "../../../repository/providerRepository";


import {enqueueDispatchPush} from "../../taskQueueService";
import {normalizeWorkItems, workItemsTotal} from "./items";
import {findCandidates} from "../candidates";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as paymentService from "../../paymentService";
import * as refundService from "../../refundService";
import {FieldValue} from "../../../config/firebase";


import {MOBILE_TOW_OFFER_TTL_MS, NS} from "../constants";


import {
  PROVIDER_KIND,
  PROVIDER_STATUS,
  STATUS_DISPATCH,
} from "../../../constants/status";
import {PAYMENT_ACTIVE_STATUSES} from "../../../constants/payments";
import {ROLE_ADMIN} from "../../../constants/roles";

import {createDispatch} from "../tickets";
import {acceptDispatch} from "../accept";
import {continueSos} from "../sos";
import {mobileTowAvailabilityFor} from "../summary";

import {chatService} from "../../chatService";


import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";


export const setMobileShopFix = async ({
  userId,
  ticketId,
  fixAmount,
  items,
}: {
  userId: string;
  ticketId: string;
  fixAmount: number;
  items?: unknown;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "SOS") {
    throw new ValidationError("Mobile shop fees are SOS-only");
  }
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (shopId === "") {
    throw new ValidationError("Mobile shop is not assigned");
  }
  const shop = await providerRepository.findById(shopId);
  if (!shop || shop.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ForbiddenError("Only the mobile shop sets the fix fee");
  }
  if (shop.operatorUid !== userId) {
    const caller = await userRepository.findById(userId);
    if (!caller || caller.role !== ROLE_ADMIN) {
      throw new ForbiddenError("Only the mobile shop sets the fix fee");
    }
  }
  if (ticket.status !== STATUS_DISPATCH.ARRIVED) {
    throw new ValidationError("Set the fix fee after arriving on scene");
  }
  if (ticket.disputeHold === true) {
    throw new ValidationError("Dispute under review");
  }
  if (!Number.isInteger(fixAmount) || fixAmount < 0) {
    throw new ValidationError("Fix fee must be a non-negative integer");
  }
  const invoiceItems = items === undefined ?
    null :
    normalizeWorkItems(items, {
      services: (Array.isArray(shop.services) ? shop.services : []) as never,
      allowExtras: true,
      ...(typeof ticket.vehicleClass === "string" ?
        {vehicleClass: ticket.vehicleClass} : {}),
    });
  if (invoiceItems !== null && workItemsTotal(invoiceItems) !== fixAmount) {
    throw new ValidationError("Fix items must match the fix fee");
  }
  await dispatchRepository.update(ticketId, {
    finalAmount: fixAmount,
    ...(invoiceItems !== null ? {invoiceItems} : {}),
    mobileFixApprovedAt: null,
    mobileFixDeclinedAt: null,
    mobileFixDeclineReason: null,
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.QUOTED,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "The mobile shop sent a fix quote.",
    "MOBILE_FIX_QUOTED",
    {amount: fixAmount},
  );
  await enqueueDispatchPush(ticketId, `-status-9-${Date.now()}`);
  return {updated: 1};
};

export const approveMobileFix = async ({
  userId,
  ticketId,
}: {
  userId: string;
  ticketId: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "SOS") {
    throw new ValidationError("Mobile fix approval is SOS-only");
  }
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider approves the fix");
  }
  if (ticket.status !== STATUS_DISPATCH.QUOTED) {
    throw new ValidationError("No mobile fix awaiting approval");
  }
  if (ticket.disputeHold === true) {
    throw new ValidationError("Dispute under review");
  }
  const payments = await paymentRepository.findByTicketId(ticketId);
  let funded = payments.some((p) =>
    (p.method === "CASH" && (p.status === "PENDING" ||
      p.status === "CONFIRMED")) ||
    (p.method === "SEPAY" && (p.status === "HELD" ||
      p.status === "CONFIRMED")));
  const active = payments.some((p) =>
    PAYMENT_ACTIVE_STATUSES.includes(p.status));
  if (!funded && !active) {
    await paymentService.createPaymentForTicket({
      userId,
      ticketId,
      method: "CASH",
    });
    funded = true;
  }
  if (!funded) {
    throw new ValidationError("Payment required before approving the fix");
  }
  await dispatchRepository.update(ticketId, {
    mobileFixApprovedAt: new Date().toISOString(),
    fulfilledByShopId: ticket.assignedShopId ?? null,
  });
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.READY,
    userId,
  );
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "The rider approved the fix quote.",
    "MOBILE_FIX_APPROVED",
  );
  await enqueueDispatchPush(ticketId, "-status-7");
  await enqueueDispatchPush(
    ticketId,
    `-mobile-fix-approved-operator-${Date.now()}`,
    {
      audience: "operator",
      urgent: "true",
      title: "Fix quote approved",
      body: "The rider approved your fix quote — tap to view",
    },
  );
  return {approved: true};
};

export const declineMobileFix = async ({
  userId,
  ticketId,
  reason,
}: {
  userId: string;
  ticketId: string;
  reason?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "SOS") {
    throw new ValidationError("Mobile fix decline is SOS-only");
  }
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider declines the fix");
  }
  if (ticket.status !== STATUS_DISPATCH.QUOTED) {
    throw new ValidationError("No mobile fix awaiting approval");
  }
  if (ticket.disputeHold === true) {
    throw new ValidationError("Dispute under review");
  }
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (shopId === "") {
    throw new ValidationError("Mobile shop is not assigned");
  }
  const shop = await providerRepository.findById(shopId);
  if (!shop) throw new NotFoundError("Provider not found");
  const now = new Date().toISOString();
  const history = Array.isArray(ticket.mobileFeeHistory) ?
    [...ticket.mobileFeeHistory] :
    [];
  history.push({
    shopId,
    shopName: typeof shop.name === "string" ? shop.name : null,
    callOutFee: typeof ticket.mobileCallOutFee === "number" ?
      ticket.mobileCallOutFee :
      0,
    travelFee: typeof ticket.mobileTravelFee === "number" ?
      ticket.mobileTravelFee :
      0,
    waived: ticket.mobileCallOutWaived === true,
    fixAmount: typeof ticket.finalAmount === "number" ?
      ticket.finalAmount :
      null,
    items: Array.isArray(ticket.invoiceItems) ? ticket.invoiceItems : [],
    declinedAt: now,
    reason: typeof reason === "string" && reason.trim() !== "" ?
      reason.trim() :
      null,
  });
  const excludedShops = Array.isArray(ticket.excludedShopIds) ?
    [...ticket.excludedShopIds] :
    [];
  if (!excludedShops.includes(shopId)) excludedShops.push(shopId);
  const excludedOperators = Array.isArray(ticket.excludedOperatorUids) ?
    [...ticket.excludedOperatorUids] :
    [];
  if (typeof shop.operatorUid === "string" &&
    shop.operatorUid !== "" &&
    !excludedOperators.includes(shop.operatorUid)) {
    excludedOperators.push(shop.operatorUid);
  }
  const former = Array.isArray(ticket.formerAssignedShopIds) ?
    [...ticket.formerAssignedShopIds] :
    [];
  if (!former.includes(shopId)) former.push(shopId);
  const chatVersion = typeof ticket.chatVersion === "number" ?
    ticket.chatVersion :
    0;
  await chatService.addSystemEvent(
    ticketId,
    "The rider declined the fix quote.",
    "MOBILE_FIX_DECLINED",
    {
      ...(typeof reason === "string" && reason.trim() !== "" ?
        {reason: reason.trim()} :
        {}),
    },
  );
  const archived = await chatService.archiveTicketRoom({
    ticketId,
    version: chatVersion,
  }).catch(() => null);
  const candidates = await findCandidates({
    lat: ticket.lat,
    lng: ticket.lng,
    ...(typeof ticket.vehicleType === "string" ?
      {vehicleType: ticket.vehicleType} :
      {}),
    excludeOperatorUids: excludedOperators,
    excludeShopIds: excludedShops,
  }).catch(() => []);
  await dispatchRepository.update(ticketId, {
    assignedShopId: null,
    assignedUid: null,
    assignedKind: null,
    assignedAt: null,
    mobileCallOutFee: null,
    mobileCallOutWaived: null,
    mobileTravelFee: null,
    finalAmount: null,
    invoiceItems: null,
    mobileFeeHistory: history,
    mobileFixDeclinedAt: now,
    mobileFixDeclineReason: typeof reason === "string" &&
      reason.trim() !== "" ? reason.trim() : null,
    excludedShopIds: excludedShops,
    excludedOperatorUids: excludedOperators,
    formerAssignedShopIds: former,
    chatVersion: chatVersion + (archived !== null ? 1 : 0),
    ...(archived !== null ?
      {
        chatHistory: FieldValue.arrayUnion({
          version: chatVersion,
          roomId: archived.roomId,
          shopId,
          shopName: typeof shop.name === "string" ? shop.name : null,
          at: archived.at,
        }),
      } :
      {}),
    candidates,
    candidateTs: candidates.length > 0 ? now : null,
  });
  try {
    await paymentService.cancelPendingPayments(ticketId);
    const payments = await paymentRepository.findByTicketId(ticketId);
    for (const payment of payments) {
      if (payment.status === "HELD" ||
        payment.status === "CONFIRMED" ||
        payment.status === "PARTIAL") {
        await refundService.requestRefund({
          paymentId: payment.id,
          requestedBy: userId,
          automatic: true,
          reason: "Mobile fix declined",
        });
      }
    }
  } catch {
    void 0;
  }
  await dispatchRepository.updateStatus(
    ticketId,
    STATUS_DISPATCH.PENDING,
    userId,
  );
  cacheManager.del(NS);
  const pushAt = Date.now();
  await enqueueDispatchPush(ticketId, `-mobile-fix-declined-${pushAt}`);
  await enqueueDispatchPush(
    ticketId,
    `-mobile-fix-declined-shop-${pushAt}`,
    {
      audience: "shop",
      shopId,
      urgent: "true",
      title: "Fix quote declined",
      body: "The rider declined your fix quote — the request was " +
        "sent to another mobile shop.",
    },
  );
  return {declined: true};
};

export const offerMobileShopTow = async ({
  userId,
  ticketId,
  destinationShopId,
}: {
  userId: string;
  ticketId: string;
  destinationShopId?: string;
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.ticketType !== "SOS" ||
    ticket.status !== STATUS_DISPATCH.UNFIXABLE) {
    throw new ValidationError("Only unfixable SOS tickets take a tow offer");
  }
  if (typeof ticket.continuationTicketId === "string" &&
    ticket.continuationTicketId !== "") {
    throw new ValidationError("This SOS already continued");
  }
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (shopId === "") throw new ValidationError("Mobile shop is not assigned");
  const shop = await providerRepository.findById(shopId);
  if (!shop || shop.kind !== PROVIDER_KIND.MOBILE_SHOP) {
    throw new ForbiddenError("Only the mobile shop offers a tow");
  }
  if (shop.operatorUid !== userId) {
    const caller = await userRepository.findById(userId);
    if (!caller || caller.role !== ROLE_ADMIN) {
      throw new ForbiddenError("Only the mobile shop offers a tow");
    }
  }
  const operatorUid = typeof shop.operatorUid === "string" ?
    shop.operatorUid :
    "";
  if (destinationShopId !== undefined) {
    const dest = await providerRepository.findById(destinationShopId);
    if (!dest || dest.kind !== PROVIDER_KIND.SHOP ||
      dest.status !== PROVIDER_STATUS.ACTIVE ||
      (dest as {suspended?: boolean}).suspended === true ||
      dest.accepting === false) {
      throw new ValidationError("Destination shop is not accepting drop-offs");
    }
    if (operatorUid !== "" && dest.operatorUid !== operatorUid) {
      throw new ForbiddenError("Destination shop belongs to another operator");
    }
  }
  const availability = await mobileTowAvailabilityFor(ticket);
  if (!availability.available) {
    throw new ValidationError("No tow is available for this request");
  }
  const at = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + MOBILE_TOW_OFFER_TTL_MS,
  ).toISOString();
  await dispatchRepository.update(ticketId, {
    mobileTowOffer: {
      status: "PENDING",
      shopId,
      destinationShopId: destinationShopId ?? null,
      mode: availability.mode,
      towProviderId: availability.towProviderId,
      by: userId,
      at,
      expiresAt,
    },
  });
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    availability.mode === "NETWORK" ?
      "The mobile shop requested a network tow." :
      "The mobile shop offered a tow.",
    "TOW_OFFER",
    {shopId, expiresAt, mode: availability.mode},
  );
  await enqueueDispatchPush(ticketId, "-mobile-tow-offer", {
    audience: "rider",
    urgent: "true",
    title: availability.mode === "NETWORK" ? "Tow request" : "Tow offer",
    body: availability.mode === "NETWORK" ?
      "The mobile shop can arrange a tow — tap to confirm" :
      "The mobile shop can tow your vehicle — tap to review",
    action: "mobile-tow-offer",
  });
  await enqueueDispatchPush(
    ticketId,
    `-mobile-tow-expire-${Date.parse(at)}`,
    {action: "expire-mobile-tow-offer", offerAt: at},
    expiresAt,
  );
  return {offered: true, expiresAt, mode: availability.mode};
};

export const respondMobileShopTow = async ({
  userId,
  ticketId,
  accept,
  destinationShopId,
  destinationPoint,
}: {
  userId: string;
  ticketId: string;
  accept: boolean;
  destinationShopId?: string;
  destinationPoint?: {lat: number; lng: number; label?: string};
}) => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  if (ticket.userId !== userId) {
    throw new ForbiddenError("Only the rider answers the tow offer");
  }
  const offer = ticket.mobileTowOffer;
  if (!offer || offer.status !== "PENDING") {
    throw new ValidationError("No tow offer awaiting an answer");
  }
  if (!accept) {
    await dispatchRepository.update(ticketId, {
      mobileTowOffer: {...offer, status: "DECLINED"},
    });
    cacheManager.del(NS);
    await chatService.addSystemEvent(
      ticketId,
      "The rider declined the tow offer.",
      "TOW_DECLINED",
    );
    await enqueueDispatchPush(ticketId, "-mobile-tow-declined-shop", {
      audience: "operator",
      title: "Tow offer declined",
      body: "The rider declined the tow offer.",
    });
    const continuation = await continueSos({
      userId,
      ticketId,
      auto: true,
    });
    return {accepted: false, ...continuation};
  }
  const network = offer.mode === "NETWORK";
  if (!network && offer.mode !== "DIRECT") {
    throw new ValidationError("Tow offer is no longer available");
  }
  if (!network &&
    (typeof offer.towProviderId !== "string" || offer.towProviderId === "")) {
    throw new ValidationError("Tow offer is no longer available");
  }
  const destinationId = destinationShopId ?? offer.destinationShopId ?? "";
  if (destinationId === "" && destinationPoint === undefined) {
    throw new ValidationError("Choose a destination for the tow");
  }
  if (destinationId !== "") {
    const dest = await providerRepository.findById(destinationId);
    if (!dest || dest.kind !== PROVIDER_KIND.SHOP ||
      dest.status !== PROVIDER_STATUS.ACTIVE ||
      (dest as {suspended?: boolean}).suspended === true ||
      dest.accepting === false) {
      throw new ValidationError("Destination shop is not accepting drop-offs");
    }
  }
  let towOperatorUid = "";
  if (!network) {
    const towProviderId = offer.towProviderId as string;
    const tow = await providerRepository.findById(towProviderId);
    if (!tow || tow.kind !== PROVIDER_KIND.TOW ||
      tow.status !== PROVIDER_STATUS.ACTIVE ||
      (tow as {suspended?: boolean}).suspended === true ||
      tow.accepting === false) {
      throw new ValidationError("Tow vehicle is no longer available");
    }
    const active = (await dispatchRepository.findActiveForShop(tow.id)) ?? [];
    if (active.length > 0) {
      throw new ValidationError("Tow vehicle is no longer available");
    }
    towOperatorUid = typeof tow.operatorUid === "string" ? tow.operatorUid : "";
  }
  const created = await createDispatch({
    userId,
    ticketType: "TOW",
    lat: ticket.lat,
    lng: ticket.lng,
    diagnosticId: typeof ticket.diagnosticId === "string" ?
      ticket.diagnosticId :
      undefined,
    note: typeof ticket.note === "string" ? ticket.note : undefined,
    description: typeof ticket.description === "string" ?
      ticket.description :
      undefined,
    photoUrls: Array.isArray(ticket.photoUrls) ? ticket.photoUrls : [],
    ...(!network ? {providerId: offer.towProviderId as string} : {}),
    addressedTow: !network,
    sourceTicketId: ticketId,
    allowMissingVehicle: true,
    ...(destinationId !== "" ?
      {destinationShopId: destinationId} :
      destinationPoint !== undefined ? {destinationPoint} : {}),
    ...(typeof ticket.vehicleId === "string" ?
      {vehicleId: ticket.vehicleId} :
      {}),
    vehicleType: ticket.vehicleType ?? undefined,
    vehicleWidth: typeof ticket.vehicleWidth === "number" ?
      ticket.vehicleWidth :
      undefined,
    vehicleLabel: ticket.vehicleLabel ?? undefined,
  });
  if (!network) {
    try {
      await acceptDispatch({
        userId: towOperatorUid,
        ticketId: created.id,
        shopId: offer.towProviderId as string,
      });
    } catch (err) {
      await dispatchRepository.updateStatus(
        created.id,
        STATUS_DISPATCH.CANCELLED,
        userId,
      );
      await dispatchRepository.update(created.id, {
        cancelledBy: userId,
        linkedTicketIds: [],
      });
      throw err;
    }
  }
  const sosLinks = Array.isArray(ticket.linkedTicketIds) ?
    ticket.linkedTicketIds as string[] :
    [];
  await dispatchRepository.update(ticketId, {
    mobileTowOffer: {...offer, status: "ACCEPTED"},
    linkedTicketIds: [
      ...sosLinks.filter((id) => id !== created.id),
      created.id,
    ],
  });
  await dispatchRepository.update(created.id, {
    linkedTicketIds: [ticketId],
  });
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    network ?
      "The rider confirmed a network tow request." :
      "The rider accepted the tow offer.",
    "TOW_ACCEPTED",
    {ticketId: created.id, mode: network ? "NETWORK" : "DIRECT"},
  );
  if (network) {
    await enqueueDispatchPush(ticketId, "-mobile-tow-network-shop", {
      audience: "operator",
      title: "Tow requested",
      body: "The rider confirmed. We are finding a tow truck.",
    });
    await enqueueDispatchPush(created.id, "-mobile-tow-network-rider", {
      audience: "rider",
      urgent: "true",
      title: "Finding a tow truck",
      body: "Your tow request is live — a tow truck can accept it.",
    });
  } else {
    await enqueueDispatchPush(created.id, "-mobile-tow-assigned", {
      audience: "operator",
      title: "Tow job assigned",
      body: "The rider accepted your tow offer.",
    });
  }
  return {
    accepted: true,
    ticketId: created.id,
    ...(network ? {network: true} : {}),
  };
};
