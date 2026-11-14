import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import * as platformConfigService from "../../platformConfigService";
import {chatService} from "../../chatService";
import {enqueueDispatchPush} from "../../taskQueueService";
import {autoFile, bumpCancelCounters} from "../../disputeService";
import {stopWaiting} from "../waiting";
import {NS, TOWER_CANCEL_SOURCE, TOWER_SEARCH_ACTIVE} from "../constants";
import {
  ACCUSED_KIND,
  DISPUTE_REASON,
  DISPUTE_TYPE,
} from "../../../constants/disputes";
import {PROVIDER_KIND, STATUS_DISPATCH} from "../../../constants/status";
import {FieldValue} from "../../../config/firebase";
import {vehicleClassOf} from "../../providerService";
import {freezeTowLeg, trackedDeadheadKm, trackedLoadedKm} from "../helpers";
import {
  actualDeadheadKm,
  DEFAULT_TOW_RATES,
  isNightFare,
  partialTowFare,
  type TowFareQuote,
} from "../fare";
import {findTowOperators} from "../candidates";
import {
  NotFoundError,
  ValidationError,
} from "../../../utils/errors";
import * as cacheManager from "../../../utils/cacheManager";

const historyAmountOf = (ticket: dispatchRepository.DispatchTicket): number => {
  if (!Array.isArray(ticket.towFeeHistory)) return 0;
  return ticket.towFeeHistory.reduce((sum, entry) => {
    if (typeof entry !== "object" || entry === null) return sum;
    const value = (entry as {amount?: unknown}).amount;
    return sum + (typeof value === "number" && value > 0 ? value : 0);
  }, 0);
};

const fareStateFor = async ({
  ticket,
  towerId,
  nextLat,
  nextLng,
  reasonCode,
}: {
  ticket: dispatchRepository.DispatchTicket;
  towerId: string;
  nextLat: number;
  nextLng: number;
  reasonCode: string;
}) => {
  const destId = typeof ticket.destinationShopId === "string" &&
    ticket.destinationShopId !== "" ?
    ticket.destinationShopId as string :
    null;
  const tracked = trackedDeadheadKm(ticket, towerId) ?? 0;
  const trackedLoaded = trackedLoadedKm(ticket, towerId) ?? 0;
  await freezeTowLeg(ticket.id, {
    towLegs: ticket.towLegs,
    towDistanceMeters: ticket.towDistanceMeters,
    assignedShopId: ticket.assignedShopId,
    lat: nextLat,
    lng: nextLng,
  }, destId, tracked);
  const fresh = await dispatchRepository.findById(ticket.id);
  const partialKm = actualDeadheadKm(fresh?.towLegs);
  const rates = await platformConfigService.getTowRates()
    .catch(() => DEFAULT_TOW_RATES);
  const prior = fresh?.towFare as TowFareQuote | null | undefined;
  const partial = partialTowFare({
    ...(typeof ticket.vehicleType === "string" ?
      {vehicleClass: vehicleClassOf(ticket.vehicleType)} :
      {}),
    night: isNightFare(new Date(), rates.nightWindow),
    deadheadKm: partialKm + trackedLoaded,
    ...(typeof prior?.perKmFee === "number" ?
      {perKmFee: prior.perKmFee} :
      {}),
    rates,
  });
  const cap = typeof ticket.towFeeCap === "number" ?
    ticket.towFeeCap :
    typeof prior?.ceiling === "number" ? prior.ceiling : null;
  const previousHistory = Array.isArray(ticket.towFeeHistory) ?
    [...ticket.towFeeHistory] :
    [];
  const historyAmount = historyAmountOf(ticket) + partial;
  const ceiling = cap === null ?
    (typeof prior?.ceiling === "number" ?
      Math.max(0, prior.ceiling - historyAmount) :
      0) :
    Math.max(0, cap - historyAmount);
  const tower = await providerRepository.findById(towerId);
  const history = partial > 0 ?
    [...previousHistory, {
      shopId: towerId,
      shopName: tower?.name ?? null,
      amount: partial,
      deadheadKm: partialKm,
      loadedKm: trackedLoaded,
      at: new Date().toISOString(),
      reasonCode,
    }] :
    previousHistory;
  return {
    cap,
    ceiling,
    history,
    partialKm,
    trackedLoaded,
    prior,
    rates,
  };
};

type RematchFare = Awaited<ReturnType<typeof fareStateFor>>;

const rematchPatchFor = ({
  towerName,
  towerId,
  userId,
  effectiveReason,
  note,
  nextLat,
  nextLng,
  pickupHistory,
  chatVersion,
  archived,
  exclusions,
  fare,
  operatorUid,
  breakdown,
  quotedKm,
  vehicleClass,
}: {
  towerName: unknown;
  towerId: string;
  userId: string;
  effectiveReason: string;
  note?: string;
  nextLat: number;
  nextLng: number;
  pickupHistory: unknown[];
  chatVersion: number;
  archived: {roomId: string; at: string} | null;
  exclusions: {shopIds: string[]; operatorUids: string[]};
  fare: RematchFare;
  operatorUid: string;
  breakdown: boolean;
  quotedKm: number | null;
  vehicleClass: string;
}) => ({
  lat: nextLat,
  lng: nextLng,
  pickupHistory,
  assignedShopId: null,
  assignedUid: null,
  assignedKind: null,
  assignedAt: null,
  loadedAt: null,
  hold: null,
  chatVersion: chatVersion + 1,
  ...(archived !== null ?
    {
      chatHistory: FieldValue.arrayUnion({
        version: chatVersion,
        roomId: archived.roomId,
        shopId: towerId,
        shopName: towerName ?? null,
        at: archived.at,
      }),
    } :
    {}),
  formerAssignedShopIds: FieldValue.arrayUnion(towerId),
  towCancelHistory: FieldValue.arrayUnion({
    shopId: towerId,
    by: userId,
    at: new Date().toISOString(),
    reasonCode: effectiveReason,
    ...(note !== undefined ? {note} : {}),
  }),
  excludedShopIds: exclusions.shopIds,
  ...(operatorUid !== "" ?
    {excludedOperatorUids: exclusions.operatorUids} :
    {}),
  ...(fare.cap !== null ? {towFeeCap: fare.cap} : {}),
  towFeeHistory: fare.history,
  towFare: {
    estimate: 0,
    ceiling: fare.ceiling,
    final: null,
    partial: false,
    deadheadKm: 0,
    loadedKm: 0,
    night: isNightFare(new Date(), fare.rates.nightWindow),
    nightMultiplier: fare.rates.nightMultiplier,
    vehicleClass,
  },
  towActual: {
    quotedKm,
    actualKm: fare.partialKm,
    cappedKm: Math.round(fare.partialKm * 10) / 10,
    loadedTraveledKm: fare.trackedLoaded,
    ...(breakdown ? {breakdown: true} : {}),
  },
  towerSearch: TOWER_SEARCH_ACTIVE,
  etaPickupAt: null,
  etaDropoffAt: null,
  etaNotifiedAt: null,
  cancelledBy: null,
  candidates: [],
  candidateTs: null,
});

const exclusionsFor = (
  ticket: dispatchRepository.DispatchTicket,
  towerId: string,
  operatorUid: string,
): {shopIds: string[]; operatorUids: string[]} => {
  const shopIds = Array.isArray(ticket.excludedShopIds) ?
    [...ticket.excludedShopIds] :
    [];
  if (!shopIds.includes(towerId)) shopIds.push(towerId);
  const operatorUids = Array.isArray(ticket.excludedOperatorUids) ?
    [...ticket.excludedOperatorUids] :
    [];
  if (operatorUid !== "" && !operatorUids.includes(operatorUid)) {
    operatorUids.push(operatorUid);
  }
  return {shopIds, operatorUids};
};

const rematchBody = (breakdown: boolean, travelledKm: number): string => {
  if (breakdown) return "The tower broke down — finding another tower";
  if (travelledKm > 0) {
    return "The tower cancelled — searching for a new tower " +
      `(${travelledKm} km on record)`;
  }
  return "The tower cancelled — searching for a new tower";
};

const rematchTow = async ({
  ticket,
  userId,
  reasonCode,
  note,
  lat,
  lng,
  pickupReason,
}: {
  ticket: dispatchRepository.DispatchTicket;
  userId: string;
  reasonCode: string;
  note?: string;
  lat?: number;
  lng?: number;
  pickupReason?: string;
}): Promise<{updated: number; requeued: boolean}> => {
  const towerId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (towerId === "") {
    throw new ValidationError("Re-match needs an assigned tower");
  }
  const tower = await providerRepository.findById(towerId);
  if (!tower || tower.kind !== PROVIDER_KIND.TOW) {
    throw new NotFoundError("Provider not found");
  }
  const effectiveReason = typeof reasonCode === "string" &&
    reasonCode.trim() !== "" ?
    reasonCode.trim() :
    DISPUTE_REASON.TOWER_CANCEL_OTHER;
  const breakdown = effectiveReason === DISPUTE_REASON.TOWER_CANCEL_BREAKDOWN;
  const operatorUid = typeof tower.operatorUid === "string" ?
    tower.operatorUid :
    "";
  const nextLat = typeof lat === "number" ? lat : ticket.lat;
  const nextLng = typeof lng === "number" ? lng : ticket.lng;
  const fare = await fareStateFor({
    ticket,
    towerId,
    nextLat,
    nextLng,
    reasonCode: effectiveReason,
  });
  const exclusions = exclusionsFor(ticket, towerId, operatorUid);
  const pickupHistory = Array.isArray(ticket.pickupHistory) ?
    [...ticket.pickupHistory] :
    [];
  pickupHistory.push({
    lat: nextLat,
    lng: nextLng,
    at: new Date().toISOString(),
    reason: pickupReason ??
      (breakdown ? "tower-breakdown" : TOWER_CANCEL_SOURCE.REMATCH),
  });
  const chatVersion = typeof ticket.chatVersion === "number" ?
    ticket.chatVersion :
    0;
  const quotedKm = typeof fare.prior?.loadedKm === "number" ?
    fare.prior.loadedKm :
    null;
  const vehicleClass = typeof fare.prior?.vehicleClass === "string" ?
    fare.prior.vehicleClass :
    vehicleClassOf(ticket.vehicleType);
  const archived = await chatService.archiveTicketRoom({
    ticketId: ticket.id,
    version: chatVersion,
  }).catch(() => null);
  await dispatchRepository.update(ticket.id, rematchPatchFor({
    towerName: tower.name,
    towerId,
    userId,
    effectiveReason,
    note,
    nextLat,
    nextLng,
    pickupHistory,
    chatVersion,
    archived,
    exclusions,
    fare,
    operatorUid,
    breakdown,
    quotedKm,
    vehicleClass,
  }));
  await dispatchRepository.updateStatus(
    ticket.id,
    STATUS_DISPATCH.PENDING,
    userId,
  );
  try {
    await stopWaiting(ticket.id);
  } catch {
    void 0;
  }
  try {
    await providerRepository.update(towerId, {accepting: false});
  } catch {
    void 0;
  }
  if (typeof providerLocationRepository.remove === "function") {
    try {
      await providerLocationRepository.remove(towerId);
    } catch {
      void 0;
    }
  }
  cacheManager.del("shop");
  cacheManager.del("provider");
  try {
    const operators = await findTowOperators({
      lat: nextLat,
      lng: nextLng,
      vehicleType: ticket.vehicleType as string | undefined,
      excludeOperatorUids: exclusions.operatorUids,
      excludeShopIds: exclusions.shopIds,
    });
    if (operators.length > 0) {
      await dispatchRepository.update(ticket.id, {
        candidates: operators,
        candidateTs: new Date().toISOString(),
      });
    }
  } catch {
    cacheManager.del(NS);
    return {updated: 1, requeued: true};
  }
  cacheManager.del(NS);
  const travelledKm = Math.round(
    (fare.partialKm + fare.trackedLoaded) * 10,
  ) / 10;
  await enqueueDispatchPush(ticket.id, "-rematch-rider", {
    audience: "rider",
    urgent: "true",
    title: "Finding another tower",
    body: rematchBody(breakdown, travelledKm),
  });
  await enqueueDispatchPush(ticket.id, "-rematch-towers", {
    audience: "tower-candidates",
    title: "Tow request available",
    body: "A tow request needs a tower — tap to view",
  });
  if (!breakdown) {
    try {
      await autoFile({
        ticketId: ticket.id,
        reporterUid: ticket.userId,
        accusedKind: ACCUSED_KIND.TOWER,
        accusedId: towerId,
        reasonCode: effectiveReason,
        ...(note !== undefined ? {note} : {}),
        type: DISPUTE_TYPE.TOWER_CANCEL_MID,
      });
    } catch {
      return {updated: 1, requeued: true};
    }
    try {
      await bumpCancelCounters({providerId: towerId, userId});
    } catch {
      void 0;
    }
  }
  return {updated: 1, requeued: true};
};

export {rematchTow};
