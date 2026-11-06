import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as supportController from "../controller/supportController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/support",
    writeLimited,
    requireAuth,
    validate({body: schemas.supportCreate}),
    supportController.create,
  );
  app.post(
    "/support/mine",
    requireAuth,
    validate({body: schemas.supportMine}),
    supportController.mine,
  );
  app.post(
    "/admin/support",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.supportAdminList}),
    supportController.adminList,
  );
  app.post(
    "/admin/support/respond",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.supportRespond}),
    supportController.respond,
  );
};
