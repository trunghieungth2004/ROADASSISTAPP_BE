import {strReq, photoList} from "./primitives";
import Joi from "joi";


export const chatSchemas = {
  chatRoom: Joi.object({
    scope: Joi.string().valid("TICKET", "HAZARD").required(),
    refId: strReq(),
    version: Joi.number().integer().min(0).optional(),
  }),
  chatSend: Joi.object({
    scope: Joi.string().valid("TICKET", "HAZARD").required(),
    refId: strReq(),
    version: Joi.number().integer().min(0).optional(),
    text: Joi.string().trim().max(1000).allow("", null).optional(),
    photoUrls: photoList().optional(),
  }),
};
