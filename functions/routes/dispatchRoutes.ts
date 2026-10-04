import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as dispatchController from "../controller/dispatchController";
import {requireDeliverSecret} from "../middleware/deliverAuth";

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
    "/dispatch/decline",
    requireAuth,
    validate({body: schemas.declineDispatch}),
    dispatchController.declineDispatch,
  );
  app.post(
    "/dispatch/work",
    requireAuth,
    validate({body: schemas.updateWorkOrder}),
    dispatchController.updateWorkOrder,
  );
  app.post(
    "/dispatch/shop/requests",
    requireAuth,
    validate({body: schemas.shopTickets}),
    dispatchController.shopRequests,
  );
  app.post(
    "/dispatch/shop/records",
    requireAuth,
    validate({body: schemas.shopTickets}),
    dispatchController.shopRecords,
  );
  app.post(
    "/dispatch/feed",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.feedTickets}),
    dispatchController.feedTickets,
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
    requireDeliverSecret,
    validate({body: schemas.deliverDispatch}),
    dispatchController.deliverDispatch,
  );
};
