import {
  strReq,
  numOpt,
  langAttr,
  latAttr,
  locationBody,
  MAX_STOPS,
  emptyBody,
} from "./primitives";
import Joi from "joi";
import {VEHICLE_TYPE} from "../../constants/status";


export const routesSchemas = {
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
};
