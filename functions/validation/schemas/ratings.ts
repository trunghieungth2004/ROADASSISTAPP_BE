import {strReq} from "./primitives";
import Joi from "joi";
import {RATING_MAX, RATING_MIN, RATING_TARGET} from "../../constants/status";


export const ratingsSchemas = {
  submitRating: Joi.object({
    targetId: strReq(),
    targetKind: Joi.string()
      .valid(...Object.values(RATING_TARGET))
      .required(),
    ticketId: strReq(),
    score: Joi.number()
      .integer()
      .min(RATING_MIN)
      .max(RATING_MAX)
      .required(),
    text: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  replyRating: Joi.object({
    ratingId: strReq(),
    reply: Joi.string().trim().min(1).max(280).required(),
  }),
  ratingsByTicket: Joi.object({
    ticketId: strReq(),
  }),
};
