import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as routingController from "../controller/routingController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/routes",
    requireAuth,
    validate({body: schemas.getRoute}),
    routingController.getRoute,
  );
};
