import Joi from "joi";
import {photoList, strReq} from "./primitives";
import {
  APPEAL_RESOLUTION,
  APPEAL_STATUS,
  APPEAL_SUBJECT,
} from "../../constants/appeals";

export const appealsSchemas = {
  fileAppeal: Joi.object({
    subjectKind: Joi.string()
      .valid(...Object.values(APPEAL_SUBJECT))
      .required(),
    subjectId: strReq(),
    reason: Joi.string().trim().min(1).max(64).required(),
    note: Joi.string().trim().min(1).max(500).required(),
    photoUrls: photoList().optional(),
  }),
  eligibleAppeals: Joi.object({}),
  adminAppeals: Joi.object({
    subjectKind: Joi.string()
      .valid(...Object.values(APPEAL_SUBJECT))
      .optional(),
    status: Joi.string()
      .valid(...Object.values(APPEAL_STATUS))
      .optional(),
  }),
  decideAppeal: Joi.object({
    appealId: strReq(),
    resolution: Joi.string()
      .valid(...Object.values(APPEAL_RESOLUTION))
      .required(),
    note: Joi.string().trim().min(1).max(500).required(),
    adjustedAmount: Joi.number().integer().min(0).optional(),
  }),
};
