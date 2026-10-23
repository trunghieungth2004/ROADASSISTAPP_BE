import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as notificationController from "../controller/notificationController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/notifications/prefs",
    requireAuth,
    validate({body: schemas.notificationPrefs}),
    notificationController.getPrefs,
  );
  app.put(
    "/notifications/prefs",
    requireAuth,
    validate({body: schemas.notificationPrefsUpdate}),
    notificationController.updatePrefs,
  );
};
