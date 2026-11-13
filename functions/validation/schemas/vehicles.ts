import {strReq, numReq, emptyBody, rideConfigFields} from "./primitives";
import Joi from "joi";
import {VEHICLE_TYPE} from "../../constants/status";

export const vehiclesSchemas = {
  createVehicleProfile: Joi.object({
    type: Joi.string()
      .valid(...Object.values(VEHICLE_TYPE))
      .required(),
    baseWidth: numReq(),
    baseHeight: numReq(),
    label: Joi.string().trim().max(80).allow("", null).optional(),
    plate: Joi.string().trim().max(32).allow("", null).optional(),
  }),
  updateVehicleProfile: Joi.object({
    profileId: strReq(),
    label: Joi.string().trim().max(80).allow("", null).optional(),
    plate: Joi.string().trim().max(32).allow("", null).optional(),
    baseWidth: Joi.number().min(0.3).max(3).optional(),
    baseHeight: Joi.number().min(0.5).max(3).optional(),
  }),
  vehicleHistory: Joi.object({
    profileId: strReq(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
  addRideConfig: Joi.object({
    profileId: strReq(),
    ...rideConfigFields,
  }),
  getAllVehicleProfiles: emptyBody(),
  removeVehicleProfile: Joi.object({
    profileId: strReq(),
  }),
};
