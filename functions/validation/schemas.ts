import Joi from "joi";
import {
  RATING_MAX,
  RATING_MIN,
  RATING_TARGET,
  DECLINE_REASON,
  PROVIDER_REPORT_REASON,
  SERVICE_ROLE,
  SHOP_SEARCH_MAX_RADIUS,
  STATUS_DISPATCH,
  STATUS_FLAGS,
  STATUS_USER,
  TOW_VEHICLE_TYPE,
  VEHICLE_TYPE,
  VEHICLE_CLASS,
  VOLUNTEER_CAPABILITY,
} from "../constants/status";

const strReq = (): Joi.StringSchema => Joi.string().required();
const strOpt = (): Joi.StringSchema => Joi.string().allow("", null).optional();
const numReq = (): Joi.NumberSchema => Joi.number().required();
const numOpt = (): Joi.NumberSchema => Joi.number().optional();
const langAttr = (): Joi.NumberSchema =>
  Joi.number().min(-180).max(180).required();
const latAttr = (): Joi.NumberSchema =>
  Joi.number().min(-90).max(90).required();

const locationBody = (): Joi.ObjectSchema =>
  Joi.object({
    lat: latAttr(),
    lng: langAttr(),
  });

const MAX_STOPS = 10;

const emptyBody = (): Joi.ObjectSchema => Joi.object({}).unknown(true);

const dayInterval =
  "(MON|TUE|WED|THU|FRI|SAT|SUN) \\d{2}:\\d{2}-\\d{2}:\\d{2}";

const dayHoursPattern = (): Joi.StringSchema =>
  Joi.string().pattern(
    new RegExp(`^${dayInterval}(,${dayInterval})*$`),
  );

const rideConfigFields = {
  configType: Joi.string().valid("SOLO", "PASSENGER", "CARGO").required(),
  estWidth: numOpt(),
  estHeight: numOpt(),
};

const schemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    displayName: Joi.string().allow("", null).optional(),
    phone: Joi.string().pattern(/^\+?[0-9\s\-()]+$/).min(7).max(20)
      .required(),
  }),
  getOneUser: emptyBody(),
  getMe: emptyBody(),
  setActiveVehicle: Joi.object({
    profileId: Joi.string().min(1).allow("", null).optional(),
  }),
  setOnboarded: Joi.object({
    service: Joi.string()
      .valid(...Object.values(SERVICE_ROLE))
      .optional(),
    role: Joi.string()
      .valid(...Object.values(SERVICE_ROLE))
      .optional(),
  }).or("service", "role"),
  updateUserRole: Joi.object({
    targetUserId: strReq(),
    role: strReq(),
  }),
  updateUserServices: Joi.object({
    targetUserId: strReq(),
    grant: Joi.array()
      .items(Joi.string().valid(...Object.values(SERVICE_ROLE)))
      .optional(),
    revoke: Joi.array()
      .items(Joi.string().valid(...Object.values(SERVICE_ROLE)))
      .optional(),
  }).or("grant", "revoke"),
  updateUserTrust: Joi.object({
    targetUserId: strReq(),
    trustScore: numReq(),
  }),
  updateUserStatus: Joi.object({
    targetUserId: strReq(),
    status: Joi.string()
      .valid(...Object.values(STATUS_USER))
      .required(),
  }),
  updateProfile: Joi.object({
    displayName: Joi.string().trim().min(1).max(120).required(),
  }),
  createVehicleProfile: Joi.object({
    type: Joi.string()
      .valid(...Object.values(VEHICLE_TYPE))
      .required(),
    baseWidth: numReq(),
    baseHeight: numReq(),
  }),
  addRideConfig: Joi.object({
    profileId: strReq(),
    ...rideConfigFields,
  }),

  getAllVehicleProfiles: emptyBody(),
  getAlleySegment: Joi.object({
    segmentId: strReq(),
  }),
  searchAlleysNear: locationBody().append({radiusMeters: numOpt()}),
  createAlleySegment: Joi.object({
    lat: latAttr(),
    lng: langAttr(),
    baseWidth: numOpt(),
    wireHeight: numOpt(),
    inclinePct: numOpt(),
    tier: Joi.string().valid("TIER1", "TIER2", "TIER3").required(),
  }),
  setPassability: Joi.object({
    segmentId: strReq(),
    baseWidth: numOpt(),
    wireHeight: numOpt(),
    inclinePct: numOpt(),
    tier: Joi.string().valid("TIER1", "TIER2", "TIER3").required(),
  }),
  moderateSegment: Joi.object({
    segmentId: strReq(),
    baseWidth: numOpt(),
    wireHeight: numOpt(),
    inclinePct: numOpt(),
    tier: Joi.string().valid("TIER1", "TIER2", "TIER3").optional(),
    verifiedCount: numOpt(),
  }),
  createFlag: Joi.object({
    type: Joi.string().valid("ACCIDENT", "FLOOD", "OBSTRUCTION").required(),
    lat: latAttr(),
    lng: langAttr(),
    note: Joi.string().allow("", null).optional(),
    radiusMeters: Joi.number().min(25).max(3000).optional(),
  }),
  moderateFlag: Joi.object({
    flagId: strReq(),
    status: Joi.string()
      .valid(...Object.values(STATUS_FLAGS))
      .required(),
  }),
  getFlagsNear: locationBody().append({radiusMeters: numOpt()}),
  getMyFlags: emptyBody(),
  getFlagById: Joi.object({
    flagId: strReq(),
  }),
  confirmFlag: Joi.object({
    flagId: strReq(),
  }),
  denyFlag: Joi.object({
    flagId: strReq(),
  }),
  unflagFlag: Joi.object({
    flagId: strReq(),
  }),
  nearLandmarks: locationBody().append({radiusMeters: numOpt()}),
  createLandmark: Joi.object({
    lat: latAttr(),
    lng: langAttr(),
    displayLabel: strReq(),
  }),
  matchLandmark: Joi.object({
    lat: latAttr(),
    lng: langAttr(),
    embedding: Joi.array().items(Joi.number()).min(1).required(),
    radiusMeters: numOpt(),
  }),
  getRoute: Joi.object({
    originLat: latAttr(),
    originLng: langAttr(),
    destLat: latAttr(),
    destLng: langAttr(),
    stops: Joi.array().items(locationBody()).max(MAX_STOPS).optional(),
    width: numOpt(),
    vehicleType: Joi.string()
      .valid(...Object.values(VEHICLE_TYPE))
      .optional(),
    mode: Joi.string().valid("scooter", "car", "foot").optional(),
  }),
  saveRoute: Joi.object({
    name: Joi.string().max(120).allow("", null).optional(),
    originLat: latAttr(),
    originLng: langAttr(),
    destLat: latAttr(),
    destLng: langAttr(),
    stops: Joi.array().items(locationBody()).max(MAX_STOPS).optional(),
    width: numOpt(),
    distanceMeters: numOpt(),
    durationSeconds: numOpt(),
    source: Joi.string().max(32).allow("", null).optional(),
    geometry: Joi.object().unknown(true).required(),
  }),
  listSavedRoutes: emptyBody(),
  getSavedRoute: Joi.object({
    routeId: strReq(),
  }),
  renameSavedRoute: Joi.object({
    routeId: strReq(),
    name: Joi.string().trim().min(1).max(120).required(),
  }),
  deleteSavedRoute: Joi.object({
    routeId: strReq(),
  }),
  registerPush: Joi.object({
    token: Joi.string().min(1).max(4096).required(),
    platform: Joi.string().valid("android", "ios", "web").optional(),
  }),
  unregisterPush: Joi.object({
    token: Joi.string().min(1).max(4096).required(),
  }),
  deliverPush: Joi.object({
    flagId: strReq(),
    type: Joi.string().optional(),
    lat: latAttr().optional(),
    lng: langAttr().optional(),
    radiusMeters: Joi.number().min(25).max(3000).optional(),
    removed: Joi.boolean().optional(),
  }),
  createProvider: Joi.object({
    kind: Joi.string().valid("SHOP", "TOW").required(),
    name: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    label: Joi.string().trim().max(140).allow("", null).optional(),
    openHours: Joi.when("kind", {
      is: "SHOP",
      then: dayHoursPattern().allow("", null).optional(),
      otherwise: Joi.forbidden(),
    }),
    vehicleClasses: Joi.when("kind", {
      is: "SHOP",
      then: Joi.array()
        .items(Joi.string().valid(...Object.values(VEHICLE_CLASS)))
        .min(1)
        .max(2)
        .unique()
        .optional(),
      otherwise: Joi.forbidden(),
    }),
    plate: Joi.when("kind", {
      is: "TOW",
      then: Joi.string().trim().min(4).max(16).required(),
      otherwise: Joi.forbidden(),
    }),
    vehicleType: Joi.when("kind", {
      is: "TOW",
      then: Joi.string()
        .valid(...Object.values(TOW_VEHICLE_TYPE))
        .required(),
      otherwise: Joi.forbidden(),
    }),
    vehicleWidth: Joi.when("kind", {
      is: "TOW",
      then: Joi.number().min(0.3).max(3).optional(),
      otherwise: Joi.forbidden(),
    }),
    serviceFee: Joi.when("kind", {
      is: "SHOP",
      then: Joi.number().integer().min(0).max(999999999).optional(),
      otherwise: Joi.forbidden(),
    }),
    towBaseFee: Joi.when("kind", {
      is: "TOW",
      then: Joi.number().integer().min(0).max(999999999).optional(),
      otherwise: Joi.forbidden(),
    }),
    towPerKmFee: Joi.when("kind", {
      is: "TOW",
      then: Joi.number().integer().min(0).max(99999).optional(),
      otherwise: Joi.forbidden(),
    }),
  }),
  updateProvider: Joi.object({
    providerId: strReq(),
    name: Joi.string().trim().min(1).max(120).optional(),
    label: Joi.string().trim().max(140).allow("", null).optional(),
    openHours: dayHoursPattern().allow("", null).optional(),
    vehicleClasses: Joi.array()
      .items(Joi.string().valid(...Object.values(VEHICLE_CLASS)))
      .min(1)
      .max(2)
      .unique()
      .optional(),
    serviceFee: Joi.number().integer().min(0).max(999999999).optional(),
    towBaseFee: Joi.number().integer().min(0).max(999999999).optional(),
    towPerKmFee: Joi.number().integer().min(0).max(99999).optional(),
    accepting: Joi.boolean().optional(),
    lat: latAttr().optional(),
    lng: langAttr().optional(),
  }),
  nearProviders: locationBody().append({
    radiusMeters: Joi.number()
      .min(200)
      .max(SHOP_SEARCH_MAX_RADIUS)
      .optional(),
    kind: Joi.string().valid("SHOP", "TOW").optional(),
    acceptingOnly: Joi.boolean().optional(),
    openOnly: Joi.boolean().optional(),
    vehicleClass: Joi.string()
      .valid(...Object.values(VEHICLE_CLASS))
      .optional(),
    limit: Joi.number().integer().min(1).max(20).optional(),
  }),
  searchProviders: locationBody().append({
    query: Joi.string().trim().min(1).max(120).required(),
    vehicleClass: Joi.string()
      .valid(...Object.values(VEHICLE_CLASS))
      .optional(),
    radiusMeters: Joi.number()
      .min(200)
      .max(SHOP_SEARCH_MAX_RADIUS)
      .optional(),
    limit: Joi.number().integer().min(1).max(20).optional(),
  }),
  myProviders: emptyBody(),
  reviewProvider: Joi.object({
    providerId: strReq(),
    approve: Joi.boolean().required(),
    reviewNote: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  reportProvider: Joi.object({
    providerId: strReq(),
    reason: Joi.string()
      .valid(...Object.values(PROVIDER_REPORT_REASON))
      .required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
    ticketId: strOpt(),
  }),
  listReports: emptyBody(),
  dismissReport: Joi.object({
    reportId: strReq(),
  }),
  suspendProvider: Joi.object({
    providerId: strReq(),
    reason: Joi.string().trim().max(280).allow("", null).optional(),
    reportId: strOpt(),
  }),
  restoreProvider: Joi.object({
    providerId: strReq(),
  }),
  updateProviderLocation: locationBody(),
  searchPlaces: Joi.object({
    q: Joi.string().trim().min(2).max(80).required(),
    limit: Joi.number().integer().min(1).max(10).optional(),
  }),
  savePlace: Joi.object({
    label: Joi.string().trim().min(1).max(120).required(),
    lat: latAttr(),
    lng: langAttr(),
  }),
  listSavedPlaces: emptyBody(),
  unsavePlace: Joi.object({
    placeId: strReq(),
  }),
  createDiagnostic: Joi.object({
    category: Joi.string()
      .valid("FLAT_TIRE", "FLUID_LEAK", "CHAIN_SLACK", "SPARK_CAP")
      .required(),
    imagePath: strReq(),
  }),
  getDiagnostic: Joi.object({
    diagnosticId: strReq(),
  }),
  createDispatch: Joi.object({
    ticketType: Joi.string().valid("MECHANIC", "TOW", "SOS", "WALK_IN")
      .required(),
    lat: latAttr(),
    lng: langAttr(),
    diagnosticId: strOpt(),
    alleySegmentId: strOpt(),
    accessWidthMeters: Joi.number().min(0).max(20).optional(),
    note: Joi.string().max(280).allow("", null).optional(),
    providerId: strOpt(),
    destinationShopId: strOpt(),
    destinationPoint: Joi.object({
      lat: latAttr(),
      lng: langAttr(),
      label: Joi.string().max(140).allow("", null).optional(),
    }).optional(),
    vehicleType: Joi.string()
      .valid(...Object.values(VEHICLE_TYPE))
      .optional(),
    vehicleWidth: Joi.number().min(0.3).max(3).optional(),
    vehicleLabel: Joi.string().trim().max(120).allow("", null).optional(),
  }),
  getDispatch: Joi.object({
    ticketId: strReq(),
  }),
  getMyTickets: emptyBody(),
  updateDispatchStatus: Joi.object({
    ticketId: strReq(),
    status: Joi.string()
      .valid(...Object.values(STATUS_DISPATCH))
      .required(),
  }),
  acceptDispatch: Joi.object({
    ticketId: strReq(),
    shopId: strOpt(),
  }),
  declineDispatch: Joi.object({
    ticketId: strReq(),
    shopId: strReq(),
    reason: Joi.string()
      .valid(...Object.values(DECLINE_REASON))
      .required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  updateWorkOrder: Joi.object({
    ticketId: strReq(),
    workType: Joi.string().trim().max(280).allow("", null).optional(),
    quotedAmount: Joi.number().integer().min(0).max(999999999).optional(),
    finalAmount: Joi.number().integer().min(0).max(999999999).optional(),
    invoiceRef: Joi.string().trim().max(120).allow("", null).optional(),
  }),
  shopTickets: Joi.object({
    shopId: strReq(),
    limit: Joi.number().integer().min(1).max(50).optional(),
  }),
  feedTickets: Joi.object({
    limit: Joi.number().integer().min(1).max(50).optional(),
  }),
  selectDispatch: Joi.object({
    ticketId: strReq(),
    shopId: strReq(),
  }),
  updateDispatchDestination: Joi.object({
    ticketId: strReq(),
    destinationShopId: strOpt(),
    destinationPoint: Joi.object({
      lat: latAttr(),
      lng: langAttr(),
      label: Joi.string().max(140).allow("", null).optional(),
    }).optional(),
  }),
  nearDispatch: locationBody().append({
    radiusMeters: Joi.number()
      .min(200)
      .max(SHOP_SEARCH_MAX_RADIUS)
      .optional(),
    ticketType: Joi.string()
      .valid("MECHANIC", "TOW", "SOS")
      .optional(),
  }),
  dispatchOffers: locationBody().append({
    radiusMeters: Joi.number()
      .min(200)
      .max(SHOP_SEARCH_MAX_RADIUS)
      .optional(),
    kind: Joi.string().valid("SHOP", "TOW").optional(),
    limit: Joi.number().integer().min(1).max(20).optional(),
    accessWidthMeters: Joi.number().min(0).max(20).optional(),
  }),
  volunteerToggle: Joi.object({
    available: Joi.boolean().required(),
    volunteerRadiusKm: Joi.number().min(1).max(50).optional(),
    capability: Joi.string()
      .valid(...Object.values(VOLUNTEER_CAPABILITY))
      .optional(),
  }),
  volunteerHeartbeat: locationBody(),
  userRatings: Joi.object({
    userId: strReq(),
    targetKind: Joi.string()
      .valid(RATING_TARGET.VOLUNTEER, RATING_TARGET.RIDER)
      .required(),
    ticketId: strOpt(),
  }),
  submitRating: Joi.object({
    targetId: strReq(),
    targetKind: Joi.string()
      .valid(...Object.values(RATING_TARGET))
      .required(),
    ticketId: strReq(),
    score: Joi.number()
      .integer()
      .min(RATING_MIN)
      .max(RATING_MAX)
      .required(),
  }),
  replyRating: Joi.object({
    ratingId: strReq(),
    reply: Joi.string().trim().min(1).max(280).required(),
  }),
  providerRatings: Joi.object({
    providerId: strReq(),
  }),
  ratingsByTicket: Joi.object({
    ticketId: strReq(),
  }),
  deliverDispatch: Joi.object({
    ticketId: strReq(),
  }),
  getRoles: emptyBody(),
  getRoleByUser: emptyBody(),
  getStatuses: emptyBody(),
};

type Schemas = typeof schemas;

export {schemas, locationBody, Schemas, MAX_STOPS};
