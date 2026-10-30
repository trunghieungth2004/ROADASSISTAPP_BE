import {strReq, strOpt, photoList} from "./primitives";
import Joi from "joi";


import {
  ACCUSED_KIND,
  DISPUTE_LIST_MAX,
  DISPUTE_OUTCOME,
  DISPUTE_REASON,
  DISPUTE_STATUS,
  DISPUTE_TYPE,
} from "../../constants/disputes";


export const disputesSchemas = {
  fileDispute: Joi.object({
    ticketId: strReq(),
    accusedId: strOpt(),
    accusedKind: Joi.string()
      .valid(...Object.values(ACCUSED_KIND))
      .optional(),
    type: Joi.string()
      .valid(...Object.values(DISPUTE_TYPE))
      .optional(),
    reasonCode: Joi.string()
      .valid(...Object.values(DISPUTE_REASON))
      .optional(),
    reason: Joi.string().trim().max(40).optional(),
    note: Joi.string().trim().max(500).allow("", null).optional(),
    photoUrls: photoList().optional(),
    photoUrl: Joi.string().trim().max(500).optional(),
  }).or("reasonCode", "reason"),
  disputeOne: Joi.object({
    disputeId: strReq(),
  }),
  disputesAll: Joi.object({
    status: Joi.string()
      .valid(...Object.values(DISPUTE_STATUS))
      .optional(),
    limit: Joi.number().integer().min(1).max(DISPUTE_LIST_MAX).optional(),
  }),
  resolveDispute: Joi.object({
    disputeId: strReq(),
    resolution: Joi.string().trim().min(1).max(120).required(),
    outcome: Joi.string()
      .valid(...Object.values(DISPUTE_OUTCOME))
      .optional(),
    adjustedAmount: Joi.number().integer().min(0).max(999999999).optional(),
    refundAdjust: Joi.number().integer().min(0).max(999999999).optional(),
    payoutAdjust: Joi.number().integer().min(0).max(999999999).optional(),
  }),
};
