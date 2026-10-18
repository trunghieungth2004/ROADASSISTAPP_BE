import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {ROLE_ADMIN} from "../constants/roles";
import * as disputeController from "../controller/disputeController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/disputes",
    requireAuth,
    validate({body: schemas.fileDispute}),
    disputeController.file,
  );
  app.post(
    "/disputes/one",
    requireAuth,
    validate({body: schemas.disputeOne}),
    disputeController.one,
  );
  app.post(
    "/disputes/all",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.disputesAll}),
    disputeController.listAll,
  );
  app.post(
    "/disputes/resolve",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.resolveDispute}),
    disputeController.resolve,
  );
};
