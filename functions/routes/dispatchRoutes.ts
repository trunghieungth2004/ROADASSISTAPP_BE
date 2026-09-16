import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as dispatchController from "../controller/dispatchController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/dispatch",
    requireAuth,
    validate({body: schemas.createDispatch}),
    dispatchController.createDispatch,
  );
  app.post(
    "/dispatch/one",
    requireAuth,
    validate({body: schemas.getDispatch}),
    dispatchController.getDispatch,
  );
  app.put(
    "/dispatch/status",
    requireAuth,
    validate({body: schemas.updateDispatchStatus}),
    dispatchController.updateDispatchStatus,
  );
  app.post(
    "/dispatch/near",
    requireAuth,
    validate({body: schemas.nearDispatch}),
    dispatchController.nearDispatch,
  );
  app.post(
    "/dispatch/offers",
    requireAuth,
    validate({body: schemas.dispatchOffers}),
    dispatchController.dispatchOffers,
  );
  app.post(
    "/dispatch/select",
    requireAuth,
    validate({body: schemas.selectDispatch}),
    dispatchController.selectDispatch,
  );
  app.post(
    "/dispatch/accept",
    requireAuth,
    validate({body: schemas.acceptDispatch}),
    dispatchController.acceptDispatch,
  );
  app.post(
    "/dispatch/deliver",
    validate({body: schemas.deliverDispatch}),
    dispatchController.deliverDispatch,
  );
};
