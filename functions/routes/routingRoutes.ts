import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as routingController from "../controller/routingController";
import * as savedRouteController from "../controller/savedRouteController";

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/routes",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.getRoute}),
    routingController.getRoute,
  );
  app.post(
    "/routes/sweep",
    requireAuth,
    requireRole("1"),
    routingController.sweepRoutes,
  );
  app.post(
    "/routes/save",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.saveRoute}),
    savedRouteController.saveRoute,
  );
  app.post(
    "/routes/saved",
    requireAuth,
    validate({body: schemas.listSavedRoutes}),
    savedRouteController.listRoutes,
  );
  app.post(
    "/routes/saved/one",
    requireAuth,
    validate({body: schemas.getSavedRoute}),
    savedRouteController.getRoute,
  );
  app.put(
    "/routes/saved",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.renameSavedRoute}),
    savedRouteController.renameRoute,
  );
  app.post(
    "/routes/unsave",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.deleteSavedRoute}),
    savedRouteController.deleteRoute,
  );
};
