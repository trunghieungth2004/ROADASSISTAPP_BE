import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as flagController from "../controller/flagController";

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/flags",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createFlag}),
    flagController.createFlag,
  );
  app.post(
    "/flags/confirm",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.confirmFlag}),
    flagController.confirmFlag,
  );
  app.post(
    "/flags/deny",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.denyFlag}),
    flagController.denyFlag,
  );
  app.post(
    "/flags/near",
    requireAuth,
    validate({body: schemas.getFlagsNear}),
    flagController.getNear,
  );
  app.post(
    "/flags/mine",
    requireAuth,
    validate({body: schemas.getMyFlags}),
    flagController.getMine,
  );
  app.post(
    "/flags/all",
    requireAuth,
    requireRole("1"),
    flagController.getAllFlags,
  );
  app.put(
    "/flags/moderate",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.moderateFlag}),
    flagController.moderateFlag,
  );
  app.post(
    "/flags/unflag",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.unflagFlag}),
    flagController.unflagFlag,
  );
  app.post(
    "/flags/expire",
    requireAuth,
    requireRole("1"),
    flagController.expireFlags,
  );
};
