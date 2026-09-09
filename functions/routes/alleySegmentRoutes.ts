import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as alleySegmentController from "../controller/alleySegmentController";

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
