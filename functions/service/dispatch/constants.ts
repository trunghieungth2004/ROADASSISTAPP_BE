import {
  STATUS_DISPATCH,
} from "../../constants/status";

export const VALID_STATUSES: string[] = Object.values(STATUS_DISPATCH);
export const NS = "dispatch";
export const SEND_CHUNK = 500;
export const WALK_IN_TTL_MS = 2 * 60 * 60 * 1000;
export const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);


export const TERMINAL_STATUSES: Set<string> = new Set([
  STATUS_DISPATCH.RESOLVED,
  STATUS_DISPATCH.CANCELLED,
  STATUS_DISPATCH.DECLINED,
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
