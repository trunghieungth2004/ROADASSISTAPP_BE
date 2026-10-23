import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import {ROLE_ADMIN} from "../constants/roles";
import * as paymentController from "../controller/paymentController";
import paymentWriteLimiter from "../middleware/paymentRateLimit";

const mountPaymentIpn = (app: Express) => {
  app.post("/payments/ipn", paymentController.ipn);
};

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/payments/create",
    requireAuth,
    paymentWriteLimiter,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createPayment}),
    paymentController.createPayment,
  );
  app.post(
    "/payments/confirm-cash",
    requireAuth,
    paymentWriteLimiter,
    validate({body: schemas.confirmCash}),
    paymentController.confirmCash,
  );
  app.post(
    "/payments/one",
    requireAuth,
    validate({body: schemas.paymentOne}),
    paymentController.getOne,
  );
  app.post(
    "/payments/all",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.paymentsAll}),
    paymentController.listAll,
  );
};

export {mountPaymentIpn};
