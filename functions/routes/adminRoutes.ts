import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {ROLE_ADMIN} from "../constants/roles";
import * as adminController from "../controller/adminController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/admin/config",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminConfigGet}),
    adminController.getConfig,
  );
  app.put(
    "/admin/config",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminConfigUpdate}),
    adminController.updateConfig,
  );
  app.post(
    "/admin/payouts",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminPayout}),
    adminController.payout,
  );
  app.post(
    "/admin/payouts/pending",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.payoutsPending}),
    adminController.pendingPayouts,
  );
  app.post(
    "/admin/payouts/batch",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.payoutsSettle}),
    adminController.settlePayoutBatch,
  );
  app.post(
    "/admin/payouts/batches",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.payoutsBatches}),
    adminController.listPayoutBatches,
  );
  app.post(
    "/admin/payments/audit",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.paymentsAudit}),
    adminController.auditPayments,
  );
  app.post(
    "/admin/reports/revenue",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.reportRange}),
    adminController.revenueReport,
  );
  app.post(
    "/admin/reports/payees",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.reportRange}),
    adminController.payeeReport,
  );
};
