import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as dispatchController from "../controller/dispatchController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/dispatch",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createDispatch}),
    dispatchController.createDispatch,
  );
  app.post(
    "/dispatch/mine",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.getMyTickets}),
    dispatchController.getMyTickets,
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
    requireService(SERVICE_ROLE.VOLUNTEER, SERVICE_ROLE.SHOP),
    validate({body: schemas.nearDispatch}),
    dispatchController.nearDispatch,
  );
  app.post(
    "/dispatch/offers",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.dispatchOffers}),
    dispatchController.dispatchOffers,
  );
  app.post(
    "/dispatch/select",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
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
    "/dispatch/destination",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.updateDispatchDestination}),
    dispatchController.updateDispatchDestination,
  );
  app.post(
    "/dispatch/deliver",
    validate({body: schemas.deliverDispatch}),
    dispatchController.deliverDispatch,
  );
};
