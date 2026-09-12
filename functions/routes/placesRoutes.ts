import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as placesController from "../controller/placesController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/places/search",
    requireAuth,
    validate({body: schemas.searchPlaces}),
    placesController.searchDirectory,
  );
};
