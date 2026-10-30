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
