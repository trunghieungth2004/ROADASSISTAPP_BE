import Joi from "joi";
import {
  RATING_MAX,
  RATING_MIN,
  RATING_TARGET,
  SHOP_SEARCH_MAX_RADIUS,
  STATUS_DISPATCH,
  STATUS_FLAGS,
  STATUS_USER,
  TOW_VEHICLE_TYPE,
  VEHICLE_TYPE,
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
  }),
  getOneUser: emptyBody(),
  updateUserRole: Joi.object({
    targetUserId: strReq(),
    role: strReq(),
  }),
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
  }),
  createShop: Joi.object({
    name: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    type: Joi.string().valid("SHOP", "MOBILE", "TOW").required(),
    openHours: Joi.string()
      .pattern(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
      .allow("", null)
      .optional(),
    hasTow: Joi.boolean().optional(),
    towVehicleType: Joi.string()
      .valid(...Object.values(TOW_VEHICLE_TYPE))
      .optional(),
    towVehicleWidth: Joi.number().min(0.3).max(3).optional(),
    operatorUid: strOpt(),
  }),
  updateShop: Joi.object({
    shopId: strReq(),
    name: Joi.string().trim().min(1).max(120).optional(),
    openHours: Joi.string()
      .pattern(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
      .allow("", null)
      .optional(),
    accepting: Joi.boolean().optional(),
    hasTow: Joi.boolean().optional(),
    towVehicleType: Joi.string()
      .valid(...Object.values(TOW_VEHICLE_TYPE))
      .allow(null)
      .optional(),
    towVehicleWidth: Joi.number().min(0.3).max(3).allow(null).optional(),
    operatorUid: strOpt(),
  }),
  nearShops: locationBody().append({
    radiusMeters: Joi.number()
      .min(200)
      .max(SHOP_SEARCH_MAX_RADIUS)
      .optional(),
    type: Joi.string().valid("SHOP", "MOBILE", "TOW").optional(),
    acceptingOnly: Joi.boolean().optional(),
    openOnly: Joi.boolean().optional(),
    limit: Joi.number().integer().min(1).max(20).optional(),
  }),
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
    ticketType: Joi.string().valid("MECHANIC", "TOW", "SOS").required(),
    lat: latAttr(),
    lng: langAttr(),
    diagnosticId: strOpt(),
    alleySegmentId: strOpt(),
    accessWidthMeters: Joi.number().min(0).max(20).optional(),
    note: Joi.string().max(280).allow("", null).optional(),
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
  }),
  getDispatch: Joi.object({
    ticketId: strReq(),
  }),
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
  selectDispatch: Joi.object({
    ticketId: strReq(),
    shopId: strReq(),
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
    kind: Joi.string().valid("SHOP", "MOBILE", "TOW").optional(),
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
  deliverDispatch: Joi.object({
    ticketId: strReq(),
  }),
  getRoles: emptyBody(),
  getRoleByUser: emptyBody(),
  getStatuses: emptyBody(),
};

type Schemas = typeof schemas;

export {schemas, locationBody, Schemas, MAX_STOPS};
