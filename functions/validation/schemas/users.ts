import {strReq, strOpt, emptyBody} from "./primitives";
import Joi from "joi";
import {
  RATING_TARGET,
  SERVICE_ROLE,
  STATUS_USER,
} from "../../constants/status";


export const usersSchemas = {
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
      .valid(...Object.values(SERVICE_ROLE), "SHOP", "TOW")
      .optional(),
    role: Joi.string()
      .valid(...Object.values(SERVICE_ROLE), "SHOP", "TOW")
      .optional(),
  }).or("service", "role"),
  updateUserRole: Joi.object({
    targetUserId: strReq(),
    role: Joi.string().valid("1", "2").required(),
  }),
  updateUserServices: Joi.object({
    targetUserId: strReq(),
    grant: Joi.array()
      .items(Joi.string().valid(...Object.values(SERVICE_ROLE)))
      .unique()
      .optional(),
    revoke: Joi.array()
      .items(Joi.string().valid(...Object.values(SERVICE_ROLE)))
      .unique()
      .optional(),
  }).or("grant", "revoke"),
  updateUserTrust: Joi.object({
    targetUserId: strReq(),
    trustScore: Joi.number().integer().min(0).max(100).required(),
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
  userRatings: Joi.object({
    userId: strReq(),
    targetKind: Joi.string()
      .valid(RATING_TARGET.RIDER)
      .required(),
    ticketId: strOpt(),
  }),
};
