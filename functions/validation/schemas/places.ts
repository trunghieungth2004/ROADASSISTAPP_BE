import {strReq, langAttr, latAttr, emptyBody} from "./primitives";
import Joi from "joi";


export const placesSchemas = {
  searchPlaces: Joi.object({
    q: Joi.string().trim().min(2).max(80).required(),
    limit: Joi.number().integer().min(1).max(10).optional(),
  }),
  savePlace: Joi.object({
    label: Joi.string().trim().min(1).max(120).required(),
    lat: latAttr(),
    lng: langAttr(),
  }),
  listSavedPlaces: emptyBody(),
  unsavePlace: Joi.object({
    placeId: strReq(),
  }),
};
