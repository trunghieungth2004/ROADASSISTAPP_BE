import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {SERVICE_ROLE} from "../constants/status";
import * as landmarkController from "../controller/landmarkController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/landmarks/near",
    requireAuth,
    validate({body: schemas.nearLandmarks}),
    landmarkController.nearLandmarks,
  );
  app.post(
    "/landmarks",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createLandmark}),
    landmarkController.createLandmark,
  );
  app.post(
    "/landmarks/match",
    requireAuth,
    validate({body: schemas.matchLandmark}),
    landmarkController.matchNearby,
  );
};
