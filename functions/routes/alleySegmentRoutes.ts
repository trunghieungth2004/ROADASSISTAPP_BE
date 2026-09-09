import {Express} from "express";
import * as alleySegmentController from "../controller/alleySegmentController";

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
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/alleys/segment",
    requireAuth,
    validate({body: schemas.getAlleySegment}),
    alleySegmentController.getSegment,
  );
  app.post(
    "/alleys/near",
    requireAuth,
    validate({body: schemas.searchAlleysNear}),
    alleySegmentController.searchNear,
  );
  app.post(
    "/alleys",
    requireAuth,
    validate({body: schemas.createAlleySegment}),
    alleySegmentController.createSegment,
  );
  app.put(
    "/alleys/passability",
    requireAuth,
    validate({body: schemas.setPassability}),
    alleySegmentController.setPassability,
  );
  app.put(
    "/alleys/moderate",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.moderateSegment}),
    alleySegmentController.moderateSegment,
  );
};
