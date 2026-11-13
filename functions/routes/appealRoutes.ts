import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {ROLE_ADMIN} from "../constants/roles";
import * as appealController from "../controller/appealController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/appeals",
    writeLimited,
    requireAuth,
    validate({body: schemas.fileAppeal}),
    appealController.file,
  );
  app.post(
    "/appeals/eligible",
    requireAuth,
    validate({body: schemas.eligibleAppeals}),
    appealController.eligible,
  );
  app.post(
    "/admin/appeals",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminAppeals}),
    appealController.adminList,
  );
  app.post(
    "/admin/appeals/decide",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.decideAppeal}),
    appealController.decide,
  );
};
