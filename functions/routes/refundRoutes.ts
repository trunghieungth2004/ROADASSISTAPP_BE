import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as refundController from "../controller/refundController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/refunds/request",
    writeLimited,
    requireAuth,
    validate({body: schemas.refundRequest}),
    refundController.request,
  );
  app.post(
    "/refunds/mine",
    requireAuth,
    validate({body: schemas.refundMine}),
    refundController.mine,
  );
};
