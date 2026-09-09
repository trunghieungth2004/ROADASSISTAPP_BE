import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as diagnosticController from "../controller/diagnosticController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/diagnostics",
    requireAuth,
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
