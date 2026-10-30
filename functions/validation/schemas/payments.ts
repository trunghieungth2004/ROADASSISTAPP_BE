import {strReq} from "./primitives";
import Joi from "joi";


import {
  BILL_LIST_MAX,
  PAYMENT_LIST_MAX,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
} from "../../constants/payments";


export const paymentsSchemas = {
  createPayment: Joi.object({
    ticketId: strReq(),
    method: Joi.string()
      .valid(...Object.values(PAYMENT_METHOD))
      .required(),
  }),
  confirmCash: Joi.object({
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
