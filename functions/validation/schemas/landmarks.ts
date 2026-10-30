import {strReq, numOpt, langAttr, latAttr, locationBody} from "./primitives";
import Joi from "joi";


export const landmarksSchemas = {
  nearLandmarks: locationBody().append({radiusMeters: numOpt()}),
  createLandmark: Joi.object({
    lat: latAttr(),
    lng: langAttr(),
    displayLabel: strReq(),
  }),
  matchLandmark: Joi.object({
    lat: latAttr(),
    lng: langAttr(),
    embedding: Joi.array().items(Joi.number()).min(1).required(),
    radiusMeters: numOpt(),
  }),
};
