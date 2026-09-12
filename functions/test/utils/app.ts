import express, {Express, NextFunction, Request, Response} from "express";
import {RouteDeps} from "../../types/routes";
import {validate} from "../../middleware/validate";
import {schemas} from "../../validation/schemas";
import {handleServiceError} from "../../utils/response";
import {
  stubRequireAuth,
  stubRequireRole,
  integrationRequireAuth,
  integrationRequireRole,
} from "./stubs";
import userRoutes from "../../routes/userRoutes";
import roleRoutes from "../../routes/roleRoutes";
import statusRoutes from "../../routes/statusRoutes";
import vehicleProfileRoutes from "../../routes/vehicleProfileRoutes";
import alleySegmentRoutes from "../../routes/alleySegmentRoutes";
import flagRoutes from "../../routes/flagRoutes";
import landmarkRoutes from "../../routes/landmarkRoutes";
import placesRoutes from "../../routes/placesRoutes";
import savedPlaceRoutes from "../../routes/savedPlaceRoutes";
import routingRoutes from "../../routes/routingRoutes";
import shopRoutes from "../../routes/shopRoutes";
import diagnosticRoutes from "../../routes/diagnosticRoutes";
import dispatchRoutes from "../../routes/dispatchRoutes";
import pushRoutes, {mountPushDeliver} from "../../routes/pushRoutes";

const registerRoutes = (app: Express, deps: RouteDeps): void => {
  mountPushDeliver(app, deps);
  userRoutes(app, deps);
  roleRoutes(app, deps);
  statusRoutes(app, deps);
  vehicleProfileRoutes(app, deps);
  alleySegmentRoutes(app, deps);
  flagRoutes(app, deps);
  landmarkRoutes(app, deps);
  placesRoutes(app, deps);
  savedPlaceRoutes(app, deps);
  routingRoutes(app, deps);
  shopRoutes(app, deps);
  diagnosticRoutes(app, deps);
  dispatchRoutes(app, deps);
  pushRoutes(app, deps);
};

const buildApp = (deps: RouteDeps): Express => {
  const app = express();
  app.use(express.json());
  registerRoutes(app, deps);
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    handleServiceError(res, err);
  });
  return app;
};

const buildUnitApp = (): Express =>
  buildApp({
    requireAuth: stubRequireAuth,
    requireRole: stubRequireRole,
    validate,
    schemas,
  });

const buildIntegrationApp = (): Express =>
  buildApp({
    requireAuth: integrationRequireAuth,
    requireRole: integrationRequireRole,
    validate,
    schemas,
  });

export {buildUnitApp, buildIntegrationApp};
