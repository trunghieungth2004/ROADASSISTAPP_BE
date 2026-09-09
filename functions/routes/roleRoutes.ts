import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as roleController from "../controller/roleController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/roles/all",
    requireAuth,
    validate({body: schemas.getRoles}),
    roleController.getRoles,
  );
  app.post(
    "/roles/user",
    requireAuth,
    validate({body: schemas.getRoleByUser}),
    roleController.getRoleByUser,
  );
};
