import * as dispatchRepository from "../../repository/dispatchRepository";
import * as providerRepository from "../../repository/providerRepository";
import {PROVIDER_KIND, PROVIDER_STATUS, MOBILE_SHOP_CALL_OUT_FEE} from
  "../../constants/status";
import {findTowOperators} from "./candidates";

type LinkedSummary = {
  ticketId: string;
  ticketType: string;
  note: string | null;
  description: string | null;
  photoUrls: string[];
  evidencePhotoUrls: string[];
  unfixableReason: string | null;
  sosAttempt: number;
  createdAt: string | null;
};

type MobileTowMode = "DIRECT" | "NETWORK";

type MobileTowState =
  | "DIRECT"
  | "TOW_OFF_DUTY"
  | "TOW_BUSY"
  | "NO_TOW"
  | "NONE_NEARBY";

type MobileTowAvailability = {
  available: boolean;
  mode: MobileTowMode;
  state: MobileTowState;
  towProviderId: string | null;
};

type MobileShopContext = {
  operatorUid: string;
  vehicleProfileId: string;
  operated: providerRepository.Provider[];
};

const parentSosFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<dispatchRepository.DispatchTicket | null> => {
  const direct = typeof ticket.sourceTicketId === "string" ?
    ticket.sourceTicketId :
    typeof ticket.continuedFromTicketId === "string" ?
      ticket.continuedFromTicketId :
      "";
  if (direct !== "") return dispatchRepository.findById(direct);
  if (ticket.ticketType !== "TOW") return null;
  const links = Array.isArray(ticket.linkedTicketIds) ?
    ticket.linkedTicketIds :
    [];
  for (const id of links) {
    if (typeof id !== "string" || id === "" || id === ticket.id) continue;
    const linked = await dispatchRepository.findById(id);
    if (linked && linked.ticketType === "SOS") return linked;
  }
  return null;
};

const linkedSummaryFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<LinkedSummary | null> => {
  if (ticket.ticketType !== "TOW" && ticket.ticketType !== "SOS") return null;
  const linked = await parentSosFor(ticket);
  if (!linked || linked.ticketType !== "SOS") return null;
  const unfixable = linked.unfixable;
  const evidencePhotoUrls = unfixable && Array.isArray(unfixable.photoUrls) ?
    unfixable.photoUrls.filter((path): path is string =>
      typeof path === "string" && path !== "") :
    [];
  return {
    ticketId: linked.id,
    ticketType: linked.ticketType,
    note: null,
    description: null,
    photoUrls: evidencePhotoUrls,
    evidencePhotoUrls,
    unfixableReason: unfixable && typeof unfixable.reason === "string" ?
      unfixable.reason :
      null,
    sosAttempt: typeof linked.sosAttempt === "number" ? linked.sosAttempt : 1,
    createdAt: typeof linked.createdAt === "string" ? linked.createdAt : null,
  };
};

const sosCallOutTotalFor = async (
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

const mobileShopContextFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<MobileShopContext | null> => {
  if (ticket.ticketType !== "SOS") return null;
  const shopId = typeof ticket.assignedShopId === "string" ?
    ticket.assignedShopId :
    "";
  if (shopId === "") return null;
  const shop = await providerRepository.findById(shopId);
  if (!shop || shop.kind !== PROVIDER_KIND.MOBILE_SHOP) return null;
  const operatorUid = typeof shop.operatorUid === "string" ?
    shop.operatorUid :
    "";
  const vehicleProfileId = typeof shop.vehicleProfileId === "string" ?
    shop.vehicleProfileId :
    "";
  const operated = operatorUid !== "" ?
    (await providerRepository.findByOperator(operatorUid)) ?? [] :
    [];
  return {operatorUid, vehicleProfileId, operated};
};

const operatorBusy = async (
  operated: providerRepository.Provider[],
): Promise<boolean> => {
  for (const provider of operated) {
    if (provider.kind !== PROVIDER_KIND.TOW &&
      provider.kind !== PROVIDER_KIND.MOBILE_SHOP) {
      continue;
    }
    const active = (await dispatchRepository.findActiveForShop(
      provider.id,
    )) ?? [];
    if (active.length > 0) return true;
  }
  return false;
};

const mobileTowAvailabilityFor = async (
  ticket: dispatchRepository.DispatchTicket,
): Promise<MobileTowAvailability> => {
  const context = await mobileShopContextFor(ticket);
  if (!context) {
    return {
      available: false,
      mode: "NETWORK",
      state: "NO_TOW",
      towProviderId: null,
    };
  }
  const linkedTows = context.operated.filter((provider) =>
    provider.kind === PROVIDER_KIND.TOW &&
    provider.status === PROVIDER_STATUS.ACTIVE &&
    (provider as {suspended?: boolean}).suspended !== true &&
    typeof provider.plate === "string" &&
    provider.plate !== "" &&
    context.vehicleProfileId !== "" &&
    provider.vehicleProfileId === context.vehicleProfileId);
  let state: MobileTowState = "NO_TOW";
  if (linkedTows.length > 0) {
    const onDuty = linkedTows.filter((provider) =>
      provider.accepting !== false);
    if (onDuty.length === 0) {
      state = "TOW_OFF_DUTY";
    } else {
      const free = [];
      for (const tow of onDuty) {
        const active = (await dispatchRepository.findActiveForShop(
          tow.id,
        )) ?? [];
        if (active.length === 0) free.push(tow);
      }
      if (free.length === 0) {
        state = "TOW_BUSY";
      } else if (!(await operatorBusy(context.operated))) {
        return {
          available: true,
          mode: "DIRECT",
          state: "DIRECT",
          towProviderId: free[0].id,
        };
      } else {
        state = "TOW_BUSY";
      }
    }
  }
  let candidates: string[] = [];
  try {
    candidates = await findTowOperators({
      lat: ticket.lat,
      lng: ticket.lng,
      ...(typeof ticket.vehicleType === "string" ?
        {vehicleType: ticket.vehicleType} :
        {}),
    });
  } catch {
    candidates = [];
  }
  if (candidates.length === 0) {
    return {
      available: false,
      mode: "NETWORK",
      state: "NONE_NEARBY",
      towProviderId: null,
    };
  }
  return {
    available: true,
    mode: "NETWORK",
    state,
    towProviderId: null,
  };
};

export {
  linkedSummaryFor,
  mobileTowAvailabilityFor,
  sosCallOutTotalFor,
};
export type {
  LinkedSummary,
  MobileTowAvailability,
  MobileTowMode,
  MobileTowState,
};
