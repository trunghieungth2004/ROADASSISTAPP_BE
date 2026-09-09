import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as flagController from "../controller/flagController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/flags",
    requireAuth,
    validate({body: schemas.createFlag}),
    flagController.createFlag,
  );
  app.post(
    "/flags/confirm",
    requireAuth,
    validate({body: schemas.confirmFlag}),
    flagController.confirmFlag,
  );
  app.post(
    "/flags/near",
    requireAuth,
    validate({body: schemas.getFlagsNear}),
    flagController.getNear,
  );
  app.put(
    "/flags/moderate",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.moderateFlag}),
    flagController.moderateFlag,
  );
  app.post(
    "/flags/expire",
    requireAuth,
    requireRole("1"),
    flagController.expireFlags,
  );
};
