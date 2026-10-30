import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as providerController from "../controller/providerController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/providers",
    writeLimited,
    requireAuth,
    validate({body: schemas.createProvider}),
    providerController.createProvider,
  );
  app.put(
    "/providers",
    writeLimited,
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
    "/providers/search",
    requireAuth,
    validate({body: schemas.searchProviders}),
    providerController.searchProviders,
  );
  app.post(
    "/providers/ratings",
    requireAuth,
    validate({body: schemas.providerRatings}),
    providerController.providerRatings,
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
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.reviewProvider}),
    providerController.reviewProvider,
  );
  app.post(
    "/providers/revoke",
    writeLimited,
    requireAuth,
    validate({body: schemas.revokeProvider}),
    providerController.revokeProvider,
  );
  app.post(
    "/providers/report",
    writeLimited,
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
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.dismissReport}),
    providerController.dismissReport,
  );
  app.post(
    "/providers/suspend",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.suspendProvider}),
    providerController.suspendProvider,
  );
  app.post(
    "/providers/restore",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.restoreProvider}),
    providerController.restoreProvider,
  );
  app.post(
    "/providers/location",
    writeLimited,
    requireAuth,
    validate({body: schemas.updateProviderLocation}),
    providerController.updateProviderLocation,
  );
};
