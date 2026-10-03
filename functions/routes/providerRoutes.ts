import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as providerController from "../controller/providerController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/providers",
    requireAuth,
    validate({body: schemas.createProvider}),
    providerController.createProvider,
  );
  app.put(
    "/providers",
    requireAuth,
    validate({body: schemas.updateProvider}),
    providerController.updateProvider,
  );
  app.post(
    "/providers/near",
    requireAuth,
    validate({body: schemas.nearProviders}),
    providerController.nearProviders,
  );
  app.post(
    "/providers/mine",
    requireAuth,
    validate({body: schemas.myProviders}),
    providerController.myProviders,
  );
  app.post(
    "/providers/pending",
    requireAuth,
    requireRole("1"),
    providerController.listPending,
  );
  app.post(
    "/providers/review",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.reviewProvider}),
    providerController.reviewProvider,
  );
  app.post(
    "/providers/report",
    requireAuth,
    validate({body: schemas.reportProvider}),
    providerController.reportProvider,
  );
  app.post(
    "/providers/reports",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.listReports}),
    providerController.listReports,
  );
  app.post(
    "/providers/reports/dismiss",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.dismissReport}),
    providerController.dismissReport,
  );
  app.post(
    "/providers/suspend",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.suspendProvider}),
    providerController.suspendProvider,
  );
  app.post(
    "/providers/restore",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.restoreProvider}),
    providerController.restoreProvider,
  );
  app.post(
    "/providers/location",
    requireAuth,
    validate({body: schemas.updateProviderLocation}),
    providerController.updateProviderLocation,
  );
};
