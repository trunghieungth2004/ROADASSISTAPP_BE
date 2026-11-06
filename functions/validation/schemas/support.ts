import Joi from "joi";
import {strReq} from "./primitives";
import {
  SUPPORT_ANSWER_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_STATUS,
} from "../../constants/support";

export const supportSchemas = {
  supportCreate: Joi.object({
    category: Joi.string().valid(...SUPPORT_CATEGORIES).required(),
    message: Joi.string()
      .trim()
      .min(SUPPORT_MESSAGE_MIN)
      .max(SUPPORT_MESSAGE_MAX)
      .required(),
    ticketId: Joi.string().trim().max(80).optional(),
  }),
  supportMine: Joi.object({}),
  supportAdminList: Joi.object({
    status: Joi.string()
      .valid(
        SUPPORT_STATUS.OPEN,
        SUPPORT_STATUS.ANSWERED,
        SUPPORT_STATUS.CLOSED,
      )
      .optional(),
  }),
  supportRespond: Joi.object({
    supportId: strReq(),
    answer: Joi.string().trim().min(1).max(SUPPORT_ANSWER_MAX).required(),
    close: Joi.boolean().optional(),
  }),
};
