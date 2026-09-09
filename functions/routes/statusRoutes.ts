import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as statusController from "../controller/statusController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/statuses",
    requireAuth,
    validate({body: schemas.getStatuses}),
    statusController.getStatuses,
  );
};
