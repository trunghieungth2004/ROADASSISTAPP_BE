export const SUPPORT_STATUS = {
  OPEN: "OPEN",
  ANSWERED: "ANSWERED",
  CLOSED: "CLOSED",
} as const;

export const SUPPORT_CATEGORIES = [
  "PAYMENT",
  "SAFETY",
  "APP",
  "PROVIDER",
  "OTHER",
] as const;

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 1000;
export const SUPPORT_ANSWER_MAX = 1000;
export const SUPPORT_LIST_LIMIT = 50;
