import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as pushController from "../controller/pushController";
import {requireDeliverIdentity} from "../middleware/deliverAuth";

const mountPushDeliver = (app: Express, {validate, schemas}: RouteDeps) => {
  app.post(
    "/push/deliver",
    requireDeliverIdentity,
    validate({body: schemas.deliverPush}),
    pushController.deliver,
  );
};

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/push/register",
    writeLimited,
    requireAuth,
    validate({body: schemas.registerPush}),
    pushController.register,
  );
  app.post(
    "/push/unregister",
    writeLimited,
    requireAuth,
    validate({body: schemas.unregisterPush}),
    pushController.unregister,
  );
  app.post(
    "/push/ping",
    writeLimited,
    requireAuth,
    validate({body: schemas.pingPush}),
    pushController.ping,
  );
  app.post(
    "/admin/push/register",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.adminRegisterPush}),
    pushController.adminRegister,
  );
  app.post(
    "/admin/push/unregister",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.adminUnregisterPush}),
    pushController.adminUnregister,
  );
};

export {mountPushDeliver};
