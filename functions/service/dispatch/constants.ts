import {STATUS_DISPATCH, TICKET_SEARCH} from "../../constants/status";
import {
  DISPUTE_TYPE,
  MS_PER_MIN,
  QUOTE_TTL_MS,
  SHOP_DECLINE_REASON,
  TOWER_CANCEL_SOURCE,
  TOW_ESTIMATE_TTL_MS,
  WAITING_CAP_MS,
  WAITING_GRACE_MS,
  WAITING_RADIUS_M,
  WAITING_RATE_PER_MIN,
} from "../../constants/dispatch";

export {
  DISPUTE_TYPE,
  MS_PER_MIN,
  QUOTE_TTL_MS,
  SHOP_DECLINE_REASON,
  TICKET_SEARCH,
  TOWER_CANCEL_SOURCE,
  TOW_ESTIMATE_TTL_MS,
  WAITING_CAP_MS,
  WAITING_GRACE_MS,
  WAITING_RADIUS_M,
  WAITING_RATE_PER_MIN,
};

export const VALID_STATUSES: string[] = Object.values(STATUS_DISPATCH);
export const NS = "dispatch";
export const SEND_CHUNK = 500;
export const WALK_IN_TTL_MS = 2 * 60 * 60 * 1000;
export const SECURE_MINUTES_BIKE = 10;
export const SECURE_MINUTES_CAR = 20;
export const LOADED_FACTOR = 1.1;
export const LATE_GRACE_MS = 10 * 60 * 1000;
export const ESTIMATE_TTL_MS = QUOTE_TTL_MS;
export const WAITING_BLOCK_MS = 15 * 60 * 1000;
export const WAITING_NEAR_M = WAITING_RADIUS_M;
export const TOWER_SEARCH_ACTIVE = TICKET_SEARCH.ACTIVE;
export const TOWER_SEARCH_PAUSED = TICKET_SEARCH.PAUSED;
export const QUOTE_KIND_ESTIMATE = "ESTIMATE";
export const QUOTE_KIND_FINAL = "FINAL";
export const QUOTE_STATUS_PENDING = "PENDING";
export const QUOTE_STATUS_APPROVED = "APPROVED";
export const QUOTE_STATUS_DECLINED = "DECLINED";
export const QUOTE_STATUS_EXPIRED = "EXPIRED";
export const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);


export const TERMINAL_STATUSES: Set<string> = new Set([
  STATUS_DISPATCH.RESOLVED,
  STATUS_DISPATCH.CANCELLED,
  STATUS_DISPATCH.DECLINED,
  STATUS_DISPATCH.RESOLVED_UNFIXABLE,
  STATUS_DISPATCH.UNFIXABLE,
]);


export const STATUS_PUSH_BODY: Record<string, string> = {
  [STATUS_DISPATCH.MATCHED]: "A helper accepted your request — tap to view",
  [STATUS_DISPATCH.ARRIVED]: "Your helper has arrived",
  [STATUS_DISPATCH.RESOLVED]: "Your request was resolved",
  [STATUS_DISPATCH.CANCELLED]: "Your walk-in request expired — tap to view",
  [STATUS_DISPATCH.IN_PROGRESS]: "Work is underway on your vehicle",
  [STATUS_DISPATCH.READY]: "Your vehicle is ready for pickup",
  [STATUS_DISPATCH.DECLINED]: "The shop can't take your request",
  [STATUS_DISPATCH.QUOTED]: "Your shop sent a quote — tap to review",
  [STATUS_DISPATCH.ESTIMATED]: "Your shop sent an estimate — tap to review",
  [STATUS_DISPATCH.EST_APPROVED]: "Estimate approved — tow authorized",
  [STATUS_DISPATCH.FINAL_QUOTED]: "Final amount posted — tap to review",
  [STATUS_DISPATCH.IN_SHOP]: "Vehicle received at the shop",
  [STATUS_DISPATCH.UNFIXABLE]: "Vehicle marked unfixable — tap to view",
  [STATUS_DISPATCH.RESOLVED_UNFIXABLE]: "Closed as unfixable",
};

export const PUSH_TITLE_BY_TYPE: Record<string, string> = {
  SOS: "SOS update",
  TOW: "Tow update",
  MECHANIC: "Repair update",
  WALK_IN: "Walk-in update",
};

export const MATCHED_BODY_BY_TYPE: Record<string, string> = {
  SOS: "A helper accepted your request — tap to view",
  TOW: "A tow operator accepted your request — tap to view",
  MECHANIC: "The shop accepted your request — tap to view",
  WALK_IN: "The shop accepted your request — tap to view",
};

export const DECLINE_REASON_LABEL: Record<string, string> = {
  FULL: "Shop is full",
  CLOSED: "Shop is closed",
  PARTS_DELAY: "Parts delayed",
  OTHER: "",
};

export const TOW_FARE = {
  SOLO_BIKE: {base: 150000, perKm: 10000, includedKm: 3},
  CAR: {base: 500000, perKm: 25000, includedKm: 10},
};

export const TOW_FARE_NIGHT_MULT = 1.5;
export const TOW_FARE_CEILING = 1.1;
export const NIGHT_START_MINUTES = 22 * 60;
export const NIGHT_END_MINUTES = 6 * 60;

export const DISPATCH_CHANNEL = "dispatch";
export const URGENT_DISPATCH_CHANNEL = "dispatch-urgent";

export const URGENT_DISPATCH_STATUSES: Set<string> = new Set([
  STATUS_DISPATCH.MATCHED,
  STATUS_DISPATCH.ARRIVED,
  STATUS_DISPATCH.CANCELLED,
]);
