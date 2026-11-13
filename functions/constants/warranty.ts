const WARRANTY_DECLINE_REASON = {
  NOT_COVERED: "NOT_COVERED",
  WEAR_AND_TEAR: "WEAR_AND_TEAR",
  EXPIRED: "EXPIRED",
  WRONG_SERVICE: "WRONG_SERVICE",
  MISUSE: "MISUSE",
  OTHER: "OTHER",
} as const;

const WARRANTY_DECLINE_LABEL: Record<string, string> = {
  NOT_COVERED: "Not covered by warranty",
  WEAR_AND_TEAR: "Wear and tear",
  EXPIRED: "Warranty expired",
  WRONG_SERVICE: "Different service or issue",
  MISUSE: "Misuse or accident",
  OTHER: "Other",
};

export {WARRANTY_DECLINE_REASON, WARRANTY_DECLINE_LABEL};
