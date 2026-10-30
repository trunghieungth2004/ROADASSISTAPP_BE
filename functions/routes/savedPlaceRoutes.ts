import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {SERVICE_ROLE} from "../constants/status";
import * as savedPlaceController from "../controller/savedPlaceController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/places/save",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.savePlace}),
    savedPlaceController.savePlace,
  );
  app.post(
    "/places/saved",
    requireAuth,
    validate({body: schemas.listSavedPlaces}),
    savedPlaceController.listSavedPlaces,
  );
  app.post(
    "/places/unsave",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.unsavePlace}),
    savedPlaceController.removeSavedPlace,
  );
};
