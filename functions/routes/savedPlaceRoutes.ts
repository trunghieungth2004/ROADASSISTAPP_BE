import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as savedPlaceController from "../controller/savedPlaceController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/places/save",
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
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.unsavePlace}),
    savedPlaceController.removeSavedPlace,
  );
};
