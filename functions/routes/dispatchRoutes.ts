import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {SERVICE_ROLE} from "../constants/status";
import * as dispatchController from "../controller/dispatchController";
import {requireDeliverIdentity} from "../middleware/deliverAuth";

const mountDispatchDeliver = (
  app: Express,
  {validate, schemas}: RouteDeps,
) => {
  app.post(
    "/dispatch/deliver",
    requireDeliverIdentity,
    validate({body: schemas.deliverDispatch}),
    dispatchController.deliverDispatch,
  );
};

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/dispatch",
    writeLimited,
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
    writeLimited,
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
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.selectDispatch}),
    dispatchController.selectDispatch,
  );
  app.post(
    "/dispatch/accept",
    writeLimited,
    requireAuth,
    validate({body: schemas.acceptDispatch}),
    dispatchController.acceptDispatch,
  );
  app.post(
    "/dispatch/decline",
    writeLimited,
    requireAuth,
    validate({body: schemas.declineDispatch}),
    dispatchController.declineDispatch,
  );
  app.post(
    "/dispatch/work",
    writeLimited,
    requireAuth,
    validate({body: schemas.updateWorkOrder}),
    dispatchController.updateWorkOrder,
  );
  app.post(
    "/dispatch/quote",
    writeLimited,
    requireAuth,
    validate({body: schemas.sendQuote}),
    dispatchController.sendQuote,
  );
  app.post(
    "/dispatch/quote/approve",
    writeLimited,
    requireAuth,
    validate({body: schemas.approveQuote}),
    dispatchController.approveQuote,
  );
  app.post(
    "/dispatch/estimate",
    writeLimited,
    requireAuth,
    validate({body: schemas.sendEstimate}),
    dispatchController.sendEstimate,
  );
  app.post(
    "/dispatch/estimate/approve",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.approveEstimate}),
    dispatchController.approveEstimate,
  );
  app.post(
    "/dispatch/estimate/decline",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.declineEstimate}),
    dispatchController.declineEstimate,
  );
  app.post(
    "/dispatch/mobile-shop/fix",
    writeLimited,
    requireAuth,
    validate({body: schemas.setMobileShopFix}),
    dispatchController.setMobileShopFix,
  );
  app.post(
    "/dispatch/mobile-shop/tow-offer",
    writeLimited,
    requireAuth,
    validate({body: schemas.mobileShopTowOffer}),
    dispatchController.offerMobileShopTow,
  );
  app.post(
    "/dispatch/mobile-shop/tow-offer/respond",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.respondMobileShopTow}),
    dispatchController.respondMobileShopTow,
  );
  app.post(
    "/dispatch/sos/continue",
    writeLimited,
    requireAuth,
    validate({body: schemas.continueSos}),
    dispatchController.continueSos,
  );
  app.post(
    "/dispatch/walk-in/return-tow",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.respondReturnTow}),
    dispatchController.respondReturnTow,
  );
  app.post(
    "/dispatch/unfixable",
    writeLimited,
    requireAuth,
    validate({body: schemas.markUnfixable}),
    dispatchController.markUnfixable,
  );
  app.post(
    "/dispatch/destination/decline",
    writeLimited,
    requireAuth,
    validate({body: schemas.declineDestination}),
    dispatchController.declineDestination,
  );
  app.post(
    "/dispatch/tower/cancel",
    writeLimited,
    requireAuth,
    validate({body: schemas.cancelTowerSearch}),
    dispatchController.cancelTowerSearch,
  );
  app.post(
    "/dispatch/waiting",
    requireAuth,
    validate({body: schemas.waitingStatus}),
    dispatchController.waitingStatus,
  );
  app.post(
    "/dispatch/eta/refresh",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.refreshTowEta}),
    dispatchController.refreshTowEta,
  );
  app.post(
    "/dispatch/fare/estimate",
    requireAuth,
    validate({body: schemas.estimateTowFare}),
    dispatchController.estimateTowFare,
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
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.updateDispatchDestination}),
    dispatchController.updateDispatchDestination,
  );
};

export {mountDispatchDeliver};
