import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as notificationController from "../controller/notificationController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/notifications/prefs",
    writeLimited,
    requireAuth,
    validate({body: schemas.notificationPrefs}),
    notificationController.getPrefs,
  );
  app.put(
    "/notifications/prefs",
    writeLimited,
    requireAuth,
    validate({body: schemas.notificationPrefsUpdate}),
    notificationController.updatePrefs,
  );
};
