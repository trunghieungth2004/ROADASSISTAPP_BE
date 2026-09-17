import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as diagnosticController from "../controller/diagnosticController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/diagnostics",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createDiagnostic}),
    diagnosticController.createDiagnostic,
  );
  app.post(
    "/diagnostics/one",
    requireAuth,
    validate({body: schemas.getDiagnostic}),
    diagnosticController.getDiagnostic,
  );
};
