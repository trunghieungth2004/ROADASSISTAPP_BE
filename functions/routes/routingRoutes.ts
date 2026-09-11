import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as routingController from "../controller/routingController";
import * as savedRouteController from "../controller/savedRouteController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/routes",
    requireAuth,
    validate({body: schemas.getRoute}),
    routingController.getRoute,
  );
  app.post(
    "/routes/save",
    requireAuth,
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
    validate({body: schemas.renameSavedRoute}),
    savedRouteController.renameRoute,
  );
  app.post(
    "/routes/unsave",
    requireAuth,
    validate({body: schemas.deleteSavedRoute}),
    savedRouteController.deleteRoute,
  );
};
