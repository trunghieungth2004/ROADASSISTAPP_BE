import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as pushController from "../controller/pushController";
import {requireDeliverSecret} from "../middleware/deliverAuth";

const mountPushDeliver = (app: Express, {validate, schemas}: RouteDeps) => {
  app.post(
    "/push/deliver",
    requireDeliverSecret,
    validate({body: schemas.deliverPush}),
    pushController.deliver,
  );
};

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/push/register",
    requireAuth,
    validate({body: schemas.registerPush}),
    pushController.register,
  );
  app.post(
    "/push/unregister",
    requireAuth,
    validate({body: schemas.unregisterPush}),
    pushController.unregister,
  );
};

export {mountPushDeliver};
