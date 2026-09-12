import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as savedPlaceController from "../controller/savedPlaceController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/places/save",
    requireAuth,
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
    validate({body: schemas.unsavePlace}),
    savedPlaceController.removeSavedPlace,
  );
};
