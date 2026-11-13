import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {ROLE_ADMIN} from "../constants/roles";
import * as adminController from "../controller/adminController";
import * as adminTicketController from "../controller/adminTicketController";
import * as adminSearchController from "../controller/adminSearchController";
import * as payoutController from "../controller/payoutController";
import * as refundController from "../controller/refundController";
import * as warrantyController from "../controller/warrantyController";

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
  app.post(
    "/admin/payouts/requests",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminPayoutRequests}),
    payoutController.requests,
  );
  app.post(
    "/admin/payouts/requests/decide",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminPayoutRequestDecide}),
    payoutController.decideRequest,
  );
  app.post(
    "/admin/payouts/commission",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminCommissionSettle}),
    payoutController.settleCommission,
  );
  app.post(
    "/admin/refunds",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminRefunds}),
    refundController.list,
  );
  app.post(
    "/admin/refunds/decide",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminRefundDecide}),
    refundController.decide,
  );
  app.post(
    "/admin/refunds/send",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminRefundSend}),
    refundController.send,
  );
  app.post(
    "/admin/refunds/confirm",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminRefundConfirm}),
    refundController.confirm,
  );
  app.post(
    "/admin/refunds/fail",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminRefundFail}),
    refundController.fail,
  );
  app.post(
    "/admin/warranty/claims",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminWarrantyClaims}),
    warrantyController.list,
  );
  app.post(
    "/admin/warranty/resolve",
    writeLimited,
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminWarrantyResolve}),
    warrantyController.resolve,
  );
  app.post(
    "/admin/ops",
    requireAuth,
    requireRole(ROLE_ADMIN),
    adminController.ops,
  );
  app.post(
    "/admin/audit",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminAudit}),
    adminController.audit,
  );
  app.post(
    "/admin/search",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminSearch}),
    adminSearchController.search,
  );
  app.post(
    "/admin/tickets",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminTickets}),
    adminTicketController.list,
  );
  app.post(
    "/admin/dashboard",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminDashboard}),
    adminController.dashboard,
  );
  app.post(
    "/admin/providers/stats",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.providerStats}),
    adminController.providerStats,
  );
};
