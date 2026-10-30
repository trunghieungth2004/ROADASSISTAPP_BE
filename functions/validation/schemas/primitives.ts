import Joi from "joi";
import {
  PROVIDER_SERVICE_CODE_MAX,
  PROVIDER_SERVICE_NAME_MAX,
  PROVIDER_SERVICE_PRICE_MAX,
  PROVIDER_SERVICES_MAX,
} from "../../constants/status";


import {PHOTO_MAX_COUNT, PHOTO_URL_MAX_LENGTH} from "../../constants/media";


export const strReq = (): Joi.StringSchema => Joi.string().required();
export const strOpt = (): Joi.StringSchema =>
  Joi.string().allow("", null).optional();
export const numReq = (): Joi.NumberSchema => Joi.number().required();
export const numOpt = (): Joi.NumberSchema => Joi.number().optional();
export const langAttr = (): Joi.NumberSchema =>
  Joi.number().min(-180).max(180).required();
export const latAttr = (): Joi.NumberSchema =>
  Joi.number().min(-90).max(90).required();

export const locationBody = (): Joi.ObjectSchema =>
  Joi.object({
    lat: latAttr(),
    lng: langAttr(),
  });

export const MAX_STOPS = 10;

export const emptyBody = (): Joi.ObjectSchema => Joi.object({}).unknown(true);

export const photoList = (): Joi.ArraySchema =>
  Joi.array()
    .items(Joi.string().max(PHOTO_URL_MAX_LENGTH))
    .max(PHOTO_MAX_COUNT);

export const dayInterval =
  "((MON|TUE|WED|THU|FRI|SAT|SUN) )?\\d{2}:\\d{2}-\\d{2}:\\d{2}";

export const dayHoursPattern = (): Joi.StringSchema =>
  Joi.string().pattern(
    new RegExp(`^${dayInterval}(,${dayInterval})*$`),
  );

export const providerServiceItem = (): Joi.ObjectSchema =>
  Joi.object({
    code: Joi.string().trim().min(1).max(PROVIDER_SERVICE_CODE_MAX)
      .required(),
    name: Joi.string().trim().min(1).max(PROVIDER_SERVICE_NAME_MAX)
      .required(),
    displayPrice: Joi.number().integer().min(0)
      .max(PROVIDER_SERVICE_PRICE_MAX).required(),
    quoteRequired: Joi.boolean().required(),
  });

export const providerServiceList = (): Joi.ArraySchema =>
  Joi.array()
    .items(providerServiceItem())
    .max(PROVIDER_SERVICES_MAX)
    .optional();

export const rideConfigFields = {
  configType: Joi.string().valid("SOLO", "PASSENGER", "CARGO").required(),
  estWidth: numOpt(),
  estHeight: numOpt(),
};
