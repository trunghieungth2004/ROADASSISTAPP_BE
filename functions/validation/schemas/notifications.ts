import Joi from "joi";


export const notificationsSchemas = {
  notificationPrefs: Joi.object({}),
  notificationPrefsUpdate: Joi.object({
    paymentUpdates: Joi.boolean().optional(),
    payoutUpdates: Joi.boolean().optional(),
  }).min(1),
};
