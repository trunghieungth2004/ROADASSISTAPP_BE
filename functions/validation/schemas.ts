import Joi from "joi";

const strReq = (): Joi.StringSchema => Joi.string().required();
const strOpt = (): Joi.StringSchema => Joi.string().allow("", null).optional();
const numReq = (): Joi.NumberSchema => Joi.number().required();
const numOpt = (): Joi.NumberSchema => Joi.number().optional();
const boolReq = (): Joi.BooleanSchema => Joi.boolean().required();
const langAttr = (): Joi.NumberSchema =>
  Joi.number().min(-180).max(180).required();
const latAttr = (): Joi.NumberSchema =>
  Joi.number().min(-90).max(90).required();

const userIdBody = (): Joi.ObjectSchema => Joi.object({userId: strReq()});

const locationBody = (): Joi.ObjectSchema =>
  Joi.object({
    userId: strReq(),
    lat: latAttr(),
    lng: langAttr(),
  });

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
  getOneUser: userIdBody(),
  updateUserRole: Joi.object({
    userId: strReq(),
    targetUserId: strReq(),
    role: strReq(),
  }),
  updateUserTrust: Joi.object({
    userId: strReq(),
    targetUserId: strReq(),
    trustScore: numReq(),
  }),
  updateUserStatus: Joi.object({
    userId: strReq(),
    targetUserId: strReq(),
    status: boolReq(),
  }),
  getRoles: Joi.object({}).unknown(true),
  getRoleByUser: userIdBody(),
  createVehicleProfile: Joi.object({
    userId: strReq(),
    type: Joi.string().valid("SCOOTER", "CUB", "MANUAL").required(),
    baseWidth: numReq(),
    baseHeight: numReq(),
  }),
  addRideConfig: Joi.object({
    userId: strReq(),
    profileId: strReq(),
    ...rideConfigFields,
  }),
  getAllVehicleProfiles: Joi.object({
    userId: strReq(),
  }),
  getAlleySegment: Joi.object({
    userId: strReq(),
    segmentId: strReq(),
  }),
  searchAlleysNear: locationBody().append({radiusMeters: numOpt()}),
  createAlleySegment: Joi.object({
    userId: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    baseWidth: numOpt(),
    wireHeight: numOpt(),
    inclinePct: numOpt(),
    tier: Joi.string().valid("TIER1", "TIER2", "TIER3").required(),
  }),
  setPassability: Joi.object({
    userId: strReq(),
    segmentId: strReq(),
    baseWidth: numOpt(),
    wireHeight: numOpt(),
    inclinePct: numOpt(),
    tier: Joi.string().valid("TIER1", "TIER2", "TIER3").required(),
  }),
  moderateSegment: Joi.object({
    userId: strReq(),
    segmentId: strReq(),
    baseWidth: numOpt(),
    wireHeight: numOpt(),
    inclinePct: numOpt(),
    tier: Joi.string().valid("TIER1", "TIER2", "TIER3").optional(),
    verifiedCount: numOpt(),
  }),
  createFlag: Joi.object({
    userId: strReq(),
    type: Joi.string().valid("ACCIDENT", "FLOOD", "OBSTRUCTION").required(),
    lat: latAttr(),
    lng: langAttr(),
    note: Joi.string().allow("", null).optional(),
  }),
  moderateFlag: Joi.object({
    userId: strReq(),
    flagId: strReq(),
    status: Joi.string()
      .valid("SUGGESTED", "CONFIRMED", "LOCKED", "EXPIRED", "REJECTED")
      .required(),
  }),
  getFlagsNear: locationBody().append({radiusMeters: numOpt()}),
  confirmFlag: Joi.object({
    userId: strReq(),
    flagId: strReq(),
  }),
  nearLandmarks: locationBody().append({radiusMeters: numOpt()}),
  createLandmark: Joi.object({
    userId: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    displayLabel: strReq(),
  }),
  matchLandmark: Joi.object({
    userId: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    embedding: Joi.array().items(Joi.number()).min(1).required(),
    radiusMeters: numOpt(),
  }),
  getRoute: Joi.object({
    userId: strReq(),
    originLat: latAttr(),
    originLng: langAttr(),
    destLat: latAttr(),
    destLng: langAttr(),
    width: numOpt(),
  }),
  createShop: Joi.object({
    userId: strReq(),
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
    userId: strReq(),
    category: Joi.string()
      .valid("FLAT_TIRE", "FLUID_LEAK", "CHAIN_SLACK", "SPARK_CAP")
      .required(),
    imagePath: strReq(),
  }),
  getDiagnostic: Joi.object({
    userId: strReq(),
    diagnosticId: strReq(),
  }),
  createDispatch: Joi.object({
    userId: strReq(),
    ticketType: Joi.string().valid("MECHANIC", "TOW", "SOS").required(),
    lat: latAttr(),
    lng: langAttr(),
    diagnosticId: strOpt(),
  }),
  getDispatch: Joi.object({
    userId: strReq(),
    ticketId: strReq(),
  }),
  updateDispatchStatus: Joi.object({
    userId: strReq(),
    ticketId: strReq(),
    status: Joi.string()
      .valid("PENDING", "MATCHED", "ARRIVED", "RESOLVED", "CANCELLED")
      .required(),
  }),
};

export {schemas, userIdBody, locationBody};
