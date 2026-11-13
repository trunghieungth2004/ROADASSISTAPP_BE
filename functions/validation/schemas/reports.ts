import Joi from "joi";
import {photoList, strOpt, strReq} from "./primitives";
import {
  REPORT_ACTION,
  REPORT_STATUS,
  REPORT_TARGET,
} from "../../constants/behaviorReports";

export const reportsSchemas = {
  reportFile: Joi.object({
    targetKind: Joi.string()
      .valid(...Object.values(REPORT_TARGET))
      .required(),
    targetId: strReq(),
    ticketId: strOpt(),
    reason: strReq(),
    note: Joi.string().trim().max(500).optional(),
    photoUrls: photoList().optional(),
  }),
  reportMine: Joi.object({}),
  adminReports: Joi.object({
    targetKind: Joi.string()
      .valid(...Object.values(REPORT_TARGET))
      .optional(),
    status: Joi.string()
      .valid(...Object.values(REPORT_STATUS))
      .optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
  adminReportDecide: Joi.object({
    reportId: strReq(),
    action: Joi.string()
      .valid(...Object.values(REPORT_ACTION))
      .required(),
    note: Joi.string().trim().max(500).optional(),
  }),
  reportRestrictionClear: Joi.object({
    targetKind: Joi.string()
      .valid(...Object.values(REPORT_TARGET))
      .required(),
    targetId: strReq(),
  }),
  userStanding: Joi.object({
    userId: strReq(),
  }),
  userStandingReset: Joi.object({
    userId: strReq(),
  }),
};
