import {strReq} from "./primitives";
import Joi from "joi";


import {
  BILL_LIST_MAX,
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../../constants/payments";
import {SUBSCRIPTION_PLAN_IDS} from "../../constants/subscriptions";


export const paymentsSchemas = {
  createPayment: Joi.object({
    ticketId: Joi.string().trim().max(120),
    planId: Joi.string().valid(...SUBSCRIPTION_PLAN_IDS),
    method: Joi.string()
      .valid(...Object.values(PAYMENT_METHOD))
      .required(),
  }).xor("ticketId", "planId"),
  confirmCash: Joi.object({
    ticketId: strReq(),
  }),
  cancelPayment: Joi.object({
    ticketId: strReq(),
  }),
  paymentOne: Joi.object({
    ticketId: strReq(),
  }),
  paymentsAll: Joi.object({
    status: Joi.string()
      .valid(...Object.values(PAYMENT_STATUS))
      .optional(),
    limit: Joi.number().integer().min(1).max(PAYMENT_LIST_MAX).optional(),
  }),
  billsAll: Joi.object({
    limit: Joi.number().integer().min(1).max(BILL_LIST_MAX).optional(),
  }),
  billOne: Joi.object({
    ticketId: Joi.string().trim().max(120).optional(),
    billId: Joi.string().trim().max(120).optional(),
    scope: Joi.string().valid("payee").optional(),
  }).or("ticketId", "billId"),
};
