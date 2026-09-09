import {Express} from "express";
import * as landmarkController from "../controller/landmarkController";

interface RouteDeps {
  requireAuth: (req: any, res: any, next: any) => void;
  requireRole: (
    role: string | string[],
  ) => (req: any, res: any, next: any) => void;
  validate: (schema: any) => (req: any, res: any, next: any) => void;
  schemas: Record<string, unknown>;
}

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/landmarks/near",
    requireAuth,
    validate({body: schemas.nearLandmarks}),
    landmarkController.nearLandmarks,
  );
  app.post(
    "/landmarks",
    requireAuth,
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
