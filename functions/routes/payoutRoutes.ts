import {Express} from "express";
import {RouteDeps} from "../types/routes";
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
};
