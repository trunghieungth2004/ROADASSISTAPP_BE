import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {ROLE_ADMIN} from "../constants/roles";
import * as adminController from "../controller/adminController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/admin/config",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminConfigGet}),
    adminController.getConfig,
  );
  app.put(
    "/admin/config",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminConfigUpdate}),
    adminController.updateConfig,
  );
  app.post(
    "/admin/payouts",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminPayout}),
    adminController.payout,
  );
};
