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
} as const;

const HELPER_KIND = {
  VOLUNTEER: "VOLUNTEER",
  SHOP: "SHOP",
} as const;

const RATING_TARGET = {
  VOLUNTEER: "VOLUNTEER",
  SHOP: "SHOP",
  RIDER: "RIDER",
} as const;

const RATING_MIN = 1;
const RATING_MAX = 5;

const VOLUNTEER_FRESH_MS = 15 * 60 * 1000;
const VOLUNTEER_DEFAULT_RADIUS = 5000;
const WALK_RADIUS_MIN = 500;
const WALK_RADIUS_MAX = 2000;
const SHOP_SEARCH_MAX_RADIUS = 10000;
const NEAR_SHOPS_MAX = 10;

const VEHICLE_TYPE = {
  SCOOTER: "SCOOTER",
  CUB: "CUB",
  MANUAL: "MANUAL",
  CAR: "CAR",
  VAN: "VAN",
  TRUCK: "TRUCK",
} as const;

const VEHICLE_DEFAULT_WIDTH: Record<string, number> = {
  SCOOTER: 0.7,
  CUB: 0.7,
  MANUAL: 0.8,
  CAR: 1.9,
  VAN: 2.0,
  TRUCK: 2.3,
};

const TOW_VEHICLE_TYPE = {
  CAR: "CAR",
  VAN: "VAN",
  TRUCK: "TRUCK",
} as const;

const VOLUNTEER_CAPABILITY = {
  SOLO_BIKE: "SOLO_BIKE",
  CAR: "CAR",
} as const;

const SERVICE_ROLE = {
  RIDER: "RIDER",
  SHOP: "SHOP",
  MOBILE: "MOBILE",
  TOW: "TOW",
  VOLUNTEER: "VOLUNTEER",
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
    "Ticket opened, awaiting a mechanic match",
    1,
  ),
  [STATUS_DISPATCH.MATCHED]: definition(
    "dispatch",
    STATUS_DISPATCH.MATCHED,
    "Matched",
    "Mechanic assigned and en route",
    2,
  ),
  [STATUS_DISPATCH.ARRIVED]: definition(
    "dispatch",
    STATUS_DISPATCH.ARRIVED,
    "Arrived",
    "Mechanic on scene",
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
};

const STATUS_GROUPS: Record<string, Record<string, StatusDefinition>> = {
  users: USER_STATUSES,
  flags: FLAG_STATUSES,
  dispatch: DISPATCH_STATUSES,
};

export {
  STATUS_USER,
  STATUS_FLAGS,
  STATUS_DISPATCH,
  HELPER_KIND,
  RATING_TARGET,
  RATING_MIN,
  RATING_MAX,
  VOLUNTEER_FRESH_MS,
  VOLUNTEER_DEFAULT_RADIUS,
  WALK_RADIUS_MIN,
  WALK_RADIUS_MAX,
  SHOP_SEARCH_MAX_RADIUS,
  NEAR_SHOPS_MAX,
  VEHICLE_TYPE,
  VEHICLE_DEFAULT_WIDTH,
  TOW_VEHICLE_TYPE,
  VOLUNTEER_CAPABILITY,
  SERVICE_ROLE,
  USER_STATUSES,
  FLAG_STATUSES,
  DISPATCH_STATUSES,
  STATUS_GROUPS,
  StatusDefinition,
};
