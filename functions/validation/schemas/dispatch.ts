import {
  strReq,
  strOpt,
  langAttr,
  latAttr,
  locationBody,
  emptyBody,
  photoList,
} from "./primitives";
import Joi from "joi";
import {
  DECLINE_REASON,
  SHOP_SEARCH_MAX_RADIUS,
  STATUS_DISPATCH,
  VEHICLE_TYPE,
} from "../../constants/status";
import {SHOP_DECLINE_REASON} from "../../constants/dispatch";


export const dispatchSchemas = {
  createDispatch: Joi.object({
    ticketType: Joi.string().valid("MECHANIC", "TOW", "SOS", "WALK_IN")
      .required(),
    lat: latAttr(),
    lng: langAttr(),
    diagnosticId: strOpt(),
    note: Joi.string().max(280).allow("", null).optional(),
    description: Joi.string().trim().max(1000).allow("", null).optional(),
    photoUrls: photoList().optional(),
    providerId: strOpt(),
    destinationShopId: strOpt(),
    destinationPoint: Joi.object({
      lat: latAttr(),
      lng: langAttr(),
      label: Joi.string().max(140).allow("", null).optional(),
    }).optional(),
    vehicleId: strOpt(),
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
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    reasonCode: Joi.string().trim().max(64).allow("", null).optional(),
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
  sendQuote: Joi.object({
    ticketId: strReq(),
    quotedAmount: Joi.number().integer().min(0).max(999999999).optional(),
    finalAmount: Joi.number().integer().min(0).max(999999999).optional(),
    workType: Joi.string().trim().max(280).allow("", null).optional(),
    faultPhotos: photoList().optional(),
  }).or("quotedAmount", "finalAmount"),
  sendEstimate: Joi.object({
    ticketId: strReq(),
    estimateAmount: Joi.number().integer().min(0).max(999999999).required(),
    estimateNote: Joi.string().trim().max(500).allow("", null).optional(),
    eta: Joi.number().integer().min(0).max(86400).optional(),
    faultPhotos: photoList().optional(),
  }),
  approveEstimate: Joi.object({
    ticketId: strReq(),
  }),
  declineEstimate: Joi.object({
    ticketId: strReq(),
    shopId: strOpt(),
  }),
  markUnfixable: Joi.object({
    ticketId: strReq(),
    reason: Joi.string().trim().min(1).max(500).required(),
    photoUrls: photoList().min(1).required(),
  }),
  setMobileShopFix: Joi.object({
    ticketId: strReq(),
    fixAmount: Joi.number().integer().min(0).max(999999999).required(),
  }),
  mobileShopTowOffer: Joi.object({
    ticketId: strReq(),
    destinationShopId: strOpt(),
  }),
  respondMobileShopTow: Joi.object({
    ticketId: strReq(),
    accept: Joi.boolean().required(),
    destinationShopId: strOpt(),
    destinationPoint: Joi.object({
      lat: latAttr(),
      lng: langAttr(),
      label: Joi.string().max(140).allow("", null).optional(),
    }).optional(),
  }),
  continueSos: Joi.object({
    ticketId: strReq(),
  }),
  respondReturnTow: Joi.object({
    ticketId: strReq(),
    accept: Joi.boolean().required(),
    destinationPoint: Joi.object({
      lat: latAttr(),
      lng: langAttr(),
      label: Joi.string().max(140).allow("", null).optional(),
    }).optional(),
  }),
  approveQuote: Joi.object({
    ticketId: strReq(),
  }),
  declineDestination: Joi.object({
    ticketId: strReq(),
    reasonCode: Joi.string()
      .valid(...Object.values(SHOP_DECLINE_REASON))
      .required(),
  }),
  cancelTowerSearch: Joi.object({
    ticketId: strReq(),
    lat: latAttr(),
    lng: langAttr(),
    reasonCode: Joi.string().trim().min(1).max(64).required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  waitingStatus: Joi.object({
    ticketId: strReq(),
  }),
  refreshTowEta: Joi.object({
    ticketId: strReq(),
  }),
  estimateTowFare: locationBody().append({
    ticketId: strReq(),
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
    minRating: Joi.number().min(0).max(5).optional(),
    sortBy: Joi.string().valid("distance", "rating").optional(),
    ticketId: strOpt(),
  }),
};
