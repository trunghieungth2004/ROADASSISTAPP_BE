const USER_ACTIVE = "1";
const USER_INACTIVE = "0";

const STATUS_USER = {
  ACTIVE: USER_ACTIVE,
  INACTIVE: USER_INACTIVE,
} as const;

const STATUS_FLAGS = {
  SUGGESTED: "1",
  CONFIRMED: "2",
  LOCKED: "3",
  EXPIRED: "4",
  REJECTED: "5",
} as const;

const STATUS_DISPATCH = {
  PENDING: "1",
  MATCHED: "2",
  ARRIVED: "3",
  RESOLVED: "4",
  CANCELLED: "5",
  IN_PROGRESS: "6",
  READY: "7",
  DECLINED: "8",
  QUOTED: "9",
  IN_SHOP: "10",
  FINAL_QUOTED: "11",
  RESOLVED_UNFIXABLE: "12",
  ESTIMATED: "13",
  EST_APPROVED: "14",
  UNFIXABLE: "15",
} as const;

const HELPER_KIND = {
  SHOP: "SHOP",
  TOW: "TOW",
  MOBILE_SHOP: "MOBILE_SHOP",
} as const;

const TICKET_SEARCH = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
} as const;

const RATING_TARGET = {
  SHOP: "SHOP",
  RIDER: "RIDER",
} as const;

const RATING_MIN = 1;
const RATING_MAX = 5;

const TOW_CLASS_MULTIPLIER_BIKE = 1;
const TOW_CLASS_MULTIPLIER_CAR = 2.5;

const MOBILE_SHOP_DEFAULT_RADIUS = 5000;
const MOBILE_SHOP_CALL_OUT_FEE = 50000;
const MOBILE_SHOP_CALL_OUT_WAIVER_M = 1000;
const MOBILE_SHOP_TRAVEL_PER_KM = 5000;
const TOW_DISPATCH_RADIUS = 15000;
const PROVIDER_FRESH_MS = 15 * 60 * 1000;
const WALK_RADIUS_MIN = 500;
const WALK_RADIUS_MAX = 2000;
const SHOP_SEARCH_MAX_RADIUS = 20000;
const NEAR_SHOPS_MAX = 10;
const PROVIDER_SERVICES_MAX = 20;
const PROVIDER_SERVICE_PRICE_MAX = 999999999;
const PROVIDER_SERVICE_CODE_MAX = 64;
const PROVIDER_SERVICE_NAME_MAX = 120;

const VEHICLE_TYPE = {
  BIKE: "BIKE",
  CAR: "CAR",
} as const;

const VEHICLE_DEFAULT_WIDTH: Record<string, number> = {
  BIKE: 0.7,
  CAR: 1.9,
};

const TOW_VEHICLE_TYPE = {
  CAR: "CAR",
} as const;

const VEHICLE_CLASS = {
  SOLO_BIKE: "SOLO_BIKE",
  CAR: "CAR",
} as const;

const SERVICE_ROLE = {
  RIDER: "RIDER",
} as const;

const PROVIDER_KIND = {
  SHOP: "SHOP",
  TOW: "TOW",
  MOBILE_SHOP: "MOBILE_SHOP",
} as const;

const PROVIDER_STATUS = {
  ACTIVE: "ACTIVE",
  PENDING: "PENDING",
  DENIED: "DENIED",
} as const;

const PROVIDER_REPORT_REASON = {
  FAKE_BUSINESS: "FAKE_BUSINESS",
  WRONG_LOCATION: "WRONG_LOCATION",
  UNSAFE: "UNSAFE",
  HARASSMENT: "HARASSMENT",
  SPAM: "SPAM",
  INFO_INACCURATE: "INFO_INACCURATE",
  OTHER: "OTHER",
} as const;

const PROVIDER_REPORT_STATUS = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED",
} as const;

const DECLINE_REASON = {
  FULL: "FULL",
  CLOSED: "CLOSED",
  PARTS_DELAY: "PARTS_DELAY",
  OTHER: "OTHER",
} as const;

interface StatusDefinition {
  domain: string;
  code: string;
  name: string;
  description: string;
  order: number;
}

const definition = (
  domain: string,
  code: string,
  name: string,
  description: string,
  order: number,
): StatusDefinition => ({domain, code, name, description, order});

const USER_STATUSES: Record<string, StatusDefinition> = {
  [USER_ACTIVE]: definition(
    "users",
    USER_ACTIVE,
    "Active",
    "User can authenticate and use protected endpoints",
    1,
  ),
  [USER_INACTIVE]: definition(
    "users",
    USER_INACTIVE,
    "Inactive",
    "User is blocked from authenticating",
    0,
  ),
};

const FLAG_STATUSES: Record<string, StatusDefinition> = {
  [STATUS_FLAGS.SUGGESTED]: definition(
    "flags",
    STATUS_FLAGS.SUGGESTED,
    "Suggested",
    "Submitted by a rider, awaiting consensus votes",
    1,
  ),
  [STATUS_FLAGS.CONFIRMED]: definition(
    "flags",
    STATUS_FLAGS.CONFIRMED,
    "Confirmed",
    "Reached the consensus vote threshold",
    2,
  ),
  [STATUS_FLAGS.LOCKED]: definition(
    "flags",
    STATUS_FLAGS.LOCKED,
    "Locked",
    "Pinned by an admin, unaffected by voting",
    3,
  ),
  [STATUS_FLAGS.EXPIRED]: definition(
    "flags",
    STATUS_FLAGS.EXPIRED,
    "Expired",
    "TTL lapsed, swept by the expire job",
    4,
  ),
  [STATUS_FLAGS.REJECTED]: definition(
    "flags",
    STATUS_FLAGS.REJECTED,
    "Rejected",
    "Dismissed by an admin",
    5,
  ),
};

const DISPATCH_STATUSES: Record<string, StatusDefinition> = {
  [STATUS_DISPATCH.PENDING]: definition(
    "dispatch",
    STATUS_DISPATCH.PENDING,
    "Pending",
    "Ticket opened, awaiting a match",
    1,
  ),
  [STATUS_DISPATCH.MATCHED]: definition(
    "dispatch",
    STATUS_DISPATCH.MATCHED,
    "Matched",
    "Helper assigned and en route",
    2,
  ),
  [STATUS_DISPATCH.ARRIVED]: definition(
    "dispatch",
    STATUS_DISPATCH.ARRIVED,
    "Arrived",
    "Helper on scene",
    3,
  ),
  [STATUS_DISPATCH.RESOLVED]: definition(
    "dispatch",
    STATUS_DISPATCH.RESOLVED,
    "Resolved",
    "Ticket completed",
    4,
  ),
  [STATUS_DISPATCH.CANCELLED]: definition(
    "dispatch",
    STATUS_DISPATCH.CANCELLED,
    "Cancelled",
    "Ticket withdrawn",
    5,
  ),
  [STATUS_DISPATCH.IN_PROGRESS]: definition(
    "dispatch",
    STATUS_DISPATCH.IN_PROGRESS,
    "In progress",
    "Repair work underway",
    6,
  ),
  [STATUS_DISPATCH.READY]: definition(
    "dispatch",
    STATUS_DISPATCH.READY,
    "Ready",
    "Work done, awaiting rider confirmation",
    7,
  ),
  [STATUS_DISPATCH.DECLINED]: definition(
    "dispatch",
    STATUS_DISPATCH.DECLINED,
    "Declined",
    "Provider cannot take the job",
    8,
  ),
  [STATUS_DISPATCH.QUOTED]: definition(
    "dispatch",
    STATUS_DISPATCH.QUOTED,
    "Quoted",
    "Shop quote sent, awaiting rider approval",
    9,
  ),
  [STATUS_DISPATCH.IN_SHOP]: definition(
    "dispatch",
    STATUS_DISPATCH.IN_SHOP,
    "In shop",
    "Vehicle received at the shop, work pending",
    10,
  ),
  [STATUS_DISPATCH.FINAL_QUOTED]: definition(
    "dispatch",
    STATUS_DISPATCH.FINAL_QUOTED,
    "Final quoted",
    "Final amount posted, awaiting rider approval",
    11,
  ),
  [STATUS_DISPATCH.RESOLVED_UNFIXABLE]: definition(
    "dispatch",
    STATUS_DISPATCH.RESOLVED_UNFIXABLE,
    "Resolved unfixable",
    "Closed as unfixable with evidence on file",
    12,
  ),
  [STATUS_DISPATCH.ESTIMATED]: definition(
    "dispatch",
    STATUS_DISPATCH.ESTIMATED,
    "Estimated",
    "Estimate sent, awaiting rider approval",
    13,
  ),
  [STATUS_DISPATCH.EST_APPROVED]: definition(
    "dispatch",
    STATUS_DISPATCH.EST_APPROVED,
    "Estimate approved",
    "Estimate approved, tow and drop-off authorized",
    14,
  ),
  [STATUS_DISPATCH.UNFIXABLE]: definition(
    "dispatch",
    STATUS_DISPATCH.UNFIXABLE,
    "Unfixable",
    "Closed as unfixable with evidence on file",
    15,
  ),
};

const PROVIDER_STATUSES: Record<string, StatusDefinition> = {
  [PROVIDER_STATUS.PENDING]: definition(
    "providers",
    PROVIDER_STATUS.PENDING,
    "Pending",
    "Tow provider awaiting admin review",
    1,
  ),
  [PROVIDER_STATUS.ACTIVE]: definition(
    "providers",
    PROVIDER_STATUS.ACTIVE,
    "Active",
    "Provider visible to riders and able to accept work",
    2,
  ),
  [PROVIDER_STATUS.DENIED]: definition(
    "providers",
    PROVIDER_STATUS.DENIED,
    "Denied",
    "Provider rejected by admin review",
    3,
  ),
};

const STATUS_GROUPS: Record<string, Record<string, StatusDefinition>> = {
  users: USER_STATUSES,
  flags: FLAG_STATUSES,
  dispatch: DISPATCH_STATUSES,
  providers: PROVIDER_STATUSES,
};

export {
  STATUS_USER,
  STATUS_FLAGS,
  STATUS_DISPATCH,
  HELPER_KIND,
  TICKET_SEARCH,
  RATING_TARGET,
  RATING_MIN,
  RATING_MAX,
  TOW_CLASS_MULTIPLIER_BIKE,
  TOW_CLASS_MULTIPLIER_CAR,
  MOBILE_SHOP_DEFAULT_RADIUS,
  MOBILE_SHOP_CALL_OUT_FEE,
  MOBILE_SHOP_CALL_OUT_WAIVER_M,
  MOBILE_SHOP_TRAVEL_PER_KM,
  TOW_DISPATCH_RADIUS,
  WALK_RADIUS_MIN,
  WALK_RADIUS_MAX,
  SHOP_SEARCH_MAX_RADIUS,
  NEAR_SHOPS_MAX,
  PROVIDER_SERVICES_MAX,
  PROVIDER_SERVICE_PRICE_MAX,
  PROVIDER_SERVICE_CODE_MAX,
  PROVIDER_SERVICE_NAME_MAX,
  VEHICLE_TYPE,
  VEHICLE_DEFAULT_WIDTH,
  TOW_VEHICLE_TYPE,
  VEHICLE_CLASS,
  SERVICE_ROLE,
  PROVIDER_KIND,
  PROVIDER_STATUS,
  PROVIDER_REPORT_REASON,
  PROVIDER_REPORT_STATUS,
  DECLINE_REASON,
  PROVIDER_FRESH_MS,
  USER_STATUSES,
  FLAG_STATUSES,
  DISPATCH_STATUSES,
  STATUS_GROUPS,
  PROVIDER_STATUSES,
  StatusDefinition,
};

export * from "./payments";
