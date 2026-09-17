import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as pushController from "../controller/pushController";

const mountPushDeliver = (app: Express, {validate, schemas}: RouteDeps) => {
  app.post(
    "/push/deliver",
    validate({body: schemas.deliverPush}),
    pushController.deliver,
  );
};

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/push/register",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.registerPush}),
    pushController.register,
  );
  app.post(
    "/push/unregister",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.unregisterPush}),
    pushController.unregister,
  );
};

export {mountPushDeliver};
