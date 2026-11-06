import Joi from "joi";
import {strReq, emptyBody} from "./primitives";
import {BOOKING_NOTE_MAX, BOOKING_SERVICE_MAX} from "../../constants/booking";

const bookingDate = Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/);

export const bookingsSchemas = {
  bookingAvailability: Joi.object({
    providerId: strReq(),
    date: bookingDate.optional(),
  }),
  bookingCreate: Joi.object({
    providerId: strReq(),
    scheduledAt: Joi.string()
      .trim()
      .pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      .required(),
    serviceCodes: Joi.array()
      .items(Joi.string().trim().min(1).max(40))
      .max(BOOKING_SERVICE_MAX)
      .unique()
      .optional(),
    note: Joi.string().trim().max(BOOKING_NOTE_MAX).allow("", null)
      .optional(),
    vehicleId: Joi.string().trim().max(80).optional(),
    arrivalMode: Joi.string().valid("SELF", "TOW").optional(),
    origin: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      label: Joi.string().trim().max(140).allow("", null).optional(),
    }).optional(),
    bufferMinutes: Joi.number().integer().min(0).max(240).optional(),
  }),
  bookingUpdate: Joi.object({
    bookingId: strReq(),
    arrivalMode: Joi.string().valid("SELF", "TOW").optional(),
    origin: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      label: Joi.string().trim().max(140).allow("", null).optional(),
    }).optional(),
    bufferMinutes: Joi.number().integer().min(0).max(240).optional(),
  }),
  bookingRespond: Joi.object({
    bookingId: strReq(),
    accept: Joi.boolean().required(),
    reason: Joi.string().trim().max(200).allow("", null).optional(),
  }),
  bookingCancel: Joi.object({
    bookingId: strReq(),
    reason: Joi.string().trim().max(200).allow("", null).optional(),
  }),
  bookingArrive: Joi.object({
    bookingId: strReq(),
  }),
  bookingShop: Joi.object({
    providerId: strReq(),
  }),
  bookingDeposit: Joi.object({
    bookingId: strReq(),
    collected: Joi.boolean().optional(),
  }),
  bookingDepositRequest: Joi.object({
    bookingId: strReq(),
  }),
  bookingMine: emptyBody(),
};
