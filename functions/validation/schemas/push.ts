import {strReq, langAttr, latAttr, emptyBody} from "./primitives";
import Joi from "joi";


export const pushSchemas = {
  registerPush: Joi.object({
    token: Joi.string().min(1).max(4096).required(),
    platform: Joi.string().valid("android", "ios", "web").optional(),
  }),
  unregisterPush: Joi.object({
    token: Joi.string().min(1).max(4096).required(),
  }),
  pingPush: emptyBody(),
  deliverPush: Joi.object({
    flagId: strReq(),
    type: Joi.string().optional(),
    lat: latAttr().optional(),
    lng: langAttr().optional(),
    radiusMeters: Joi.number().min(25).max(3000).optional(),
    removed: Joi.boolean().optional(),
  }),
  deliverDispatch: Joi.object({
    ticketId: strReq(),
    audience: Joi.string().valid(
      "operator",
      "rider",
      "tower-candidates",
      "destination-shop",
    ).optional(),
    shopId: Joi.string().trim().max(120).optional(),
    title: Joi.string().trim().max(120).optional(),
    body: Joi.string().trim().max(280).optional(),
    urgent: Joi.boolean().truthy("true").falsy("false").optional(),
    action: Joi.string().trim().max(80).optional(),
    offerAt: Joi.string().trim().max(80).optional(),
  }),
};
