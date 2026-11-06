import {strReq, strOpt, emptyBody} from "./primitives";
import Joi from "joi";


import {REPORT_FORMAT} from "../../constants/reports";

import {
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYOUT_LIST_MAX,
  PAYOUT_REQUEST_STATUS,
  REFUND_LIST_MAX,
  REFUND_POLICY,
  REFUND_STATUS,
} from "../../constants/payments";
import {
  ACCOUNT_NUMBER_PATTERN,
  HOLDER_NAME_PATTERN,
} from "../../constants/banks";


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
    providerPricing: Joi.object({
      TOW: Joi.object({
        baseMin: Joi.number().integer().min(0).max(999999999).optional(),
        baseMax: Joi.number().integer().min(0).max(999999999).optional(),
        perKmMin: Joi.number().integer().min(0).max(999999).optional(),
        perKmMax: Joi.number().integer().min(0).max(999999).optional(),
      }).optional(),
      MOBILE_SHOP: Joi.object({
        callOutMin: Joi.number().integer().min(0).max(999999999).optional(),
        callOutMax: Joi.number().integer().min(0).max(999999999).optional(),
        travelPerKmMin: Joi.number().integer().min(0).max(999999).optional(),
        travelPerKmMax: Joi.number().integer().min(0).max(999999).optional(),
      }).optional(),
    }).optional(),
    paymentMethodsEnabled: Joi.array()
      .items(Joi.string().valid(...Object.values(PAYMENT_METHOD)))
      .optional(),
    refundPolicy: Joi.string()
      .valid(...Object.values(REFUND_POLICY))
      .optional(),
    features: Joi.object({
      quickFix: Joi.boolean().optional(),
      towCashAtDelivery: Joi.boolean().optional(),
      phoneMasking: Joi.boolean().optional(),
    }).optional(),
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
  payoutBanks: emptyBody(),
  payoutStatement: Joi.object({
    from: Joi.string().trim().max(40).optional(),
    to: Joi.string().trim().max(40).optional(),
  }),
  payoutAccountGet: emptyBody(),
  payoutAccountSet: Joi.object({
    bankCode: Joi.string().trim().min(2).max(24).required(),
    accountNumber: Joi.string().trim()
      .pattern(ACCOUNT_NUMBER_PATTERN).required(),
    holderName: Joi.string().trim().min(2).max(80)
      .pattern(HOLDER_NAME_PATTERN).required(),
  }),
  payoutRequest: Joi.object({
    amount: Joi.number().integer().min(10000).max(999999999).required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  adminPayoutRequests: Joi.object({
    status: Joi.string()
      .valid(...Object.values(PAYOUT_REQUEST_STATUS))
      .optional(),
    limit: Joi.number().integer().min(1).max(PAYOUT_LIST_MAX).optional(),
  }),
  adminPayoutRequestDecide: Joi.object({
    requestId: strReq(),
    approve: Joi.boolean().required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
    payoutRef: Joi.string().trim().max(80).optional(),
  }),
  adminCommissionSettle: Joi.object({
    payeeId: strReq(),
  }),
  refundMine: emptyBody(),
  refundRequest: Joi.object({
    paymentId: strReq(),
    amount: Joi.number().integer().min(1).max(999999999).optional(),
    reason: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  adminRefunds: Joi.object({
    status: Joi.string()
      .valid(...Object.values(REFUND_STATUS))
      .optional(),
    limit: Joi.number().integer().min(1).max(REFUND_LIST_MAX).optional(),
  }),
  adminRefundDecide: Joi.object({
    refundId: strReq(),
    approve: Joi.boolean().required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  adminRefundSend: Joi.object({
    refundId: strReq(),
    transferRef: Joi.string().trim().max(120).allow("", null).optional(),
  }),
  adminRefundConfirm: Joi.object({
    refundId: strReq(),
    transferRef: Joi.string().trim().max(120).allow("", null).optional(),
  }),
  adminRefundFail: Joi.object({
    refundId: strReq(),
    reason: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  warrantyFile: Joi.object({
    ticketId: strReq(),
    lineId: strReq(),
    reason: Joi.string().trim().min(5).max(280).required(),
    photoUrls: Joi.array().items(Joi.string().max(500)).max(5).optional(),
  }),
  warrantyMine: Joi.object({
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
  warrantyShop: Joi.object({
    providerId: Joi.string().trim().max(120).optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
  warrantyRespond: Joi.object({
    claimId: strReq(),
    accept: Joi.boolean().required(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  warrantyDispute: Joi.object({
    claimId: strReq(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  adminWarrantyClaims: Joi.object({
    status: Joi.string().trim().max(24).optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
  adminWarrantyResolve: Joi.object({
    claimId: strReq(),
    outcome: Joi.string().valid("SHOP", "RIDER", "PARTIAL").required(),
    refundAmount: Joi.number().integer().min(1).max(999999999).optional(),
    note: Joi.string().trim().max(280).allow("", null).optional(),
  }),
  adminAudit: Joi.object({
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
  adminDashboard: Joi.object({
    days: Joi.number().integer().min(1).max(365).optional(),
  }),
  providerStats: Joi.object({
    providerId: strReq(),
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
