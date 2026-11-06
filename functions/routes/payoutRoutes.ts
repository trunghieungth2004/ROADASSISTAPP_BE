import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as payoutController from "../controller/payoutController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/payouts/mine",
    requireAuth,
    validate({body: schemas.payoutMine}),
    payoutController.mine,
  );
  app.post(
    "/payouts/statement",
    requireAuth,
    validate({body: schemas.payoutStatement}),
    payoutController.statement,
  );
  app.post(
    "/payouts/banks",
    requireAuth,
    validate({body: schemas.payoutBanks}),
    payoutController.banks,
  );
  app.post(
    "/payouts/account",
    requireAuth,
    validate({body: schemas.payoutAccountGet}),
    payoutController.getAccount,
  );
  app.put(
    "/payouts/account",
    writeLimited,
    requireAuth,
    validate({body: schemas.payoutAccountSet}),
    payoutController.setAccount,
  );
  app.post(
    "/payouts/request",
    writeLimited,
    requireAuth,
    validate({body: schemas.payoutRequest}),
    payoutController.request,
  );
};
