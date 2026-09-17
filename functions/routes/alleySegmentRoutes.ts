import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as alleySegmentController from "../controller/alleySegmentController";

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
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
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createAlleySegment}),
    alleySegmentController.createSegment,
  );
  app.put(
    "/alleys/passability",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
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
