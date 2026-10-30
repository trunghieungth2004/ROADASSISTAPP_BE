import * as dispatchRepository from "../../repository/dispatchRepository";
import * as providerRepository from "../../repository/providerRepository";
import * as userRepository from "../../repository/userRepository";
import * as cacheManager from "../../utils/cacheManager";
import {db} from "../../config/firebase";
import {createDispatch} from "./tickets";
import {findCandidates} from "./candidates";
import {enqueueDispatchPush} from "../taskQueueService";
import {chatService} from "../chatService";
import {
  MOBILE_TOW_OFFER_TTL_MS,
  NS,
  SOS_AUTO_CONTINUATION_LIMIT,
  UNFIX_GRACE_MS,
} from "./constants";
import {
  MOBILE_SHOP_CALL_OUT_FEE,
  STATUS_DISPATCH,
} from "../../constants/status";
import {ROLE_ADMIN} from "../../constants/roles";
import {ForbiddenError, NotFoundError, ValidationError} from
  "../../utils/errors";

type ContinuationResult = {
  ticketId?: string;
  attempt?: number;
  callOutTotal?: number;
  automatic?: boolean;
  requiresContinuationConfirmation?: boolean;
  noCandidates?: boolean;
  nextAttempt?: number;
};

const callOutTotalFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<number> => {
  let total = 0;
  let current: dispatchRepository.DispatchTicket | null = ticket;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.ticketType === "SOS") {
      total += typeof current.mobileCallOutFee === "number" ?
        current.mobileCallOutFee :
        MOBILE_SHOP_CALL_OUT_FEE;
    }
    const parentId: string = typeof current.continuedFromTicketId === "string" ?
      current.continuedFromTicketId :
      "";
    current = parentId === "" ?
      null :
      await dispatchRepository.findById(parentId);
  }
  return total;
};

const hasActiveTowOffer = (
  ticket: dispatchRepository.DispatchTicket,
): boolean => {
  const offer = ticket.mobileTowOffer;
  return offer !== null && offer !== undefined &&
    (offer.status === "PENDING" || offer.status === "ACCEPTED");
};

const excludedShops = (
  ticket: dispatchRepository.DispatchTicket,
): {shopIds: string[]; operatorUids: string[]} => {
  const shopIds = Array.isArray(ticket.excludedShopIds) ?
    [...ticket.excludedShopIds] :
    [];
  const operatorUids = Array.isArray(ticket.excludedOperatorUids) ?
    [...ticket.excludedOperatorUids] :
    [];
  const assignedShopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (assignedShopId !== "" && !shopIds.includes(assignedShopId)) {
    shopIds.push(assignedShopId);
  }
  return {shopIds, operatorUids};
};

const addOperatorForShop = async (
  shopId: string,
  operatorUids: string[],
): Promise<string[]> => {
  if (shopId === "") return operatorUids;
  const shop = await providerRepository.findById(shopId);
  const operatorUid = shop && typeof shop.operatorUid === "string" ?
    shop.operatorUid :
    "";
  if (operatorUid === "" || operatorUids.includes(operatorUid)) {
    return operatorUids;
  }
  return [...operatorUids, operatorUid];
};

export const continueSos = async ({
  userId,
  ticketId,
  auto = false,
}: {
  userId: string;
  ticketId: string;
  auto?: boolean;
}): Promise<ContinuationResult> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  const caller = await userRepository.findById(userId);
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  const shop = shopId !== "" ?
    await providerRepository.findById(shopId) :
    null;
  const isRider = ticket.userId === userId;
  const isOperator = shop !== null && shop.operatorUid === userId;
  const isAdmin = caller?.role === ROLE_ADMIN;
  if (!isRider && !isOperator && !isAdmin) {
    throw new ForbiddenError(
      "Only the rider or assigned shop continues this SOS",
    );
  }
  if (ticket.ticketType !== "SOS" ||
    ticket.status !== STATUS_DISPATCH.UNFIXABLE) {
    throw new ValidationError("Only unfixable SOS tickets continue");
  }
  if (hasActiveTowOffer(ticket)) {
    throw new ValidationError("A tow offer is already active");
  }
  const existing = typeof ticket.continuationTicketId === "string" ?
    ticket.continuationTicketId :
    "";
  const attempt = typeof ticket.sosAttempt === "number" ?
    ticket.sosAttempt :
    1;
  const priorTotal = await callOutTotalFor(ticket);
  const total = priorTotal + MOBILE_SHOP_CALL_OUT_FEE;
  if (existing !== "") {
    return {
      ticketId: existing,
      attempt: attempt + 1,
      callOutTotal: total,
      automatic: auto,
    };
  }
  if (auto && attempt > SOS_AUTO_CONTINUATION_LIMIT) {
    return {
      requiresContinuationConfirmation: true,
      nextAttempt: attempt + 1,
      callOutTotal: priorTotal,
    };
  }
  const excluded = excludedShops(ticket);
  const operatorUids = await addOperatorForShop(
    typeof ticket.assignedShopId === "string" ? ticket.assignedShopId : "",
    excluded.operatorUids,
  );
  const candidates = await findCandidates({
    lat: ticket.lat,
    lng: ticket.lng,
    vehicleType: ticket.vehicleType ?? undefined,
    excludeOperatorUids: operatorUids,
    excludeShopIds: excluded.shopIds,
  });
  const noCandidates = candidates.length === 0;
  const childId = db.collection("dispatch_tickets").doc().id;
  const parentRef = db.collection("dispatch_tickets").doc(ticketId);
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(parentRef);
    const data = snap.data() as
      {continuationTicketId?: unknown} | undefined;
    const current = typeof data?.continuationTicketId === "string" ?
      data.continuationTicketId :
      "";
    if (current !== "") return {existing: current};
    tx.update(parentRef, {continuationTicketId: childId});
    return {childId};
  });
  if ("existing" in claim) {
    return {
      ticketId: claim.existing,
      attempt: attempt + 1,
      callOutTotal: total,
      automatic: auto,
    };
  }
  try {
    const child = await createDispatch({
      userId,
      ticketType: "SOS",
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
      ...(typeof ticket.vehicleId === "string" ?
        {vehicleId: ticket.vehicleId} :
        {}),
      vehicleType: ticket.vehicleType ?? undefined,
      vehicleWidth: typeof ticket.vehicleWidth === "number" ?
        ticket.vehicleWidth :
        undefined,
      vehicleLabel: ticket.vehicleLabel ?? undefined,
      continuedFromTicketId: ticketId,
      sosAttempt: attempt + 1,
      allowMissingVehicle: true,
      excludedShopIds: excluded.shopIds,
      excludedOperatorUids: operatorUids,
      id: childId,
    });
    const links = Array.isArray(ticket.linkedTicketIds) ?
      ticket.linkedTicketIds :
      [];
    await dispatchRepository.update(ticketId, {
      linkedTicketIds: [
        ...links.filter((id) => id !== child.id),
        child.id,
      ],
    });
    await dispatchRepository.update(child.id, {
      linkedTicketIds: [ticketId],
    });
    await chatService.addSystemEvent(
      ticketId,
      "Requesting another mobile shop.",
      "SOS_CONTINUED",
      {ticketId: child.id, attempt: attempt + 1},
    );
    await enqueueDispatchPush(ticketId, "-sos-continued-rider", {
      audience: "rider",
      title: "Requesting another mobile shop",
      body: "We are sending your SOS to another mobile shop.",
    });
    cacheManager.del(NS);
    return {
      ticketId: child.id,
      attempt: attempt + 1,
      callOutTotal: total,
      automatic: auto,
      ...(noCandidates ? {noCandidates: true} : {}),
    };
  } catch (err) {
    await dispatchRepository.update(ticketId, {
      continuationTicketId: null,
    });
    throw err;
  }
};

export const expireMobileTowOffer = async (
  ticketId: string,
  offerAt: string,
): Promise<{expired: boolean; continuation?: ContinuationResult}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket) return {expired: false};
  const offer = ticket.mobileTowOffer;
  if (!offer || offer.status !== "PENDING" || offer.at !== offerAt) {
    return {expired: false};
  }
  const expiresAt = typeof offer.expiresAt === "string" ?
    offer.expiresAt :
    new Date(Date.parse(offer.at) + MOBILE_TOW_OFFER_TTL_MS).toISOString();
  if (Date.parse(expiresAt) > Date.now()) return {expired: false};
  await dispatchRepository.update(ticketId, {
    mobileTowOffer: {...offer, status: "EXPIRED"},
  });
  cacheManager.del(NS);
  await chatService.addSystemEvent(
    ticketId,
    "Tow offer expired.",
    "TOW_EXPIRED",
  );
  await enqueueDispatchPush(ticketId, "-mobile-tow-expired-shop", {
    audience: "operator",
    title: "Tow offer expired",
    body: "The rider did not answer the tow offer.",
  });
  const attempt = typeof ticket.sosAttempt === "number" ?
    ticket.sosAttempt :
    1;
  if (attempt > SOS_AUTO_CONTINUATION_LIMIT) {
    await enqueueDispatchPush(ticketId, "-mobile-tow-expired-rider", {
      audience: "rider",
      urgent: "true",
      title: "Tow offer expired",
      body: "Request another mobile shop or a tow.",
    });
    return {expired: true};
  }
  const continuation = await continueSos({
    userId: ticket.userId,
    ticketId,
    auto: true,
  });
  if (continuation.ticketId !== undefined) {
    await enqueueDispatchPush(ticketId, "-mobile-tow-expired-rider", {
      audience: "rider",
      urgent: "true",
      title: "Requesting another mobile shop",
      body: "We are sending your SOS to another mobile shop.",
    });
  } else if (continuation.noCandidates === true) {
    await enqueueDispatchPush(ticketId, "-mobile-tow-expired-rider", {
      audience: "rider",
      urgent: "true",
      title: "No other mobile shops nearby",
      body: "Request a tow instead.",
    });
  }
  return {expired: true, continuation};
};

export const continueUnfixIfNeeded = async (
  ticketId: string,
  unfixAt: string,
): Promise<{continued: boolean; continuation?: ContinuationResult}> => {
  const ticket = await dispatchRepository.findById(ticketId);
  if (!ticket || ticket.status !== STATUS_DISPATCH.UNFIXABLE) {
    return {continued: false};
  }
  if (ticket.unfixGraceAt !== unfixAt) return {continued: false};
  if (typeof ticket.continuationTicketId === "string" &&
    ticket.continuationTicketId !== "") {
    return {continued: false};
  }
  const offer = ticket.mobileTowOffer;
  if (offer && (offer.status === "PENDING" || offer.status === "ACCEPTED")) {
    return {continued: false};
  }
  const continuation = await continueSos({
    userId: ticket.userId,
    ticketId,
    auto: true,
  });
  if (continuation.ticketId !== undefined) {
    await dispatchRepository.update(ticketId, {unfixGraceAt: null});
    await enqueueDispatchPush(ticketId, "-unfix-continued-rider", {
      audience: "rider",
      urgent: "true",
      title: "Requesting another mobile shop",
      body: "We are sending your SOS to another mobile shop.",
    });
    return {continued: true, continuation};
  }
  if (continuation.noCandidates === true) {
    await dispatchRepository.update(ticketId, {unfixGraceAt: null});
    await enqueueDispatchPush(ticketId, "-unfix-no-candidates", {
      audience: "rider",
      urgent: "true",
      title: "No other mobile shops nearby",
      body: "Request a tow instead.",
    });
  } else if (continuation.requiresContinuationConfirmation === true) {
    await dispatchRepository.update(ticketId, {unfixGraceAt: null});
    await enqueueDispatchPush(ticketId, "-unfix-continue-rider", {
      audience: "rider",
      urgent: "true",
      title: "Request another mobile shop",
      body: "Tap to request another mobile shop.",
    });
  }
  return {continued: false, continuation};
};

export const sweepUnfixGrace = async (): Promise<{continued: number}> => {
  const tickets = await dispatchRepository.findByStatusForTypes(
    STATUS_DISPATCH.UNFIXABLE,
    ["SOS"],
    100,
  );
  let continued = 0;
  for (const ticket of tickets) {
    const at = ticket.unfixGraceAt;
    if (typeof at !== "string" || at === "") continue;
    if (Date.now() - Date.parse(at) < UNFIX_GRACE_MS) continue;
    try {
      const result = await continueUnfixIfNeeded(ticket.id, at);
      if (result.continued) continued += 1;
    } catch {
      continue;
    }
  }
  return {continued};
};

export const sweepMobileTowOffers = async (): Promise<{expired: number}> => {
  const tickets = await dispatchRepository.findByStatusForTypes(
    STATUS_DISPATCH.UNFIXABLE,
    ["SOS"],
    100,
  );
  let expired = 0;
  for (const ticket of tickets) {
    const offer = ticket.mobileTowOffer;
    if (!offer || offer.status !== "PENDING") continue;
    const expiresAt = typeof offer.expiresAt === "string" ?
      offer.expiresAt :
      new Date(Date.parse(offer.at) + MOBILE_TOW_OFFER_TTL_MS).toISOString();
    if (Date.parse(expiresAt) > Date.now()) continue;
    try {
      const result = await expireMobileTowOffer(ticket.id, offer.at);
      if (result.expired) expired += 1;
    } catch {
      continue;
    }
  }
  return {expired};
};

export {callOutTotalFor};
