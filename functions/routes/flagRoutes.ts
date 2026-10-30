import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {SERVICE_ROLE} from "../constants/status";
import * as flagController from "../controller/flagController";

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/flags",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createFlag}),
    flagController.createFlag,
  );
  app.post(
    "/flags/confirm",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.confirmFlag}),
    flagController.confirmFlag,
  );
  app.post(
    "/flags/deny",
    writeLimited,
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
    "/flags/get",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.getFlagById}),
    flagController.getById,
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
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.moderateFlag}),
    flagController.moderateFlag,
  );
  app.post(
    "/flags/unflag",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.unflagFlag}),
    flagController.unflagFlag,
  );
  app.post(
    "/flags/expire",
    writeLimited,
    requireAuth,
    requireRole("1"),
    flagController.expireFlags,
  );
};
