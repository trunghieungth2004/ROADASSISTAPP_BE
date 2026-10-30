import {strReq, strOpt, emptyBody} from "./primitives";
import Joi from "joi";


import {REPORT_FORMAT} from "../../constants/reports";

import {
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYOUT_LIST_MAX,
  REFUND_POLICY,
} from "../../constants/payments";


export const adminSchemas = {
  adminConfigGet: emptyBody(),
  adminConfigUpdate: Joi.object({
    commissionRate: Joi.object({
      MECHANIC: Joi.number().min(0).max(100).optional(),
      TOW: Joi.number().min(0).max(100).optional(),
      SOS: Joi.number().min(0).max(100).optional(),
      WALK_IN: Joi.number().min(0).max(100).optional(),
    }).optional(),
    towBaseFee: Joi.number().integer().min(0).max(999999999).optional(),
    towPerKmFee: Joi.number().integer().min(0).max(999999).optional(),
    carBaseFee: Joi.number().integer().min(0).max(999999999).optional(),
    carMultiplier: Joi.number().min(0).max(10).optional(),
    nightMultiplier: Joi.number().min(0).max(10).optional(),
    nightWindow: Joi.object({
      start: Joi.number().integer().min(0).max(23).required(),
      end: Joi.number().integer().min(0).max(23).required(),
    }).optional(),
    minimumTowFee: Joi.number().integer().min(0).max(999999999).optional(),
    bikeIncludedKm: Joi.number().min(0).max(1000).optional(),
    carIncludedKm: Joi.number().min(0).max(1000).optional(),
    ceilingMultiplier: Joi.number().min(1).max(5).optional(),
    waitingRatePer15Min: Joi.number().integer().min(0).max(999999999)
      .optional(),
    waitingGraceMin: Joi.number().integer().min(0).max(1440).optional(),
    waitingCapMin: Joi.number().integer().min(0).max(1440).optional(),
    detourTolerancePct: Joi.number().min(0).max(100).optional(),
    deadheadPayable: Joi.boolean().optional(),
    paymentMethodsEnabled: Joi.array()
      .items(Joi.string().valid(...Object.values(PAYMENT_METHOD)))
      .optional(),
    refundPolicy: Joi.string()
      .valid(...Object.values(REFUND_POLICY))
      .optional(),
  }),
  adminPayout: Joi.object({
    paymentId: strReq(),
  }),
  payoutsPending: Joi.object({
    payeeId: strOpt(),
    limit: Joi.number().integer().min(1).max(PAYOUT_LIST_MAX).optional(),
  }),
  payoutsSettle: Joi.object({
    payeeId: strReq(),
    paymentIds: Joi.array()
      .items(Joi.string().required())
      .min(1)
      .max(PAYOUT_LIST_MAX)
      .optional(),
    payoutRef: Joi.string().trim().max(80).optional(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  payoutsBatches: Joi.object({
    payeeId: strOpt(),
    limit: Joi.number().integer().min(1).max(PAYOUT_LIST_MAX).optional(),
  }),
  payoutMine: Joi.object({
    limit: Joi.number().integer().min(1).max(PAYOUT_LIST_MAX).optional(),
  }),
  paymentsAudit: Joi.object({
    limit: Joi.number().integer().min(1).max(PAYMENT_LIST_MAX).optional(),
  }),
  reportRange: Joi.object({
    from: strOpt(),
    to: strOpt(),
    format: Joi.string().valid(...Object.values(REPORT_FORMAT)).optional(),
  }),
};
