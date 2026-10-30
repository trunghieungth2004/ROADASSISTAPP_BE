import {
  strReq,
  strOpt,
  langAttr,
  latAttr,
  locationBody,
  emptyBody,
  dayHoursPattern,
  providerServiceList,
} from "./primitives";
import Joi from "joi";
import {
  PROVIDER_REPORT_REASON,
  SHOP_SEARCH_MAX_RADIUS,
  TOW_VEHICLE_TYPE,
  VEHICLE_TYPE,
  VEHICLE_CLASS,
} from "../../constants/status";


export const providersSchemas = {
  createProvider: Joi.object({
    kind: Joi.string().valid("SHOP", "TOW", "MOBILE_SHOP").required(),
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
      is: Joi.valid("TOW", "MOBILE_SHOP"),
      then: Joi.string().trim().min(4).max(16).required(),
      otherwise: Joi.forbidden(),
    }),
    vehicleType: Joi.when("kind", {
      is: "TOW",
      then: Joi.string()
        .valid(...Object.values(TOW_VEHICLE_TYPE))
        .required(),
      otherwise: Joi.when("kind", {
        is: "MOBILE_SHOP",
        then: Joi.string()
          .valid(...Object.values(VEHICLE_TYPE))
          .required(),
        otherwise: Joi.forbidden(),
      }),
    }),
    vehicleWidth: Joi.when("kind", {
      is: Joi.valid("TOW", "MOBILE_SHOP"),
      then: Joi.number().min(0.3).max(3).optional(),
      otherwise: Joi.forbidden(),
    }),
    serviceFee: Joi.when("kind", {
      is: "SHOP",
      then: Joi.number().integer().min(0).max(999999999).optional(),
      otherwise: Joi.forbidden(),
    }),
    services: Joi.when("kind", {
      is: "SHOP",
      then: providerServiceList(),
      otherwise: Joi.forbidden(),
    }),
    licenseNumber: Joi.when("kind", {
      is: "MOBILE_SHOP",
      then: Joi.string().trim().min(2).max(80).required(),
      otherwise: Joi.forbidden(),
    }),
    licensePhotoUrl: Joi.when("kind", {
      is: "MOBILE_SHOP",
      then: Joi.string().trim().max(500).allow("", null).optional(),
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
    services: providerServiceList(),
    licenseNumber: Joi.string().trim().min(2).max(80).optional(),
    licensePhotoUrl: Joi.string().trim().max(500).allow("", null).optional(),
    plate: Joi.string().trim().min(4).max(16).optional(),
    vehicleType: Joi.string()
      .valid(...Object.values(VEHICLE_TYPE))
      .optional(),
    vehicleWidth: Joi.number().min(0.3).max(3).optional(),
    towBaseFee: Joi.number().integer().min(0).max(999999999).optional(),
    towPerKmFee: Joi.number().integer().min(0).max(99999).optional(),
    accepting: Joi.boolean().optional(),
    lat: latAttr().optional(),
    lng: langAttr().optional(),
  }).and("lat", "lng"),
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
    minRating: Joi.number().min(0).max(5).optional(),
    sortBy: Joi.string().valid("distance", "rating").optional(),
    ticketId: strOpt(),
  }),
  searchProviders: locationBody().append({
    query: Joi.string().trim().min(1).max(120).required(),
    kind: Joi.string().valid("SHOP", "TOW").optional(),
    vehicleClass: Joi.string()
      .valid(...Object.values(VEHICLE_CLASS))
      .optional(),
    radiusMeters: Joi.number()
      .min(200)
      .optional(),
    limit: Joi.number().integer().min(1).max(20).optional(),
    minRating: Joi.number().min(0).max(5).optional(),
    sortBy: Joi.string().valid("distance", "rating").optional(),
    ticketId: strOpt(),
  }),
  myProviders: emptyBody(),
  revokeProvider: Joi.object({
    providerId: strReq(),
  }),
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
  providerRatings: Joi.object({
    providerId: strReq(),
  }),
};
