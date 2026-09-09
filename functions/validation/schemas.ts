import Joi from "joi";
import {
  STATUS_DISPATCH,
  STATUS_FLAGS,
  STATUS_USER,
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
    type: Joi.string().valid("SCOOTER", "CUB", "MANUAL").required(),
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
  }),
  moderateFlag: Joi.object({
    flagId: strReq(),
    status: Joi.string()
      .valid(...Object.values(STATUS_FLAGS))
      .required(),
  }),
  getFlagsNear: locationBody().append({radiusMeters: numOpt()}),
  confirmFlag: Joi.object({
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
    width: numOpt(),
  }),
  createShop: Joi.object({
    name: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    type: Joi.string().valid("SHOP", "PUMP").required(),
  }),
  nearShops: locationBody().append({
    radiusMeters: numOpt(),
    type: Joi.string().valid("SHOP", "PUMP").optional(),
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
  getRoles: emptyBody(),
  getRoleByUser: emptyBody(),
  getStatuses: emptyBody(),
};

type Schemas = typeof schemas;

export {schemas, locationBody, Schemas};
