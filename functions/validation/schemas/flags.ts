import {
  strReq,
  numOpt,
  langAttr,
  latAttr,
  locationBody,
  emptyBody,
  photoList,
} from "./primitives";
import Joi from "joi";
import {STATUS_FLAGS} from "../../constants/status";


export const flagsSchemas = {
  createFlag: Joi.object({
    type: Joi.string().valid("ACCIDENT", "FLOOD", "OBSTRUCTION").required(),
    lat: latAttr(),
    lng: langAttr(),
    note: Joi.string().allow("", null).optional(),
    radiusMeters: Joi.number().min(25).max(3000).optional(),
    photoUrls: photoList().optional(),
    ttlMinutes: Joi.number().integer().min(15).max(10080).optional(),
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
};
