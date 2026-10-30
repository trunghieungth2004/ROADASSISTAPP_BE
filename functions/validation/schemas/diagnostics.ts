import {strReq} from "./primitives";
import Joi from "joi";


export const diagnosticsSchemas = {
  createDiagnostic: Joi.object({
    category: Joi.string()
      .valid("FLAT_TIRE", "FLUID_LEAK", "CHAIN_SLACK", "SPARK_CAP")
      .required(),
    imagePath: strReq(),
  }),
  getDiagnostic: Joi.object({
    diagnosticId: strReq(),
  }),
};
