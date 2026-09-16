import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as ratingController from "../controller/ratingController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/ratings",
    requireAuth,
    validate({body: schemas.submitRating}),
    ratingController.submitRating,
  );
};
