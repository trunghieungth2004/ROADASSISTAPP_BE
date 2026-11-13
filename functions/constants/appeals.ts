const APPEAL_COLLECTION = "appeals";

const APPEAL_SUBJECT = {
  RATING: "RATING",
  REPORT: "REPORT",
  DISPUTE: "DISPUTE",
} as const;

const APPEAL_STATUS = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED",
} as const;

const APPEAL_RESOLUTION = {
  REMOVE: "REMOVE",
  KEEP: "KEEP",
  UPHOLD: "UPHOLD",
  OVERTURN: "OVERTURN",
  ADJUST: "ADJUST",
} as const;

const APPEAL_REASONS: Record<string, readonly string[]> = {
  RATING: [
    "RETALIATORY",
    "NOT_THE_SERVICE",
    "WRONG_TICKET",
    "ABUSIVE_CONTENT",
    "SPAM",
    "OTHER",
  ],
  REPORT: [
    "FALSE_REPORT",
    "NOT_MY_CONDUCT",
    "CONTEXT_MISSING",
    "NEW_EVIDENCE",
    "PROCEDURAL_ERROR",
    "OTHER",
  ],
  DISPUTE: [
    "NEW_EVIDENCE",
    "WRONG_OUTCOME",
    "AMOUNT_ERROR",
    "PROCEDURAL_ERROR",
    "OTHER",
  ],
};

const APPEAL_WINDOW_DAYS: Record<string, number> = {
  RATING: 30,
  REPORT: 14,
  DISPUTE: 7,
};

const APPEAL_MAX: Record<string, number> = {
  RATING: 2,
  REPORT: 1,
  DISPUTE: 1,
};

export {
  APPEAL_COLLECTION,
  APPEAL_SUBJECT,
  APPEAL_STATUS,
  APPEAL_RESOLUTION,
  APPEAL_REASONS,
  APPEAL_WINDOW_DAYS,
  APPEAL_MAX,
};
