import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {ROLE_ADMIN} from "../constants/roles";
import * as reportController from "../controller/reportController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/reports",
    writeLimited,
    requireAuth,
    validate({body: schemas.reportFile}),
    reportController.file,
  );
  app.post(
    "/reports/mine",
    requireAuth,
    validate({body: schemas.reportMine}),
    reportController.mine,
  );
  app.post(
    "/admin/reports",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminReports}),
    reportController.adminList,
  );
  app.post(
    "/admin/reports/decide",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminReportDecide}),
    reportController.decide,
  );
  app.post(
    "/admin/reports/restriction/clear",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.reportRestrictionClear}),
    reportController.clearRestriction,
  );
  app.post(
    "/admin/users/standing",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.userStanding}),
    reportController.standing,
  );
  app.post(
    "/admin/users/standing/reset",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.userStandingReset}),
    reportController.resetStanding,
  );
};
