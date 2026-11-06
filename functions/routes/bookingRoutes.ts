import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as bookingController from "../controller/bookingController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/bookings/availability",
    requireAuth,
    validate({body: schemas.bookingAvailability}),
    bookingController.availability,
  );
  app.post(
    "/bookings/config",
    requireAuth,
    bookingController.config,
  );
  app.post(
    "/bookings",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingCreate}),
    bookingController.create,
  );
  app.post(
    "/bookings/tow",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingDepositRequest}),
    bookingController.createTow,
  );
  app.post(
    "/bookings/update",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingUpdate}),
    bookingController.updatePlan,
  );
  app.post(
    "/bookings/respond",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingRespond}),
    bookingController.respond,
  );
  app.post(
    "/bookings/cancel",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingCancel}),
    bookingController.cancel,
  );
  app.post(
    "/bookings/arrive",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingArrive}),
    bookingController.arrive,
  );
  app.post(
    "/bookings/deposit/checkout",
    requireAuth,
    validate({body: schemas.bookingDepositRequest}),
    bookingController.depositCheckout,
  );
  app.post(
    "/bookings/deposit/request",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingDepositRequest}),
    bookingController.requestDeposit,
  );
  app.post(
    "/bookings/deposit",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingDeposit}),
    bookingController.deposit,
  );
  app.post(
    "/bookings/complete",
    writeLimited,
    requireAuth,
    validate({body: schemas.bookingArrive}),
    bookingController.complete,
  );
  app.post(
    "/bookings/mine",
    requireAuth,
    validate({body: schemas.bookingMine}),
    bookingController.mine,
  );
  app.post(
    "/bookings/shop",
    requireAuth,
    validate({body: schemas.bookingShop}),
    bookingController.shop,
  );
};
